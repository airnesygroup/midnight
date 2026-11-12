"""
Regression tests for: "articles skipped as too short when the real article is long", "dropped for no image when the page
has images", "skipped with no retries", and "'will retry' rows that never come back".
"""
import io
from datetime import datetime, timedelta, timezone

import mongomock
import pytest
import requests
from bs4 import BeautifulSoup

import generate
import images
import pagefetch
import scraper
from storage import MongoStorage, outcome_of, RETRY_MINUTES


# ------------------------------------------------------------------ fixtures
PARA = ("The minister told reporters on Tuesday that the new agreement would take effect next month, adding that "
        "officials from both countries had spent several weeks negotiating the final wording of the text. ")


def long_article_page(with_teaser_first=True):
    """A page whose FIRST <article> is a short teaser card (what broke the old scraper), with the real story in a div."""
    teaser = ('<article class="card"><h3>Related</h3><p>Short teaser text that is just long enough to pass forty chars.</p>'
              '</article>') if with_teaser_first else ""
    body = "".join(f"<p>{PARA}Paragraph {i} has a <a href='/x'>linked phrase</a> inside it and keeps going.</p>" for i in range(14))
    return f"""<html><head><meta property="og:image" content="https://cdn.example.com/hero.jpg"></head><body>
      <nav><p>Home | World | Sport | Business | Opinion | Culture | Travel | Weather | Contact us now</p></nav>
      {teaser}
      <div class="page"><div class="story-body">{body}</div></div>
      <aside class="related"><p>You might also like this other very long related story title that is not the article.</p></aside>
      <footer><p>Copyright notice and other footer text that is definitely longer than forty characters.</p></footer>
    </body></html>"""


def soup(html):
    return BeautifulSoup(html, "lxml")


# ------------------------------------------------------------------ text extraction
def test_teaser_article_tag_no_longer_hides_the_real_story():
    text, how = pagefetch.extract_text(soup(long_article_page()))
    assert len(text.split()) > 250                                  # the old scraper returned the ~10-word teaser
    assert "Short teaser text" not in text and "You might also like" not in text and "Copyright notice" not in text
    assert "Home | World" not in text


def test_words_are_not_glued_together_around_inline_links():
    html = "<html><body><article><p>Mbappé said <a href='/r'>Real Madrid</a>, which won, would <b>never</b> agree to it.</p>" \
           "<p>" + PARA * 3 + "</p></article></body></html>"
    text, _ = pagefetch.extract_text(soup(html))
    assert "said Real Madrid, which won, would never agree" in text      # old code: "saidReal Madrid,which won,wouldneveragree"


def test_json_ld_article_body_is_used_when_the_page_body_is_script_rendered():
    body = " ".join(["Sentence number %d of the article body goes here." % i for i in range(80)])
    html = ('<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle",'
            '"articleBody":"%s","image":["https://cdn.example.com/a.jpg"]}</script></head><body><div id="root"></div></body></html>' % body)
    text, how = pagefetch.extract_text(soup(html))
    assert how == "json-ld" and len(text.split()) > 300


def test_text_is_capped_so_a_huge_page_cannot_blow_the_prompt():
    big = "<html><body><div>" + "".join(f"<p>{PARA}{i}</p>" for i in range(400)) + "</div></body></html>"
    text, _ = pagefetch.extract_text(soup(big))
    assert len(text) <= pagefetch.MAX_TEXT_CHARS


# ------------------------------------------------------------------ image candidates
def test_image_candidates_include_lazy_srcset_picture_noscript_and_amp():
    html = """<html><head><meta property="og:image" content="/og.jpg"></head><body><article>
      <img data-src="/lazy.jpg" src="data:image/gif;base64,AAAA">
      <img srcset="/s-400.jpg 400w, /s-1200.jpg 1200w, /s-800.jpg 800w">
      <picture><source srcset="/pic-640.webp 640w, /pic-1600.webp 1600w"><img src="/pic-fallback.jpg"></picture>
      <noscript><img src="/noscript.jpg"></noscript>
      <amp-img src="/amp.jpg" width="600" height="400"></amp-img>
    </article></body></html>"""
    got = pagefetch.extract_images(soup(html), "https://site.example.com/a/b")
    assert got[0] == "https://site.example.com/og.jpg"                 # the page's declared hero comes first
    for expect in ("lazy.jpg", "s-1200.jpg", "pic-1600.webp", "noscript.jpg", "amp.jpg"):
        assert any(g.endswith(expect) for g in got), expect
    assert not any(g.startswith("data:") for g in got)
    assert not any(g.endswith("s-400.jpg") for g in got)               # biggest srcset entry wins, not the first/last


