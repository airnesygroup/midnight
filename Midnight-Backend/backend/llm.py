"""
Groq access with automatic key rotation.

  * Any number of keys. The current key is used until it fails, then the next. With 2+ keys one is kept
    back for the Midnight Report (see KeyPool).
  * A key that is rate-limited / out of credit is put on cooldown (until the
    server's Retry-After, or 1 min if not given; 15 min if the error mentions
    quota/credit) and skipped. No cooldown is ever longer than 15 minutes.
  * A key that is rejected (401/403) is disabled until restart.
  * When EVERY key is unavailable, AllKeysExhausted is raised. The pipeline
    then pauses (at most 15 minutes), clears the cooldowns, and tries again from
    the first key. It never keeps hammering the API.
  * chat() returns the text AND the finish_reason, so callers can refuse
    answers that were cut off.
"""

import functools
import re
import threading
import time

import config

DEFAULT_COOLDOWN = 60          # rate limited, server gave no Retry-After: a per-minute limit clears fast
QUOTA_COOLDOWN = 900            # 15 minutes
MAX_COOLDOWN = 900             # never wait longer than 15 minutes on one key (config.max_wait_seconds)
SHORT_WAIT = 120               # every key is cooling down but one is ready within this many seconds: just wait

# Only these mean the account is really out of money/credit. NOT "billing" or "credit" on their own:
# Groq's ordinary per-minute rate-limit message ends with an "upgrade ... /settings/billing" link, and
# treating that as "out of credit" put every key to sleep (and the pipeline to sleep for 2 hours)
# over a limit that clears in seconds.
OUT_OF_CREDIT = ("insufficient", "out of credit", "credit balance", "exceeded your current quota", "payment required")


class AllKeysExhausted(Exception):
    def __init__(self, next_ready_at=None):
        self.next_ready_at = next_ready_at
        super().__init__("every Groq API key is out of credit / rate-limited")


class NoValidKeys(Exception):
    pass


class LLMError(Exception):
    """A failure of this one request (not the key): bad request, repeated
    network trouble, etc."""


class ChatResult:
    def __init__(self, text, finish_reason):
        self.text, self.finish_reason = text, finish_reason


REBALANCE_SECONDS = 15 * 60        # the reserved key is checked this often (is it still usable?)
RESERVE_HOLD_SECONDS = 10 * 3600   # ...and only re-picked for "most credit left" after this long
SWITCH_MARGIN = 0.8                # a challenger must have used under 80% of the reserved key's tokens to take over


def _locked(fn):
    """The article loop, the trends loop and the report thread share one pool: serialise changes to it."""
    @functools.wraps(fn)
    def wrapper(self, *a, **k):
        with self._lock:
            return fn(self, *a, **k)
    return wrapper


