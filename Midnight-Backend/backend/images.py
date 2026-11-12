"""
Image verification. An article is never published unless its hero image
passes ALL of these tests, by actually downloading it:

  * absolute https:// URL (http:// is upgraded to https:// if that works)
  * HTTP 200 and an image/* content type (SVG rejected: that is how logos ship)
  * real image bytes (PNG/JPEG/GIF/WEBP/AVIF signature) that Pillow can decode
  * at least 400x220 px, a photo-like aspect ratio (0.6 .. 3.2) and >= 12 KB
  * not a logo / icon / avatar / tracking pixel / placeholder by URL
  * not a GENERIC image: the same picture an outlet puts on story after story (NPR's headphones artwork, a site
    banner, a "no photo" tile). Recognised by CONTENT, not by URL: every accepted image gets a perceptual
    fingerprint (dHash). An image is refused when it matches known placeholder art (KNOWN_GENERIC), or when the
    same picture is already on a published article of the SAME outlet (IMAGE_MAX_REUSE_SAME_SOURCE, default 1),
    or on IMAGE_MAX_REUSE_ANY (default 3) articles from anywhere.
"""

import io
import re
import time
from urllib.parse import urlsplit, urlunsplit

import requests

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "image/avif,image/webp,image/*;q=0.8,*/*;q=0.5",
}
MIN_W, MIN_H, MIN_BYTES, MAX_BYTES = 400, 220, 4_000, 6_000_000   # MIN_BYTES: a real 640x360 thumbnail can be ~9 KB
MIN_STDDEV = 6.0            # a picture with almost no tonal variation is a blank/solid placeholder, however big
PARTIAL_OK_BYTES = 64_000   # a stream that broke after this much is judged on its (intact) header
MOBILE_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
             "Version/17.4 Mobile/15E148 Safari/604.1")
MIN_ASPECT, MAX_ASPECT = 0.6, 3.2

BAD_URL_PARTS = ("logo", "icon", "favicon", "avatar", "sprite", "spacer", "pixel.", "tracking",
                 "-ad-", "/ads/", "advert", "badge", "button", "share-", "social-", "author-",
                 "profile-", "placeholder", "default-image", "1x1", "blank.gif", "/emoji/",
                 "default-audio", "default_audio", "default-share", "default_share", "default-og", "og-default",
                 "generic", "fallback", "no-image", "noimage", "image-not-available", "coming-soon", "site-default")

_SIGNATURES = (b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"GIF87a", b"GIF89a")


class NoVerifiedImage(Exception):
    """No candidate image passed verification. transient=True: every failure was a network hiccup (timeout, 5xx,
    rate limit), not a bad image, so the story is worth another try later instead of being skipped for good."""
    def __init__(self, msg="", transient=False):
        super().__init__(msg)
        self.transient = transient


TRANSIENT_MARKERS = ("request failed", "unreachable", "HTTP 5", "HTTP 429", "HTTP 408", "HTTP 403", "HTTP 401",
                     "HTTP 406", "only 0 bytes", "stream broke", "timed out")


def is_transient(reason):
    """A failure that may well succeed on a second look (network trouble, hotlink check), not a bad image."""
    return any(m in (reason or "") for m in TRANSIENT_MARKERS)


def looks_like_url(url):
    return isinstance(url, str) and bool(re.match(r"^https?://[^\s/]+\.[^\s/]+/\S*$", url))


def _is_image_bytes(b):
    if b.startswith(_SIGNATURES):
        return True
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return True
    return b[4:12] in (b"ftypavif", b"ftypavis")


# ------------------------------------------------------------------ generic-image guard
DHASH_SIZE = 16            # 16x16 gradient bits = a 256-bit fingerprint, stable across resizing and re-compression
NEAR_BITS = 20             # two fingerprints this close (of 256) are "the same picture"

# Placeholder art that outlets use instead of a real photo. dHash-256, hex.
KNOWN_GENERIC = {
    "NPR audio headphones artwork": "032004c00968133414d024d8254825482cc826982298233813301334033004c0",
}

_FP = {}                   # final image URL -> fingerprint of the bytes that were just verified (bounded)
SOFT = set()               # accepted, but only as a last resort: huge files, or a download that broke after a good header


def dhash(im, size=DHASH_SIZE):
    """256-bit difference hash (hex, 64 chars) of a PIL image."""
    g = im.convert("L").resize((size + 1, size))
    px = g.tobytes()
    bits = 0
    for r in range(size):
        base = r * (size + 1)
        for c in range(size):
            bits = (bits << 1) | (1 if px[base + c] > px[base + c + 1] else 0)
    return f"{bits:0{size * size // 4}x}"


