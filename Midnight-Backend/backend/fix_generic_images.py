"""
Repair articles (and trend posts) that are ALREADY published with a generic placeholder picture, e.g. NPR's
headphones artwork, or the same banner on every story of one outlet.

For every published item the picture is downloaded and fingerprinted (images.py). An item is flagged when its picture
is known placeholder art, or when the same picture is on more articles than IMAGE_MAX_REUSE_SAME_SOURCE /
IMAGE_MAX_REUSE_ANY allow. For each flagged item the article page is read again and the first REAL picture is put in
(`img`), skipping every flagged picture. Items with no real picture are left alone, or taken offline with --unpublish
(status -> "draft", reversible).

    python fix_generic_images.py                  # DRY RUN: lists what is wrong and what it would change
    python fix_generic_images.py --go             # writes the replacement pictures
    python fix_generic_images.py --go --unpublish # ...and drafts the ones that have no real picture
    python fix_generic_images.py --trends         # also check the trend posts
    python fix_generic_images.py --limit 500      # only look at the newest N (default: all)

It also (re)builds the `imageFingerprints` table the live pipeline uses to refuse placeholders.
"""
import argparse
from datetime import datetime, timezone

import config
import images


def fingerprint(url, get=None):
    """Fingerprint of the image at `url`, or None if it cannot be fetched/decoded."""
    kw = {"get": get} if get else {}
    ok, _why, final = images._verify_once(url, **kw)
    return images.fingerprint_of(final) if ok else None


def scan(docs, fp_of, settings):
    """docs: [{_id, img, source_name, ...}]. Returns (fps {id: fp|None}, flagged {id: reason})."""
    fps = {d["_id"]: fp_of(d["img"]) if d.get("img") else None for d in docs}
    flagged = {}
    known = images.KNOWN_GENERIC
    for d in docs:
        fp = fps[d["_id"]]
        if not fp:
            continue
        hit = next((n for n, k in known.items() if images.hamming(fp, k) <= images.NEAR_BITS), None)
        if hit:
            flagged[d["_id"]] = f"known placeholder: {hit}"
            continue
        near = [o for o in docs if fps[o["_id"]] and images.hamming(fp, fps[o["_id"]]) <= images.NEAR_BITS]
        same = [o for o in near if o.get("source_name") == d.get("source_name")]
        # the picture is "too common" when it sits on MORE articles than allowed (the item itself counts as one)
        if settings["same_source"] and len(same) - 1 >= settings["same_source"]:
            flagged[d["_id"]] = f"{d.get('source_name')} uses this same picture on {len(same)} articles"
        elif settings["any_source"] and len(near) > settings["any_source"]:
            flagged[d["_id"]] = f"this same picture is on {len(near)} articles"
    return fps, flagged


def replacement(doc, bad_fps, candidates_of, pick):
    """First real picture for `doc` that is not one of the flagged pictures, or None."""
    guard = images.ImageGuard(settings={"same_source": 0, "any_source": 0})        # known placeholders only
    good, _ = pick([c for c in candidates_of(doc) if c != doc.get("img")], limit=3, source=None, guard=guard,
                   max_tries=config.retry_settings()["image_tries"], referer=doc.get("source_url"))
    for url in good:
        fp = images.fingerprint_of(url)
        if fp and not any(images.hamming(fp, b) <= images.NEAR_BITS for b in bad_fps):
            return url
    return None


def run(db, collection="articles", go=False, unpublish=False, limit=None, fp_of=fingerprint, candidates_of=None,
        pick=images.pick_verified_images, log=print):
    settings = config.image_guard_settings()
    if candidates_of is None:
        import scraper
        candidates_of = lambda d: scraper._scrape_html_fallback(d["source_url"], d.get("source_name"))[1]   # noqa: E731
    cur = db[collection].find({"status": "published"}, {"title": 1, "img": 1, "source_name": 1, "source_url": 1}).sort("createdAt", -1)
    docs = list(cur.limit(limit) if limit else cur)
    log(f"{collection}: fingerprinting {len(docs)} pictures ...")
    fps, flagged = scan(docs, fp_of, settings)
    bad_fps = [fps[i] for i in flagged if fps[i]]
    log(f"{collection}: {len(flagged)} of {len(docs)} have a generic picture")
    fixed = drafted = left = 0
    for d in docs:
        if d["_id"] not in flagged:
            continue
        new = replacement(d, bad_fps, candidates_of, pick) if d.get("source_url") else None
        label = f"  - {d.get('source_name')}: {d['title'][:70]}  [{flagged[d['_id']]}]"
        if new:
            log(f"{label}\n      -> {new}")
            if go:
                db[collection].update_one({"_id": d["_id"]}, {"$set": {"img": new, "updatedAt": datetime.now(timezone.utc).isoformat()}})
                fps[d["_id"]] = images.fingerprint_of(new)
            fixed += 1
        elif unpublish:
            log(f"{label}\n      -> no real picture found: {'drafted' if go else 'would be drafted'}")
            if go:
                db[collection].update_one({"_id": d["_id"]}, {"$set": {"status": "draft"}})
            drafted += 1
        else:
            log(f"{label}\n      -> no real picture found, left as it is")
            left += 1
    if go:                                           # rebuild the table the live pipeline checks against
        t = db["imageFingerprints"]
        for d in docs:
            fp = fps.get(d["_id"])
            if fp and d["_id"] not in flagged and not t.find_one({"ref": str(d["_id"])}):
                t.insert_one({"fp": fp, "url": d.get("img"), "source": d.get("source_name"), "ref": str(d["_id"]),
                              "at": datetime.now(timezone.utc).isoformat()})
    log(f"{collection}: {fixed} picture(s) {'replaced' if go else 'would be replaced'}, "
        f"{drafted} {'drafted' if go else 'would be drafted'}, {left} left as they are")
    return {"flagged": len(flagged), "fixed": fixed, "drafted": drafted, "left": left}


if __name__ == "__main__":
    from pymongo import MongoClient
    ap = argparse.ArgumentParser()
    ap.add_argument("--go", action="store_true", help="write the changes (default: dry run)")
    ap.add_argument("--unpublish", action="store_true", help="set items with no real picture to draft")
    ap.add_argument("--trends", action="store_true", help="also check the trend posts")
    ap.add_argument("--limit", type=int, default=None)
    a = ap.parse_args()
    db = MongoClient(config.get_mongo_uri())[config.get_mongo_db_name()]
    run(db, "articles", go=a.go, unpublish=a.unpublish, limit=a.limit)
    if a.trends:
        run(db, "trends", go=a.go, unpublish=a.unpublish, limit=a.limit)
    if not a.go:
        print("\nDry run only. Add --go to apply.")
