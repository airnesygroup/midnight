"""
The Midnight Trends loop. Runs on its own, in parallel with generate.py (the news
loop); the two share nothing except the Groq keys' pool settings and the database.

    python generate_trends.py --forever         # keep going (what `run.py --live` starts)
    python generate_trends.py                   # write everything currently waiting, then stop
    python generate_trends.py --count 5         # stop after 5 posts
    python generate_trends.py --dry-run         # build + check, write nothing

Each cycle
  1. Read Google Trends "Trending now" for every configured country (TREND_GEOS).
     Whatever is trending, whether for minutes or weeks, is RECORDED IMMEDIATELY in
     the permanent trendLedger, before anything is written.
  2. Take the biggest trend still waiting (new ones, plus earlier ones that could
     not be finished: offline, out of credit, thin sources, no image).
  3. Find and read the top articles about it, verify a real image, write our own
     blog post with Groq, run the completeness gates, push to the `trends` collection.
  4. Never twice: a trend, a reordering of its words, a different search about the
     same event (sources overlap) or a headline matching an existing post is skipped.

Nothing here touches articles, sections or the news ledger.
"""

import argparse
import time
from datetime import datetime, timedelta, timezone

import config
import factcheck
import llm
from config import check_key_or_exit
import images as image_guard
from images import NoVerifiedImage, looks_like_url, pick_verified_images
from quality import Incomplete
from schema import iso, now_iso
from dedupe import normalise_url
from storage import get_storage
from trend_schema import build_trend, headline_weight, validate_trend
from trend_sources import ThinMaterial, fetch_all_geos, gather_material
from trend_store import TrendMonitor, TrendSeen, TrendStore
from trend_writer import Unsuitable, write_trend
from monitor import NullMonitor
from control import Control, Watcher, NullWatcher


class Skip(Exception):
    """Deliberately not published, and never retried."""


class Defer(Exception):
    """Could not be finished now; retried later (1h, 3h, 8h, then given up)."""


def blocked(query, words):
    q = f" {(query or '').lower()} "
    return next((w for w in words if w and w in q), None)


def final_gate(t):
    validate_trend(t)
    if not (looks_like_url(t["img"]) and t["img"].startswith("https://")):
        raise Incomplete("no real https image URL")
    if not looks_like_url(t.get("source_url") or ""):
        raise Incomplete("source URL missing")
    if len(t["summary"]) != 3 or not all(t["summary"]):
        raise Incomplete("summary incomplete")
    if len(t["body"]) < 3:
        raise Incomplete("body has fewer than 3 paragraphs")
    if t["status"] != "published":
        raise Incomplete("status not published")
    return True


def as_trend(entry):
    """Ledger entry -> the trend dict the sources/writer modules use."""
    return {"query": entry["query"], "key": entry["key"], "geos": entry.get("geos") or [],
            "trafficMin": int(entry.get("peakTraffic") or 0), "trafficLabel": entry.get("trafficLabel"),
            "news": entry.get("news") or [], "picture": entry.get("picture")}


