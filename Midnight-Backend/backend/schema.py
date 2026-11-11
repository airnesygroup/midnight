"""
Builds and validates article documents that follow the Lovable/Midnight
`articles` schema (lovable/src/lib/mongodb/schemas.ts, articleSchema).

The schema is STRICT: no extra keys, exact types. validate_article() mirrors
the Zod rules so a bad document is rejected here instead of being pushed
into the live collection where the front end would choke on it.
"""

import json
import os
import re
import uuid
from datetime import datetime, timezone

import nh3

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(BACKEND_DIR, "sections.json"), encoding="utf-8") as _f:
    SECTIONS = json.load(_f)
SECTION_BY_SLUG = {s["slug"]: s for s in SECTIONS}
# sections.json is only the first-run seed. The live list is the MongoDB `sections` collection
# (the site reads it too); load_sections() swaps it in, in place, so every importer sees it.

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
DATETIME_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")
URL_RE = re.compile(r"^https?://[^\s]+$")

ARTICLE_KEYS = {
    "schemaVersion", "id", "slug", "title", "subtitle", "excerpt", "body",
    "html_body", "summary", "section", "sections", "tag", "category", "desk", "img",
    "imageAlt", "hashtags", "readingMinutes", "time", "createdAt", "updatedAt",
    "publishedAt", "source_name", "source_url", "voice", "views", "shares",
    "saves", "likes", "comments", "headlineWeight", "featured", "status",
    "provenance",
}

MAX_SECTIONS = 3
_NAME_TO_SLUG = {s["name"].lower(): s["slug"] for s in SECTIONS}


def load_sections(docs):
    """Replace the in-memory section list with the live one (documents from the `sections`
    collection). Malformed documents are ignored; an empty result leaves the current list alone.
    Returns the number of sections now loaded."""
    fresh = []
    for d in docs or []:
        slug, name = d.get("slug"), d.get("name")
        if not (isinstance(slug, str) and SLUG_RE.match(slug) and isinstance(name, str) and name.strip()):
            continue
        tags = [t for t in (d.get("tags") or []) if isinstance(t, str) and t.strip()] or [name.strip()]
        fresh.append({"slug": slug, "name": name.strip(), "desc": d.get("desc") or "", "tags": tags})
    if fresh:
        SECTIONS[:] = fresh
        SECTION_BY_SLUG.clear()
        SECTION_BY_SLUG.update({s["slug"]: s for s in fresh})
        _NAME_TO_SLUG.clear()
        _NAME_TO_SLUG.update({s["name"].lower(): s["slug"] for s in fresh})
    return len(SECTIONS)


def _as_slug(raw: str) -> str:
    t = re.sub(r"\s+", " ", (raw or "").strip().strip("#*`\"'").lower())
    if t in SECTION_BY_SLUG:
        return t
    if t in _NAME_TO_SLUG:
        return _NAME_TO_SLUG[t]
    return re.sub(r"[^a-z0-9]+", "-", t.replace("&", "and")).strip("-")


def resolve_sections(candidates, fallback):
    """Turns the writer model's section picks into a clean list of real UI sections.

    * Only slugs that exist in sections.json survive (names like "Middle East" are mapped).
    * Duplicates are dropped, at most MAX_SECTIONS are kept, order = relevance (primary first).
    * "world" is the catch-all: it is never the primary section when a more specific one was chosen.
    * If the model gave nothing usable, the feed's own section is used so the article is never lost.
    """
    out = []
    for c in candidates or []:
        slug = _as_slug(c)
        if slug in SECTION_BY_SLUG and slug not in out:
            out.append(slug)
    if len(out) > 1 and "world" in out:
        out = [x for x in out if x != "world"] + ["world"]
    out = out[:MAX_SECTIONS]
    if out:
        return out
    if fallback in SECTION_BY_SLUG:
        return [fallback]
    return ["world"] if "world" in SECTION_BY_SLUG else [SECTIONS[0]["slug"]]   # feed's section was removed from the site


ALLOWED_TAGS = {"p", "b", "i", "strong", "em", "h3", "ul", "ol", "li", "br",
                "blockquote", "figure", "img"}
ALLOWED_ATTRS = {"img": {"src", "alt", "loading"}, "figure": {"class"}}


def sanitize_html(html: str) -> str:
    """Allowlist sanitizer (nh3). Editorial formatting only: no scripts, no
    event handlers, no javascript: URLs."""
    return nh3.clean(html or "", tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRS,
                     url_schemes={"http", "https"}, link_rel=None).strip()


def iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
        f"{dt.microsecond // 1000:03d}Z"


def now_iso() -> str:
    return iso(datetime.now(timezone.utc))


def slugify(text: str, max_len: int = 90) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    s = s[:max_len].strip("-")
    return s or "article"


def html_to_paragraphs(html: str):
    """Plain-text paragraphs for the `body` array."""
    html = re.sub(r"<figure.*?</figure>", "", html, flags=re.S)
    parts = re.findall(r"<(?:p|h3|li|blockquote)[^>]*>(.*?)</(?:p|h3|li|blockquote)>", html, flags=re.S)
    out = []
    for p in parts:
        t = re.sub(r"<[^>]+>", "", p)
        t = nh3.clean(t, tags=set())  # escape stray markup
        t = re.sub(r"\s+", " ", t.replace("&amp;", "&").replace("&quot;", '"')
                   .replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">")).strip()
        if t:
            out.append(t)
    return out


def reading_minutes(paragraphs) -> int:
    words = sum(len(p.split()) for p in paragraphs)
    return max(1, round(words / 220))


