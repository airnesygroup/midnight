"""
Publishers whose lead (first) image usually carries the outlet's own logo as a watermark in a corner (bottom-left,
bottom-right, top-right). For these the SECOND distinct image of the article is used as the hero image instead; the
first is kept as a fallback when the article only has one usable picture.

This list comes from general knowledge of how these outlets brand their lead images, NOT from inspecting their feeds
today. Check it against the live site and adjust without touching code:
    WATERMARK_SITES_ADD=example.com,other.org      more publishers (domains)
    WATERMARK_SITES_REMOVE=cnn.com                 publishers that turn out to be fine
    WATERMARK_SECOND_IMAGE=off                     switch the rule off completely
"""

from urllib.parse import urlsplit

import config

WATERMARKED = {
    # UK / Ireland
    "bbc.co.uk", "bbc.com", "sky.com", "itv.com", "channel4.com", "rte.ie",
    # Canada
    "cbc.ca", "ctvnews.ca", "globalnews.ca",
    # US broadcasters and cable news
    "cnbc.com", "nbcnews.com", "msnbc.com", "abcnews.go.com", "cbsnews.com", "cnn.com", "foxnews.com", "foxbusiness.com",
    "newsmax.com", "pbs.org",
    # international broadcasters (logo bug on video stills and lead photos)
    "aljazeera.com", "france24.com", "dw.com", "euronews.com", "rt.com", "trtworld.com", "cgtn.com", "abc.net.au",
    "9news.com.au", "ndtv.com", "wionews.com", "timesnow.com", "indiatoday.in", "arabnews.com",
}


def _domains(name):
    return {d.strip().lower().removeprefix("www.") for d in (config.env(name, "") or "").split(",") if d.strip()}


def watermarked_sites():
    return (WATERMARKED | _domains("WATERMARK_SITES_ADD")) - _domains("WATERMARK_SITES_REMOVE")


def host_of(url):
    try:
        return (urlsplit(url).hostname or "").lower().removeprefix("www.")
    except Exception:  # noqa: BLE001
        return ""


def is_watermarked(url):
    """True when the article at `url` is from a publisher known for watermarked lead images."""
    if (config.env("WATERMARK_SECOND_IMAGE", "on") or "on").lower() in ("off", "0", "false", "no"):
        return False
    h = host_of(url)
    return any(h == d or h.endswith("." + d) for d in watermarked_sites())


def prefer_second(good, distinct):
    """`good`: verified image URLs in page order. `distinct(a, b)`: True when a and b are different pictures
    (not the same photo at two sizes). Returns the list with the second DISTINCT picture first."""
    if len(good) < 2:
        return good
    first = good[0]
    for i, g in enumerate(good[1:], start=1):
        if distinct(first, g):
            return [g, first] + [x for j, x in enumerate(good) if j not in (0, i)]
    return good
