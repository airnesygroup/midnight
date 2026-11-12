"""
Repair the backlog in `ingestLedger` after the scraper/retry fixes.

  1. STUCK "will retry" rows   rows that said "Will retry" (0/5, 13 days old...) but could never come back, because they
                               had no saved snapshot / due time. They are given what they lack and become due now.
                               (generate.py also does this by itself at start-up and every 30 minutes.)
  2. OLD-POLICY casualties     stories abandoned for reasons that a different approach can fix: source text too thin, no
                               verifiable image, interrupted downloads (ChunkedEncodingError / Read timed out). They get a
                               fresh set of tries (the first try + 5 retries, each with a different approach).
                               Never reopened: published stories, "same story already covered", anything older than --days.

    python requeue_stuck.py                 # dry run: shows how many rows each step would touch
    python requeue_stuck.py --go            # does it
    python requeue_stuck.py --go --days 30  # reach further back
    python requeue_stuck.py --go --also "incomplete"   # extra reason substring(s) to reopen
"""
import argparse
import re

from sources import interleaved
from storage import get_storage

DEFAULT_REASONS = ["too thin", "no verifiable image", "ChunkedEncodingError", "ConnectionError", "IncompleteRead",
                   "Read timed out", "file too large", "HTTP 406", "gave up after"]

ap = argparse.ArgumentParser()
ap.add_argument("--go", action="store_true", help="actually change the database (default: dry run)")
ap.add_argument("--days", type=int, default=14, help="only stories first seen within this many days (default 14)")
ap.add_argument("--also", action="append", default=[], help="extra reason substring to reopen")
a = ap.parse_args()

st = get_storage()
feed_by_source = {}
for name, url, _section in interleaved():
    feed_by_source.setdefault(name, url)

pattern = "|".join(re.escape(r) for r in DEFAULT_REASONS + a.also)
if a.go:
    stuck = st.rescue_stuck(feed_by_source)
    reopened = st.requeue_abandoned(pattern, days=a.days, feed_by_source=feed_by_source)
    print(f"repaired {stuck} stuck 'will retry' row(s); reopened {reopened} abandoned row(s) for a new set of tries.")
else:
    q = {"status": {"$in": ["failed", "skipped"]}, "$or": [
        {"status": "failed", "retryable": {"$exists": False}},
        {"retryable": True, "entry": {"$exists": False}},
        {"retryable": True, "nextTryAt": None}]}
    print(f"{st.ledger.count_documents(q)} stuck 'will retry' row(s) would be repaired.")
    print(f"{st.requeue_abandoned(pattern, days=a.days, feed_by_source=feed_by_source, dry_run=True)} abandoned row(s) "
          f"(last {a.days} days) would be reopened for a new set of tries.")
    print("(dry run; add --go to do it)")
