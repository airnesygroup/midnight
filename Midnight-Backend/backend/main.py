import os
import subprocess
import sys
import threading
from datetime import datetime, timezone

import config  # noqa: F401  -- loads .env before anything reads os.environ

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from storage import get_storage
from schema import SECTIONS
from trends_api import router as trends_router
from control import Control, LOOPS

app = FastAPI(title="Signal Feed")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(trends_router)   # /api/trends/*  (before the SPA catch-all below)

FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

_gen_lock = threading.Lock()
_gen_state = {"running": False, "published": 0, "error": None}


def _storage():
    try:
        return get_storage()
    except Exception as e:  # unavailable storage is an explicit error, never an empty success
        raise HTTPException(status_code=503, detail=f"MongoDB unavailable: {type(e).__name__}: {str(e)[:150]}")


# ---------------------------------------------------------------- loop control
# The news and trends loops are separate processes. Pause / Go live are written to MongoDB
# (control.py) and the loops read them between steps; see control.py for the exact behaviour.
_LOOP_SCRIPT = {"news": "generate.py", "trends": "generate_trends.py"}
_LOOP_STATE_ID = {"news": "generator", "trends": "trends"}
_spawned = {}
_spawn_lock = threading.Lock()
STALE_AFTER = 120      # seconds without a heartbeat before a loop counts as not running at all


def heartbeat_age(st):
    hb = (st or {}).get("heartbeat")
    if not hb:
        return None
    try:
        return (datetime.now(timezone.utc) - datetime.fromisoformat(hb.replace("Z", "+00:00"))).total_seconds()
    except ValueError:
        return None


def _ensure_process(loop, st):
    """Go live on a loop whose process is not running: start it. A loop that is alive (even
    cooling down) is left alone; it picks the new wish up itself. Returns True if it was started."""
    if os.environ.get("LOOP_AUTOSTART", "1").strip().lower() in ("0", "false", "no"):
        return False
    age = heartbeat_age(st)
    if age is not None and age < STALE_AFTER:
        return False
    with _spawn_lock:
        p = _spawned.get(loop)
        if p is not None and p.poll() is None:
            return False                      # we already started it and it is still booting
        _spawned[loop] = subprocess.Popen([sys.executable, _LOOP_SCRIPT[loop], "--forever"],
                                          cwd=os.path.dirname(os.path.abspath(__file__)),
                                          stdin=subprocess.DEVNULL)
    return True


@app.on_event("shutdown")
def _stop_spawned():
    for p in _spawned.values():
        try:
            if p.poll() is None:
                p.terminate()
        except Exception:
            pass


def _loop_or_404(loop):
    if loop not in LOOPS:
        raise HTTPException(status_code=404, detail=f"Unknown loop '{loop}' (use one of: {', '.join(LOOPS)})")
    return loop


@app.get("/api/control")
def control_overview():
    s = _storage()
    ctl = Control(s.db)
    out = {}
    for loop in LOOPS:
        st = s.db["systemState"].find_one({"_id": _LOOP_STATE_ID[loop]}) or {}
        age = heartbeat_age(st)
        out[loop] = {**ctl.get(loop), "online": age is not None and age < 90, "state": st.get("state"),
                     "manualPause": bool(st.get("manualPause")), "pausedUntil": st.get("pausedUntil")}
    return out


@app.post("/api/control/{loop}/pause")
def control_pause(loop: str):
    """Stop taking new work after the article in hand is finished, and stay stopped (even with
    credit left) until Go live."""
    _loop_or_404(loop)
    return {"control": Control(_storage().db).pause(loop)}


@app.post("/api/control/{loop}/resume")
def control_resume(loop: str):
    """Go live. A loop that is cooling down (out of credit) stops waiting and tries its keys
    right now; a loop that is not running at all is started."""
    _loop_or_404(loop)
    s = _storage()
    ctl = Control(s.db).resume(loop)
    st = s.db["systemState"].find_one({"_id": _LOOP_STATE_ID[loop]}) or {}
    started = _ensure_process(loop, st)
    return {"control": ctl, "started": started}


@app.get("/api/health")
def health():
    s = _storage()
    s.ping()
    return {"status": "ok", "database": s.db.name, "articles": s.articles.count_documents({})}


@app.get("/api/categories")
def get_categories():
    return [s["name"] for s in SECTIONS]


@app.get("/api/sections")
def get_sections():
    return SECTIONS


@app.get("/api/hashtags")
def get_hashtags():
    return _storage().all_hashtags()


@app.get("/api/posts")
def get_posts(category: str = None, hashtag: str = None, search: str = None,
              sort: str = "newest", offset: int = 0, limit: int = None):
    """sort: newest | oldest | trending | popular | viral. Returns published
    articles in the Midnight article schema."""
    items, total = _storage().list_posts(category=category, hashtag=hashtag, search=search,
                                         sort=sort, offset=max(offset, 0), limit=limit)
    return {"items": items, "total": total, "offset": offset, "limit": limit}


