"""
MongoDB storage for Midnight Trends. Lives in the SAME database as the news but
in its own collections, so trends and articles never mix:

  trends        public documents the Lovable site reads (trend_schema.py)
  trendLedger   a permanent record of EVERY trend the loop has ever seen, written
                the moment it is first seen: status seen | pending | published |
                skipped | failed. It is what guarantees nothing is written twice and
                nothing seen is forgotten, even if the loop was offline or out of
                credit half-way through. Never pruned.
  trendEvents   live activity for the dashboard (14 day expiry)
  systemState   shared with the news loop; this loop's document has _id "trends"
"""

import math
import os
import re
import threading
from datetime import datetime, timedelta, timezone

from pymongo import ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError, PyMongoError

import dedupe
from dedupe import SeenIndex, normalise_url
from monitor import KEEP_DAYS, Monitor
from schema import now_iso, iso
from trend_schema import validate_trend

TREND_INDEXES = [  # mirrors lovable/src/lib/mongodb/indexes.ts
    ("trend_id", [("id", ASCENDING)], True),
    ("trend_slug", [("slug", ASCENDING)], True),
    ("trend_publication", [("status", ASCENDING), ("publishedAt", DESCENDING), ("slug", ASCENDING)], False),
    ("trend_popular", [("status", ASCENDING), ("views", DESCENDING), ("slug", ASCENDING)], False),
    ("trend_hashtags", [("status", ASCENDING), ("hashtags", ASCENDING), ("publishedAt", DESCENDING)], False),
]
RETRY_HOURS = (1, 3, 8)        # wait before retry 1, 2, 3 of a trend that could not be written yet


def _first_url(news):
    for n in news or []:
        u = n.get("url") if isinstance(n, dict) else n
        if isinstance(u, str) and u.startswith("http"):
            return u
    return None


def _public(d):
    if d:
        d.pop("_id", None)
    return d


class TrendMonitor(Monitor):
    """Same behaviour as the news monitor but with its own events collection and state document."""
    state_id = "trends"

    def __init__(self, db):
        super().__init__(db)
        self.events = db["trendEvents"]
        try:
            self.events.create_index("at", name="trend_event_expiry", expireAfterSeconds=KEEP_DAYS * 86400)
        except Exception:
            pass


class TrendSeen:
    """In-memory view of everything already handled; seeded from MongoDB, updated live."""

    def __init__(self):
        self.keys = set()
        self.titles = SeenIndex()
        self.url_owner = {}          # normalised source URL -> trend id that used it

    def add_key(self, key):
        self.keys.add(key)

    def add_published(self, title, source_urls, trend_id):
        self.titles.add(None, title, ref=trend_id)
        for u in source_urls:
            self.url_owner[normalise_url(u)] = trend_id

    def same_event_as(self, source_urls):
        """Trend id of an already-published post whose sources substantially overlap, else None."""
        hits = [self.url_owner[normalise_url(u)] for u in source_urls if normalise_url(u) in self.url_owner]
        if not hits:
            return None
        need = 1 if len(source_urls) == 1 else max(2, math.ceil(len(source_urls) / 2))
        for tid in set(hits):
            if hits.count(tid) >= need:
                return tid
        return None


