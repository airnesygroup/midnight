"""
Fetching and reading ONE article page, with a ladder of genuinely different approaches.

Why this exists: the old scraper took the first <article> tag on the page (often a teaser card), glued words together
(get_text(strip=True) with no separator), swallowed every fetch error, and had exactly one way of asking for a page. A
long article therefore looked "too short", and a blocked page looked the same as a short one.

Approaches ("profiles"), each different from the others:
  browser   desktop Chrome headers
  mobile    iPhone Safari headers (mobile pages are often lighter and less blocked)
  amp       the page's own AMP version (<link rel="amphtml">), which is plain, server-rendered HTML
  minimal   an honest feed-reader User-Agent and no other headers (some firewalls reject "browser-like" header sets)
  reader    OPTIONAL (READER_FALLBACK=on): a reader proxy. Off by default because it sends the article URL to a third party.

ladder(attempt) orders them so that every scheduled retry STARTS with a different approach than the one before it.

Reading the page: several extraction strategies run on the same HTML and the one that finds the most real article text
wins (schema.org JSON-LD articleBody, known article containers, a paragraph-density scorer, trafilatura if installed).
Every fetch reports what happened (status, words found) so a skip says WHY, instead of just "too short".
"""

import json
import re
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

CHROME_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
             "Chrome/124.0 Safari/537.36")
MOBILE_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
             "Version/17.4 Mobile/15E148 Safari/604.1")
READER_UA = "Mozilla/5.0 (compatible; MidnightNewsReader/1.0)"

