"""Dashboard API for Midnight Trends, mounted by main.py under /api/trends."""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

import config
from control import Control
from storage import get_storage
from trend_store import TrendMonitor, TrendStore

router = APIRouter(prefix="/api/trends", tags=["trends"])
_store = None


def _trends():
    global _store
    if _store is None:
        try:
            _store = TrendStore(get_storage().db, config.trend_settings()["max_attempts"])
            _store.ensure_ready()
        except Exception as e:  # unavailable storage is an explicit error, never an empty success
            raise HTTPException(status_code=503, detail=f"MongoDB unavailable: {type(e).__name__}: {str(e)[:150]}")
    return _store


@router.get("")
def list_trends(hashtag: str = None, search: str = None, sort: str = "newest", offset: int = 0, limit: int = None):
    items, total = _trends().list_trends(hashtag=hashtag, search=search, sort=sort, offset=max(offset, 0), limit=limit)
    return {"items": items, "total": total, "offset": offset, "limit": limit}


@router.get("/hashtags")
def hashtags():
    return _trends().hashtag_counts()


@router.get("/status")
def status():
    s = _trends()
    st = TrendMonitor(s.db).get_state()
    st.pop("_id", None)
    online, hb = False, st.get("heartbeat")
    if hb:
        try:
            online = (datetime.now(timezone.utc) - datetime.fromisoformat(hb.replace("Z", "+00:00"))).total_seconds() < 90
        except ValueError:
            pass
    st["online"] = online
    st["heartbeatAgeSeconds"] = int((datetime.now(timezone.utc) - datetime.fromisoformat(hb.replace("Z", "+00:00"))).total_seconds()) if hb else None
    st.update(Control(s.db).get("trends"))    # desired / retryNonce, so the dashboard can show "pausing..."
    return {"generator": st, "totals": s.ledger_summary(), "trends": s.trends.count_documents({"status": "published"}),
            "hashtags": s.hashtag_counts()}


@router.get("/events")
def events(after: str = None, limit: int = 100):
    """Newest first. Pass `after=<id of newest event you have>` to get only newer ones."""
    return TrendMonitor(_trends().db).recent(after=after, limit=limit)


@router.get("/ledger")
def ledger(status: str = None, limit: int = 100):
    """Everything the loop has ever seen (seen / pending / published / skipped)."""
    return _trends().recent_ledger(limit=min(limit, 500), status=status)


@router.get("/{key}")
def get_trend(key: str):
    t = _trends().get_trend(key)
    if not t:
        raise HTTPException(status_code=404, detail="Trend not found")
    return t
