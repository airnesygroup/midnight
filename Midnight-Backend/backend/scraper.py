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


_DIAG = {}     # url -> notes about every page look (what happened, how many words), read back by hydrate_entry


def _scrape_profile(url, source, profile="browser", attempt=0):
    """One look at the article page with one approach (see pagefetch.PROFILES). Returns (text, image candidates).
    Never raises; what happened is kept in _DIAG so a skip can say WHY (blocked? empty? really short?)."""
    import pagefetch
    text, imgs, note = pagefetch.scrape(url, profile, attempt)
    _DIAG.setdefault(url, []).append(note)
    if len(_DIAG) > 500:
        for k in list(_DIAG)[:100]:
            _DIAG.pop(k, None)
    return text, imgs


def _scrape_html_fallback(url, source):
    """Best-effort fetch of a single article page (the default 'browser' approach). Returns (text, image candidates)."""
    return _scrape_profile(url, source, "browser")


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

    It does not give up after one way of asking. The page is looked at with up to four different approaches
    (pagefetch.ladder: browser, mobile, AMP, minimal; plus an optional reader proxy), moving on to the next one whenever
    the text is still too short or no picture has verified. A scheduled retry (entry["attempt"] > 0) starts from a
    DIFFERENT approach than the previous try, and is more patient.

    Text first: a story that cannot be written is not worth downloading pictures for, so thin text returns early
    (generate.process_entry raises ThinSource, whose reason lists every approach that was tried).
    Raises images.NoVerifiedImage only when every approach and every candidate picture has been used.
    """
    import config
    import pagefetch
    from images import pick_verified_images, NoVerifiedImage, is_transient, fingerprint_of
    budget = config.retry_settings()["image_tries"]
    need = config.source_settings()["min_words"]
    attempt = int(entry.get("attempt") or 0)
    ref, src = entry.get("url"), entry.get("source")
    text = strip_boilerplate(entry.get("text") or "")        # publisher disclaimers are not article text
    candidates = list(entry.get("images", []))
    rungs = pagefetch.ladder(attempt)
    state = {"next": 0}
    _DIAG.pop(ref, None)

    def look():
        """One more look at the article page, with the next approach on the ladder. False when the ladder is used up."""
        nonlocal text
        if state["next"] >= len(rungs):
            return None
        profile = rungs[state["next"]]
        state["next"] += 1
        time.sleep(POLITE_DELAY)
        if profile == "browser" and attempt == 0:
            full_text, page_imgs = _scrape_html_fallback(ref, src)      # the default approach
        else:
            full_text, page_imgs = _scrape_profile(ref, src, profile, attempt)
        full_text = strip_boilerplate(full_text)
        if full_text and (len(full_text.split()), len(full_text)) > (len(text.split()), len(text)):
            text = full_text                   # more real words wins (not more characters: a long blob is not an article)
        fresh = [i for i in page_imgs if i not in candidates]
        candidates.extend(fresh)
        return fresh

    def words():
        return len(text.split())

    if len(text) < 1500 or not candidates:
        look()
    while words() < need and look() is not None:               # still thin: a different approach
        pass
    entry["text"] = text
    notes = _DIAG.pop(ref, [])
    entry["_diag"] = " | ".join(notes)
    if words() < need:
        entry["images"] = candidates[:6]
        return entry

    good, rejected = pick_verified_images(candidates, limit=3, max_tries=budget, referer=ref, source=src)
    while not good:                                            # nothing verified: look at the page the next way
        fresh = look()
        if fresh is None:
            break
        if not fresh:
            continue
        got, more = pick_verified_images(fresh, limit=3, max_tries=max(3, budget - len(rejected)), referer=ref, source=src)
        good += got
        rejected += more
    if not good:                                               # network-trouble failures get one more look after a pause
        again = [c for c, why in rejected if is_transient(why)][:max(2, budget // 2)]
        if again:
            sleep(3)
            good, _ = pick_verified_images(again, limit=3, max_tries=len(again), referer=ref, source=src)
    notes = notes + _DIAG.pop(ref, [])
    entry["_diag"] = " | ".join(notes)
    if not good:
        why = "; ".join(f"{u.split('/')[-1][:30]}: {w}" for u, w in rejected[:3]) or "no image found"
        tried = f" [pages: {entry['_diag']}]" if entry["_diag"] else ""
        raise NoVerifiedImage(f"no verifiable image after {len(rejected)} candidate(s) ({why}){tried}",
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