def hamming(a, b):
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def fingerprint_of(url):
    """Fingerprint of an image URL that verify_image/_verify_once accepted a moment ago, else None."""
    return _FP.get(url)


def _remember_fp(url, fp):
    if len(_FP) > 2000:
        for k in list(_FP)[:500]:
            _FP.pop(k, None)
    _FP[url] = fp


class ImageGuard:
    """Refuses pictures that are placeholders. Backed by the `imageFingerprints` collection (one row per
    published article/trend image: fp, url, source, ref, at); works without a database too (known art only)."""

    def __init__(self, db=None, settings=None):
        self.db, self.rows, self._settings = db, None, settings

    def use_database(self, db):
        if db is not None and db is not self.db:
            self.db, self.rows = db, None

    def settings(self):
        if self._settings:
            return self._settings
        try:
            import config
            return config.image_guard_settings()
        except Exception:  # noqa: BLE001
            return {"same_source": 1, "any_source": 3}

    def _load(self):
        if self.rows is None:
            self.rows = []
            if self.db is not None:
                try:
                    for d in self.db["imageFingerprints"].find({}, {"fp": 1, "source": 1}):
                        if d.get("fp"):
                            self.rows.append((d["fp"], d.get("source")))
                except Exception:  # noqa: BLE001 - a missing/slow collection must never stop publishing
                    pass
        return self.rows

    def why_generic(self, fp, source=None):
        """None when the picture looks like a real, story-specific photo, else the reason it is refused."""
        if not fp:
            return None
        for name, known in KNOWN_GENERIC.items():
            if hamming(fp, known) <= NEAR_BITS:
                return f"generic placeholder image ({name})"
        cfg = self.settings()
        near = [src for f, src in self._load() if hamming(fp, f) <= NEAR_BITS]
        same = sum(1 for src in near if source and src == source)
        if source and cfg["same_source"] and same >= cfg["same_source"]:
            return f"generic image: {source} already used this same picture on {same} other article(s)"
        if cfg["any_source"] and len(near) >= cfg["any_source"]:
            return f"generic image: this same picture is already on {len(near)} published articles"
        return None

    def record(self, fp, url, source=None, ref=None):
        """Call after an article/trend using this image was published."""
        if not fp:
            return
        self._load().append((fp, source))
        if self.db is not None:
            try:
                from datetime import datetime, timezone
                self.db["imageFingerprints"].insert_one({"fp": fp, "url": url, "source": source, "ref": ref,
                                                         "at": datetime.now(timezone.utc).isoformat()})
            except Exception:  # noqa: BLE001
                pass


GUARD = ImageGuard()


def use_database(db):
    """Point the module-wide guard at the database (idempotent)."""
    GUARD.use_database(db)


def record_use(fp, url, source=None, ref=None):
    GUARD.record(fp, url, source, ref)


def _read_capped(r):
    """Reads an image response. Returns (bytes, state): "ok" (whole file), "big" (stopped at MAX_BYTES) or "broke"
    (the connection died part-way: ChunkedEncodingError / read timeout while streaming). Never raises: a broken
    stream used to escape from here and take the whole article down with it."""
    data = bytearray()
    try:
        for chunk in r.iter_content(65536):
            data += chunk
            if len(data) > MAX_BYTES:
                return bytes(data), "big"
    except Exception:  # noqa: BLE001
        return bytes(data), "broke"
    return bytes(data), "ok"


