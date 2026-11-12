"""
The live pipeline: ONE article per source, round-robin, pushed to MongoDB the
moment each one is written. Also writes the daily Midnight Report.

    python generate.py --count 50          # 50 articles, one from each source in turn
    python generate.py --forever           # keep cycling (this is what `run.py --live` uses)
    python generate.py --count 5 --dry-run # build + check, don't write

Rules enforced on every article before it is pushed
  * URL never seen before, and the STORY not already covered by any outlet.
  * A real hero image, downloaded and verified (images.py). No image = no article.
  * A COMPLETE article (quality.py): the model's reply must have finished
    normally and ended with ===END===, with title, excerpt, 3 summary points,
    a full body ending on a finished sentence. Half-written output is dropped.
  * FACT-CHECKED against the source (factcheck.py): numbers, quotes and names must appear in it, and a
    second model pass lists anything else it does not support. One corrective rewrite, then skipped.
  * Section(s) chosen by the writer model from the story's content (not from the feed it came from).
  * Validated against the Lovable article schema; source URL always stored.

Groq keys (llm.py): any number of keys; when one runs out the next is used.
When ALL are out, the pipeline pauses (KEY_PAUSE_HOURS, default 2), then
retries from key 1, and pauses again if they are still out.

Everything it does is also written to MongoDB (ingestEvents / systemState /
ingestLedger) for the dashboard.
"""

import argparse
import re
import time
from datetime import datetime, timedelta, timezone

import config
import factcheck
import llm
import realcheck
from config import check_key_or_exit
from sources import interleaved, site_of
from scraper import fetch_feed_entries, hydrate_entry
from rewriter import rewrite_article
import images as image_guard
from images import NoVerifiedImage
from quality import Incomplete, final_gate
from dedupe import SeenIndex, normalise_url
from schema import build_article, iso, now_iso, resolve_sections, SECTION_BY_SLUG
from storage import get_storage
from monitor import Monitor, NullMonitor
from control import Control, Watcher, NullWatcher
from report import ReportScheduler, ReportLoop
import headlines

FEED_TTL_SECONDS = 15 * 60
MIN_SOURCE_CHARS = 250
TRIES_PER_VISIT = 3
STOPWORDS = {"the", "a", "an", "and", "or", "for", "with", "this", "that", "its", "new",
             "how", "why", "what", "your", "you", "are", "will", "has", "from", "into", "over"}


class Skip(Exception):
    """Not an error: this article is deliberately not published."""


class DuplicateStory(Skip):
    pass


class ThinSource(Skip):
    pass


class NotNewsArticle(Skip):
    """The writer model confirmed the scraped material is not a real news article (a text blob): never retried."""


class FailedFactCheck(Skip):
    """The article still contained claims its source does not support after one corrective rewrite."""


def guess_hashtags(title, tag, max_tags=4):
    words = [w for w in re.findall(r"[A-Za-z']+", title) if len(w) > 3 and w.lower() not in STOPWORDS]
    tags = [f"#{w.capitalize()}" for w in words[:max_tags - 1]]
    tags.append("#" + re.sub(r"[^A-Za-z0-9]", "", tag))
    seen, out = set(), []
    for t in tags:
        if t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out