# ------------------------------------------------------------------ the ladder
def test_every_retry_starts_with_a_different_approach(monkeypatch):
    monkeypatch.setenv("READER_FALLBACK", "off")
    firsts = [pagefetch.ladder(a)[0] for a in range(4)]
    assert len(set(firsts)) == 4                                       # four attempts, four different first approaches
    assert all(sorted(pagefetch.ladder(a)) == sorted(pagefetch.BASE_ORDER) for a in range(6))
    assert pagefetch.timeout_for(3) > pagefetch.timeout_for(0)         # later retries are more patient


def test_reader_proxy_is_off_by_default_and_opt_in(monkeypatch):
    monkeypatch.delenv("READER_FALLBACK", raising=False)
    assert "reader" not in pagefetch.ladder(0)
    monkeypatch.setenv("READER_FALLBACK", "on")
    assert pagefetch.ladder(0)[-1] == "reader" and pagefetch.ladder(3)[0] == "reader"


def fake_fetch(pages):
    """pages: {profile: html or None (blocked)}"""
    def f(url, profile="browser", attempt=0):
        html = pages.get(profile)
        if html is None:
            return None, {"status": 403, "error": None, "bytes": 0}
        return soup(html), {"status": 200, "error": None, "bytes": len(html)}
    return f


@pytest.fixture
def no_net(monkeypatch):
    monkeypatch.setattr(scraper, "POLITE_DELAY", 0)
    monkeypatch.setattr(images, "GUARD", images.ImageGuard())
    monkeypatch.setattr(images, "verify_image", lambda u, **k: (True, "ok", u))


def test_a_blocked_first_approach_falls_through_to_one_that_works(monkeypatch, no_net):
    monkeypatch.setattr(pagefetch, "fetch_html", fake_fetch({"browser": None, "mobile": long_article_page()}))
    e = {"url": "https://www.africanews.example/a", "source": "Africanews", "title": "t",
         "text": "China excludes La Liga matches from broadcast schedule.", "images": []}
    out = scraper.hydrate_entry(e, sleep=lambda s: None)
    assert len(out["text"].split()) > 250 and out["images"]
    assert "browser: HTTP 403" in out["_diag"] and "mobile: HTTP 200" in out["_diag"]    # and it says what happened


def test_a_scheduled_retry_starts_from_a_different_approach(monkeypatch, no_net):
    order = []

    def f(url, profile="browser", attempt=0):
        order.append(profile)
        return soup(long_article_page()), {"status": 200, "error": None, "bytes": 9999}
    monkeypatch.setattr(pagefetch, "fetch_html", f)
    for attempt in (0, 1, 2):
        e = {"url": "https://x.example/a", "source": "X", "title": "t", "text": "short", "images": [], "attempt": attempt}
        scraper.hydrate_entry(e, sleep=lambda s: None)
    assert len(set(order)) == 3                                         # each try opened with a different approach


def test_thin_everywhere_reports_every_approach_that_was_tried(monkeypatch, no_net):
    stub = "<html><body><article><p>Just one short paragraph of about twenty words, which really is all there is here.</p></article></body></html>"
    monkeypatch.setattr(pagefetch, "fetch_html", fake_fetch({"browser": stub, "mobile": None, "amp": stub, "minimal": stub}))
    e = {"url": "https://x.example/stub", "source": "X", "title": "Stub", "text": "tiny feed text", "images": ["https://i.example.com/a.jpg"]}
    scraper.hydrate_entry(e, sleep=lambda s: None)
    with pytest.raises(generate.ThinSource) as ei:
        class St:                                               # process_entry only needs hydrate to have run
            db = None
        monkeypatch.setattr(generate, "hydrate_entry", lambda x: x)
        generate.process_entry(e, "world", St(), generate.SeenIndex(), dry_run=True)
    msg = str(ei.value)
    for profile in ("browser", "mobile", "amp", "minimal"):
        assert profile in msg, profile
    assert "words of real text" in msg


def test_no_picture_is_verified_until_the_text_is_long_enough(monkeypatch, no_net):
    calls = []
    monkeypatch.setattr(images, "verify_image", lambda u, **k: calls.append(u) or (True, "ok", u))
    monkeypatch.setattr(pagefetch, "fetch_html", fake_fetch({p: None for p in pagefetch.BASE_ORDER}))
    e = {"url": "https://x.example/t", "source": "X", "title": "T", "text": "tiny", "images": ["https://i.example.com/a.jpg"]}
    scraper.hydrate_entry(e, sleep=lambda s: None)
    assert calls == []                                          # no bandwidth spent on a story that cannot be written