@app.get("/api/posts/{post_id}")
def get_post(post_id: str):
    post = _storage().get_post(post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return post


@app.post("/api/posts/{post_id}/view")
def register_view(post_id: str):
    views = _storage().increment_views(post_id)
    if views is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return {"id": post_id, "views": views}


@app.put("/api/posts/{post_id}")
def edit_post(post_id: str, updates: dict):
    """Partial edit: title, excerpt, html_body, hashtags, img."""
    try:
        updated = _storage().update_post(post_id, updates)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if not updated:
        raise HTTPException(status_code=404, detail="Post not found")
    return updated


@app.get("/api/status")
def status():
    """Live pipeline state for the dashboard: what it is doing right now."""
    from datetime import datetime, timezone
    from monitor import Monitor
    s = _storage()
    st = Monitor(s.db).get_state()
    st.pop("_id", None)
    online = False
    hb = st.get("heartbeat")
    if hb:
        try:
            online = (datetime.now(timezone.utc) - datetime.fromisoformat(hb.replace("Z", "+00:00"))).total_seconds() < 90
        except ValueError:
            pass
    st["online"] = online
    st["heartbeatAgeSeconds"] = int(heartbeat_age(st)) if heartbeat_age(st) is not None else None
    st.update(Control(s.db).get("news"))      # desired / retryNonce, so the dashboard can show "pausing..."
    return {"generator": st, "totals": s.ledger_summary(), "articles": s.articles.count_documents({"status": "published"}),
            "reports": s.db["reports"].count_documents({}), "sections": s.section_counts(), "database": s.db.name}


@app.get("/api/review/{kind}")
def review(kind: str, scope: str = "articles", outcome: str = None, search: str = None, offset: int = 0, limit: int = 50):
    """Admin Skipped / Failed pages. kind: skipped | failed. scope: articles | trends. Each item carries the story,
    every reason it was skipped/failed, the tries so far and its FINAL outcome (published later / will retry /
    abandoned for good)."""
    if kind not in ("skipped", "failed") or scope not in ("articles", "trends"):
        raise HTTPException(status_code=404, detail="kind is skipped|failed, scope is articles|trends")
    if outcome not in (None, "", "published", "retrying", "abandoned", "queued"):
        raise HTTPException(status_code=400, detail="outcome is published|retrying|abandoned")
    if scope == "trends":
        from trends_api import _trends
        store = _trends()
    else:
        store = _storage()
    return store.review(kind, outcome=outcome or None, search=search or None, offset=max(offset, 0), limit=min(max(limit, 1), 200))


@app.get("/api/watchdog")
def watchdog_status():
    """The independent watchdog: is it running, and what has it restarted lately."""
    from datetime import datetime, timezone
    st = _storage().db["systemState"].find_one({"_id": "watchdog"}) or {}
    st.pop("_id", None)
    age = heartbeat_age(st)
    st["online"] = age is not None and age < 120
    return st


@app.get("/api/events")
def events(after: str = None, limit: int = 100):
    """Newest first. Pass `after=<id of newest event you have>` to get only newer ones."""
    from monitor import Monitor
    return Monitor(_storage().db).recent(after=after, limit=limit)


@app.get("/api/reports")
def list_reports():
    return _storage().list_reports()


@app.get("/api/reports/events")
def report_events(after: str = None, limit: int = 100):
    """Only the Midnight Report's own events (waiting, writing, failed, deferred, published), newest first."""
    from monitor import Monitor
    return Monitor(_storage().db).recent(after=after, limit=limit, kind_prefix="report")


@app.get("/api/reports/runs")
def report_runs(limit: int = 30):
    """When each report was written, which window of articles it covered, and whether it was late."""
    out = []
    for d in _storage().db["reportRuns"].find({}).sort("windowEnd", -1).limit(min(limit, 100)):
        d.pop("_id", None)
        d.pop("storyIds", None)
        out.append(d)
    return out


@app.get("/api/reports/{date}")
def get_report(date: str):
    r = _storage().get_report(date)
    if not r:
        raise HTTPException(status_code=404, detail="No report for that date")
    return r


@app.get("/api/sources")
def sources_overview():
    from sources import SOURCES, site_of
    stats = _storage().source_stats()
    return [{"name": n, "site": site_of(n), "section": sec, "feed": u, **stats.get(n, {"published": 0, "skipped": 0, "failed": 0, "lastAt": None})}
            for n, u, sec in SOURCES]


@app.get("/api/ingest/status")
def ingest_status():
    """What the pipeline has handled so far, straight from the ledger."""
    s = _storage()
    return {"generator": dict(_gen_state), "totals": s.ledger_summary(), "recent": s.recent_ledger(30)}


@app.post("/api/generate")
def trigger_generate(count: int = 50):
    """Starts the live pipeline in the background (one article per source in
    turn, each pushed to MongoDB as soon as it is written)."""
    with _gen_lock:
        if _gen_state["running"]:
            return {"status": "already_running", **_gen_state}
        _gen_state.update(running=True, published=0, error=None)

    def work():
        try:
            from generate import run
            _gen_state["published"] = run(count)
        except BaseException as e:  # noqa: BLE001
            _gen_state["error"] = f"{type(e).__name__}: {e}"
        finally:
            _gen_state["running"] = False

    threading.Thread(target=work, daemon=True).start()
    return {"status": "started", "count": count}


if os.path.isdir(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