class Rotation:
    """Walks the sources in order, remembering each feed's remaining candidates.

    With a `store` (the MongoDB storage) nothing scraped is ever lost: every scraped entry is written to the ledger as
    'queued' the moment it is scraped, and whenever a feed is read again the entries still waiting (never written, or a
    retry whose time has come) are put back in its queue, even after a restart or after the story left the feed."""

    def __init__(self, sources, seen, fetch=fetch_feed_entries, store=None):
        self.sources, self.seen, self.fetch, self.store = sources, seen, fetch, store
        self.queues, self.fetched_at = {}, {}
        self.holds = {}                      # normalised url -> epoch seconds before which it must not be retried
        if store is not None:
            try:
                now = datetime.now(timezone.utc)
                for u, at in store.retry_holds().items():
                    self.holds[u] = time.time() + max(0.0, (datetime.fromisoformat(at.replace("Z", "+00:00")) - now).total_seconds())
            except Exception:  # noqa: BLE001 - never stop the loop over bookkeeping
                pass

    def hold_until(self, url, iso_time):
        try:
            secs = (datetime.fromisoformat(iso_time.replace("Z", "+00:00")) - datetime.now(timezone.utc)).total_seconds()
        except Exception:  # noqa: BLE001
            return
        self.holds[normalise_url(url)] = time.time() + max(0.0, secs)

    def _queue(self, name, url):
        age = time.monotonic() - self.fetched_at.get(url, -1e9)
        old = self.queues.get(url)
        actionable = bool(old) and any(self.holds.get(normalise_url(e["url"]), 0) <= time.time() for e in old)
        if old is None or (not actionable and age > FEED_TTL_SECONDS):
            fresh = list(self.fetch(name, url))
            have = {normalise_url(e["url"]) for e in fresh}
            queue = fresh + [e for e in (old or []) if normalise_url(e["url"]) not in have]     # waiting retries are kept
            if self.store is not None:
                try:
                    self.store.queue_entries(fresh, url)
                    owed = [e for e in self.store.due_entries(url) if normalise_url(e["url"]) not in {normalise_url(x["url"]) for x in queue}]
                    queue = owed + queue
                except Exception as e:  # noqa: BLE001
                    print(f"  ! queue bookkeeping for {name}: {type(e).__name__}: {str(e)[:80]}")
            self.queues[url] = queue
            self.fetched_at[url] = time.monotonic()
        return self.queues[url]

    def requeue(self, url, entry):
        self.queues.setdefault(url, []).insert(0, entry)

    def next_candidate(self, name, url):
        q = self._queue(name, url)
        skipped, deferred = [], []
        try:
            while q:
                e = q.pop(0)
                if self.seen.has_url(e["url"]):
                    continue
                if self.holds.get(normalise_url(e["url"]), 0) > time.time():
                    deferred.append(e)           # its retry time has not come: keep it, look at the next one
                    continue
                match = self.seen.match(e["title"])
                if match:
                    skipped.append((e, f"same story already covered: \"{match[0][:70]}\"", match[1]))
                    continue
                return e, skipped
            return None, skipped
        finally:
            q.extend(deferred)


def retry_note(res):
    """' (try 2 of 6, next in 30 min with a different approach)' / ' (given up after 6 tries)' / ''."""
    if not res:
        return ""
    cap = config.item_retry_settings()["max_attempts"]
    if res.get("retrying"):
        mins = ""
        try:
            secs = (datetime.fromisoformat(res["nextTryAt"].replace("Z", "+00:00")) - datetime.now(timezone.utc)).total_seconds()
            mins = f", next in {max(1, round(secs / 60))} min"
        except Exception:  # noqa: BLE001
            pass
        return f" (try {res.get('attempts', '?')} of {cap}{mins}, with a different approach)"
    if res.get("attempts"):
        return f" (given up after {res['attempts']} tries)"
    return ""


