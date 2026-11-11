"""
Headline ranking: decides what the website's hero shows.

The Lovable site's topNews() uses two fields on every article:
  featured        (bool)   - when at least 3 articles have it, ONLY those can be in the hero
  headlineWeight  (0..100) - eligible articles are sorted by it, highest first

This module fills them in with real values:

  weight = Groq's importance score (0-100, asked for while the article is
           rewritten)  +  a section adjustment  +  a bonus for every OTHER
           outlet that covered the same story, clamped to 0..100.

refresh_headlines() then marks the top FEATURED_COUNT stories of the last
FEATURED_WINDOW_HOURS as featured:true (and clears the flag from the rest).

The article schema is strict (no extra keys), so the raw Groq score and the
outlet counts live in our own collection, `headlineSignals`, keyed by article id.
"""

from datetime import datetime, timedelta, timezone

import config
from schema import iso

NEUTRAL = 40            # what the pipeline used for every article before this module

# Section adjustment, added to the model's score. World/politics/business/tech
# should dominate the hero; sport, entertainment and lifestyle should not.
HIGH, MID, LOW = +10, 0, -18
SECTION_ADJUST = {
    "world": HIGH, "politics": HIGH, "business": HIGH, "tech": HIGH, "us": HIGH,
    "europe": HIGH, "asia": HIGH, "middle-east": HIGH, "africa": HIGH,
    "latin-america": HIGH, "oceania": MID, "climate": MID, "health": MID,
    "science": MID, "health-and-science": MID, "crypto": MID, "education": MID,
    "weather": MID, "opinion": LOW, "real-estate": LOW, "automotive": LOW,
    "culture": LOW, "sport": LOW, "entertainment": LOW, "gaming": LOW,
    "travel": LOW, "style": LOW, "food": LOW,
}
COVERAGE_BONUS = 6      # per extra outlet covering the same story
COVERAGE_CAP = 18


def section_adjust(slug):
    return SECTION_ADJUST.get(slug, MID)


def compute_weight(llm_score, section, outlets=1):
    """Final headlineWeight (int 0..100). outlets counts every outlet on the story."""
    base = NEUTRAL if llm_score is None else max(0, min(100, int(llm_score)))
    bonus = min(COVERAGE_CAP, COVERAGE_BONUS * max(0, outlets - 1))
    return max(0, min(100, base + section_adjust(section) + bonus))


class HeadlineBook:
    """Reads/writes the headlineSignals collection."""

    def __init__(self, db):
        self.col = db["headlineSignals"]
        try:
            self.col.create_index("articleId", unique=True, name="signal_article")
        except Exception:
            pass

    def record_article(self, article_id, section, source, llm_score):
        self.col.update_one(
            {"articleId": article_id},
            {"$setOnInsert": {"articleId": article_id, "section": section, "llmScore": llm_score,
                              "outlets": [source], "createdAt": iso(datetime.now(timezone.utc))}},
            upsert=True)

    def record_coverage(self, article_id, source):
        """Another outlet wrote about a story we already published."""
        if not article_id or not source:
            return
        self.col.update_one({"articleId": article_id}, {"$addToSet": {"outlets": source}})

    def get(self, article_id):
        return self.col.find_one({"articleId": article_id}) or {}


def refresh_headlines(storage, now=None, settings=None):
    """Recompute headlineWeight for recent articles and set featured:true on the
    top ones. Returns the list of featured article ids."""
    st = settings or config.headline_settings()
    now = now or datetime.now(timezone.utc)
    since = iso(now - timedelta(hours=st["window_hours"]))
    book = HeadlineBook(storage.db)
    recent = list(storage.articles.find(
        {"status": "published", "provenance.content": "measured", "publishedAt": {"$gte": since}},
        {"id": 1, "section": 1, "publishedAt": 1, "headlineWeight": 1, "featured": 1}))

    scored = []
    for a in recent:
        sig = book.get(a["id"])
        outlets = len(sig.get("outlets") or []) or 1
        w = compute_weight(sig.get("llmScore"), a["section"], outlets)
        scored.append((w, a.get("publishedAt") or "", a))
        if a.get("headlineWeight") != w:
            storage.articles.update_one({"id": a["id"]}, {"$set": {"headlineWeight": w}})

    # best weight first; ties go to the most recently published
    scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
    top = [a["id"] for w, _, a in scored if w >= st["min_weight"]][: st["featured_count"]]
    if len(top) < 3:
        top = []   # the site ignores `featured` below 3 anyway; fall back to weights only

    storage.articles.update_many({"id": {"$in": top}, "featured": {"$ne": True}}, {"$set": {"featured": True}})
    storage.articles.update_many(
        {"featured": True, "provenance.content": "measured", "id": {"$nin": top}},
        {"$set": {"featured": False}})
    return top