def process_trend(trend, store, seen, settings, dry_run=False, mon=None, gather=gather_material,
                  write=write_trend, pick_images=pick_verified_images, verify=None):
    """Material -> image -> write -> gates -> publish. Raises Skip / Defer / llm.* errors."""
    mon = mon or NullMonitor()
    verify = verify or factcheck.verify_trend
    hit = blocked(trend["query"], settings["blocklist"])
    if hit:
        raise Skip(f"topic not written about (blocklist: {hit})")
    mon.emit("fetching", f"Reading the top articles about: {trend['query']}", trend=trend["query"])
    try:
        material = gather(trend)
    except ThinMaterial as e:
        raise Defer(f"thin sources: {e}")
    urls = [s["url"] for s in material["sources"]]
    same = seen.same_event_as(urls)
    if same:
        raise Skip(f"same event as an existing trend post ({same})")
    if not dry_run:
        image_guard.use_database(getattr(store, "db", None))
    good, rejected = pick_images(material["images"], limit=3)
    if not good:
        why = "; ".join(f"{u.split('/')[-1][:30]}: {w}" for u, w in rejected[:3]) or "no image found"
        raise Defer(f"no verifiable image ({why})")
    import watermarks
    if material["sources"] and watermarks.is_watermarked(material["sources"][0].get("url") or ""):
        from images import hamming, NEAR_BITS, fingerprint_of as _fp   # logo watermark on the lead picture: use the second one

        def _distinct(a, b):
            fa, fb = _fp(a), _fp(b)
            return not (fa and fb and hamming(fa, fb) <= NEAR_BITS)
        good = watermarks.prefer_second(good, _distinct)
    mon.emit("image_ok", f"Image verified for: {trend['query']}", img=good[0])
    mon.emit("writing", f"Writing: {trend['query']} ({len(material['sources'])} sources)", trend=trend["query"])
    try:
        post = write(trend, material)
    except Unsuitable as e:
        raise Skip(f"writer declined: {e}")
    # Hallucination guard, same as articles: every claim must be in the material the writer read.
    problems = verify(trend, material, post)
    rounds = config.retry_settings()["factcheck_rounds"]
    history = []
    for n in range(1, rounds + 1):             # a failed fact-check is a small correction, not the end of the post
        if not problems:
            break
        history.append(problems)
        feedback = list(dict.fromkeys(p for h in history[-2:] for p in h))[:10]
        mon.emit("factcheck_retry", f"Fact-check failed, correction {n}/{rounds}: {trend['query'][:60]} — {problems[0][:100]}",
                 trend=trend["query"], problems=problems[:6], round=n)
        try:
            post = write(trend, material, feedback=feedback)
        except Unsuitable as e:
            raise Skip(f"writer declined: {e}")
        problems = verify(trend, material, post)
    if problems:
        raise Defer(f"failed fact-check after {rounds} corrections: " + "; ".join(problems[:3])[:300])
    clash = seen.titles.match(post["title"])
    if clash:
        raise Skip(f"headline matches an existing post: \"{clash[0][:70]}\"")
    first = material["sources"][0]
    doc = build_trend(title=post["title"], excerpt=post["excerpt"], summary=post["summary"],
                      html_body=post["html_body"], hashtags=post["hashtags"], img=good[0],
                      source_name=first["name"], source_url=first["url"],
                      weight=headline_weight(trend["trafficMin"], len(trend["geos"]), len(material["sources"])))
    final_gate(doc)
    if not dry_run:
        store.publish_trend(doc)
        image_guard.record_use(image_guard.fingerprint_of(good[0]), good[0], first["name"], doc.get("id"))
    return doc, urls, post