def process_entry(entry, section_slug, storage, seen, dry_run=False, monitor=None, rewrite=None, verify=None):
    """Hydrate (+verify image) -> rewrite (+completeness) -> fact-check -> final gate -> push.

    section_slug is only the FALLBACK (the feed's label). The writer model decides the real
    section(s) from the story's content; see schema.resolve_sections."""
    mon = monitor or NullMonitor()
    base_rewrite = rewrite or rewrite_article

    def rewrite(*a, **k):
        try:
            return base_rewrite(*a, **k)
        except realcheck.NotNews as n:
            raise NotNewsArticle(f"not a real news article (writer model): {n}") from n
    verify = verify or factcheck.verify
    mon.emit("fetching", f"Reading {entry['source']}: {entry['title'][:80]}", source=entry["source"])
    entry["attempt"] = 0                       # tries so far: every retry starts from a DIFFERENT approach (pagefetch.ladder)
    if not dry_run:
        image_guard.use_database(storage.db)   # lets the generic-image guard see what is already published
        try:
            entry["attempt"] = storage.attempts_for(entry["url"])
        except Exception:  # noqa: BLE001 - bookkeeping must never stop an article
            pass
    hydrate_entry(entry)                       # raises NoVerifiedImage
    text = entry.get("text", "")
    n_words, need = len(text.split()), config.source_settings()["min_words"]
    if len(text) < MIN_SOURCE_CHARS or n_words < need:
        tried = entry.get("_diag")
        raise ThinSource(f"source text too thin to write an honest article ({n_words} words of real text, need {need})"
                         + (f" | tried: {tried}" if tried else ""))
    mon.emit("image_ok", f"Image verified for {entry['source']}", img=entry["images"][0])
    mon.emit("writing", f"Writing: {entry['title'][:80]}", source=entry["source"])
    post = rewrite(entry)                      # raises Incomplete / llm errors

    problems = verify(entry, post)             # [] = every claim is supported by the source
    rounds = config.retry_settings()["factcheck_rounds"]
    history = []
    for n in range(1, rounds + 1):             # a failed fact-check is a small correction, not the end of the article
        if not problems:
            break
        history.append(problems)
        feedback = list(dict.fromkeys(p for h in history[-2:] for p in h))[:10]
        mon.emit("factcheck_retry", f"Fact-check failed, correction {n}/{rounds}: {entry['title'][:60]} — {problems[0][:100]}",
                 source=entry["source"], problems=problems[:6], round=n)
        post = rewrite(entry, feedback=feedback)
        problems = verify(entry, post)
    if problems:
        raise FailedFactCheck(f"failed fact-check after {rounds} corrections: " + "; ".join(problems[:3])[:300])

    slugs = resolve_sections(post.get("sections"), section_slug)
    primary = slugs[0]

    clash = seen.match(post["title"])
    if clash:
        if not dry_run:
            headlines.HeadlineBook(storage.db).record_coverage(clash[1], entry["source"])
        raise DuplicateStory(f"rewritten headline matches \"{clash[0][:70]}\"")

    published = entry.get("published_at")
    if config.scrape_settings()["published_at_mode"] == "own":
        published = None                       # PUBLISHED_AT_MODE=own: stamp with OUR publishing time (schema uses "now")
    article = build_article(
        title=post["title"], excerpt=post["excerpt"], summary=post["summary"],
        html_body=post["html_body"], section_slug=primary, section_slugs=slugs,
        hashtags=guess_hashtags(post["title"], SECTION_BY_SLUG[primary]["tags"][0]),
        img=post["img"], source_name=entry["source"], source_url=entry["url"],
        voice=post["voice"], published_at=iso(published) if published else None,
        headline_weight=headlines.compute_weight(post.get("importance"), primary))
    final_gate(article)
    if not dry_run:
        storage.publish_article(article)       # live push to MongoDB
        image_guard.record_use(entry.get("image_fp"), article["img"], entry["source"], article["id"])
        headlines.HeadlineBook(storage.db).record_article(
            article["id"], primary, entry["source"], post.get("importance"))
    return article