class TrendStore:
    def __init__(self, db, max_attempts=3):
        self.db = db
        self.trends = db["trends"]
        self.ledger = db["trendLedger"]
        self.max_attempts = max_attempts
        self._lock = threading.Lock()

    # ------------------------------------------------------------ setup
    def ensure_ready(self):
        """Idempotent. Creates missing indexes only; never touches existing documents."""
        for name, keys, unique in TREND_INDEXES:
            try:
                self.trends.create_index(keys, name=name, unique=unique)
            except PyMongoError as e:
                print(f"  ! trends index {name}: {str(e)[:100]} (left as-is)")
        try:
            self.ledger.create_index([("key", ASCENDING)], name="trend_ledger_key", unique=True)
            self.ledger.create_index([("status", ASCENDING), ("peakTraffic", DESCENDING)], name="trend_ledger_queue")
            self.ledger.create_index([("lastSeenAt", DESCENDING)], name="trend_ledger_seen")
        except PyMongoError as e:
            print(f"  ! trendLedger index: {str(e)[:100]}")

    # ----------------------------------------------------------- ledger
    def sight(self, t):
        """Record that a trend was seen (first thing that happens to it). True if it is brand new."""
        now = now_iso()
        r = self.ledger.update_one(
            {"key": t["key"]},
            {"$setOnInsert": {"key": t["key"], "status": "seen", "attempts": 0, "firstSeenAt": now,
                              "nextTryAt": None, "trendId": None, "reason": None},
             "$set": {"query": t["query"], "lastSeenAt": now, "trafficLabel": t.get("trafficLabel"),
                      # keep Google's links and picture so a backlog item can still be written later
                      **({"news": list(t["news"])[:8]} if t.get("news") else {}),
                      **({"picture": t["picture"]} if t.get("picture") else {})},
             "$max": {"peakTraffic": int(t.get("trafficMin") or 0)},
             "$addToSet": {"geos": {"$each": list(t.get("geos") or [])}},
             "$inc": {"timesSeen": 1}},
            upsert=True)
        return r.upserted_id is not None

    def get(self, key):
        return _public(self.ledger.find_one({"key": key}))

    def set_status(self, key, status, reason=None, kind=None, **fields):
        """kind: how this event counts on the dashboard: 'skipped' (decided against it) or 'failed' (could not be
        written, e.g. API trouble). Every event is kept in `history` with its reason."""
        now = now_iso()
        upd = {"$set": {"status": status, "reason": reason, "updatedAt": now, **fields}}
        if status != "seen":
            upd["$push"] = {"history": {"$each": [{"at": now, "status": status, "kind": kind or status, "reason": reason,
                                                   "attempt": fields.get("attempts")}], "$slice": -25}}
        self.ledger.update_one({"key": key}, upd)

    def defer(self, key, reason):
        """Could not be written yet (thin sources, no image, API trouble). Retry later; after
        max_attempts it becomes 'skipped' so it is never retried forever."""
        e = self.ledger.find_one({"key": key}) or {}
        attempts = int(e.get("attempts") or 0) + 1
        if attempts >= self.max_attempts:
            self.set_status(key, "skipped", f"gave up after {attempts} tries: {reason}", kind="failed", attempts=attempts, nextTryAt=None)
            return "skipped"
        wait = RETRY_HOURS[min(attempts - 1, len(RETRY_HOURS) - 1)]
        self.set_status(key, "pending", reason, kind="failed", attempts=attempts,
                        nextTryAt=iso(datetime.now(timezone.utc) + timedelta(hours=wait)))
        return "pending"

    def queue(self, limit=500, now=None):
        """Everything still to be written, biggest trends first: new ones, plus
        deferred ones whose retry time has come."""
        now = iso(now or datetime.now(timezone.utc))
        q = {"$or": [{"status": "seen"},
                     {"status": "pending", "nextTryAt": {"$lte": now}},
                     {"status": "failed", "attempts": {"$lt": self.max_attempts}}]}
        return [_public(d) for d in self.ledger.find(q).sort([("peakTraffic", DESCENDING), ("firstSeenAt", ASCENDING)]).limit(limit)]

    def load_seen(self, seen: TrendSeen, limit=50000):
        for e in self.ledger.find({}, {"key": 1, "status": 1, "attempts": 1, "sourceUrls": 1, "title": 1, "trendId": 1}).limit(limit):
            if e.get("status") in ("published", "skipped"):
                seen.add_key(e["key"])
            if e.get("status") == "published":
                seen.add_published(e.get("title") or "", e.get("sourceUrls") or [], e.get("trendId"))
        for d in self.trends.find({}, {"title": 1, "id": 1, "source_url": 1}).limit(limit):
            seen.add_published(d.get("title") or "", [d["source_url"]] if d.get("source_url") else [], d.get("id"))
        return seen

    def ledger_summary(self):
        out = {}
        for r in self.ledger.aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
            out[r["_id"]] = r["n"]
        return out

    def outcome_of(self, d):
        """published | retrying | abandoned | queued: the final outcome of a trend ledger row."""
        st = d.get("status")
        if st == "published":
            return "published"
        if st == "seen":
            return "queued"
        if st == "pending" or (st == "failed" and int(d.get("attempts") or 0) < self.max_attempts):
            return "retrying"
        return "abandoned"

    def review(self, kind, outcome=None, search=None, offset=0, limit=50):
        """Every trend that was ever skipped (decided against) or failed (could not be written), with all reasons,
        the tries and the final outcome: published later / will retry / abandoned."""
        from review import describe, reasons_from
        conds = [{"history.kind": kind}, {"status": kind}] if kind == "skipped" else \
                [{"history.kind": kind}, {"status": {"$in": ["pending", "failed"]}}]
        q = {"$or": conds}
        if search:
            rx = {"$regex": re.escape(search), "$options": "i"}
            q = {"$and": [q, {"$or": [{"query": rx}, {"reason": rx}]}]}
        rows = [_public(d) for d in self.ledger.find(q).sort("updatedAt", DESCENDING).limit(5000)]
        items, counts = [], {"published": 0, "retrying": 0, "abandoned": 0}
        for d in rows:
            o = self.outcome_of(d)
            counts[o] = counts.get(o, 0) + 1
            if outcome and o != outcome:
                continue
            reasons = reasons_from(d.get("history"), d.get("reason"), d.get("status"), d.get("updatedAt"), kinds=(kind,))
            items.append({"title": d.get("query"), "url": _first_url(d.get("news")),
                          "source": ", ".join(d.get("geos") or [])[:60], "snippet": d.get("trafficLabel"),
                          "status": d.get("status"), "reason": d.get("reason") or (reasons[-1]["reason"] if reasons else None),
                          "reasons": reasons, "attempts": int(d.get("attempts") or 0), "maxAttempts": self.max_attempts,
                          "firstSeenAt": d.get("firstSeenAt"), "lastAt": d.get("updatedAt") or d.get("lastSeenAt"),
                          "outcome": o, "nextTryAt": d.get("nextTryAt"), "articleId": d.get("trendId"),
                          "articleTitle": d.get("title"),
                          "outcomeText": describe(o, d.get("attempts"), self.max_attempts, d.get("nextTryAt"), d.get("title"), d.get("reason"))})
        return {"items": items[offset:offset + limit], "total": len(items), "counts": counts}

    def recent_ledger(self, limit=50, status=None):
        q = {"status": status} if status else {}
        return [_public(d) for d in self.ledger.find(q).sort("lastSeenAt", DESCENDING).limit(limit)]

    # -------------------------------------------------------- publishing
    def publish_trend(self, doc):
        """Validate, then insert straight into MongoDB. Retries with a unique slug on a collision."""
        validate_trend(doc)
        with self._lock:
            for attempt in range(4):
                try:
                    self.trends.insert_one(dict(doc))
                    return doc
                except DuplicateKeyError as e:
                    if "slug" in str(e):
                        suffix = doc["id"][-6:] if attempt == 0 else f"{doc['id'][-6:]}-{attempt}"
                        doc["slug"] = f"{doc['slug'][:76]}-{suffix}"
                        continue
                    raise
        raise RuntimeError("could not find a unique slug")

    # ------------------------------------------------------------ reads
    def list_trends(self, hashtag=None, search=None, sort="newest", offset=0, limit=None):
        import re
        f = {"status": "published"}
        if hashtag:
            f["hashtags"] = {"$regex": f"^{re.escape(hashtag.lstrip('#'))}$", "$options": "i"}
        if search and search.strip():
            rx = {"$regex": re.escape(search.strip()), "$options": "i"}
            f["$or"] = [{"title": rx}, {"excerpt": rx}, {"hashtags": rx}]
        order = {"oldest": [("publishedAt", ASCENDING), ("slug", ASCENDING)],
                 "created": [("createdAt", DESCENDING), ("slug", ASCENDING)],    # dashboard: when WE published it
                 "popular": [("views", DESCENDING), ("slug", ASCENDING)]}.get(sort, [("publishedAt", DESCENDING), ("slug", ASCENDING)])
        total = self.trends.count_documents(f)
        cur = self.trends.find(f).sort(order).skip(max(offset, 0))
        if limit is not None:
            cur = cur.limit(limit)
        return [_public(d) for d in cur], total

    def get_trend(self, key):
        return _public(self.trends.find_one({"$or": [{"id": key}, {"slug": key}], "status": "published"}))

    def hashtag_counts(self):
        return {r["_id"]: r["n"] for r in self.trends.aggregate(
            [{"$match": {"status": "published"}}, {"$unwind": "$hashtags"},
             {"$group": {"_id": "$hashtags", "n": {"$sum": 1}}}, {"$sort": {"n": -1}}])}