PROFILES = {
    "browser": {"User-Agent": CHROME_UA,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9"},
    "mobile": {"User-Agent": MOBILE_UA,
               "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
               "Accept-Language": "en-US,en;q=0.9"},
    "amp": {"User-Agent": CHROME_UA, "Accept": "text/html,*/*;q=0.8"},
    "minimal": {"User-Agent": READER_UA},
}
BASE_ORDER = ["browser", "mobile", "amp", "minimal"]
MAX_TEXT_CHARS = 14_000
MAX_PAGE_BYTES = 4_000_000


def reader_enabled():
    import config
    return str(config.env("READER_FALLBACK", "off")).strip().lower() in ("on", "1", "true", "yes")


def ladder(attempt=0):
    """The order in which to try the approaches. A retry (attempt >= 1) starts from a different one than the last."""
    attempt = max(0, int(attempt or 0))
    k = attempt % len(BASE_ORDER)
    order = BASE_ORDER[k:] + BASE_ORDER[:k]
    if reader_enabled():
        order = ["reader"] + order if attempt >= 3 else order + ["reader"]
    return order


def timeout_for(attempt=0):
    """Later retries are more patient: 15s, 25s, 35s ..."""
    return min(45, 15 + 10 * max(0, int(attempt or 0)))


# ------------------------------------------------------------------ fetching
def fetch_html(url, profile="browser", attempt=0):
    """Returns (BeautifulSoup | None, info) where info is {"status": int|None, "error": str|None, "bytes": n}.
    Never raises. A connection that breaks half-way keeps what already arrived (the article is usually in it)."""
    headers = dict(PROFILES.get(profile, PROFILES["browser"]))
    info = {"status": None, "error": None, "bytes": 0}
    data = b""
    try:
        r = requests.get(url, headers=headers, timeout=timeout_for(attempt), stream=True, allow_redirects=True)
    except Exception as e:  # noqa: BLE001
        info["error"] = type(e).__name__
        return None, info
    try:
        info["status"] = r.status_code
        try:
            for chunk in r.iter_content(65536):
                data += chunk
                if len(data) > MAX_PAGE_BYTES:
                    break
        except Exception as e:  # noqa: BLE001 - ChunkedEncodingError, ReadTimeout while streaming: keep the partial page
            info["error"] = type(e).__name__
    finally:
        try:
            r.close()
        except Exception:  # noqa: BLE001
            pass
    info["bytes"] = len(data)
    if info["status"] != 200 or len(data) < 500:
        if info["status"] == 200 and not info["error"]:
            info["error"] = "empty page"
        return None, info
    return BeautifulSoup(data, "lxml"), info


def fetch_reader(url, attempt=0):
    """Optional third-party reader proxy. Returns (text, info)."""
    info = {"status": None, "error": None, "bytes": 0}
    try:
        r = requests.get("https://r.jina.ai/" + url, headers={"User-Agent": READER_UA, "Accept": "text/plain"},
                         timeout=timeout_for(attempt) + 10)
        info["status"], info["bytes"] = r.status_code, len(r.content)
        if r.status_code != 200:
            return "", info
        return reader_text(r.text), info
    except Exception as e:  # noqa: BLE001
        info["error"] = type(e).__name__
        return "", info


def reader_text(raw):
    """Plain article text from a reader-proxy markdown reply."""
    body = raw.split("Markdown Content:", 1)[-1]
    body = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", body)               # images
    body = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", body)            # links -> their text
    paras = [re.sub(r"[#*_>`]+", "", p).strip() for p in re.split(r"\n\s*\n", body)]
    return clean_join([p for p in paras if len(p) > 40])


# ------------------------------------------------------------------ text helpers
def norm_space(s):
    s = re.sub(r"\s+", " ", s or "").strip()
    return re.sub(r"\s+([,.;:!?%)\]])", r"\1", s)


def clean_join(paras):
    out, seen, total = [], set(), 0
    for p in paras:
        p = norm_space(p)
        key = p.lower()
        if not p or key in seen:
            continue
        seen.add(key)
        out.append(p)
        total += len(p) + 2
        if total >= MAX_TEXT_CHARS:
            break
    return "\n\n".join(out)[:MAX_TEXT_CHARS]


_NOISE = {"related", "comments", "comment", "share", "sharing", "social", "newsletter", "promo", "advert", "ad", "ads",
          "sidebar", "recommended", "trending", "breadcrumb", "cookie", "consent", "subscribe", "footer", "menu",
          "widget", "teaser", "readmore", "morestories", "mostread", "byline", "caption", "credit", "tags"}


def _tokens(el):
    raw = " ".join(el.get("class") or []) + " " + (el.get("id") or "")
    return set(re.split(r"[^a-z0-9]+", raw.lower())) - {""}


def _noisy(p, depth=5):
    """True when this paragraph sits inside navigation, a footer, a related-stories box, comments, a share bar..."""
    el, n = p, 0
    while el is not None and n < depth:
        if getattr(el, "name", None) in ("nav", "footer", "aside", "form"):
            return True
        if hasattr(el, "get") and _tokens(el) & _NOISE:
            return True
        el, n = el.parent, n + 1
    return False


def _link_heavy(p):
    total = len(p.get_text(" ", strip=True)) or 1
    linked = sum(len(a.get_text(" ", strip=True)) for a in p.find_all("a"))
    return linked / total > 0.6


def _para_text(p):
    return norm_space(p.get_text(" ", strip=True))


def _good_paragraphs(root, min_chars=30):
    out = []
    for p in root.find_all("p"):
        t = _para_text(p)
        if len(t) >= min_chars and not _noisy(p) and not _link_heavy(p):
            out.append(t)
    return out


# ------------------------------------------------------------------ extraction strategies
def _jsonld_objects(page):
    objs = []

    def walk(o):
        if isinstance(o, list):
            for x in o:
                walk(x)
        elif isinstance(o, dict):
            objs.append(o)
            for v in o.values():
                if isinstance(v, (list, dict)):
                    walk(v)
    for sc in page.find_all("script", type=re.compile(r"ld\+json", re.I)):
        raw = sc.string or sc.get_text() or ""
        try:
            walk(json.loads(raw))
        except Exception:  # noqa: BLE001 - invalid JSON-LD is common; ignore it
            continue
    return objs


def text_from_jsonld(page):
    best = ""
    for o in _jsonld_objects(page):
        body = o.get("articleBody")
        if isinstance(body, str):
            body = norm_space(BeautifulSoup(body, "lxml").get_text(" ", strip=True)) if "<" in body else norm_space(body)
            if len(body) > len(best):
                best = body
    return best[:MAX_TEXT_CHARS]


_CONTAINER_SELECTORS = (
    "[itemprop=articleBody]", "[class*=article-body]", "[class*=article__body]", "[class*=article-content]",
    "[class*=article__content]", "[class*=articleBody]", "[class*=story-body]", "[class*=storytext]",
    "[class*=entry-content]", "[class*=post-content]", "[class*=post-body]", "[class*=c-article-body]",
    "[class*=body-content]", "[class*=content-body]", "[class*=news-body]", "[data-component=text-block]",
)


def text_from_known_containers(page):
    best = ""
    for sel in _CONTAINER_SELECTORS:
        try:
            nodes = page.select(sel)
        except Exception:  # noqa: BLE001
            continue
        for node in nodes[:6]:
            t = clean_join(_good_paragraphs(node))
            if len(t) > len(best):
                best = t
    return best


def best_container(page):
    """The element that holds the story: paragraphs score their parent fully and grandparent by half (readability-style),
    so a teaser <article> or a sidebar cannot win over the real body."""
    scores, nodes = {}, {}
    for p in page.find_all("p"):
        t = _para_text(p)
        if len(t) < 30 or _noisy(p) or _link_heavy(p):
            continue
        parent = p.parent
        if parent is None:
            continue
        for node, weight in ((parent, 1.0), (parent.parent, 0.5)):
            if node is None or getattr(node, "name", None) in (None, "[document]", "html"):
                continue
            scores[id(node)] = scores.get(id(node), 0.0) + weight * min(len(t), 400)
            nodes[id(node)] = node
    if not scores:
        return None
    return nodes[max(scores, key=scores.get)]


def text_from_density(page):
    node = best_container(page)
    if node is None:
        return "", None
    t = clean_join(_good_paragraphs(node))
    if len(t.split()) < 40:                         # body is not in <p> tags (div + <br>): take the lines instead
        lines = [norm_space(x) for x in node.get_text("\n").split("\n")]
        t2 = clean_join([x for x in lines if len(x) > 60])
        if len(t2) > len(t):
            t = t2
    return t, node


def text_from_trafilatura(html_text):
    try:
        import trafilatura                       # optional: pip install trafilatura
    except Exception:  # noqa: BLE001
        return ""
    try:
        return clean_join((trafilatura.extract(html_text, include_comments=False, include_tables=False) or "").split("\n"))
    except Exception:  # noqa: BLE001
        return ""


def text_from_all_paragraphs(page):
    return clean_join(_good_paragraphs(page, min_chars=40))


def extract_text(page, raw_html=None):
    """(text, strategy name). The strategy that finds the most real words wins."""
    results = []
    node_text, node = text_from_density(page)
    results.append(("density", node_text))
    results.append(("known-container", text_from_known_containers(page)))
    results.append(("json-ld", text_from_jsonld(page)))
    if raw_html:
        results.append(("trafilatura", text_from_trafilatura(raw_html)))
    results = [(n, t) for n, t in results if t]
    best = max(results, key=lambda r: len(r[1].split()), default=("", ""))
    if len(best[1].split()) < 40:                   # nothing convincing: the loosest net
        loose = text_from_all_paragraphs(page)
        if len(loose.split()) > len(best[1].split()):
            best = ("all-paragraphs", loose)
    return best[1], best[0] or "none"


# ------------------------------------------------------------------ images
_IMG_ATTRS = ("src", "data-src", "data-lazy-src", "data-original", "data-lazy", "data-img-src")
_SRCSET_ATTRS = ("srcset", "data-srcset")


def biggest_from_srcset(srcset):
    """URL with the largest width descriptor (falls back to the last entry)."""
    best, best_w = None, -1
    for part in (srcset or "").split(","):
        bits = part.strip().split()
        if not bits:
            continue
        w = 0
        if len(bits) > 1:
            m = re.match(r"(\d+(?:\.\d+)?)[wx]", bits[1])
            w = float(m.group(1)) if m else 0
        if w >= best_w:
            best, best_w = bits[0], w
    return best


def _img_urls(tag, base):
    urls = []
    for attr in _SRCSET_ATTRS:
        u = biggest_from_srcset(tag.get(attr))
        if u:
            urls.append(u)
    for attr in _IMG_ATTRS:
        if tag.get(attr):
            urls.append(tag.get(attr))
    out = []
    for u in urls:
        if not u or u.startswith("data:"):
            continue
        u = urljoin(base, u.strip())
        if u.startswith("http") and u not in out:
            out.append(u)
    return out


def extract_images(page, url, container=None, limit=24):
    """Candidate hero images, best first: the page's declared hero (og/twitter/JSON-LD), then pictures inside the story
    (lazy-loaded ones, <picture>, AMP, <noscript> fallbacks included), then the rest of the page."""
    cands = []

    def add(u):
        if u and u.startswith("http") and u not in cands:
            cands.append(u)
    for attrs in ({"property": "og:image"}, {"property": "og:image:secure_url"}, {"name": "twitter:image"},
                  {"name": "twitter:image:src"}, {"property": "twitter:image"}, {"itemprop": "image"}):
        for m in page.find_all("meta", attrs=attrs):
            if m.get("content"):
                add(urljoin(url, m["content"].strip()))
    link = page.find("link", rel="image_src")
    if link and link.get("href"):
        add(urljoin(url, link["href"]))
    for o in _jsonld_objects(page):
        img = o.get("image") or o.get("thumbnailUrl")
        for v in (img if isinstance(img, list) else [img]):
            if isinstance(v, dict):
                v = v.get("url") or v.get("contentUrl")
            if isinstance(v, str):
                add(urljoin(url, v))

    def from_area(area):
        for ns in area.find_all("noscript"):                       # lazy-load placeholders keep the real <img> in here
            inner = BeautifulSoup(ns.string or ns.get_text() or "", "lxml")
            for im in inner.find_all("img"):
                for u in _img_urls(im, url):
                    add(u)
        for tag in area.find_all(["img", "amp-img", "source"]):
            for u in _img_urls(tag, url):
                add(u)
    if container is not None:
        from_area(container)
    for fig in page.find_all("figure"):
        from_area(fig)
    from_area(page)
    return cands[:limit]


def amp_url(page, url):
    link = page.find("link", rel=lambda r: r and "amphtml" in (r if isinstance(r, list) else [r]))
    if link and link.get("href"):
        return urljoin(url, link["href"])
    return None


# ------------------------------------------------------------------ the one entry point
def scrape(url, profile="browser", attempt=0):
    """Fetch ONE page with one approach. Returns (text, image_candidates, note) where note is a short human-readable
    account ("browser: HTTP 200, 412 words"). Never raises."""
    if profile == "reader":
        text, info = fetch_reader(url, attempt)
        note = f"reader: HTTP {info['status'] or info['error'] or '?'}, {len(text.split())} words"
        return text, [], note
    page, info = fetch_html(url, profile, attempt)
    if page is None:
        why = f"HTTP {info['status']}" if info["status"] and info["status"] != 200 else (info["error"] or "no page")
        return "", [], f"{profile}: {why}"
    target, note_extra = page, ""
    if profile == "amp":
        amp = amp_url(page, url)
        if amp and amp != url:
            apage, ainfo = fetch_html(amp, "amp", attempt)
            if apage is not None:
                target, note_extra = apage, " (AMP page)"
        # a page that has no AMP twin is read as-is: still a new look at it
    text, how = extract_text(target)
    _, node = text_from_density(target)
    imgs = extract_images(target, url, node)
    if target is not page:                                          # keep the canonical page's declared hero image too
        imgs += [i for i in extract_images(page, url) if i not in imgs]
    partial = ", partial page" if info.get("error") else ""
    note = f"{profile}: HTTP {info['status']}{note_extra}, {len(text.split())} words via {how}{partial}"
    return text, imgs[:24], note