def test_when_feed_images_fail_the_next_approach_supplies_new_candidates(monkeypatch, no_net):
    amp_page = long_article_page().replace("hero.jpg", "amp-hero.jpg")
    monkeypatch.setattr(pagefetch, "fetch_html", fake_fetch({"browser": long_article_page(), "mobile": amp_page}))
    monkeypatch.setattr(images, "verify_image", lambda u, **k: (True, "ok", u) if "amp-hero" in u else (False, "HTTP 404", None))
    e = {"url": "https://x.example/t", "source": "X", "title": "T", "text": "x " * 900, "images": ["https://i.example.com/feed.jpg"]}
    out = scraper.hydrate_entry(e, sleep=lambda s: None)
    assert out["images"] == ["https://cdn.example.com/amp-hero.jpg"]


# ------------------------------------------------------------------ images: the exact failures from the log
def jpeg(w, h, quality, grain=0):
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):                                   # a smooth, photo-ish gradient with shapes: compresses small
        d.line([(0, y), (w, y)], fill=(40 + y * 120 // h, 90, 160 - y * 100 // h))
    d.ellipse([w // 4, h // 4, w * 3 // 4, h * 3 // 4], fill=(230, 200, 120))
    d.rectangle([20, 20, 140, 90], fill=(30, 30, 30))
    if grain:                                            # film-grain, like a real photo: big files at high quality
        im = Image.blend(im, Image.effect_noise((w, h), grain).convert("RGB"), 0.35)
    b = io.BytesIO()
    im.save(b, "JPEG", quality=quality)
    return b.getvalue()


class Resp:
    def __init__(self, data, status=200, ctype="image/jpeg", break_after=None, length=None):
        self.status_code, self._d, self._break = status, data, break_after
        self.headers = {"Content-Type": ctype}
        if length:
            self.headers["Content-Length"] = str(length)

    def iter_content(self, n):
        data = self._d if self._break is None else self._d[:self._break]
        for i in range(0, len(data), n):
            yield data[i:i + n]
        if self._break is not None:
            raise requests.exceptions.ChunkedEncodingError("Connection broken: IncompleteRead")

    def close(self):
        pass


def test_a_small_but_real_640x360_thumbnail_is_accepted():
    data = jpeg(640, 360, quality=20)
    assert 4000 <= len(data) < 12000, len(data)          # the old code refused anything under 12 000 bytes ("only 9107 bytes")
    ok, why, _ = images._verify_once("https://cdn.example.com/p/640x360_cms.jpg", get=lambda *a, **k: Resp(data))
    assert ok, why


def test_a_blank_picture_is_still_refused():
    from PIL import Image
    b = io.BytesIO()
    Image.new("RGB", (640, 360), (128, 128, 128)).save(b, "JPEG")
    ok, why, _ = images._verify_once("https://cdn.example.com/p/gray.jpg", get=lambda *a, **k: Resp(b.getvalue() + b" " * 5000))
    assert not ok and "blank" in why


def test_a_download_that_breaks_midway_no_longer_kills_the_article():
    data = jpeg(1600, 900, quality=95, grain=60)
    assert len(data) > images.PARTIAL_OK_BYTES * 2
    # old behaviour: ChunkedEncodingError escaped from here and the whole article failed with it
    ok, why, final = images._verify_once("https://cdn.example.com/p/photo.jpg",
                                          get=lambda *a, **k: Resp(data, break_after=images.PARTIAL_OK_BYTES + 5000))
    assert ok and "partial" in why and final in images.SOFT


def test_a_stream_that_breaks_too_early_is_a_retryable_failure_not_a_crash():
    ok, why, _ = images._verify_once("https://cdn.example.com/p/photo.jpg",
                                      get=lambda *a, **k: Resp(jpeg(1600, 900, 95, grain=60), break_after=1000))
    assert not ok and images.is_transient(why)


def test_a_huge_original_is_a_last_resort_not_a_rejection(monkeypatch):
    monkeypatch.setattr(images, "MAX_BYTES", 40_000)
    big = jpeg(1600, 900, quality=95, grain=60)
    assert len(big) > 40_000
    ok, why, final = images._verify_once("https://cdn.example.com/p/ED_PYR_original.jpg",
                                          get=lambda *a, **k: Resp(big, length=13_000_000))
    assert ok and "oversize" in why and "13 MB" in why and final in images.SOFT


def test_a_normal_sized_picture_beats_a_huge_one_even_when_the_huge_one_is_listed_first(monkeypatch):
    monkeypatch.setattr(images, "MAX_BYTES", 40_000)
    big, small = jpeg(1600, 900, 95, grain=60), jpeg(800, 450, 40)
    assert len(small) < 40_000 < len(big)
    mapping = {"https://cdn.example.com/p/huge.jpg": big, "https://cdn.example.com/p/small.jpg": small}
    good, rejected = images.pick_verified_images(list(mapping), limit=1, get=lambda u, *a, **k: Resp(mapping[u]), guard=images.ImageGuard())
    assert good == ["https://cdn.example.com/p/small.jpg"]
    only_huge, _ = images.pick_verified_images(["https://cdn.example.com/p/huge.jpg"], limit=1,
                                               get=lambda u, *a, **k: Resp(big), guard=images.ImageGuard())
    assert only_huge == ["https://cdn.example.com/p/huge.jpg"]          # ...but with nothing else, it is used


def test_http_406_is_answered_with_different_headers_instead_of_a_rejection():
    data = jpeg(800, 450, 60)
    seen = []

    def get(u, headers=None, **k):
        seen.append(headers)
        picky = headers.get("Accept", "").startswith("image/avif")
        return Resp(b"", status=406) if picky else Resp(data)
    ok, why, _ = images._verify_once("https://cdn.example.com/p/a.jpg", get=get, referer="https://news.example.com/story")
    assert ok, why
    assert len(seen) >= 2 and seen[0]["Accept"] != seen[-1]["Accept"]


def test_a_persistent_406_is_retryable_later():
    assert images.is_transient("HTTP 406") and images.is_transient("stream broke (download interrupted)")


# ------------------------------------------------------------------ retry policy and the ledger
@pytest.fixture
def st():
    s = MongoStorage(client=mongomock.MongoClient(), db_name="ladder")
    s.ensure_ready()
    return s


def rec(st, url="https://a.example.com/x", **kw):
    args = dict(source_name="A", source_url=url, source_title="Some story title", section="world",
                status="skipped", reason="source text too thin", retryable=True)
    args.update(kw)
    return st.record(**args)


def test_default_is_the_first_try_plus_five_retries(monkeypatch):
    monkeypatch.delenv("ITEM_MAX_ATTEMPTS", raising=False)
    import config
    assert config.item_retry_settings()["max_attempts"] == 6 and len(RETRY_MINUTES) == 5


def test_a_story_gets_five_retries_then_is_abandoned_with_its_reason(st, monkeypatch):
    monkeypatch.delenv("ITEM_MAX_ATTEMPTS", raising=False)
    results = [rec(st) for _ in range(6)]
    assert [r["retrying"] for r in results] == [True] * 5 + [False]
    assert results[-1]["attempts"] == 6 and "gave up after 6 tries" in results[-1]["reason"]
    assert st.attempts_for("https://a.example.com/x") == 6
    assert st.attempts_for("https://never.seen/zzz") == 0


def test_thin_and_image_failures_are_retried_by_the_pipeline(monkeypatch):
    """The two classes that used to be abandoned on the first try."""
    from tests.test_pipeline import env, go  # noqa: F401
    assert generate.ThinSource.__mro__[1] is generate.Skip
    src = open(generate.__file__).read()
    assert "isinstance(e, (FailedFactCheck, ThinSource))" in src
    assert 'str(e)[:400], True)' in src                             # NoVerifiedImage: retryable=True always


def test_pipeline_end_to_end_thin_story_is_queued_for_retry_with_the_attempt_passed_on(monkeypatch):
    from tests.test_pipeline import SOURCES, fake_pool
    from tests.test_pipeline import FEEDS
    st = MongoStorage(client=mongomock.MongoClient(), db_name="e2e")
    st.ensure_ready()
    seen_attempts = []

    def hydrate(e):
        seen_attempts.append(e.get("attempt"))
        e["text"] = "far too short"
        e["_diag"] = "browser: HTTP 200, 3 words via density | mobile: HTTP 403"
        return e
    monkeypatch.setattr(generate, "hydrate_entry", hydrate)
    fetch = lambda name, url, limit=15: [dict(x) for x in FEEDS.get(url, [])]
    generate.run(count=1, forever=False, storage=st, sources=SOURCES[:1], fetch=fetch, sleep=lambda s: None,
                 log=lambda m: None, pool=fake_pool(), reports=False)
    row = st.ledger.find_one({"sourceUrl": "https://a.example.com/news/1"})
    assert row["retryable"] is True and row["nextTryAt"] and outcome_of(row) == "retrying"
    assert "tried: browser: HTTP 200" in row["reason"] and "mobile: HTTP 403" in row["reason"]
    assert seen_attempts[0] == 0
    # second visit (time passes): the attempt number the scraper sees has gone up, so it picks another approach
    st.ledger.update_one({"_id": row["_id"]}, {"$set": {"nextTryAt": "2000-01-01T00:00:00Z"}})
    generate.run(count=1, forever=False, storage=st, sources=SOURCES[:1], fetch=lambda *a, **k: [], sleep=lambda s: None,
                 log=lambda m: None, pool=fake_pool(), reports=False)
    assert 1 in seen_attempts


# ------------------------------------------------------------------ rows that said "will retry" but never could
def old_row(st, **over):
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    d = {"normUrl": "a.example.com/legacy", "sourceName": "A", "sourceUrl": "https://a.example.com/legacy",
         "sourceTitle": "Legacy failed story", "section": "world", "status": "failed",
         "reason": "ChunkedEncodingError: ('Connection broken: IncompleteRead(1048576 bytes read, 12822114 more expected)'",
         "at": now, "firstSeenAt": now}
    d.update(over)
    st.ledger.insert_one(d)
    return d


FEED_MAP = {"A": "https://a/feed"}


def test_legacy_failed_rows_were_orphaned_and_are_rescued(st):
    old_row(st)                                                         # no retryable / attempts / entry / nextTryAt
    assert outcome_of(st.ledger.find_one({"normUrl": "a.example.com/legacy"})) == "retrying"     # dashboard: "Will retry"
    assert st.due_entries("https://a/feed") == []                       # ...but it could NEVER come back (the bug)
    assert st.rescue_stuck(FEED_MAP) == 1
    due = st.due_entries("https://a/feed")
    assert [e["url"] for e in due] == ["https://a.example.com/legacy"] and due[0]["title"] == "Legacy failed story"


def test_retryable_rows_without_a_snapshot_or_due_time_are_rescued_but_finished_rows_are_left_alone(st):
    old_row(st, normUrl="a.example.com/r1", sourceUrl="https://a.example.com/r1", retryable=True, attempts=1)
    old_row(st, normUrl="a.example.com/pub", sourceUrl="https://a.example.com/pub", status="published", articleId="art1")
    old_row(st, normUrl="a.example.com/dead", sourceUrl="https://a.example.com/dead", retryable=False, attempts=6)
    assert st.rescue_stuck(FEED_MAP) == 1
    urls = [e["url"] for e in st.due_entries("https://a/feed")]
    assert urls == ["https://a.example.com/r1"]
    assert st.ledger.find_one({"normUrl": "a.example.com/dead"}).get("retryable") is False
    assert st.rescue_stuck(FEED_MAP) == 0                               # idempotent


def test_rows_from_an_unknown_source_are_not_guessed_at(st):
    old_row(st, sourceName="Mystery")
    assert st.rescue_stuck(FEED_MAP) == 0


def test_requeue_abandoned_reopens_old_policy_casualties_only(st):
    thin = "source text too thin to write an honest article (29 words of real text, need 90)"
    old_row(st, normUrl="a.example.com/thin", sourceUrl="https://a.example.com/thin", status="skipped", reason=thin, retryable=False, attempts=3)
    old_row(st, normUrl="a.example.com/img", sourceUrl="https://a.example.com/img", status="skipped",
            reason="no verifiable image after 2 candidate(s) (x.jpg: HTTP 406)", retryable=False, attempts=1)
    old_row(st, normUrl="a.example.com/dup", sourceUrl="https://a.example.com/dup", status="skipped",
            reason='same story already covered: "Trump to remove Rwanda"', retryable=False, attempts=1)
    old_row(st, normUrl="a.example.com/old", sourceUrl="https://a.example.com/old", status="skipped", reason=thin, retryable=False,
            firstSeenAt=(datetime.now(timezone.utc) - timedelta(days=60)).isoformat().replace("+00:00", "Z"))
    rx = "too thin|no verifiable image|ChunkedEncodingError|ConnectionError"
    assert st.requeue_abandoned(rx, days=14, feed_by_source=FEED_MAP, dry_run=True) == 2          # dry run changes nothing
    assert st.due_entries("https://a/feed") == []
    assert st.requeue_abandoned(rx, days=14, feed_by_source=FEED_MAP) == 2
    assert sorted(e["url"] for e in st.due_entries("https://a/feed")) == ["https://a.example.com/img", "https://a.example.com/thin"]
    row = st.ledger.find_one({"normUrl": "a.example.com/thin"})
    assert row["attempts"] == 0 and outcome_of(row) == "retrying" and row["history"][-1]["status"] == "reopened"
