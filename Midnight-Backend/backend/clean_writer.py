"""
Empties the writer's memory in MongoDB (there is no local database).  STOP the app first (Ctrl+C).

    python clean_writer.py             # shows what would be deleted
    python clean_writer.py --go        # deletes the writer's memory collections
    python clean_writer.py --go --all  # ...and also articles, trends and reports (the published content)

Memory collections: ingestLedger (URLs already covered), trendLedger (trends already seen), headlineSignals,
reportRuns (when each report was written), ingestEvents, trendEvents, systemState.
NEVER touched: sections and everything else the Lovable site uses. Collections are emptied with delete_many, not
dropped, so their schema validators and unique indexes stay.
"""
import argparse

MEMORY = ["ingestLedger", "trendLedger", "headlineSignals", "reportRuns", "ingestEvents", "trendEvents", "systemState"]
CONTENT = ["articles", "trends", "reports"]
NEVER = {"sections"}


def clean(db, include_content=False, go=False):
    """Returns {collection: documents deleted (or that would be)}."""
    names = [n for n in MEMORY + (CONTENT if include_content else []) if n not in NEVER]
    out = {}
    for name in names:
        out[name] = db[name].delete_many({}).deleted_count if go else db[name].count_documents({})
    return out


if __name__ == "__main__":
    import config
    from pymongo import MongoClient
    ap = argparse.ArgumentParser()
    ap.add_argument("--go", action="store_true", help="really delete (default: only count)")
    ap.add_argument("--all", action="store_true", help="also articles, trends and reports")
    a = ap.parse_args()
    db = MongoClient(config.get_mongo_uri())[config.get_mongo_db_name()]
    print(f"Database: {db.name}   mode: {'DELETE' if a.go else 'dry run'}")
    for name, n in clean(db, a.all, a.go).items():
        print(f"  {name}: {n} {'deleted' if a.go else 'would be deleted'}")
    if not a.go:
        print("Nothing was deleted. Add --go to do it.")
