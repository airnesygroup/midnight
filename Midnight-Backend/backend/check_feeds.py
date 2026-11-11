#!/usr/bin/env python3
"""
Checks every news feed, so you know which of the ~450 publishers really work from YOUR machine.

    python check_feeds.py                  test all feeds, print a summary, write feeds_report.csv
    python check_feeds.py --disable-dead   also write sources_disabled.txt (dead feeds are then skipped by the pipeline)
    python check_feeds.py --enable-all     delete sources_disabled.txt (try everything again)

A feed is OK when it answers 200 and contains at least one item. The pipeline already survives dead feeds; this just
stops it wasting a request on them every pass and tells you how many distinct publishers are live (aim: 200+).
"""

import argparse
import csv
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup

import sources
from scraper import HEADERS, _parse_date

HERE = os.path.dirname(os.path.abspath(__file__))


def check(src):
    name, url, section = src
    row = {"name": name, "url": url, "section": section, "status": "", "items": 0, "newest": "", "problem": ""}
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        row["status"] = r.status_code
        if r.status_code != 200:
            row["problem"] = f"HTTP {r.status_code}"
            return row
        soup = BeautifulSoup(r.content, "xml")
        items = soup.find_all("item") or soup.find_all("entry")
        row["items"] = len(items)
        dates = []
        for it in items[:20]:
            d = it.find("pubDate") or it.find("published") or it.find("updated") or it.find("dc:date")
            dt = _parse_date(d.text if d else None)
            if dt:
                dates.append(dt)
        if dates:
            row["newest"] = max(dates).date().isoformat()
        if not items:
            row["problem"] = "no items (not an RSS/Atom feed, or empty)"
    except Exception as e:  # noqa: BLE001
        row["problem"] = f"{type(e).__name__}: {str(e)[:80]}"
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--disable-dead", action="store_true")
    ap.add_argument("--enable-all", action="store_true")
    ap.add_argument("--workers", type=int, default=16)
    a = ap.parse_args()
    path = os.path.join(HERE, "sources_disabled.txt")
    if a.enable_all:
        if os.path.exists(path):
            os.remove(path)
        print("sources_disabled.txt removed: every feed is active again.")
        return
    rows = []
    with ThreadPoolExecutor(a.workers) as ex:
        for i, row in enumerate(ex.map(check, sources.ALL_SOURCES), 1):
            rows.append(row)
            print(f"[{i}/{len(sources.ALL_SOURCES)}] {'OK  ' if not row['problem'] else 'DEAD'} {row['name']}"
                  + (f"  ({row['problem']})" if row["problem"] else f"  {row['items']} items, newest {row['newest'] or '?'}"))
            sys.stdout.flush()
    ok = [r for r in rows if not r["problem"]]
    dead = [r for r in rows if r["problem"]]
    live_sites = {sources.site_of(r["name"]) for r in ok}
    with open(os.path.join(HERE, "feeds_report.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"\n{len(ok)} feeds work, {len(dead)} are dead. Working distinct publishers: {len(live_sites)} "
          f"({'at least 200, good' if len(live_sites) >= 200 else 'BELOW 200: add more feeds to sources_extra.py'}).")
    print("Full list: backend/feeds_report.csv")
    if a.disable_dead:
        with open(path, "w", encoding="utf-8") as f:
            f.write(f"# written by check_feeds.py {datetime.now(timezone.utc).isoformat()}; run it again to refresh\n")
            for r in dead:
                f.write(f"{r['url']}  # {r['name']}: {r['problem']}\n")
        print(f"{len(dead)} dead feeds written to sources_disabled.txt; the pipeline now skips them.")


if __name__ == "__main__":
    main()
