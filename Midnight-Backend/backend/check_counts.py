"""
Where do the dashboard numbers come from, and are they real?   python check_counts.py

  Articles live  = documents in `articles` with status "published"   (what the website shows; NOT scraped items)
  Skipped/Failed = distinct source URLs in `ingestLedger` with that status, ALL TIME (a URL counts once)
  "N this session" = counter inside the running generate.py process; it restarts from 0 on every restart

This prints the real picture straight from MongoDB: articles per day (by when they were WRITTEN), the newest ones, and
whether any article is stored twice (two pipeline processes running at once would do that).
"""
from collections import Counter
from pymongo import MongoClient
import config

db = MongoClient(config.get_mongo_uri())[config.get_mongo_db_name()]
arts = list(db["articles"].find({"status": "published"},
                                {"title": 1, "source_url": 1, "source_name": 1, "createdAt": 1, "publishedAt": 1, "provenance": 1}))
print(f"published articles in the database: {len(arts)}")

by_day = Counter((a.get("createdAt") or "")[:10] for a in arts)
print("\nwritten per UTC day (createdAt):")
for d, n in sorted(by_day.items())[-7:]:
    print(f"  {d}  {n}")

print("\nnewest 10 by WHEN THEY WERE WRITTEN  (publishedAt = the source's own timestamp, which is what the site sorts by):")
for a in sorted(arts, key=lambda x: x.get("createdAt") or "", reverse=True)[:10]:
    print(f"  written {a.get('createdAt','')[:16]}  source-time {a.get('publishedAt','')[:16]}  [{a.get('source_name')}] {a.get('title','')[:60]}")

dup_url = [u for u, n in Counter(a.get("source_url") for a in arts).items() if n > 1]
dup_title = [t for t, n in Counter((a.get("title") or "").lower() for a in arts).items() if n > 1]
print(f"\nsame source URL stored more than once: {len(dup_url)}   same title more than once: {len(dup_title)}")
for u in dup_url[:5]:
    print("  ", u)

print("\nledger (all time, one row per URL):", {r["_id"]: r["n"] for r in db["ingestLedger"].aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}}}])})
st = db["systemState"].find_one({"_id": "generator"}) or {}
print(f"pipeline process: pid {st.get('pid')}, session published {st.get('published')}, started {st.get('startedAt')}, heartbeat {st.get('heartbeat')}")
runs = list(db["reportRuns"].find({}).sort("writtenAt", -1).limit(3))
print("last reports written:", [(r.get("date"), r.get("writtenAt")) for r in runs] or "none")
