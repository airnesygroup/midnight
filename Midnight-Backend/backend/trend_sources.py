"""
Where trends come from, and what we know about each one.

1. Google Trends "Trending now" public RSS feed, one feed per country
   (https://trends.google.com/trending/rss?geo=XX). Each item is a search that
   is spiking right now, with Google's traffic floor ("200+", "2M+"), when it
   started, a picture and the news stories Google links to it.
2. For every trend we then search for the top articles about it (Google's own
   linked stories first, then Bing News RSS, then Google News RSS), read them,
   and hand the combined material to the writer. We do NOT restrict this to
   verified news sites: whatever can be read about the trend is fair material.

Everything fails soft: one dead country feed or one unreadable page never stops
the loop.
"""

import re
import time
import unicodedata
from datetime import datetime, timezone
from urllib.parse import parse_qs, quote_plus, urlsplit

import requests
from bs4 import BeautifulSoup

from dedupe import normalise_url
from scraper import HEADERS, _clean, _parse_date, _scrape_html_fallback

TRENDS_RSS = "https://trends.google.com/trending/rss?geo={geo}"
BING_NEWS_RSS = "https://www.bing.com/news/search?q={q}&format=rss"
GOOGLE_NEWS_RSS = "https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"

# Pages that are not readable articles (video/social walls, search pages).
UNREADABLE_HOSTS = ("youtube.com", "youtu.be", "instagram.com", "facebook.com", "fb.com", "x.com",
                    "twitter.com", "tiktok.com", "pinterest.com", "linkedin.com", "google.com",
                    "bing.com", "t.me", "wa.me")
_NOISE = {"vs", "v", "the", "a", "an", "and", "of", "in", "on", "at", "to", "for", "live", "score", "news"}