def run(count=0, forever=False, interval=None, dry_run=False, store=None, settings=None,
        fetch_feed=None, sleep=time.sleep, log=print, pause_seconds=None, monitor=None, pool=None,
        gather=gather_material, write=write_trend, pick_images=pick_verified_images, control=None):
    """Returns the number of trend posts published."""
    settings = settings or config.trend_settings()
    interval = settings["interval"] if interval is None else interval
    if pool is None:
        check_key_or_exit()
    if store is None:
        store = TrendStore(get_storage().db, settings["max_attempts"])
        store.ensure_ready()
    pause_seconds = config.key_pause_seconds() if pause_seconds is None else pause_seconds
    mon = monitor or (NullMonitor() if dry_run else TrendMonitor(store.db))
    pool = pool or llm.get_pool()
    llm.set_pool(pool)
    pool.on_event = lambda kind, msg, **d: mon.emit(kind, msg, **d)
    fetch_feed = fetch_feed or (lambda: fetch_all_geos(settings["geos"]))
    # Dashboard control (Pause / Go live). A dry run never listens to it.
    ctl = control or (NullWatcher() if dry_run else Watcher(Control(store.db), "trends"))
    retry = {"after_cooldown": False}   # True while the very next call is a retry after a credit cooldown

    seen = TrendSeen()
    store.load_seen(seen)
    state = {"published": 0, "skipped": 0, "deferred": 0, "startedAt": now_iso()}
    log(f"Trends loop: {len(seen.keys)} trend(s) already handled, {len(settings['geos'])} countries, "
        f"{len(pool.keys)} Groq key(s).")

    def push(**extra):
        fields = {"manualPause": False, **extra}
        mon.set_state(published=state["published"], skipped=state["skipped"], deferred=state["deferred"],
                      startedAt=state["startedAt"], keys=pool.snapshot(), geos=len(settings["geos"]), **fields)

    def nap(seconds, **st):
        """Short slices: heartbeat stays fresh, Ctrl+C works, the dashboard can interrupt.
        Returns "retry" (Go live pressed), "paused" (Pause pressed) or None (time is up)."""
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
                push(**st)
                since_push = 0
        return None

    def hold():
        """Pause pressed on the dashboard: stand still (even with credit left) until Go live.
        A post being written when Pause was pressed has already been finished and pushed."""
        if not ctl.paused():
            return False
        msg = "Paused from the dashboard. Nothing new is started until you press Go live."
        log(f"  \u23f8 {msg}")
        mon.emit("paused", msg, level="warn", manual=True)
        while ctl.paused():
            push(state="paused", currentTrend=None, pausedUntil=None,
                 pauseReason="Paused from the dashboard", manualPause=True)
            sleep(3)
        ctl.retry_requested()               # consume the Go live click
        pool.reset_cooldowns()              # Go live always means: try the keys again now
        retry["after_cooldown"] = True
        mon.emit("resumed", "Back live. Trying the keys again now.")
        push(state="running", pausedUntil=None, pauseReason=None)
        return True

    def pause():
        """Every key is out of credit: cool down; Go live ends the wait early, Pause makes it a manual
        pause. The keys are then tried again; still out of credit means a fresh cooldown."""
        hours = pause_seconds / 3600
        until = datetime.now(timezone.utc) + timedelta(seconds=pause_seconds)
        if retry["after_cooldown"]:
            msg = f"Retry failed: all {len(pool.keys)} Groq key(s) are still out of credit. Trends loop cooling down {hours:g}h again."
        else:
            msg = f"All {len(pool.keys)} Groq key(s) are out of credit. Trends loop pausing {hours:g}h."
        log(f"  \u23f8 {msg}")
        mon.emit("paused", msg, level="warn", until=iso(until))
        woke = nap(pause_seconds, state="paused", pausedUntil=iso(until), pauseReason="all Groq keys out of credit")
        if woke == "paused":
            hold()
        pool.reset_cooldowns()
        retry["after_cooldown"] = True
        mon.emit("retry", "Go live pressed: trying the keys again now" if woke == "retry"
                 else "Cooldown over: trying the keys again")
        push(state="running", pausedUntil=None, pauseReason=None)

    memory_queue = {}          # dry-run only: nothing is written to MongoDB

    def refresh():
        """Step 1: read every country and record every sighting at once."""
        feed = fetch_feed()
        new = 0
        for t in feed:
            if t["key"] in seen.keys:
                continue
            if dry_run:
                memory_queue.setdefault(t["key"], {"query": t["query"], "key": t["key"], "geos": t["geos"],
                                                   "peakTraffic": t["trafficMin"], "trafficLabel": t["trafficLabel"],
                                                   "news": t["news"], "picture": t["picture"]})
                new += 1
            elif store.sight(t):
                new += 1
        mon.emit("trends_read", f"Read Google Trends in {len(settings['geos'])} countries: "
                                f"{len(feed)} trending, {new} new to us", total=len(feed), new=new)
        log(f"Google Trends: {len(feed)} trending across {len(settings['geos'])} countries, {new} new.")
        return len(feed)

    mon.emit("run_start", f"Trends loop started: {len(settings['geos'])} countries, {len(pool.keys)} key(s)")
    push(state="running", currentTrend=None, pausedUntil=None, pauseReason=None)
    mon.start_heartbeat()
    last_refresh = -1e9
    try:
        while True:
            hold()                           # Pause from the dashboard takes effect here, between posts
            if time.monotonic() - last_refresh >= interval:
                try:
                    refresh()
                except Exception as e:  # noqa: BLE001 - a bad feed round must not stop the loop
                    mon.emit("failed", f"Reading Google Trends failed: {type(e).__name__}: {str(e)[:120]}", level="error")
                last_refresh = time.monotonic()

            if dry_run:
                waiting = [e for e in memory_queue.values() if e["key"] not in seen.keys]
                waiting.sort(key=lambda e: -e["peakTraffic"])
            else:
                waiting = store.queue(limit=1)
            if not waiting:
                if not forever:
                    break
                mon.emit("idle", f"Nothing new to write; checking Google Trends again in {interval}s")
                push(state="idle", currentTrend=None)
                nap(interval, state="idle", currentTrend=None)
                continue

            entry = waiting[0]
            trend = as_trend(entry)
            push(state="running", currentTrend=trend["query"])
            try:
                doc, urls, post = process_trend(trend, store, seen, settings, dry_run, mon, gather, write, pick_images)
            except llm.AllKeysExhausted:
                pause()                      # the trend stays queued; same one is tried again
                continue
            except llm.NoValidKeys as e:
                mon.emit("fatal", f"No usable Groq key: {e}", level="error")
                push(state="stopped", pauseReason=str(e))
                log(f"Stopping: {e}")
                return state["published"]
            except Skip as e:
                state["skipped"] += 1
                log(f"  ~ skip [{trend['query']}] {e}")
                mon.emit("skipped", f"[{trend['query']}] {e}", trend=trend["query"])
                seen.add_key(trend["key"])
                if not dry_run:
                    store.set_status(trend["key"], "skipped", str(e)[:200])
                continue
            except Exception as e:  # noqa: BLE001 - Defer, Incomplete, LLMError, network, anything else
                state["deferred"] += 1
                kind = "deferred" if isinstance(e, Defer) else ("incomplete" if isinstance(e, Incomplete) else type(e).__name__)
                reason = f"{kind}: {str(e)[:160]}"
                outcome = "pending"
                if dry_run:
                    seen.add_key(trend["key"])
                else:
                    outcome = store.defer(trend["key"], reason)
                log(f"  ! {outcome} [{trend['query']}] {reason}")
                mon.emit("skipped" if isinstance(e, Defer) else "failed",
                         f"[{trend['query']}] {reason} ({'retry later' if outcome == 'pending' else 'given up'})",
                         level="info" if isinstance(e, Defer) else "error", trend=trend["query"])
                continue

            retry["after_cooldown"] = False
            state["published"] += 1
            seen.add_key(trend["key"])
            seen.add_published(doc["title"], urls, doc["id"])
            if not dry_run:
                store.set_status(trend["key"], "published", None, trendId=doc["id"], slug=doc["slug"], title=doc["title"],
                                 sourceUrls=[normalise_url(u) for u in urls], publishedAt=doc["publishedAt"])
            log(f"[{state['published']}] {'(dry) ' if dry_run else 'PUSHED '}{trend['query']} → \"{doc['title'][:80]}\" "
                f"{['#' + h for h in doc['hashtags']]}")
            mon.emit("published", f"Published trend: {doc['title'][:90]}", trend=trend["query"], trendId=doc["id"],
                     slug=doc["slug"], hashtags=doc["hashtags"])
            push(lastPublishedTitle=doc["title"], lastPublishedAt=now_iso())
            if count and state["published"] >= count:
                break
    except KeyboardInterrupt:
        mon.emit("run_end", "Trends loop stopped by the user")
        push(state="stopped", currentTrend=None)
        raise
    mon.emit("run_end", f"Trends loop finished: {state['published']} published, {state['skipped']} skipped, "
                        f"{state['deferred']} deferred")
    push(state="stopped" if not forever else "idle", currentTrend=None)
    log(f"Done. {state['published']} trend post(s) {'built (dry run)' if dry_run else 'pushed to MongoDB'}.")
    return state["published"]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=0, help="stop after N posts (0 = no limit)")
    ap.add_argument("--forever", action="store_true", help="keep running, checking Google Trends every --interval seconds")
    ap.add_argument("--interval", type=int, default=None, help="seconds between Google Trends reads (default TREND_INTERVAL_SECONDS=900)")
    ap.add_argument("--dry-run", action="store_true", help="build and check, but do not write to MongoDB")
    a = ap.parse_args()
    try:
        run(a.count, a.forever, a.interval, a.dry_run)
    except KeyboardInterrupt:
        print("\nStopped.")
