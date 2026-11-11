"""
MongoDB storage. Articles are written straight to MongoDB the moment they are
created; nothing is kept in local files.

Collections used (names/shape from the Lovable project):
  articles      strict article documents (schema.py)
  sections      section definitions (seeded once, never overwritten)
Plus one collection of our own:
  ingestLedger  a record of EVERYTHING the pipeline touched: published,
                skipped duplicates, failures. Drives de-duplication.
"""

import math
import re
import threading
from datetime import datetime, timedelta, timezone

from pymongo import MongoClient, ASCENDING, DESCENDING, UpdateOne
from pymongo.errors import DuplicateKeyError, PyMongoError

import config
from schema import iso, SECTIONS, SECTION_BY_SLUG, load_sections, validate_article, now_iso, sanitize_html, \
    html_to_paragraphs, reading_minutes, slugify
from dedupe import normalise_url

RETRY_MINUTES = (15, 30, 60, 120, 240)      # wait before retry 1, 2, 3 ... of a story that failed for a retryable reason
SNIPPET_CHARS = 600
ENTRY_TEXT_CHARS = 4000


def max_attempts():
    return config.item_retry_settings()["max_attempts"]


def outcome_of(doc, cap=None):
    """The FINAL outcome of an article ledger row, in plain terms:
       published   it was written and is live (history shows whether it needed several tries)
       retrying    it will be tried again (see nextTryAt)
       abandoned   it was skipped / failed for good and will never be retried
       queued      scraped and waiting for its turn to be written"""
    cap = cap or max_attempts()
    st = doc.get("status")
    if st == "published":
        return "published"
    if st == "queued":
        return "queued"
    if "retryable" in doc:
        return "retrying" if doc.get("retryable") and int(doc.get("attempts") or 0) < cap else "abandoned"
    if st == "failed" and int(doc.get("attempts") or 0) < 3:       # rows written before this field existed
        return "retrying"
    return "abandoned"


def entry_snapshot(e, feed_url=None):
    """What must be kept to write this story later even if the feed no longer lists it."""
    pub = e.get("published_at")
    return {"title": e.get("title"), "url": e.get("url"), "source": e.get("source"),
            "text": (e.get("text") or "")[:ENTRY_TEXT_CHARS], "images": list(e.get("images") or [])[:6],
            "published_at": pub.isoformat() if hasattr(pub, "isoformat") else pub, "feedUrl": feed_url}


def entry_from_snapshot(d):
    pub = d.get("published_at")
    if isinstance(pub, str):
        try:
            pub = datetime.fromisoformat(pub.replace("Z", "+00:00"))
        except ValueError:
            pub = None
    return {"title": d.get("title"), "url": d.get("url"), "source": d.get("source"), "text": d.get("text") or "",
            "images": list(d.get("images") or []), "published_at": pub}

ARTICLE_INDEXES = [  # mirrors lovable/src/lib/mongodb/indexes.ts
    ("article_id", [("id", ASCENDING)], True),
    ("article_slug", [("slug", ASCENDING)], True),
    ("section_publication", [("status", ASCENDING), ("tag", ASCENDING), ("publishedAt", DESCENDING), ("slug", ASCENDING)], False),
    ("popular", [("status", ASCENDING), ("views", DESCENDING), ("slug", ASCENDING)], False),
    ("headlines", [("status", ASCENDING), ("featured", ASCENDING), ("headlineWeight", DESCENDING)], False),
    ("hashtags", [("status", ASCENDING), ("hashtags", ASCENDING)], False),
]


