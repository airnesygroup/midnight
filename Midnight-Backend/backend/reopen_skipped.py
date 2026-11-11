"""
Give articles that were skipped by a BUG (not by a real reason) another chance.

Skipped URLs are remembered forever in `ingestLedger`. After fixing a check, run this to forget the skips whose
reason was one of the fixed checks, so the writer looks at those stories again (if they are still in the feeds).

    python reopen_skipped.py            # shows what it would reopen
    python reopen_skipped.py --go       # does it

Reasons reopened by default: failed fact-check, no verifiable image. Never reopened: duplicates, thin source text,
and anything that was published. Use --also "thin" to include other reasons (substring match).
"""
import argparse
import re

import config
from pymongo import MongoClient

ap = argparse.ArgumentParser()
ap.add_argument("--go", action="store_true")
ap.add_argument("--also", action="append", default=[], help="extra reason substring to reopen")
a = ap.parse_args()

db = MongoClient(config.get_mongo_uri())[config.get_mongo_db_name()]
pattern = "|".join(map(re.escape, ["fact-check", "no verifiable image", *a.also]))
q = {"status": {"$in": ["skipped", "failed"]}, "reason": {"$regex": pattern, "$options": "i"}}
n = db["ingestLedger"].count_documents(q)
print(f"{n} skipped/failed ledger entries match /{pattern}/")
if a.go:
    print("reopened:", db["ingestLedger"].delete_many(q).deleted_count)
else:
    print("(dry run; add --go to reopen them)")
