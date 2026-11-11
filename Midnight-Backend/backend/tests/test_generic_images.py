"""Generic hero images (NPR's headphones artwork, a site banner reused on every story) and junk stub articles."""
import io
import os
import sys

import mongomock
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import generate
import images
import scraper
from boilerplate import strip_boilerplate
from storage import MongoStorage

@pytest.fixture(autouse=True)
def _fresh_fingerprints():
    images._FP.clear()
    yield
    images._FP.clear()


FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "npr_generic.png")


class Resp:
    def __init__(self, data, status=200, ctype="image/png"):
        self.status_code, self.headers, self._d = status, {"Content-Type": ctype}, data

    def iter_content(self, n):
        yield self._d

    def close(self):
        pass


def photo(seed, w=1200, h=700):
    """A distinct, photo-like (noisy) image per seed."""
    from PIL import Image
    import random
    rnd = random.Random(seed)
    im = Image.new("RGB", (w, h))
    px = [(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256)) for _ in range(w * h // 64)]
    small = Image.new("RGB", (w // 8, h // 8))
    small.putdata([px[i % len(px)] for i in range(small.size[0] * small.size[1])])
    im = small.resize((w, h))
    b = io.BytesIO(); im.save(b, "PNG"); return b.getvalue()


def getter(mapping):
    return lambda u, *a, **k: Resp(mapping[u])


def test_the_npr_headphones_placeholder_is_refused_even_though_it_is_a_valid_image():
    data = open(FIXTURE, "rb").read()
    url = "https://media.npr.org/assets/img/2026/10/30/some-story-photo_wide-s1400-c100.png"   # nothing in the URL gives it away
    assert images.verify_image(url, get=lambda *a, **k: Resp(data))[0]                       # passes every old check
    good, rejected = images.pick_verified_images([url], limit=1, get=lambda *a, **k: Resp(data), source="NPR", guard=images.ImageGuard())
    assert good == [] and "generic placeholder image" in rejected[0][1]


def test_placeholder_is_recognised_at_any_size_and_after_recompression():
    from PIL import Image
    im = Image.open(FIXTURE)
    known = images.KNOWN_GENERIC["NPR audio headphones artwork"]
    for size in ((1400, 787), (700, 394), (400, 225)):
        assert images.hamming(images.dhash(im.resize(size)), known) <= images.NEAR_BITS
    b = io.BytesIO(); im.save(b, "JPEG", quality=55); b.seek(0)
    assert images.hamming(images.dhash(Image.open(b)), known) <= images.NEAR_BITS


def test_a_real_photo_is_not_mistaken_for_the_placeholder():
    g = images.ImageGuard()
    mapping = {f"https://i.example.com/p/{i}.png": photo(i) for i in range(4)}
    good, rejected = images.pick_verified_images(list(mapping), limit=4, get=getter(mapping), source="NPR", guard=g)
    assert len(good) == 4 and not rejected


def test_the_same_picture_on_every_story_of_one_outlet_is_refused_but_other_outlets_may_share_a_wire_photo():
    db = mongomock.MongoClient()["g"]
    g = images.ImageGuard(db=db, settings={"same_source": 1, "any_source": 3})
    pic = photo(99)
    url = "https://cdn.example.com/p/banner-a.png"
    get = lambda *a, **k: Resp(pic)
    good, _ = images.pick_verified_images([url], limit=1, get=get, source="Outlet X", guard=g)
    assert good == [url]                                                  # first story: no way to know yet
    g.record(images.fingerprint_of(url), url, "Outlet X", "art_1")        # ...it is published, and remembered
    good, rejected = images.pick_verified_images(["https://cdn.example.com/p/banner-b.png"], limit=1, get=get, source="Outlet X", guard=g)
    assert good == [] and "already used this same picture" in rejected[0][1]   # second story, same outlet, same picture
    assert db["imageFingerprints"].count_documents({}) == 1
    # another outlet may use the same wire photo ...
    good, _ = images.pick_verified_images(["https://cdn.example.com/p/wire-1.png"], limit=1, get=get, source="Outlet Y", guard=g)
    assert good
    g.record(images.fingerprint_of("https://cdn.example.com/p/wire-1.png"), "u", "Outlet Y", "art_2")
    g.record(images.fingerprint_of("https://cdn.example.com/p/wire-1.png"), "u", "Outlet Z", "art_3")
    # ... but not once three articles already carry it
    good, rejected = images.pick_verified_images(["https://cdn.example.com/p/wire-2.png"], limit=1, get=get, source="Outlet W", guard=g)
    assert good == [] and "already on 3 published articles" in rejected[0][1]
    # and a fresh guard on the same database learns the history from it
    assert images.ImageGuard(db=db, settings={"same_source": 1, "any_source": 3}).why_generic(images.fingerprint_of(url), "Outlet X")


def test_hydrate_falls_through_to_the_real_article_photo_when_the_first_candidate_is_the_placeholder(monkeypatch):
    placeholder = open(FIXTURE, "rb").read()
    real = photo(7)
    mapping = {"https://media.npr.org/a/default.png": placeholder, "https://media.npr.org/a/real.png": real}
    monkeypatch.setattr(images, "GUARD", images.ImageGuard())
    monkeypatch.setattr(scraper, "POLITE_DELAY", 0)
    monkeypatch.setattr(images, "verify_image", lambda u, get=None, referer=None, tries=3, sleep=None:
                        images._verify_once(u, get=lambda uu, *a, **k: Resp(mapping[uu])))
    e = {"url": "https://www.npr.org/x", "source": "NPR", "text": "word " * 300,
         "images": ["https://media.npr.org/a/default.png", "https://media.npr.org/a/real.png"]}
    out = scraper.hydrate_entry(e, sleep=lambda s: None)
    assert out["images"] == ["https://media.npr.org/a/real.png"] and out["image_fp"]


def test_only_the_placeholder_available_means_no_article():
    placeholder = open(FIXTURE, "rb").read()
    url = "https://media.npr.org/a/hero.png"
    good, rejected = images.pick_verified_images([url], limit=1, get=lambda *a, **k: Resp(placeholder), source="NPR", guard=images.ImageGuard())
    assert good == [] and rejected


# ---------------------------------------------------------------- junk stub articles
MECKLEY = ("Owner Briana Meckley says her Lopez, Pennsylvania shop, Meckley Brooms, is experiencing a surge in broom orders "
           "for Halloween. Scott Simon of NPR interviewed Meckley about the seasonal uptick. "
           "NPR does not offer or accept money for coverage or interviews. Anyone who makes such an offer or request "
           "is not an NPR employee and does not represent NPR.")


def test_boilerplate_is_stripped_so_it_cannot_pad_a_stub_or_leak_into_a_summary():
    out = strip_boilerplate(MECKLEY)
    assert "does not offer or accept money" not in out and "not an NPR employee" not in out
    assert out.startswith("Owner Briana Meckley") and out.endswith("seasonal uptick.")
    assert strip_boilerplate("Real sentence one. Subscribe to our weekly newsletter for more. Real sentence two.").count("newsletter") == 0
    assert strip_boilerplate("Copyright © 2026 NPR. All rights reserved. Body text stays here.").endswith("Body text stays here.")
    assert strip_boilerplate("") == ""


def test_hydrate_strips_the_disclaimer_before_anything_counts_the_text(monkeypatch):
    monkeypatch.setattr(scraper, "POLITE_DELAY", 0)
    monkeypatch.setattr(scraper, "_scrape_html_fallback", lambda url, src: (MECKLEY, []))
    monkeypatch.setattr(images, "verify_image", lambda u, **k: (True, "ok", u))
    monkeypatch.setattr(images, "GUARD", images.ImageGuard())
    e = {"url": "https://www.npr.org/x", "source": "NPR", "text": MECKLEY, "images": ["https://media.npr.org/a/hero.png"]}
    assert "NPR does not offer" not in scraper.hydrate_entry(e, sleep=lambda s: None)["text"]


def test_a_two_sentence_audio_teaser_is_skipped_before_any_llm_credit_is_spent(monkeypatch):
    st = MongoStorage(client=mongomock.MongoClient(), db_name="stub"); st.ensure_ready()
    monkeypatch.setattr(generate, "hydrate_entry", lambda e: e)
    stripped = strip_boilerplate(MECKLEY)
    calls = []
    entry = {"title": "Meckley Brooms sees Halloween order surge", "url": "https://www.npr.org/meckley", "text": stripped + " " + stripped,
             "images": ["https://i.example.com/a.jpg"], "source": "NPR", "published_at": None}
    with pytest.raises(generate.ThinSource) as ei:
        generate.process_entry(entry, "us", st, generate.SeenIndex(), rewrite=lambda e, feedback=None: calls.append(1))
    assert calls == [] and "words of real text" in str(ei.value)


# ---------------------------------------------------------------- cleanup of what is already published
def test_cleanup_script_replaces_placeholder_pictures_with_the_real_one():
    import fix_generic_images as fx
    db = mongomock.MongoClient()["fx"]
    placeholder, real_a, real_b = open(FIXTURE, "rb").read(), photo(1), photo(2)
    pics = {"https://i.example.com/p/npr1.png": placeholder, "https://i.example.com/p/npr2.png": placeholder, "https://i.example.com/p/bbc.png": real_a,
            "https://i.example.com/p/npr-real-1.png": real_b, "https://i.example.com/p/npr-real-2.png": photo(3)}
    db["articles"].insert_many([
        {"title": "NPR story one", "img": "https://i.example.com/p/npr1.png", "source_name": "NPR", "source_url": "https://www.npr.org/s/1", "status": "published", "createdAt": "2026-10-30T10:00:00Z"},
        {"title": "NPR story two", "img": "https://i.example.com/p/npr2.png", "source_name": "NPR", "source_url": "https://www.npr.org/s/2", "status": "published", "createdAt": "2026-10-30T11:00:00Z"},
        {"title": "BBC story", "img": "https://i.example.com/p/bbc.png", "source_name": "BBC", "source_url": "https://www.bbc.com/s/1", "status": "published", "createdAt": "2026-10-30T12:00:00Z"},
    ])
    fetch = lambda u, *a, **k: Resp(pics[u])
    fp_of = lambda url: fx.fingerprint(url, get=fetch)
    pages = {"https://www.npr.org/s/1": ["https://i.example.com/p/npr1.png", "https://i.example.com/p/npr-real-1.png"], "https://www.npr.org/s/2": ["https://i.example.com/p/npr2.png", "https://i.example.com/p/npr-real-2.png"]}
    pick = lambda c, **k: images.pick_verified_images(c, get=fetch, **k)
    dry = fx.run(db, go=False, fp_of=fp_of, candidates_of=lambda d: pages[d["source_url"]], pick=pick, log=lambda *_: None)
    assert dry["flagged"] == 2 and dry["fixed"] == 2
    assert db["articles"].find_one({"title": "NPR story one"})["img"] == "https://i.example.com/p/npr1.png"            # dry run changes nothing
    fx.run(db, go=True, fp_of=fp_of, candidates_of=lambda d: pages[d["source_url"]], pick=pick, log=lambda *_: None)
    assert db["articles"].find_one({"title": "NPR story one"})["img"] == "https://i.example.com/p/npr-real-1.png"
    assert db["articles"].find_one({"title": "NPR story two"})["img"] == "https://i.example.com/p/npr-real-2.png"
    assert db["articles"].find_one({"title": "BBC story"})["img"] == "https://i.example.com/p/bbc.png"                   # untouched
    assert db["imageFingerprints"].count_documents({}) >= 1                                                # live guard seeded


def test_cleanup_can_draft_items_that_have_no_real_picture():
    import fix_generic_images as fx
    db = mongomock.MongoClient()["fx2"]
    placeholder = open(FIXTURE, "rb").read()
    db["articles"].insert_one({"title": "Audio only", "img": "https://i.example.com/p/p.png", "source_name": "NPR", "source_url": "https://www.npr.org/s/a", "status": "published", "createdAt": "2026-10-30T10:00:00Z"})
    fetch = lambda u, *a, **k: Resp(placeholder)
    out = fx.run(db, go=True, unpublish=True, fp_of=lambda u: fx.fingerprint(u, get=fetch), candidates_of=lambda d: ["https://i.example.com/p/p.png"],
                 pick=lambda c, **k: images.pick_verified_images(c, get=fetch, **k), log=lambda *_: None)
    assert out["drafted"] == 1 and db["articles"].find_one({})["status"] == "draft"
