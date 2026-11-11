"""
Builds and validates Midnight Trends documents for the `trends` collection
(lovable/src/lib/mongodb/schemas.ts, trendSchema). The schema is STRICT, like
the article one: no extra keys, exact types. Trends have no html_body, section,
tag, desk or voice; hashtags (without '#') replace sections/categories.
"""

import math
import re
import uuid

from schema import (DATETIME_RE, SLUG_RE, URL_RE, html_to_paragraphs, now_iso,
                    reading_minutes, sanitize_html, slugify)

TREND_KEYS = {
    "schemaVersion", "id", "slug", "title", "subtitle", "excerpt", "body", "summary",
    "hashtags", "img", "imageAlt", "readingMinutes", "time", "createdAt", "updatedAt",
    "publishedAt", "source_name", "source_url", "views", "shares", "headlineWeight",
    "featured", "status", "provenance",
}

# A shared vocabulary keeps the site's hashtag dropdown tidy. The writer picks
# from these first and may add up to two specific tags of its own.
HASHTAG_VOCAB = [
    "Viral", "Celebrity", "Music", "Movies", "TV", "Sports", "Football", "Basketball",
    "Gaming", "Technology", "AI", "Fashion", "Beauty", "Food", "Travel", "Lifestyle",
    "Health", "Science", "Business", "Finance", "Crypto", "Politics", "World", "Weather",
    "Education", "Memes", "SocialMedia", "Cars", "Pets", "Space", "Culture", "Events",
]
_VOCAB_BY_LOW = {h.lower(): h for h in HASHTAG_VOCAB}


def clean_hashtag(raw):
    """'#new york' -> 'NewYork'; keeps vocabulary casing; '' if unusable."""
    t = re.sub(r"[^A-Za-z0-9 ]+", " ", (raw or "").lstrip("#")).strip()
    if not t or len(t) > 30:
        return ""
    if t.lower() in _VOCAB_BY_LOW:
        return _VOCAB_BY_LOW[t.lower()]
    t = "".join(w[:1].upper() + w[1:] for w in t.split())
    return t if 2 <= len(t) <= 24 else ""


def clean_hashtags(raws, fallback_from=None, max_tags=5):
    out, seen = [], set()
    for r in raws or []:
        h = clean_hashtag(r)
        if h and h.lower() not in seen:
            seen.add(h.lower())
            out.append(h)
    if not out and fallback_from:
        h = clean_hashtag(fallback_from)
        out = [h] if h else []
    return (out or ["Viral"])[:max_tags]


def headline_weight(traffic_min, geo_count, source_count):
    """0..100 from Google's traffic floor (log scale), how many countries it is
    trending in and how many sources we could read. Real signals only."""
    t = max(int(traffic_min or 0), 1)
    base = 22 + 11 * math.log10(t)                    # 200 -> ~47, 20K -> ~69, 2M -> ~91
    bonus = min(max(geo_count - 1, 0) * 3, 9) + min(max(source_count - 1, 0), 3)
    return int(max(0, min(100, round(base + bonus - 8))))


def build_trend(*, title, excerpt, summary, html_body, hashtags, img, source_name, source_url,
                weight, published_at=None, subtitle=None):
    html_body = sanitize_html(html_body)
    body = html_to_paragraphs(html_body)
    mins = reading_minutes(body)
    now = now_iso()
    tags = list(hashtags)
    summary = [s.strip() for s in (summary or []) if s and s.strip()][:3] or [excerpt]
    return {
        "schemaVersion": 1,
        "id": "trd_" + uuid.uuid4().hex[:12],
        "slug": slugify(title, 90),
        "title": title.strip(),
        "subtitle": subtitle or f"{tags[0]} · {mins} min read",
        "excerpt": excerpt.strip(),
        "body": body,
        "summary": summary,
        "hashtags": tags,
        "img": img,
        "imageAlt": title.strip(),
        "readingMinutes": mins,
        "time": f"{mins} min",
        "createdAt": now,
        "updatedAt": now,
        "publishedAt": published_at or now,
        "source_name": source_name,
        "source_url": source_url,
        "views": None, "shares": None,
        "headlineWeight": int(weight),
        "featured": False,
        "status": "published",
        "provenance": {"content": "measured", "publication": "measured", "engagement": "unknown"},
    }


def _is_count(v):
    return v is None or (isinstance(v, int) and not isinstance(v, bool) and v >= 0)


def validate_trend(t):
    """Raises ValueError listing every violation of the strict trend schema."""
    errs = []
    extra, missing = set(t) - TREND_KEYS - {"_id"}, TREND_KEYS - set(t)
    if extra:
        errs.append(f"unknown keys {sorted(extra)}")
    if missing:
        errs.append(f"missing keys {sorted(missing)}")
    if errs:
        raise ValueError("; ".join(errs))
    if t["schemaVersion"] != 1:
        errs.append("schemaVersion must be 1")
    for k in ("id", "title"):
        if not (isinstance(t[k], str) and t[k]):
            errs.append(f"{k} must be a non-empty string")
    for k in ("subtitle", "excerpt", "imageAlt", "time"):
        if not isinstance(t[k], str):
            errs.append(f"{k} must be a string")
    if not (isinstance(t["slug"], str) and SLUG_RE.match(t["slug"])):
        errs.append("slug invalid")
    for k in ("body", "summary"):
        if not (isinstance(t[k], list) and all(isinstance(x, str) for x in t[k])):
            errs.append(f"{k} must be a list of strings")
    h = t["hashtags"]
    if not (isinstance(h, list) and h and all(isinstance(x, str) and x and not x.startswith("#") for x in h)):
        errs.append("hashtags must be a non-empty list of strings without '#'")
    if not (isinstance(t["img"], str) and re.match(r"^https://[^\s/]+\.[^\s/]+/\S*$", t["img"])):
        errs.append("img must be a real https image URL")
    if not (isinstance(t["readingMinutes"], int) and t["readingMinutes"] > 0):
        errs.append("readingMinutes must be a positive int")
    for k in ("createdAt", "updatedAt", "publishedAt"):
        if t[k] is not None and not (isinstance(t[k], str) and DATETIME_RE.match(t[k])):
            errs.append(f"{k} must be an ISO datetime with offset")
    if t["source_name"] is not None and not isinstance(t["source_name"], str):
        errs.append("source_name must be string|null")
    if t["source_url"] is not None and not (isinstance(t["source_url"], str) and URL_RE.match(t["source_url"])):
        errs.append("source_url must be a URL|null")
    for k in ("views", "shares"):
        if not _is_count(t[k]):
            errs.append(f"{k} must be a non-negative int|null")
    w = t["headlineWeight"]
    if isinstance(w, bool) or not isinstance(w, (int, float)) or not 0 <= w <= 100:
        errs.append("headlineWeight must be 0..100")
    if not isinstance(t["featured"], bool):
        errs.append("featured must be bool")
    if t["status"] not in ("draft", "published", "archived"):
        errs.append("status invalid")
    p, ok = t["provenance"], {"sample", "measured", "unknown"}
    if not (isinstance(p, dict) and set(p) == {"content", "publication", "engagement"} and all(v in ok for v in p.values())):
        errs.append("provenance invalid")
    if errs:
        raise ValueError("; ".join(errs))
    return True
