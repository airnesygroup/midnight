"""
Completeness gates. Nothing is published unless it is a COMPLETE article.

Layers:
  1. The model's reply must have finished normally (finish_reason == "stop")
     AND end with the ===END=== marker. A reply cut off by credits, limits or
     network trouble never has both.
  2. Structure: title, excerpt, three summary points, enough body, balanced
     HTML, the last paragraph ends like a finished sentence, no leftover
     template markers, not a refusal.
  3. A verified real image (images.py) and a source URL.
"""

import re

END_MARKER = "===END==="
TERMINAL = tuple('.!?…"”’\')]')


class Incomplete(Exception):
    """The generated text is not a finished article/report."""


def strip_end_marker(text, finish_reason):
    if finish_reason != "stop":
        raise Incomplete(f"model stopped early (finish_reason={finish_reason!r})")
    t = (text or "").rstrip()
    if not t.endswith(END_MARKER):
        raise Incomplete("reply is missing the ===END=== marker (cut off)")
    return t[: -len(END_MARKER)].rstrip()


def plain(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or "")).strip()


_PAIRS = ("p", "ul", "li", "h3", "b", "i", "strong", "em", "blockquote")
_LEFTOVER = re.compile(r"(^|\n)\s*(TITLE|EXCERPT|SUMMARY\d?|BODY|IMPORTANCE|SECTION|LEAD|LAST_WORD)\s*:|\[\s*(insert|image|todo)|lorem ipsum|<\s*(one|the)\s[^>]*>", re.I)
_REFUSAL = re.compile(r"^(i('| a)m sorry|i cannot|i can't|as an ai|sorry,|here is the|here's the|certainly[,!])", re.I)


def ends_cleanly(text):
    return plain(text).rstrip().endswith(TERMINAL)


def check_article_text(title, excerpt, summary, html_body, min_body_chars):
    """Raises Incomplete with the first problem found."""
    if not title or len(title.strip()) < 15 or len(title) > 220:
        raise Incomplete("title missing or the wrong length")
    if title.rstrip().endswith((":", ",", "-", "…", "...")):
        raise Incomplete("title looks cut off")
    if not excerpt or len(excerpt.strip()) < 40:
        raise Incomplete("excerpt missing or too short")
    if not ends_cleanly(excerpt):
        raise Incomplete("excerpt does not end like a sentence")
    if len(summary or []) != 3 or any(len(s.strip()) < 25 for s in summary):
        raise Incomplete("summary must have 3 complete points")
    if not all(ends_cleanly(s) for s in summary):
        raise Incomplete("a summary point is cut off")
    text = plain(html_body)
    if len(text) < min_body_chars:
        raise Incomplete(f"body too short ({len(text)} < {min_body_chars} chars)")
    for tag in _PAIRS:
        o = len(re.findall(rf"<{tag}(\s[^>]*)?>", html_body, re.I))
        c = len(re.findall(rf"</{tag}>", html_body, re.I))
        if o != c:
            raise Incomplete(f"unbalanced <{tag}> tags (cut off mid-element)")
    paras = re.findall(r"<p[^>]*>(.*?)</p>", html_body, re.S | re.I)
    if len(paras) < 3:
        raise Incomplete("fewer than 3 paragraphs")
    if not ends_cleanly(paras[-1]):
        raise Incomplete("last paragraph does not end like a finished sentence")
    if _LEFTOVER.search(plain(title + "\n" + excerpt) + "\n" + html_body):
        raise Incomplete("template markers/placeholders left in the text")
    if _REFUSAL.match(plain(html_body)) or _REFUSAL.match(title.strip()):
        raise Incomplete("model replied with a refusal/preamble instead of an article")


def final_gate(article):
    """Last check, on the finished document, immediately before the push."""
    from schema import validate_article
    from images import looks_like_url
    validate_article(article)
    if not looks_like_url(article["img"]) or not article["img"].startswith("https://"):
        raise Incomplete("no real https image URL")
    if not looks_like_url(article.get("source_url") or ""):
        raise Incomplete("source URL missing")
    if len(article["summary"]) != 3 or not all(article["summary"]):
        raise Incomplete("summary incomplete")
    if not article["body"] or not article["html_body"].strip():
        raise Incomplete("body empty")
    if article["status"] != "published":
        raise Incomplete("status not published")
    return True


# ---- Midnight Report -------------------------------------------------
def check_report(r, min_sections=3):
    """r: dict in the Lovable `reports` shape."""
    def need(cond, msg):
        if not cond:
            raise Incomplete(msg)
    need(10 <= len(r["title"]) <= 200, "report title length")
    need(20 <= len(r["introduction"]) <= 500 and ends_cleanly(r["introduction"]), "introduction missing/cut off")
    need(10 <= len(r["leadTitle"]) <= 300, "lead title")
    need(20 <= len(r["leadExcerpt"]) <= 1000 and ends_cleanly(r["leadExcerpt"]), "lead excerpt missing/cut off")
    need(2 <= len(r["leadParagraphs"]) <= 20, "lead needs at least 2 paragraphs")
    need(min_sections <= len(r["sections"]) <= 30, f"needs at least {min_sections} sections")
    for p in r["leadParagraphs"]:
        need(40 <= len(p) <= 5000 and ends_cleanly(p), "a lead paragraph is cut off")
    for s in r["sections"]:
        need(1 <= len(s["tag"]) <= 60 and 5 <= len(s["title"]) <= 300, "section tag/title")
        need(1 <= len(s["paragraphs"]) <= 20, "section without paragraphs")
        for p in s["paragraphs"]:
            need(40 <= len(p) <= 5000 and ends_cleanly(p), f"section '{s['title'][:30]}' has a cut-off paragraph")
    need(40 <= len(r["lastWord"]) <= 2000 and ends_cleanly(r["lastWord"]), "closing word missing/cut off")
    blob = " ".join([r["title"], r["introduction"], r["lastWord"]] + r["leadParagraphs"]
                    + [p for s in r["sections"] for p in s["paragraphs"]])
    need(not _LEFTOVER.search(blob) and END_MARKER not in blob, "template markers left in the report")
    return True


def _words(t):
    return len(re.findall(r"\S+", t or ""))


def check_newsletter(r, n_stories):
    """A newsletter is dense but not an essay: every story needs real detail
    (enough words) and must stay a brief (not too many). One lead + one section
    per remaining story; at most one story may be left out."""
    check_report(r, min_sections=max(3, n_stories - 2))
    def need(cond, msg):
        if not cond:
            raise Incomplete(msg)
    lead_words = sum(_words(p) for p in r["leadParagraphs"])
    need(100 <= lead_words <= 450, f"lead story is {lead_words} words (needs 100-450)")   # prompt asks 200-320; the floor is lenient so a near miss is not a rejection
    for s in r["sections"]:
        w = sum(_words(p) for p in s["paragraphs"])
        need(40 <= w <= 220, f"story '{s['title'][:30]}' is {w} words (needs 40-220)")
    need(len(r["sections"]) >= n_stories - 1, f"only {len(r['sections'])} of {n_stories - 1} remaining stories covered")
    total = lead_words + sum(_words(p) for s in r["sections"] for p in s["paragraphs"])
    need(total >= 55 * n_stories, f"newsletter too thin ({total} words for {n_stories} stories)")
    return True