def run(count=50, forever=False, interval=300, dry_run=False, storage=None, sources=None,
        fetch=fetch_feed_entries, sleep=time.sleep, log=print, pause_seconds=None,
        reports=True, monitor=None, pool=None, rewrite=None, clock=None, control=None):
    """Returns the number of articles published."""
    if pool is None:
        check_key_or_exit()
    storage = storage or get_storage()
    sources = sources or interleaved()
    pause_seconds = config.key_pause_seconds() if pause_seconds is None else pause_seconds
    mon = monitor or (NullMonitor() if dry_run else Monitor(storage.db))
    pool = pool or llm.get_pool()
    llm.set_pool(pool)
    pool.on_event = lambda kind, msg, **d: mon.emit(kind, msg, **d)
    # Dashboard control (Pause / Go live). A dry run never listens to it.
    ctl = control or (NullWatcher() if dry_run else Watcher(Control(storage.db), "news"))
    retry = {"after_cooldown": False}   # True while the very next call is a retry after a credit cooldown

    def say(msg):
        log(msg)

    seen = SeenIndex()
    storage.load_seen(seen)
    say(f"{storage.load_sections()} sections loaded from the database.")
    n_sites = len({site_of(s[0]) for s in sources})
    say(f"Loaded {len(seen.urls)} covered URL(s) / {len(seen.headlines)} headline(s). "
        f"{len(sources)} feeds from {n_sites} sites. {len(pool.keys)} Groq key(s).")

    sched = report_loop = None
    if reports and not dry_run:
        sched = ReportScheduler(storage, mon, config.report_settings(), **({"clock": clock} if clock else {}))
        # The Midnight Report has its OWN thread: fixed 13:00 UTC edition, writing starts at 12:30 UTC; it wakes every
        # hour (sooner near the deadline), catches up any missed edition, and keeps trying until it is stored. Article pauses / key cool-downs / Pause button never hold it.
        report_loop = ReportLoop(sched)
        report_loop.start()

    state = {"published": 0, "failed": 0, "skipped": 0, "startedAt": now_iso()}

    def push_state(**extra):
        info = sched.next_info() if sched else {}
        fields = {"manualPause": False, **extra}
        mon.set_state(published=state["published"], failed=state["failed"], skipped=state["skipped"],
                      startedAt=state["startedAt"], keys=pool.snapshot(), sourcesTotal=len(sources),
                      sitesTotal=n_sites, **info, **fields)

    mon.emit("run_start", f"Pipeline started: {len(sources)} feeds, {n_sites} sites, {len(pool.keys)} key(s)")
    push_state(state="running", currentSource=None, pausedUntil=None, pauseReason=None)
    mon.start_heartbeat()      # keeps "online" true while one article takes minutes; progressAt still shows a hang

    def refresh_heroes():
        if dry_run:
            return
        try:
            headlines.refresh_headlines(storage)
        except Exception as e:  # noqa: BLE001 - ranking must never stop the articles
            mon.emit("failed", f"Headline ranking error: {type(e).__name__}: {str(e)[:120]}", level="error")

    def tick_reports():
        refresh_heroes()          # the report itself is written by the ReportLoop thread, not here

    def nap(seconds, **st):
        """Sleep in short slices so the heartbeat stays fresh, Ctrl+C works and the dashboard can
        interrupt. Returns "retry" (Go live pressed), "paused" (Pause pressed) or None (time is up)."""
        left, since_push = seconds, 15
        while left > 0:
            step = min(3, left)
            sleep(step)
            left -= step
            since_push += step
            if ctl.retry_requested():
                return "retry"
            if ctl.paused():
                return "paused"
            if since_push >= 15:
                push_state(**st)
                since_push = 0
        return None

    def hold():
        """Pause pressed on the dashboard: stand still (even with credit left) until Go live.
        The article being written when Pause was pressed has already been finished and pushed."""
        if not ctl.paused():
            return False
        msg = "Paused from the dashboard. Nothing new is started until you press Go live."
        say(f"  \u23f8 {msg}")
        mon.emit("paused", msg, level="warn", manual=True)
        while ctl.paused():
            push_state(state="paused", currentSource=None, pausedUntil=None,
                       pauseReason="Paused from the dashboard", manualPause=True)
            sleep(3)
        ctl.retry_requested()               # consume the Go live click
        pool.reset_cooldowns()              # Go live always means: try the keys again now
        retry["after_cooldown"] = True
        mon.emit("resumed", "Back live. Trying the keys again now.")
        push_state(state="running", pausedUntil=None, pauseReason=None)
        return True

    def pause(exc):
        """Every key is out of credit: cool down, but Go live ends the wait early and Pause turns it
        into a manual pause. Either way the keys are tried again afterwards; if they are still out of
        credit, AllKeysExhausted comes straight back here and a fresh cooldown starts."""
        hours = pause_seconds / 3600
        until = datetime.now(timezone.utc) + timedelta(seconds=pause_seconds)
        if retry["after_cooldown"]:
            msg = f"Retry failed: all {len(pool.keys)} Groq key(s) are still out of credit. Cooling down {hours:g}h again."
        else:
            msg = f"All {len(pool.keys)} Groq key(s) are out of credit. Pausing {hours:g}h, then retrying from key 1."
        say(f"  \u23f8 {msg}")
        mon.emit("paused", msg, level="warn", until=iso(until))
        woke = nap(pause_seconds, state="paused", pausedUntil=iso(until), pauseReason="all Groq keys out of credit")
        if woke == "paused":
            hold()                          # user pressed Pause during the cooldown: stay down until Go live
        pool.reset_cooldowns()
        retry["after_cooldown"] = True
        mon.emit("retry", "Go live pressed: trying the keys again now" if woke == "retry"
                 else "Cooldown over: trying the keys again")
        push_state(state="running", pausedUntil=None, pauseReason=None)

    def settle(entry, name, section, status, reason, retryable):
        """Record one skip/failure for good. A retryable one is kept (and held until its retry time); anything else
        (or one that ran out of tries) becomes covered, so it is never looked at again."""
        res = {"retrying": False, "attempts": 0, "nextTryAt": None}
        if not dry_run:
            res = storage.record(source_name=name, source_url=entry["url"], source_title=entry["title"], section=section,
                                 status=status, reason=reason, retryable=retryable, snippet=entry.get("text"))
        elif retryable:
            res["retrying"] = True
        if res["retrying"]:
            if res.get("nextTryAt"):
                rot.hold_until(entry["url"], res["nextTryAt"])
        else:
            seen.add(entry["url"], entry["title"])
        return res

    feed_by_source = {}
    for n_, u_, _s in sources:
        feed_by_source.setdefault(n_, u_)
    rescued_at = {"t": -1e9}

    def rescue_stuck():
        """'Will retry' rows that can never actually be retried (no snapshot / no due time) are repaired, so every
        story that is waiting for a retry really comes back. At start and then every 30 minutes."""
        if dry_run or time.monotonic() - rescued_at["t"] < 1800 or not hasattr(storage, "rescue_stuck"):
            return
        rescued_at["t"] = time.monotonic()
        try:
            n = storage.rescue_stuck(feed_by_source)
            if n:
                say(f"  \u21bb {n} story(ies) that were marked 'will retry' but could never come back are queued again.")
                mon.emit("retry", f"Re-queued {n} stuck 'will retry' stories", count=n)
        except Exception as e:  # noqa: BLE001
            mon.emit("failed", f"Stuck-story rescue error: {type(e).__name__}: {str(e)[:100]}", level="warn")

    hold()
    tick_reports()
    rescue_stuck()
    rot = Rotation(sources, seen, fetch, store=None if dry_run else storage)
    consecutive_failures = 0

    try:
        while True:
            made_this_pass = 0
            rescue_stuck()
            if not dry_run:
                storage.load_sections()      # sections added/removed on the site apply from this pass on
            for name, url, section in sources:
                if count and state["published"] >= count:
                    break
                push_state(state="running", currentSource=name)
                tries = 0
                while tries < TRIES_PER_VISIT:
                    hold()                       # Pause from the dashboard takes effect here, between articles
                    entry, skipped = rot.next_candidate(name, url)
                    for e, reason, ref in skipped:
                        state["skipped"] += 1
                        say(f"  ~ skip [{name}] {e['title'][:70]} — {reason}")
                        mon.emit("skipped", f"[{name}] {e['title'][:70]} — {reason}", source=name)
                        if not dry_run:
                            headlines.HeadlineBook(storage.db).record_coverage(ref, name)
                            storage.record(source_name=name, source_url=e["url"], source_title=e["title"],
                                           section=section, status="skipped", reason=reason)
                        seen.add(e["url"], e["title"])
                    if not entry:
                        break
                    try:
                        article = process_entry(entry, section, storage, seen, dry_run, mon, rewrite)
                    except llm.AllKeysExhausted as e:
                        rot.requeue(url, entry)      # keep it for after the pause
                        pause(e)
                        continue
                    except llm.NoValidKeys as e:
                        mon.emit("fatal", f"No usable Groq key: {e}", level="error")
                        push_state(state="stopped", pauseReason=str(e))
                        say(f"Stopping: {e}")
                        return state["published"]
                    except Skip as e:
                        tries += 1
                        # a fresh rewrite may pass another time; a thin page may give its full text to a different approach
                        retry_it = isinstance(e, (FailedFactCheck, ThinSource))
                        res = settle(entry, name, section, "skipped", str(e)[:400], retry_it)
                        state["skipped"] += 1
                        when = retry_note(res)
                        say(f"  ~ skip [{name}] {entry['title'][:60]} — {e}" + when)
                        mon.emit("skipped", f"[{name}] {entry['title'][:60]} — {e}" + when, source=name)
                        continue
                    except NoVerifiedImage as e:
                        tries += 1
                        transient = getattr(e, "transient", False)
                        # Network trouble is recorded as a failure, a bad picture as a skip, but BOTH are retried: the
                        # next try looks at the page a different way (AMP, mobile ...) and finds other pictures.
                        res = settle(entry, name, section, "failed" if transient else "skipped", str(e)[:400], True)
                        state["failed" if transient else "skipped"] += 1
                        say(f"  ~ skip [{name}] {entry['title'][:60]} — {e}")
                        mon.emit("failed" if transient else "skipped",
                                 f"[{name}] no verified image{retry_note(res)}: {entry['title'][:60]}",
                                 source=name, reason=str(e)[:200], level="warn" if transient else "info")
                        continue
                    except Exception as e:  # Incomplete, LLMError, network, anything else
                        tries += 1
                        consecutive_failures += 1
                        kind = "incomplete" if isinstance(e, Incomplete) else type(e).__name__
                        res = settle(entry, name, section, "failed", f"{kind}: {str(e)[:300]}", True)
                        state["failed"] += 1
                        say(f"  ! fail [{name}] {entry['title'][:60]}: {kind}: {str(e)[:120]}")
                        mon.emit("failed", f"[{name}] {entry['title'][:60]} — {kind}: {str(e)[:120]}" +
                                 (" (will retry)" if res["retrying"] else " (given up)"), level="error", source=name)
                        if consecutive_failures >= 8 and state["published"] == 0:
                            say("Aborting: 8 failures in a row with nothing published. Check the errors above.")
                            push_state(state="stopped", pauseReason="8 failures in a row")
                            return state["published"]
                        continue

                    consecutive_failures = 0
                    retry["after_cooldown"] = False
                    state["published"] += 1
                    made_this_pass += 1
                    seen.add(entry["url"], entry["title"], article["title"], ref=article["id"])
                    if not dry_run:
                        storage.record(source_name=name, source_url=entry["url"], source_title=entry["title"],
                                       section=article["section"], status="published", article_id=article["id"],
                                       title=article["title"])
                    say(f"[{state['published']}] {'(dry) ' if dry_run else 'PUSHED '}{name} → {'+'.join(article['sections'])}: "
                        f"\"{article['title'][:80]}\"")
                    mon.emit("published", f"Published: {article['title'][:90]}", source=name,
                             section=article["section"], articleId=article["id"], slug=article["slug"])
                    push_state(lastPublishedTitle=article["title"], lastPublishedAt=now_iso())
                    tick_reports()
                    break

            if count and state["published"] >= count:
                break
            if not forever:
                break
            if made_this_pass == 0:
                say(f"Nothing new anywhere this pass; sleeping {interval}s...")
                mon.emit("idle", f"Nothing new this pass; checking again in {interval}s")
                push_state(state="idle", currentSource=None)
                nap(interval, state="idle", currentSource=None)
                hold()
                tick_reports()
    except KeyboardInterrupt:
        if report_loop:
            report_loop.stop.set()
        mon.emit("run_end", "Pipeline stopped by the user")
        push_state(state="stopped", currentSource=None)
        raise

    if report_loop and not forever:
        report_loop.stop.set()
    tick_reports()
    mon.emit("run_end", f"Pipeline finished: {state['published']} published, {state['skipped']} skipped, {state['failed']} failed")
    push_state(state="stopped" if not forever else "idle", currentSource=None)
    say(f"Done. {state['published']} article(s) {'built (dry run)' if dry_run else 'pushed to MongoDB'}.")
    return state["published"]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=50, help="stop after N articles (0 = no limit)")
    ap.add_argument("--forever", action="store_true", help="keep cycling through the sources")
    ap.add_argument("--interval", type=int, default=300, help="seconds to sleep when nothing is new")
    ap.add_argument("--dry-run", action="store_true", help="build and check, but do not write to MongoDB")
    a = ap.parse_args()
    try:
        run(0 if a.forever and a.count == 50 else a.count, a.forever, a.interval, a.dry_run)
    except KeyboardInterrupt:
        print("\nStopped.")
