"""
Story de-duplication.

Two layers:
  1. Same URL (normalised: no tracking params, no fragment, no trailing slash).
  2. Same STORY from a different outlet, detected by comparing headline
     keywords. "Apple unveils new iPhone 18" on The Verge and "Apple launches
     iPhone 18" on TechCrunch share enough significant words to be treated as
     one story; whichever outlet's turn came first wins.
"""

import re
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

STOPWORDS = set("""a an and are as at be been but by for from has have had he her his how i if in into is it its
just more most new news not of on one or our out over say says said she so than that the their them then there these they
this to up us was we were what when where which who why will with would you your after before about amid per via
could can may might also now today get gets got set sets""".split())

_TRACKING = re.compile(r"^(utm_|fbclid|gclid|mc_|ref|source|cmpid|ocid|taid|guccounter)", re.I)


def normalise_url(url: str) -> str:
    try:
        p = urlsplit(url.strip())
        q = [(k, v) for k, v in parse_qsl(p.query) if not _TRACKING.match(k)]
        path = p.path.rstrip("/") or "/"
        return urlunsplit((p.scheme.lower(), p.netloc.lower().removeprefix("www."), path,
                           urlencode(q), ""))
    except Exception:
        return url.strip()


def _stem(w: str) -> str:
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def tokens(title: str):
    words = re.findall(r"[a-z0-9]+", (title or "").lower())
    return frozenset(_stem(w) for w in words if len(w) > 2 and w not in STOPWORDS)


def same_story(a, b) -> bool:
    """a, b: token sets of two headlines."""
    if not a or not b:
        return False
    inter = len(a & b)
    if inter < 3:
        return False
    jaccard = inter / len(a | b)
    overlap = inter / min(len(a), len(b))
    return jaccard >= 0.5 or (overlap >= 0.8 and inter >= 4) or (inter >= 5 and jaccard >= 0.4)


class SeenIndex:
    """In-memory view of everything already covered. Seeded from MongoDB at
    the start of a run and updated live after every push, so two consecutive
    articles in the same run can never be the same story either."""

    def __init__(self):
        self.urls = set()
        self.headlines = []  # list of (token_set, label)

    def add(self, url: str = None, *titles: str, ref: str = None):
        """ref = the id of the article these headlines belong to (used to count
        how many outlets cover the same story)."""
        if url:
            self.urls.add(normalise_url(url))
        for t in titles:
            tk = tokens(t)
            if tk:
                self.headlines.append((tk, t, ref))

    def has_url(self, url: str) -> bool:
        return normalise_url(url) in self.urls

    def matching_story(self, title: str):
        m = self.match(title)
        return m[0] if m else None

    def match(self, title: str):
        """(label, article_id_or_None) of the first covered story that matches."""
        tk = tokens(title)
        for other, label, ref in self.headlines:
            if same_story(tk, other):
                return label, ref
        return None