def norm_key(query):
    """Order-insensitive identity of a trend: 'Braves vs Dodgers' == 'dodgers braves'."""
    s = unicodedata.normalize("NFKD", query or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    toks = sorted({t for t in re.findall(r"[a-z0-9]+", s) if t not in _NOISE})
    return " ".join(toks) or re.sub(r"\s+", " ", s).strip()


def parse_traffic(text):
    """'200+' -> 200, '2K+' -> 2000, '5M+' -> 5_000_000, '1,000+' -> 1000. Unknown -> 0."""
    m = re.match(r"\s*([\d.,]+)\s*([KkMmBb]?)", text or "")
    if not m:
        return 0
    try:
        n = float(m.group(1).replace(",", ""))
    except ValueError:
        return 0
    return int(n * {"": 1, "k": 1e3, "m": 1e6, "b": 1e9}[m.group(2).lower()])


def host_of(url):
    try:
        return urlsplit(url).netloc.lower().removeprefix("www.")
    except Exception:
        return ""


def readable(url):
    h = host_of(url)
    return bool(h) and url.startswith("http") and not any(h == u or h.endswith("." + u) for u in UNREADABLE_HOSTS)


def _text(item, name):
    t = item.find(name)
    return _clean(t.text) if t is not None and t.text else ""


def _raw(item, name):
    """Untouched text (URLs must not go through the HTML cleaner)."""
    t = item.find(name)
    return (t.text or "").strip() if t is not None else ""


def parse_trends_feed(content, geo):
    """RSS bytes -> [{'query','geo','trafficMin','trafficLabel','startedAt','picture','pictureSource','news':[{title,url,source}]}]."""
    soup = BeautifulSoup(content, "xml")
    out = []
    for item in soup.find_all("item"):
        query = _text(item, "title")
        if not query:
            continue
        news = []
        for n in item.find_all("ht:news_item"):
            url = _raw(n, "ht:news_item_url")
            if url.startswith("http"):
                news.append({"title": _text(n, "ht:news_item_title"), "url": url,
                             "source": _text(n, "ht:news_item_source")})
        label = _text(item, "ht:approx_traffic")
        started = _parse_date(_text(item, "pubDate"))
        out.append({"query": query, "geo": geo, "trafficMin": parse_traffic(label), "trafficLabel": label,
                    "startedAt": started, "picture": _raw(item, "ht:picture") or None,
                    "pictureSource": _text(item, "ht:picture_source") or None, "news": news})
    return out


def fetch_trends_feed(geo, get=requests.get):
    """One country's trending list; [] (and a log line) if the feed is down or unsupported."""
    try:
        r = get(TRENDS_RSS.format(geo=geo), headers=HEADERS, timeout=15)
        r.raise_for_status()
        return parse_trends_feed(r.content, geo)
    except Exception as e:  # noqa: BLE001
        print(f"  ! trends feed {geo}: {type(e).__name__}")
        return []


def fetch_all_geos(geos, fetch=fetch_trends_feed, sleep=time.sleep, delay=0.6):
    """Every country's trends merged by identity. A trend trending in several
    countries is ONE entry with all its geos, its biggest traffic floor and all
    the news links Google gave for it."""
    merged = {}
    for i, geo in enumerate(geos):
        if i:
            sleep(delay)
        for t in fetch(geo):
            key = norm_key(t["query"])
            if not key:
                continue
            m = merged.get(key)
            if not m:
                merged[key] = {**t, "key": key, "geos": [geo], "news": list(t["news"])}
                continue
            if geo not in m["geos"]:
                m["geos"].append(geo)
            if t["trafficMin"] > m["trafficMin"]:
                m.update(trafficMin=t["trafficMin"], trafficLabel=t["trafficLabel"])
            if t["startedAt"] and (not m["startedAt"] or t["startedAt"] < m["startedAt"]):
                m["startedAt"] = t["startedAt"]
            m["picture"] = m["picture"] or t["picture"]
            have = {normalise_url(n["url"]) for n in m["news"]}
            m["news"] += [n for n in t["news"] if normalise_url(n["url"]) not in have]
    return list(merged.values())


# ------------------------------------------------------------ finding articles
def _bing_target(link):
    """Bing wraps results in apiclick.aspx?...&url=<real url>&..."""
    try:
        q = parse_qs(urlsplit(link).query)
        return (q.get("url") or [link])[0]
    except Exception:
        return link


def search_news(query, get=requests.get, limit=8):
    """Top articles for a query: Bing News RSS (real publisher URLs)."""
    try:
        r = get(BING_NEWS_RSS.format(q=quote_plus(query)), headers=HEADERS, timeout=15)
        r.raise_for_status()
    except Exception as e:  # noqa: BLE001
        print(f"  ! news search '{query[:40]}': {type(e).__name__}")
        return []
    out = []
    for item in BeautifulSoup(r.content, "xml").find_all("item"):
        link = _raw(item, "link")
        url = _bing_target(link) if link else ""
        if url.startswith("http"):
            out.append({"title": _text(item, "title"), "url": url,
                        "source": _text(item, "News:Source") or host_of(url)})
        if len(out) >= limit:
            break
    return out


def search_google_news(query, get=requests.get, limit=3):
    """Last resort. Google News links are redirects; keep only those that resolve to a publisher."""
    try:
        r = get(GOOGLE_NEWS_RSS.format(q=quote_plus(query)), headers=HEADERS, timeout=15)
        r.raise_for_status()
    except Exception:  # noqa: BLE001
        return []
    out = []
    for item in BeautifulSoup(r.content, "xml").find_all("item")[:limit * 2]:
        link = _raw(item, "link")
        try:
            final = get(link, headers=HEADERS, timeout=10, allow_redirects=True).url
        except Exception:  # noqa: BLE001
            continue
        if host_of(final) and not host_of(final).endswith("google.com"):
            src = item.find("source")
            out.append({"title": _text(item, "title"), "url": final,
                        "source": _clean(src.text) if src is not None and src.text else host_of(final)})
        if len(out) >= limit:
            break
    return out


def discover_sources(trend, search=search_news, search2=search_google_news, want=6):
    """Candidate article links for a trend, best first, de-duplicated."""
    cands, seen = [], set()

    def add(items):
        for n in items:
            k = normalise_url(n["url"])
            if k not in seen and readable(n["url"]):
                seen.add(k)
                cands.append(n)

    add(trend.get("news") or [])
    if len(cands) < want:
        add(search(trend["query"]))
    if len(cands) < 3:
        add(search2(trend["query"]))
    return cands[:want + 4]


class ThinMaterial(Exception):
    """Not enough readable material to write an honest post (retried later)."""


def gather_material(trend, discover=discover_sources, page=_scrape_html_fallback,
                    sleep=time.sleep, min_chars=200, max_sources=5, per_source_chars=2600):
    """Reads the top articles. Returns {'sources': [...], 'text': str, 'images': [url...]}.
    Raises ThinMaterial when nothing substantial can be read."""
    sources, images = [], []
    for c in discover(trend):
        if len(sources) >= max_sources:
            break
        sleep(1.0)
        text, imgs = page(c["url"], c.get("source") or host_of(c["url"]))
        text = (text or "").strip()
        if len(text) < min_chars:
            continue
        sources.append({"name": c.get("source") or host_of(c["url"]), "url": c["url"],
                        "title": c.get("title") or "", "text": text[:per_source_chars]})
        images += [i for i in (imgs or []) if i not in images]
    total = sum(len(s["text"]) for s in sources)
    if not sources or (len(sources) == 1 and total < 500):
        raise ThinMaterial(f"only {len(sources)} readable source(s), {total} chars")
    if trend.get("picture"):
        images.append(trend["picture"])        # Google's thumbnail, tried last (usually too small)
    blob = "\n\n".join(f"[{s['name']}] {s['title']}\n{s['text']}" for s in sources)
    return {"sources": sources, "text": blob[:9000], "images": images}