def _parse_dt(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def shape_review(d):
    """One ledger row as the admin Skipped / Failed pages show it."""
    from review import describe, reasons_from
    cap = max_attempts()
    reasons = reasons_from(d.get("history"), d.get("reason"), d.get("status"), d.get("at"))
    return {"title": d.get("sourceTitle"), "url": d.get("sourceUrl"), "source": d.get("sourceName"),
            "section": d.get("section"), "snippet": d.get("snippet"), "status": d.get("status"),
            "reason": d.get("reason") or (reasons[-1]["reason"] if reasons else None), "reasons": reasons,
            "attempts": int(d.get("attempts") or 0), "maxAttempts": cap, "firstSeenAt": d.get("firstSeenAt"),
            "lastAt": d.get("at"), "outcome": d["outcome"], "nextTryAt": d.get("nextTryAt"),
            "articleId": d.get("articleId"), "articleTitle": d.get("articleTitle"),
            "outcomeText": describe(d["outcome"], d.get("attempts"), cap, d.get("nextTryAt"), d.get("articleTitle"), d.get("reason"))}


def _public(doc):
    if doc:
        doc.pop("_id", None)
    return doc


def _rx(text):
    return {"$regex": re.escape(text), "$options": "i"}


class MongoStorage:
    def __init__(self, client=None, db_name=None):
        self.client = client or MongoClient(config.get_mongo_uri(), serverSelectionTimeoutMS=15000)
        self.db = self.client[db_name or config.get_mongo_db_name()]
        self.articles = self.db["articles"]
        self.sections = self.db["sections"]
        self.ledger = self.db["ingestLedger"]
        self._lock = threading.Lock()

    # ------------------------------------------------------------ setup
    def ping(self):
        self.client.admin.command("ping")

    def ensure_ready(self):
        """Idempotent: creates missing indexes and inserts missing sections.
        Never modifies or deletes existing documents."""
        for name, keys, unique in ARTICLE_INDEXES:
            try:
                self.articles.create_index(keys, name=name, unique=unique)
            except PyMongoError as e:
                print(f"  ! index {name}: {str(e)[:100]} (left as-is)")
        try:
            self.sections.create_index([("slug", ASCENDING)], name="section_slug", unique=True)
            self.ledger.create_index([("normUrl", ASCENDING)], name="ledger_url", unique=True)
            self.ledger.create_index([("at", DESCENDING)], name="ledger_time")
        except PyMongoError as e:
            print(f"  ! index: {str(e)[:100]}")
        now = now_iso()
        if self.sections.count_documents({}) == 0:      # first run only: never re-add sections you removed
            for s in SECTIONS:
                doc = dict(s)
                doc["createdAt"] = doc.get("createdAt") or now
                doc["updatedAt"] = doc.get("updatedAt") or now
                self.sections.update_one({"slug": s["slug"]}, {"$setOnInsert": doc}, upsert=True)
        self.load_sections()

    def load_sections(self):
        """The live section list is whatever is in the database (the site uses the same list)."""
        try:
            return load_sections(list(self.sections.find({}, {"slug": 1, "name": 1, "desc": 1, "tags": 1})))
        except PyMongoError as e:
            print(f"  ! could not refresh sections, keeping the current list: {str(e)[:100]}")
            return len(SECTIONS)

    # ------------------------------------------------------- publishing
    def publish_article(self, article: dict) -> dict:
        """Validate, then insert into MongoDB immediately. Retries with a
        unique slug if two titles collide."""
        validate_article(article)
        with self._lock:
            for attempt in range(4):
                try:
                    self.articles.insert_one(dict(article))
                    return article
                except DuplicateKeyError as e:
                    if "article_slug" in str(e) or "slug" in str(e):
                        article["slug"] = f"{article['slug'][:80]}-{article['id'][-6:]}" if attempt == 0 \
                            else f"{article['slug'][:70]}-{article['id'][-6:]}-{attempt}"
                        continue
                    raise
        raise RuntimeError("could not find a unique slug")

    # ----------------------------------------------------------- ledger
    def record(self, *, source_name, source_url, source_title, section, status,
               reason=None, article_id=None, title=None, retryable=False, snippet=None):
        """Upsert a ledger entry. status: published | skipped | failed.
        retryable=True: the story is worth another try later (a network error, an unfinished draft, a failed
        fact-check). It is tried again after RETRY_MINUTES, up to ITEM_MAX_ATTEMPTS times, then abandoned.
        Every event is appended to `history`, so the dashboard can show every reason it was ever skipped/failed.
        Returns {"retrying": bool, "attempts": n, "nextTryAt": iso|None, "reason": final reason}."""
        norm = normalise_url(source_url)
        now = now_iso()
        prev = self.ledger.find_one({"normUrl": norm}, {"attempts": 1}) or {}
        attempts = int(prev.get("attempts") or 0)
        cap = max_attempts()
        fields = {"sourceName": source_name, "sourceUrl": source_url, "sourceTitle": source_title,
                  "section": section, "status": status, "reason": reason,
                  "articleId": article_id, "articleTitle": title, "at": now}
        if snippet:
            fields["snippet"] = snippet[:SNIPPET_CHARS]
        unset = {}
        retrying, next_try = False, None
        if status == "published":
            fields.update(retryable=False, nextTryAt=None)
            unset["entry"] = ""
        else:
            attempts += 1
            fields["attempts"] = attempts
            if retryable and attempts < cap:
                retrying = True
                next_try = iso(datetime.now(timezone.utc) + timedelta(minutes=RETRY_MINUTES[min(attempts - 1, len(RETRY_MINUTES) - 1)]))
            elif retryable:
                fields["reason"] = reason = f"gave up after {attempts} tries: {reason}"
            fields.update(retryable=retrying, nextTryAt=next_try)
            if not retrying:
                unset["entry"] = ""
        update = {"$set": fields, "$setOnInsert": {"normUrl": norm, "firstSeenAt": now},
                  "$push": {"history": {"$each": [{"at": now, "status": status, "reason": reason, "attempt": attempts}],
                                        "$slice": -25}}}
        if unset:
            update["$unset"] = unset
        self.ledger.update_one({"normUrl": norm}, update, upsert=True)
        return {"retrying": retrying, "attempts": attempts, "nextTryAt": next_try, "reason": reason}

    # ----------------------------------------------- durable queue (nothing scraped is ever lost)
    def queue_entries(self, entries, feed_url):
        """Write every scraped feed entry to the ledger as status 'queued' the moment it is scraped, together with
        the data needed to write it. A story already known to the ledger is left untouched. Survives restarts, crashes,
        cooldowns and the story dropping off the feed."""
        ops = []
        now = now_iso()
        for e in entries:
            if not e.get("url") or not e.get("title"):
                continue
            ops.append(UpdateOne({"normUrl": normalise_url(e["url"])},
                                 {"$setOnInsert": {"normUrl": normalise_url(e["url"]), "firstSeenAt": now, "at": now,
                                                   "sourceName": e.get("source"), "sourceUrl": e["url"],
                                                   "sourceTitle": e["title"], "status": "queued", "attempts": 0,
                                                   "reason": None, "snippet": (e.get("text") or "")[:SNIPPET_CHARS],
                                                   "entry": entry_snapshot(e, feed_url)}},
                                 upsert=True))
        if not ops:
            return 0
        try:
            try:
                self.ledger.bulk_write(ops, ordered=False)
            except TypeError:                      # a driver/mock without bulk support: one by one
                for op in ops:
                    self.ledger.update_one(op._filter, op._doc, upsert=True)
        except PyMongoError as err:
            print(f"  ! could not queue scraped entries: {str(err)[:100]}")
            return 0
        return len(ops)

    def due_entries(self, feed_url, limit=200):
        """Stories of this feed that are waiting: never written yet ('queued') or a retry whose time has come.
        Returns entries ready for the pipeline."""
        now = now_iso()
        q = {"entry.feedUrl": feed_url,
             "$or": [{"status": "queued"}, {"retryable": True, "nextTryAt": {"$lte": now}}]}
        return [entry_from_snapshot(d["entry"]) for d in
                self.ledger.find(q).sort("firstSeenAt", ASCENDING).limit(limit) if d.get("entry")]

    def retry_holds(self):
        """{normalised url: nextTryAt iso} for stories whose retry time has not come yet."""
        now = now_iso()
        return {d["normUrl"]: d["nextTryAt"] for d in
                self.ledger.find({"retryable": True, "nextTryAt": {"$gt": now}}, {"normUrl": 1, "nextTryAt": 1})}

    def load_seen(self, seen, limit=50000):
        """Seeds a dedupe.SeenIndex with everything already covered (published or abandoned).
        Queued stories and stories waiting for a retry are NOT covered yet."""
        for e in self.ledger.find({}).sort("at", DESCENDING).limit(limit):
            if e.get("status") == "queued" or outcome_of(e) in ("queued", "retrying"):
                continue
            seen.add(e.get("sourceUrl"), e.get("sourceTitle"), e.get("articleTitle"), ref=e.get("articleId"))
        for a in self.articles.find({}, {"title": 1, "source_url": 1, "id": 1}).sort("publishedAt", DESCENDING).limit(limit):
            seen.add(a.get("source_url"), a.get("title"), ref=a.get("id"))
        return seen

    # ------------------------------------------------ admin review (Skipped / Failed pages)
    def review(self, kind, outcome=None, search=None, offset=0, limit=50):
        """Everything that was ever skipped (kind='skipped') or failed (kind='failed'), with every reason, the number
        of tries and the FINAL outcome: published later / will retry / abandoned."""
        q = {"$or": [{"history.status": kind}, {"status": kind}]}
        if search:
            q = {"$and": [q, {"$or": [{"sourceTitle": {"$regex": re.escape(search), "$options": "i"}},
                                      {"sourceName": {"$regex": re.escape(search), "$options": "i"}},
                                      {"reason": {"$regex": re.escape(search), "$options": "i"}}]}]}
        rows = [_public(d) for d in self.ledger.find(q).sort("at", DESCENDING).limit(5000)]
        out, counts = [], {"published": 0, "retrying": 0, "abandoned": 0}
        for d in rows:
            d["outcome"] = outcome_of(d)
            counts[d["outcome"]] = counts.get(d["outcome"], 0) + 1
            if outcome and d["outcome"] != outcome:
                continue
            d.pop("entry", None)
            out.append(shape_review(d))
        return {"items": out[offset:offset + limit], "total": len(out), "counts": counts}

    def ledger_summary(self):
        out = {}
        for r in self.ledger.aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
            out[r["_id"]] = r["n"]
        return out

    def recent_ledger(self, limit=50):
        return [_public(e) for e in self.ledger.find({}).sort("at", DESCENDING).limit(limit)]

    # -------------------------------------------------------- dashboard
    def source_stats(self):
        """Per-source counts from the ledger: {source: {published, skipped, failed, lastAt}}."""
        out = {}
        for r in self.ledger.aggregate([{"$group": {"_id": {"s": "$sourceName", "st": "$status"},
                                                    "n": {"$sum": 1}, "last": {"$max": "$at"}}}]):
            d = out.setdefault(r["_id"]["s"], {"published": 0, "skipped": 0, "failed": 0, "lastAt": None})
            d[r["_id"]["st"]] = r["n"]
            if not d["lastAt"] or (r["last"] and r["last"] > d["lastAt"]):
                d["lastAt"] = r["last"]
        return out

    def section_counts(self):
        return {r["_id"]: r["n"] for r in self.articles.aggregate(
            [{"$match": {"status": "published"}}, {"$group": {"_id": "$section", "n": {"$sum": 1}}}])}

    def list_reports(self, limit=60):
        return [_public(d) for d in self.db["reports"].find({}).sort("date", DESCENDING).limit(limit)]

    def get_report(self, date):
        return _public(self.db["reports"].find_one({"date": date}))

    # ------------------------------------------------------------- reads
    def _filter(self, category=None, hashtag=None, search=None):
        f = {"status": "published"}
        ands = []
        if category:
            ands.append({"$or": [{"section": slugify(category)}, {"sections": slugify(category)}, {"tag": _rx_exact(category)},
                                 {"category": _rx_exact(category)}]})
        if hashtag:
            ands.append({"hashtags": _rx_exact("#" + hashtag.lstrip("#"))})
        if search and search.strip():
            q = _rx(search.strip())
            ands.append({"$or": [{"title": q}, {"tag": q}, {"desk": q}, {"excerpt": q}]})
        if ands:
            f["$and"] = ands
        return f

    def list_posts(self, category=None, hashtag=None, search=None, sort="newest",
                   offset=0, limit=None):
        f = self._filter(category, hashtag, search)
        total = self.articles.count_documents(f)
        if sort in ("trending", "viral"):
            # Ranked in Python over the most recent window (views/min needs "now").
            docs = list(self.articles.find(f).sort([("publishedAt", DESCENDING), ("slug", ASCENDING)]).limit(1000))
            now = datetime.now(timezone.utc)

            def score(d):
                dt = _parse_dt(d.get("publishedAt") or "") or now
                mins = max((now - dt).total_seconds() / 60.0, 1.0)
                v = d.get("views") or 0
                return v / mins if sort == "viral" else v / math.pow(mins / 60.0 + 2, 1.5)
            docs.sort(key=lambda d: (score(d), d.get("publishedAt") or ""), reverse=True)
            docs = docs[offset: offset + limit] if limit is not None else docs[offset:]
            return [_public(d) for d in docs], total

        order = {"oldest": [("publishedAt", ASCENDING), ("slug", ASCENDING)],
                 "created": [("createdAt", DESCENDING), ("slug", ASCENDING)],    # dashboard: when WE published it

                 "popular": [("views", DESCENDING), ("slug", ASCENDING)]}.get(
            sort, [("publishedAt", DESCENDING), ("slug", ASCENDING)])
        cur = self.articles.find(f).sort(order).skip(max(offset, 0))
        if limit is not None:
            cur = cur.limit(limit)
        return [_public(d) for d in cur], total

    def get_post(self, key: str):
        """By stable id (art_...) or by slug."""
        return _public(self.articles.find_one({"$or": [{"id": key}, {"slug": key}], "status": "published"}))

    def all_hashtags(self):
        return sorted(t for t in self.articles.distinct("hashtags", {"status": "published"}) if t)

    def category_names(self):
        return [s["name"] for s in SECTIONS]

    # ------------------------------------------------------------ writes
    def increment_views(self, key: str):
        """Atomic. views starts as null (unknown); the first real view makes it
        a measured number."""
        match = {"$or": [{"id": key}, {"slug": key}]}
        for _ in range(3):
            r = self.articles.find_one_and_update(
                {**match, "views": {"$type": "number"}}, {"$inc": {"views": 1}}, return_document=True)
            if not r:
                r = self.articles.find_one_and_update(
                    {**match, "views": None},
                    {"$set": {"views": 1, "provenance.engagement": "measured"}}, return_document=True)
            if r:
                return r["views"]
            if not self.articles.find_one(match, {"id": 1}):
                return None
        return None

    def update_post(self, key: str, updates: dict):
        """Editable: title, excerpt, html_body, hashtags, category(tag), img."""
        cur = self.articles.find_one({"$or": [{"id": key}, {"slug": key}]})
        if not cur:
            return None
        new = {}
        for f in ("title", "excerpt", "hashtags", "img"):
            if f in updates and updates[f] is not None:
                new[f] = updates[f]
        if "img" in new:
            new["imageAlt"] = new.get("title", cur["title"])
        if "html_body" in updates and updates["html_body"]:
            html = sanitize_html(updates["html_body"])
            body = html_to_paragraphs(html)
            mins = reading_minutes(body)
            new.update(html_body=html, body=body, readingMinutes=mins, time=f"{mins} min",
                       subtitle=f"{cur['tag']} · {mins} min read")
        new["updatedAt"] = now_iso()
        merged = {**{k: v for k, v in cur.items() if k != "_id"}, **new}
        validate_article(merged)
        self.articles.update_one({"_id": cur["_id"]}, {"$set": new})
        return _public(self.articles.find_one({"_id": cur["_id"]}))


def _rx_exact(text):
    return {"$regex": f"^{re.escape(text)}$", "$options": "i"}


_instance = None


def get_storage():
    """Lazy singleton so importing this module never needs a live database."""
    global _instance
    if _instance is None:
        _instance = MongoStorage()
        _instance.ensure_ready()
    return _instance