def _verify_once(url, get=requests.get, referer=None):
    """One look at one image. Returns (ok: bool, reason: str, final_url: str|None)."""
    hdr = {**HEADERS, "Referer": referer} if referer else HEADERS
    if not looks_like_url(url):
        return False, "not an absolute image URL", None
    low = url.lower()
    if any(p in low for p in BAD_URL_PARTS):
        return False, "looks like a logo/icon/placeholder", None
    candidates = [url]
    if url.startswith("http://"):
        candidates.insert(0, "https://" + url[len("http://"):])
    last = "unreachable"
    origin = "{0.scheme}://{0.netloc}/".format(urlsplit(referer)) if referer else None
    header_sets = [hdr,
                   {**hdr, "Accept": "*/*"},
                   {"User-Agent": MOBILE_UA, "Accept": "*/*", **({"Referer": referer} if referer else {})},
                   {"User-Agent": HEADERS["User-Agent"], **({"Referer": origin} if origin else {})}]
    for u in candidates:
        r = None
        for h in header_sets:                # 406/403/401: the server dislikes our headers; ask a different way
            try:
                r = get(u, headers=h, timeout=12, stream=True, allow_redirects=True)
            except Exception as e:  # noqa: BLE001
                last = f"request failed ({type(e).__name__})"
                r = None
                break
            if r.status_code not in (406, 403, 401):
                break
            last = f"HTTP {r.status_code}"
            try:
                r.close()
            except Exception:  # noqa: BLE001
                pass
        if r is None:
            continue
        try:
            if r.status_code != 200:
                last = f"HTTP {r.status_code}"
                continue
            ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if ctype in ("binary/octet-stream", "application/octet-stream"):
                ctype = "image/unknown"     # CDNs often mislabel photos; the bytes are checked below (signature + decode)
            if not ctype.startswith("image/") or "svg" in ctype:
                last = f"content type {ctype or 'missing'} is not a photo"
                continue
            size_hdr = r.headers.get("Content-Length")
            data, state = _read_capped(r)
        finally:
            try:
                r.close()
            except Exception:  # noqa: BLE001
                pass
        if state != "ok":
            # Too big to fetch whole, or the connection broke mid-download. The header (dimensions) is at the start of
            # the file, so judge the picture on that. Such a picture is only used when no normal one verifies (SOFT).
            if len(data) >= (MAX_BYTES if state == "big" else PARTIAL_OK_BYTES) and _is_image_bytes(data):
                try:
                    from PIL import Image
                    with Image.open(io.BytesIO(data)) as im:
                        w, h = im.size
                except Exception:  # noqa: BLE001
                    w = h = 0
                if w >= MIN_W and h >= MIN_H and MIN_ASPECT <= w / h <= MAX_ASPECT:
                    SOFT.add(u)
                    mb = f", {int(size_hdr) / 1e6:.0f} MB" if (size_hdr or "").isdigit() else ""
                    return True, f"ok ({w}x{h}, {'oversize' if state == 'big' else 'partial download'}{mb})", u
            last = "file too large" if state == "big" else "stream broke (download interrupted)"
            continue
        if len(data) < MIN_BYTES:
            last = f"only {len(data)} bytes"
            continue
        if not _is_image_bytes(data):
            last = "bytes are not a real image"
            continue
        try:
            from PIL import Image, ImageStat
            with Image.open(io.BytesIO(data)) as im:
                im.load()
                w, h = im.size
                fp = dhash(im)
                flat = ImageStat.Stat(im.convert("L")).stddev[0] < MIN_STDDEV     # measured on real pixels, not a downscale
        except Exception:
            # AVIF without Pillow support: signature + size already checked, accept.
            if data[4:12] in (b"ftypavif", b"ftypavis"):
                return True, "ok (avif)", u
            last = "image cannot be decoded"
            continue
        if w < MIN_W or h < MIN_H:
            last = f"too small ({w}x{h})"
            continue
        if not MIN_ASPECT <= w / h <= MAX_ASPECT:
            last = f"odd shape ({w}x{h}), probably a banner/logo"
            continue
        if flat:
            last = f"blank image ({w}x{h}): no picture in it"
            continue
        _remember_fp(u, fp)
        return True, f"ok ({w}x{h})", u
    return False, last, None


def verify_image(url, get=requests.get, referer=None, tries=3, sleep=time.sleep):
    """Returns (ok, reason, final_url). A network hiccup (timeout, 5xx, 429, a hotlink 403) is looked at up to
    `tries` times, with a short pause and, from the second look, the article page as Referer. A genuinely bad
    image (too small, a logo, not an image) is rejected at once."""
    res = (False, "unreachable", None)
    for i in range(max(1, tries)):
        res = _verify_once(url, get=get, referer=referer if i else None)
        if res[0] or not is_transient(res[1]):
            return res
        if i < tries - 1:
            sleep(i + 1)
    return res


def pick_verified_images(candidates, limit=3, get=requests.get, max_tries=None, referer=None, source=None, guard=None):
    """(verified urls, [(candidate, why) rejected]). Looks at up to `max_tries` different candidates
    (IMAGE_TRIES, 5-10) until `limit` pass. A candidate that is a verified photo but a known placeholder, or the
    same picture this outlet (`source`) keeps reusing, is rejected like any other bad image."""
    if max_tries is None:
        import config
        max_tries = config.retry_settings()["image_tries"]
    guard = guard or GUARD
    good, rejected, soft = [], [], []
    for c in candidates:
        if len(good) >= limit or len(good) + len(rejected) + len(soft) >= max_tries:
            break
        ok, why, final = verify_image(c, get=get, referer=referer)
        if ok:
            if final in SOFT:                  # huge / interrupted download: keep it, but only if nothing better verifies
                soft.append(final)
                continue
            generic = guard.why_generic(fingerprint_of(final), source)
            if generic:
                rejected.append((c, generic))
                continue
        (good if ok else rejected).append(final if ok else (c, why))
    if not good and soft:
        good = soft[:limit]
    return good, rejected
