"""
Fetches source articles from RSS/Atom feeds.

RSS first (the sanctioned, stable way to read these sites), with a single
article-page fetch only to get fuller text and the hero image. Every fetch
fails soft: one dead source never takes down the pipeline.

Two stages, so the pipeline can take ONE article per source per turn:
  fetch_feed_entries()  - cheap: titles/links/dates from a feed, newest first
  hydrate_entry()       - on demand: full text + verified images for ONE entry

Respect each site's robots.txt/ToS; volume is kept very low (one article per
source per pass) and every post links back to the original.
"""

import re
import time
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from boilerplate import strip_boilerplate

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/rss+xml, application/xml, text/html;q=0.9, */*;q=0.8",
}
TIMEOUT = 15
MAX_AGE_DAYS = 183   # default only: the real value is SCRAPE_MAX_AGE_DAYS (config.scrape_settings), six months
POLITE_DELAY = 1.0  # seconds between article fetches

def _get(url, as_xml=False):
    resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    parser = "xml" if as_xml else "lxml"
    return BeautifulSoup(resp.content, parser)


def _clean(html_or_text):
    """Strips tags and collapses whitespace."""
    txt = BeautifulSoup(html_or_text or "", "lxml").get_text(" ", strip=True)
    return re.sub(r"\s+", " ", txt).strip()


# Filenames/paths that are almost never the actual article photo — site
# logos, nav icons, avatars, tracking pixels, ad creative. Filtered by
# substring match against the URL, which is cheap and catches most of it.
_BAD_IMAGE_PATTERNS = (
    "logo", "icon", "favicon", "avatar", "sprite", "spacer", "pixel.",
    "tracking", "-ad-", "/ads/", "advert", "badge", "button", "share-",
    "social-", "author-", "profile-", "placeholder", "1x1", "blank.gif",
)

# A real editorial photo is essentially never this small. Filters out most
# logos/icons that don't get caught by the filename check above.
_MIN_IMAGE_BYTES = 15_000


def _looks_like_content_image(url: str) -> bool:
    low = url.lower()
    return not any(p in low for p in _BAD_IMAGE_PATTERNS)


def _verify_image(url: str) -> bool:
    """
    Confirms a URL actually points at a real image of a plausible size,
    rather than a logo/icon/tracking pixel. Uses a HEAD request so this
    stays cheap — no full download just to check.

    Fails open (returns True) if the server doesn't answer HEAD requests
    cleanly, since some CDNs block HEAD but serve GET fine; better to keep
    a possibly-good image than drop it on a technicality.
    """
    try:
        resp = requests.head(url, headers=HEADERS, timeout=6, allow_redirects=True)
        content_type = resp.headers.get("Content-Type", "")
        content_length = resp.headers.get("Content-Length")

        if content_type and not content_type.startswith("image/"):
            return False
        if content_length is not None:
            try:
                if int(content_length) < _MIN_IMAGE_BYTES:
                    return False
            except ValueError:
                pass
        return True
    except Exception:
        return True  # fail open — see docstring


def _verified_images(candidates, limit=4):
    """Filters candidate image URLs down to ones that pass both checks."""
    out = []
    for url in candidates:
        if len(out) >= limit:
            break
        if not _looks_like_content_image(url):
            continue
        if _verify_image(url):
            out.append(url)
    return out


def _images_from_entry(item, verify=True):
    """Pulls image URLs out of the various RSS image conventions, verified."""
    imgs = []
    for tag in item.find_all(["media:content", "media:thumbnail", "enclosure"]):
        url = tag.get("url")
        if url and url.startswith("http") and url not in imgs:
            imgs.append(url)
    # Images embedded in the description HTML
    desc = item.find("description")
    if desc and desc.text:
        soup = BeautifulSoup(desc.text, "lxml")
        for img in soup.find_all("img"):
            src = img.get("src")
            if src and src.startswith("http") and src not in imgs:
                imgs.append(src)
    return imgs if not verify else _verified_images(imgs)


def _scrape_html_fallback(url, source):
    """Best-effort fetch of a single article page when RSS lacks body text."""
    try:
        page = _get(url)
    except Exception:
        return None, []

    # Restrict image search to the actual article content, not the whole
    # page — the whole page includes nav bars, footers, ads, and author
    # avatars, which is where most of the "random logo" images came from.
    content_area = (
        page.find("article")
        or page.find("main")
        or page.find(attrs={"class": re.compile(r"article|post-content|entry-content", re.I)})
        or page
    )

    paragraphs = [p.get_text(strip=True) for p in content_area.find_all("p")]
    text = "\n\n".join([p for p in paragraphs if len(p) > 40][:15])

    candidates = []
    # og:image is the page's own declared hero photo — highest confidence,
    # always tried first regardless of where it's declared in the HTML.
    for attrs in ({"property": "og:image"}, {"property": "og:image:secure_url"}, {"name": "twitter:image"},
                  {"name": "twitter:image:src"}, {"property": "twitter:image"}):
        m = page.find("meta", attrs=attrs)
        if m and m.get("content"):
            u = urljoin(url, m["content"])
            if u not in candidates:
                candidates.append(u)
    link = page.find("link", rel="image_src")
    if link and link.get("href") and urljoin(url, link["href"]) not in candidates:
        candidates.append(urljoin(url, link["href"]))
    for sc in page.find_all("script", type="application/ld+json"):          # schema.org NewsArticle "image"
        for u in re.findall(r'"(?:image|thumbnailUrl|contentUrl|url)"\s*:\s*"(https?:[^"]+\.(?:jpe?g|png|webp)[^"]*)"',
                            (sc.string or sc.get_text() or "").replace("\\/", "/"), re.I):
            if u not in candidates:
                candidates.append(u)

    for img in content_area.find_all("img"):
        srcset = img.get("srcset") or img.get("data-srcset")
        biggest = srcset.split(",")[-1].strip().split(" ")[0] if srcset else None     # last = usually the largest
        src = biggest or img.get("src") or img.get("data-src") or img.get("data-lazy-src")
        if not src:
            continue
        src = urljoin(url, src)
        if src.startswith("http") and src not in candidates:
            candidates.append(src)

    return text, candidates[:16]



def _parse_date(text):
    if not text:
        return None
    text = text.strip()
    for fn in (parsedate_to_datetime, lambda t: datetime.fromisoformat(t.replace("Z", "+00:00"))):
        try:
            dt = fn(text)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            continue
    return None


def fetch_feed_entries(source_name, url, limit=15):
    """
    Returns up to `limit` fresh entries (newest first):
      {"title","url","text","images","source","published_at"(datetime|None)}
    Returns [] (and logs) if the feed is down.
    """
    try:
        soup = _get(url, as_xml=True)
    except Exception as e:
        print(f"  ! {source_name}: feed unavailable ({type(e).__name__})")
        return []
    items = soup.find_all("item") or soup.find_all("entry")
    import config
    cutoff = datetime.now(timezone.utc) - timedelta(days=config.scrape_settings()["max_age_days"])
    entries = []
    for item in items:
        title_tag = item.find("title")
        link_tag = item.find("link")
        title = _clean(title_tag.text) if title_tag else ""
        link = None
        if link_tag is not None:
            link = (link_tag.text or "").strip() or link_tag.get("href")
        if not title or not link or not link.startswith("http"):
            continue
        date_tag = item.find("pubDate") or item.find("published") or item.find("updated") \
            or item.find("dc:date")
        published = _parse_date(date_tag.text if date_tag else None)
        if published and published < cutoff:
            continue
        summary_tag = item.find("content:encoded") or item.find("description") \
            or item.find("summary") or item.find("content")
        entries.append({
            "title": title,
            "url": link,
            "text": _clean(summary_tag.text) if summary_tag else "",
            "images": _images_from_entry(item, verify=False),
            "source": source_name,
            "published_at": published,
        })
        if len(entries) >= limit:
            break
    entries.sort(key=lambda e: e["published_at"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return entries


def hydrate_entry(entry, sleep=time.sleep):
    """
    Adds full article text and a VERIFIED hero image to ONE entry (in place).
    It works hard for an image before giving up (IMAGE_TRIES different candidates, 5-10):
      1. the feed's own images,  2. the article page itself (og:image, twitter:image, JSON-LD, content images),
      3. one more look, after a pause, at candidates that only failed because of network trouble.
    Raises images.NoVerifiedImage only when that is done. The article is then skipped before any LLM credit is spent.
    """
    import config
    from images import pick_verified_images, NoVerifiedImage, is_transient, fingerprint_of
    budget = config.retry_settings()["image_tries"]
    text = strip_boilerplate(entry.get("text") or "")        # publisher disclaimers are not article text
    src = entry.get("source")
    candidates = list(entry.get("images", []))
    scraped = False
    if len(text) < 1500 or not candidates:
        time.sleep(POLITE_DELAY)
        full_text, page_imgs = _scrape_html_fallback(entry["url"], entry["source"])
        scraped = True
        full_text = strip_boilerplate(full_text)
        if full_text and len(full_text) > len(text):
            text = full_text
        for i in page_imgs:
            if i not in candidates:
                candidates.append(i)
    entry["text"] = text
    ref = entry.get("url")
    good, rejected = pick_verified_images(candidates, limit=3, max_tries=budget, referer=ref, source=src)
    if not good and not scraped:                               # the feed's images were no good: ask the page itself
        time.sleep(POLITE_DELAY)
        _, page_imgs = _scrape_html_fallback(entry["url"], entry["source"])
        tried = set(candidates)
        fresh = [i for i in page_imgs if i not in tried]
        candidates += fresh
        good, more = pick_verified_images(fresh, limit=3, max_tries=max(1, budget - len(rejected)), referer=ref, source=src)
        rejected += more
    if not good:                                               # network-trouble failures get one more look after a pause
        again = [c for c, why in rejected if is_transient(why)][:max(2, budget // 2)]
        if again:
            sleep(3)
            good, _ = pick_verified_images(again, limit=3, max_tries=len(again), referer=ref, source=src)
    if not good:
        why = "; ".join(f"{u.split('/')[-1][:30]}: {w}" for u, w in rejected[:3]) or "no image found"
        raise NoVerifiedImage(f"no verifiable image after {len(rejected)} candidate(s) ({why})",
                              transient=bool(rejected) and all(is_transient(w) for _, w in rejected))
    import watermarks
    if watermarks.is_watermarked(entry.get("url") or ""):
        from images import hamming, NEAR_BITS

        def distinct(a, b):
            fa, fb = fingerprint_of(a), fingerprint_of(b)
            return not (fa and fb and hamming(fa, fb) <= NEAR_BITS)
        if len(good) < 2:                          # only one picture so far: look for a second one
            more = [c for c in candidates if c not in good and c not in {r[0] for r in rejected}]
            extra, _ = pick_verified_images(more, limit=2, max_tries=max(2, budget // 2), referer=ref, source=src)
            good = good + [g for g in extra if g not in good]
        good = watermarks.prefer_second(good, distinct)
    entry["images"] = good
    entry["image_fp"] = fingerprint_of(good[0])                # recorded when the article is published (images.GUARD)
    return entry