class KeyPool:
    """Keys are used in order. With 2 or more keys ONE key is reserved for the Midnight Report: news and
    trends never use it, so a report can always be written even when every other key is used up.

    The reserved key is the usable key with the most credit left. Groq does not expose a credit balance, so
    "most left" = fewest tokens used in the last 24 hours (measured from each response's usage). Handover
    is make-before-break: a new key is chosen only while it is usable, and it takes over in one step, so there
    is never a moment with no reserved key and a good key is never dropped for a worse one (a challenger must
    be clearly better, and the reserved key is kept at least RESERVE_HOLD_SECONDS unless it stops working)."""

    def __init__(self, keys, clock=time.time, on_event=None, reserve=True):
        if not keys:
            raise NoValidKeys("no Groq API keys configured")
        self.clock = clock
        self.on_event = on_event or (lambda *a, **k: None)
        self.keys = [{"key": k, "label": f"key {i + 1} (…{k[-4:]})", "status": "ok",
                      "until": 0.0, "error": None, "uses": 0, "usage": []} for i, k in enumerate(keys)]
        self._lock = threading.RLock()
        self.idx = 0
        self.reserve_enabled = reserve and len(keys) >= 2
        self.reserved = None            # index into self.keys
        self.reserved_since = 0.0
        self._last_check = -1e18

    # -- state ----------------------------------------------------------
    def _usable(self, k):
        if k["status"] == "invalid":
            return False
        if k["status"] == "cooldown" and self.clock() < k["until"]:
            return False
        if k["status"] == "cooldown":
            k["status"], k["until"], k["error"] = "ok", 0.0, None
        return True

    def tokens_24h(self, k):
        cut = self.clock() - 86400
        k["usage"] = [(t, n) for t, n in k["usage"] if t >= cut]
        return sum(n for _, n in k["usage"])

    @_locked
    def record_usage(self, k, tokens):
        if tokens:
            k["usage"].append((self.clock(), int(tokens)))

    # -- the key reserved for the report ---------------------------------
    @_locked
    def rebalance(self, force=False):
        """Make sure a usable key is reserved; occasionally move the reserve to the key with the most credit."""
        if not self.reserve_enabled:
            return
        now = self.clock()
        cur = self.keys[self.reserved] if self.reserved is not None else None
        cur_ok = cur is not None and self._usable(cur)
        if not force and cur_ok and now - self._last_check < REBALANCE_SECONDS:
            return
        self._last_check = now
        usable = [i for i, k in enumerate(self.keys) if self._usable(k)]
        if not usable:
            return                       # nothing better to hand over to: keep what we have
        # most credit left = fewest tokens used in 24h; ties go to the LAST key
        best = min(usable, key=lambda i: (self.tokens_24h(self.keys[i]), -i))
        if cur is None or not cur_ok:
            self._set_reserved(best, "no usable reserved key" if cur is not None else "first choice")
        elif best != self.reserved and now - self.reserved_since >= RESERVE_HOLD_SECONDS \
                and self.tokens_24h(self.keys[best]) < SWITCH_MARGIN * self.tokens_24h(cur):
            self._set_reserved(best, "more credit left")

    def _set_reserved(self, i, why):
        old = self.reserved
        self.reserved, self.reserved_since = i, self.clock()          # one assignment: no gap, old key is released
        if old != i:
            self.on_event("key_reserved", f"{self.keys[i]['label']} is now reserved for the Midnight Report ({why})",
                          key=self.keys[i]["label"])

    def reserved_label(self):
        return self.keys[self.reserved]["label"] if self.reserved is not None else None

    @_locked
    def acquire(self, purpose="work"):
        """purpose "report": the reserved key first, then any usable key. Anything else: every usable key EXCEPT
        the reserved one."""
        n = len(self.keys)
        self.rebalance()
        res = self.reserved if self.reserve_enabled else None
        if purpose == "report" and res is not None and self._usable(self.keys[res]):
            k = self.keys[res]
            k["uses"] += 1
            return k
        for i in range(n):
            j = (self.idx + i) % n
            k = self.keys[j]
            if purpose != "report" and j == res:
                continue
            if self._usable(k):
                if j != self.idx:
                    self.on_event("key_switch", f"Switched to {k['label']}", key=k["label"])
                self.idx = j
                k["uses"] += 1
                return k
        if all(k["status"] == "invalid" for k in self.keys):
            raise NoValidKeys("every Groq API key was rejected (invalid/revoked)")
        pool = [k for j, k in enumerate(self.keys) if purpose == "report" or j != res]
        waits = [k["until"] for k in pool if k["status"] == "cooldown"]
        raise AllKeysExhausted(min(waits) if waits else None)

    @_locked
    def cooldown(self, k, seconds, why):
        seconds = max(5.0, min(float(seconds), MAX_COOLDOWN, config.max_wait_seconds()))
        k["status"], k["until"], k["error"] = "cooldown", self.clock() + seconds, why[:160]
        shown = f"{int(seconds // 60)} min" if seconds >= 90 else f"{int(seconds)} s"
        self.on_event("key_cooldown", f"{k['label']} unavailable for {shown}: {why[:100]}",
                      key=k["label"], seconds=int(seconds), level="warn")
        if self.reserve_enabled and self.reserved is not None and self.keys[self.reserved] is k:
            self.rebalance(force=True)

    @_locked
    def invalidate(self, k, why):
        k["status"], k["error"] = "invalid", why[:160]
        self.on_event("key_invalid", f"{k['label']} rejected and disabled: {why[:100]}",
                      key=k["label"], level="error")
        if self.reserve_enabled and self.reserved is not None and self.keys[self.reserved] is k:
            self.rebalance(force=True)

    @_locked
    def reset_cooldowns(self):
        """After a pause: give every non-rejected key another try, starting at the first work key."""
        for k in self.keys:
            if k["status"] == "cooldown":
                k["status"], k["until"], k["error"] = "ok", 0.0, None
        self.idx = 0

    @_locked
    def snapshot(self):
        now = self.clock()
        return [{"label": k["label"], "status": k["status"], "uses": k["uses"], "error": k["error"],
                 "retryInSeconds": max(0, int(k["until"] - now)) if k["status"] == "cooldown" else 0,
                 "reserved": self.reserve_enabled and i == self.reserved, "tokens24h": self.tokens_24h(k)}
                for i, k in enumerate(self.keys)]