def build_article(*, title, excerpt, summary, html_body, section_slug, hashtags,
                  img, source_name, source_url, voice, published_at, headline_weight=40,
                  section_slugs=None):
    """Assembles a full, schema-conformant article document.

    section_slug is the PRIMARY section (drives tag/category/desk). section_slugs is the full
    list the story belongs to, primary first; it defaults to just the primary."""
    section = SECTION_BY_SLUG[section_slug]
    section_slugs = list(section_slugs or [section_slug])
    if section_slugs[0] != section_slug:
        section_slugs = [section_slug] + [x for x in section_slugs if x != section_slug]
    tag = section["tags"][0]
    html_body = sanitize_html(html_body)
    body = html_to_paragraphs(html_body)
    mins = reading_minutes(body)
    now = now_iso()
    art_id = "art_" + uuid.uuid4().hex[:12]
    if not img:
        raise ValueError("an article needs a verified image URL")
    summary = [s.strip() for s in (summary or []) if s and s.strip()][:3]
    if not summary:
        summary = [excerpt]
    return {
        "schemaVersion": 1,
        "id": art_id,
        "slug": slugify(title),
        "title": title.strip(),
        "subtitle": f"{tag} · {mins} min read",
        "excerpt": excerpt.strip(),
        "body": body,
        "html_body": html_body,
        "summary": summary,
        "section": section_slug,
        "sections": section_slugs,
        "tag": tag,
        "category": tag,
        "desk": f"Midnight {section['name']} Desk",
        "img": img,
        "imageAlt": title.strip(),
        "hashtags": list(hashtags),
        "readingMinutes": mins,
        "time": f"{mins} min",
        "createdAt": now,
        "updatedAt": now,
        "publishedAt": published_at or now,
        "source_name": source_name,
        "source_url": source_url,
        "voice": voice,
        # Engagement is unknown until a reader actually opens the article.
        "views": None, "shares": None, "saves": None, "likes": None, "comments": None,
        "headlineWeight": int(headline_weight),
        "featured": False,
        "status": "published",
        "provenance": {"content": "measured", "publication": "measured", "engagement": "unknown"},
    }


def _is_count(v):
    return v is None or (isinstance(v, int) and not isinstance(v, bool) and v >= 0)


def validate_article(a: dict):
    """Raises ValueError listing every violation of the strict article schema."""
    errs = []
    extra = set(a) - ARTICLE_KEYS - {"_id"}
    missing = ARTICLE_KEYS - set(a)
    if extra:
        errs.append(f"unknown keys {sorted(extra)}")
    if missing:
        errs.append(f"missing keys {sorted(missing)}")
    if errs:
        raise ValueError("; ".join(errs))

    def s(k, nonempty=True):
        if not isinstance(a[k], str) or (nonempty and not a[k]):
            errs.append(f"{k} must be a{' non-empty' if nonempty else ''} string")

    if a["schemaVersion"] != 1:
        errs.append("schemaVersion must be 1")
    if not (isinstance(a["img"], str) and re.match(r"^https://[^\s/]+\.[^\s/]+/\S*$", a["img"])):
        errs.append("img must be a real https image URL")
    for k in ("id", "title", "tag", "category", "html_body"):
        s(k)
    for k in ("subtitle", "excerpt", "desk", "imageAlt", "time"):
        s(k, False)
    if not (isinstance(a["slug"], str) and SLUG_RE.match(a["slug"])):
        errs.append("slug invalid")
    if not (isinstance(a["section"], str) and SLUG_RE.match(a["section"])):
        errs.append("section invalid")
    elif a["section"] not in SECTION_BY_SLUG:
        errs.append(f"unknown section {a['section']!r}")
    secs = a["sections"]
    if not (isinstance(secs, list) and secs and len(secs) <= MAX_SECTIONS and len(set(secs)) == len(secs)
            and all(isinstance(x, str) and x in SECTION_BY_SLUG for x in secs)):
        errs.append("sections must be 1-%d distinct known section slugs" % MAX_SECTIONS)
    elif secs[0] != a["section"]:
        errs.append("sections[0] must equal section (the primary)")
    for k in ("body", "summary", "hashtags"):
        if not (isinstance(a[k], list) and all(isinstance(x, str) for x in a[k])):
            errs.append(f"{k} must be a list of strings")
    if not (isinstance(a["readingMinutes"], int) and a["readingMinutes"] > 0):
        errs.append("readingMinutes must be a positive int")
    for k in ("createdAt", "updatedAt", "publishedAt"):
        if a[k] is not None and not (isinstance(a[k], str) and DATETIME_RE.match(a[k])):
            errs.append(f"{k} must be an ISO datetime with offset")
    if a["source_name"] is not None and not isinstance(a["source_name"], str):
        errs.append("source_name must be string|null")
    if a["source_url"] is not None and not (isinstance(a["source_url"], str) and URL_RE.match(a["source_url"])):
        errs.append("source_url must be a URL|null")
    if a["voice"] is not None and not isinstance(a["voice"], str):
        errs.append("voice must be string|null")
    for k in ("views", "shares", "saves", "likes", "comments"):
        if not _is_count(a[k]):
            errs.append(f"{k} must be a non-negative int|null")
    hw = a["headlineWeight"]
    if isinstance(hw, bool) or not isinstance(hw, (int, float)) or not 0 <= hw <= 100:
        errs.append("headlineWeight must be 0..100")
    if not isinstance(a["featured"], bool):
        errs.append("featured must be bool")
    if a["status"] not in ("draft", "published", "archived"):
        errs.append("status invalid")
    p = a["provenance"]
    ok = {"sample", "measured", "unknown"}
    if not (isinstance(p, dict) and set(p) == {"content", "publication", "engagement"}
            and all(v in ok for v in p.values())):
        errs.append("provenance invalid")
    if errs:
        raise ValueError("; ".join(errs))
    return True