def _retry_after(exc):
    try:
        v = exc.response.headers.get("retry-after")
        if v:
            return float(v)
    except Exception:
        pass
    m = re.search(r"try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?", str(exc))
    if m and any(m.groups()):
        h, mi, s = (float(x) if x else 0 for x in m.groups())
        return h * 3600 + mi * 60 + s
    return None


_pool = None
_client_factory = None


def _default_factory(key):
    from groq import Groq
    return Groq(api_key=key, max_retries=0, timeout=90)


def get_pool():
    global _pool
    if _pool is None:
        _pool = KeyPool(config.get_groq_keys())
    return _pool


def set_pool(pool):
    global _pool
    _pool = pool


def set_client_factory(fn):
    global _client_factory
    _client_factory = fn


_reasoning_ok = True


def _reasoning_kwargs():
    """gpt-oss models spend max_tokens on hidden reasoning first; at the default effort a 1400-token
    article often ends with finish_reason='length' and the whole call is wasted. 'low' keeps the
    reasoning short. GROQ_REASONING_EFFORT=off disables it (also switched off automatically if the API
    rejects the parameter)."""
    effort = (config.env("GROQ_REASONING_EFFORT", "low") or "low").lower()
    if not _reasoning_ok or effort in ("off", "0", "none", "false") or "gpt-oss" not in config.get_groq_model():
        return {}
    return {"reasoning_effort": effort}


def chat(prompt, max_tokens, temperature=0.8, pool=None, sleep=time.sleep, purpose="work"):
    """One completion, rotating keys as needed. Raises AllKeysExhausted /
    NoValidKeys / LLMError. A short rate limit (seconds) is waited out, not treated as 'out of credit'.
    purpose="report" may use the key reserved for the Midnight Report; everything else may not."""
    global _reasoning_ok
    pool = pool or get_pool()
    factory = _client_factory or _default_factory
    transient = 0
    for _ in range(len(pool.keys) * 3 + 8):
        try:
            k = pool.acquire(purpose)
        except AllKeysExhausted as e:
            wait = (e.next_ready_at - pool.clock()) if e.next_ready_at else None
            if wait is not None and wait <= SHORT_WAIT:
                sleep(max(1.0, wait) + 0.5)
                continue
            raise
        try:
            resp = factory(k["key"]).chat.completions.create(
                model=config.get_groq_model(), messages=[{"role": "user", "content": prompt}],
                temperature=temperature, max_tokens=max_tokens, **_reasoning_kwargs())
            ch = resp.choices[0]
            try:
                pool.record_usage(k, getattr(getattr(resp, "usage", None), "total_tokens", 0) or 0)
            except Exception:  # noqa: BLE001 - usage is bookkeeping only
                pass
            return ChatResult((ch.message.content or "").strip(), getattr(ch, "finish_reason", None))
        except Exception as e:  # noqa: BLE001 - classified below
            status = getattr(e, "status_code", None)
            msg = str(e)
            low = msg.lower()
            if status in (401, 403):
                pool.invalidate(k, f"HTTP {status}")
            elif status == 429 or "rate limit" in low or "quota" in low:
                quota = any(w in low for w in OUT_OF_CREDIT)
                ra = _retry_after(e)
                why = "out of credit" if quota else ("rate limited: " + re.sub(r"\s+", " ", msg)[:90])
                pool.cooldown(k, ra if ra else (QUOTA_COOLDOWN if quota else DEFAULT_COOLDOWN), why)
            elif status == 400 and "reasoning" in low and _reasoning_ok:
                _reasoning_ok = False          # this model/API does not take reasoning_effort: carry on without it
            elif status in (400, 404, 413, 422):
                raise LLMError(f"request rejected (HTTP {status}): {msg[:200]}") from e
            else:  # connection errors, timeouts, 5xx: retry same key a couple of times
                transient += 1
                if transient > 3:
                    raise LLMError(f"{type(e).__name__}: {msg[:200]}") from e
                sleep(2 * transient)
    raise LLMError("gave up after repeated failures")
