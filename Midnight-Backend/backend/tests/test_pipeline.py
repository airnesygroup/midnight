"""Offline tests: mongomock instead of Atlas, canned feeds instead of the web,
canned rewriter instead of Groq. Run:  python -m pytest backend/tests -q"""
import os
import sys
from datetime import datetime, timezone

import mongomock
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import generate
import llm
import schema
from images import NoVerifiedImage
from storage import MongoStorage
from dedupe import SeenIndex

NOW = datetime.now(timezone.utc)


def entry(src, title, url, images=("https://img.example/a.jpg",)):
    return {"title": title, "url": url, "text": "word " * 120, "images": list(images),
            "source": src, "published_at": NOW}


FEEDS = {
    "https://a/feed": [entry("A", "Apple unveils new iPhone 18 with bigger battery", "https://a.example.com/news/1"),
                       entry("A", "Quantum chip breaks error record at lab", "https://a.example.com/news/2"),
                       entry("A", "Rust adoption grows across kernels", "https://a.example.com/news/3?utm_source=x")],
    # same story as A#1 (different outlet), then a genuinely different one
    "https://b/feed": [entry("B", "Apple launches iPhone 18, bigger battery", "https://b.example.com/news/1"),
                       entry("B", "Parliament passes landmark budget bill", "https://b.example.com/news/2")],
    "https://c/feed": [entry("C", "Marathon world record falls in Berlin", "https://c.example.com/news/1", images=[])],
    "https://d/feed": [],  # dead feed
}
SOURCES = [("A", "https://a/feed", "tech"), ("B", "https://b/feed", "tech"),
           ("C", "https://c/feed", "sport"), ("D", "https://d/feed", "world")]


def fake_pool(n=2):
    return llm.KeyPool([f"gsk_test_key_{i}" for i in range(n)])


@pytest.fixture
def env(monkeypatch):
    st = MongoStorage(client=mongomock.MongoClient(), db_name="t")
    st.ensure_ready()

    def fake_hydrate(e):
        if not e["images"]:
            raise NoVerifiedImage("no verifiable image (none found)")
        return e
    monkeypatch.setattr(generate, "hydrate_entry", fake_hydrate)

    def fake_rewrite(e, voice=None):
        return {"title": e["title"] + " — analysis", "excerpt": "An excerpt that is a complete sentence about it.",
                "summary": ["First complete takeaway sentence.", "Second complete takeaway sentence.", "Third complete takeaway sentence."],
                "html_body": "<p>" + "Body text here. " * 40 + "</p><script>alert(1)</script>",
                "img": (e["images"] or [None])[0], "source_url": e["url"], "source_name": e["source"], "voice": "Explainer"}
    monkeypatch.setattr(generate, "rewrite_article", fake_rewrite)
    feeds = {k: list(v) for k, v in FEEDS.items()}
    return st, (lambda name, url, limit=15: list(feeds[url]))


def go(st, fetch, **kw):
    logs = []
    kw.setdefault("pool", fake_pool())
    kw.setdefault("reports", False)
    kw.setdefault("sleep", lambda s: None)
    n = generate.run(storage=st, sources=SOURCES, fetch=fetch, log=logs.append, **kw)
    return n, logs


def test_one_per_source_round_robin_and_live_push(env):
    st, fetch = env
    n, logs = go(st, fetch, count=3)
    titles = [a["source_name"] for a in st.articles.find({}).sort("createdAt", 1)]
    assert n == 2 and titles == ["A", "B"]  # one each, in rotation — not 3 from A. C has no image: skipped
    assert st.articles.count_documents({}) == 2


def test_same_story_from_other_outlet_is_skipped(env):
    st, fetch = env
    go(st, fetch, count=0 + 5)
    titles = [a["title"] for a in st.articles.find({})]
    assert not any("launches iPhone 18" in t for t in titles)
    assert any("Parliament" in t for t in titles)
    skipped = list(st.ledger.find({"status": "skipped"}))
    assert skipped and "same story" in skipped[0]["reason"]


def test_never_repeats_across_runs(env):
    st, fetch = env
    n1 = sum(go(st, fetch, count=50)[0] for _ in range(3))  # one pass = one article per source
    n2, _ = go(st, fetch, count=50)
    assert n1 == 4 and n2 == 0   # A x3, B#2; C has no image so it is never published
    assert st.articles.count_documents({}) == 4


def test_docs_match_lovable_schema_and_are_sanitised(env):
    st, fetch = env
    for _ in range(3):
        go(st, fetch, count=50)
    for d in st.articles.find({}):
        d.pop("_id")
        schema.validate_article(d)
        assert "<script" not in d["html_body"]
        assert d["provenance"]["engagement"] == "unknown" and d["views"] is None
    assert all(d["img"].startswith("https://") for d in st.articles.find({})) and all(d["source_url"] for d in st.articles.find({}))


def test_ledger_records_everything(env):
    st, fetch = env
    for _ in range(3):
        go(st, fetch, count=50)
    s = st.ledger_summary()
    assert s["published"] == 4 and s["skipped"] == 2   # same story + no image


def test_failure_is_recorded_and_does_not_stop_run(env, monkeypatch):
    st, fetch = env
    real = generate.rewrite_article
    def flaky(e, voice=None):
        if e["source"] == "A":
            raise RuntimeError("groq down")
        return real(e)
    monkeypatch.setattr(generate, "rewrite_article", flaky)
    n, _ = go(st, fetch, count=50)
    assert n >= 1 and st.ledger_summary().get("failed", 0) >= 1


def test_dry_run_writes_nothing(env):
    st, fetch = env
    n, _ = go(st, fetch, count=2, dry_run=True)
    assert n == 2 and st.articles.count_documents({}) == 0 and st.ledger.count_documents({}) == 0


def test_views_and_queries(env):
    st, fetch = env
    for _ in range(3):
        go(st, fetch, count=50)
    a = st.articles.find_one({})
    assert st.increment_views(a["id"]) == 1 and st.increment_views(a["slug"]) == 2
    assert st.get_post(a["id"])["provenance"]["engagement"] == "measured"
    items, total = st.list_posts(category="Technology")
    assert total == 4 and items[0]["section"] == "tech"
    items, _ = st.list_posts(search="parliament")
    assert len(items) == 1 and "_id" not in items[0]
    assert st.list_posts(sort="popular", limit=1)[0][0]["id"] == a["id"]
    assert st.list_posts(sort="trending", limit=2)[0]
    upd = st.update_post(a["id"], {"title": "New title", "html_body": "<p>" + "x " * 50 + "</p>"})
    assert upd["title"] == "New title" and upd["readingMinutes"] >= 1


def test_sources_cover_50_plus_sites():
    from sources import SOURCES as S, site_of
    assert len({site_of(s[0]) for s in S}) >= 50
    assert all(s[2] in schema.SECTION_BY_SLUG for s in S)


def test_http_api(env, monkeypatch):
    from fastapi.testclient import TestClient
    import storage, main
    st, fetch = env
    for _ in range(3):
        go(st, fetch, count=50)
    monkeypatch.setattr(storage, "_instance", st)
    c = TestClient(main.app)
    assert c.get("/api/health").json()["articles"] == 4
    r = c.get("/api/posts?sort=newest&limit=2&offset=0").json()
    assert len(r["items"]) == 2 and r["total"] == 4 and "_id" not in r["items"][0]
    pid = r["items"][0]["id"]
    assert c.get(f"/api/posts/{pid}").json()["slug"] == r["items"][0]["slug"]
    assert c.post(f"/api/posts/{pid}/view").json()["views"] == 1
    assert c.put(f"/api/posts/{pid}", json={"title": "Edited"}).json()["title"] == "Edited"
    assert c.get("/api/posts/nope").status_code == 404
    assert len(c.get("/api/categories").json()) == 28
    assert c.get("/api/ingest/status").json()["totals"]["published"] == 4
    s = c.get("/api/status").json()
    assert s["articles"] == 4 and "generator" in s and s["database"] == "t"
    assert isinstance(c.get("/api/events").json(), list)
    assert c.get("/api/reports").json() == [] and c.get("/api/reports/2026-01-01").status_code == 404
    srcs = c.get("/api/sources").json()
    assert len(srcs) >= 80 and {"name", "section", "published"} <= set(srcs[0])


def test_published_at_mode_source_keeps_original_time_own_uses_ours(env, monkeypatch):
    from datetime import timedelta
    old = NOW - timedelta(days=90)
    for mode in ("source", "own"):
        monkeypatch.setenv("PUBLISHED_AT_MODE", mode)
        st = MongoStorage(client=mongomock.MongoClient(), db_name="pm_" + mode); st.ensure_ready()
        e = entry("A", f"Old story {mode} about a long forgotten parliament vote", f"https://a.example.com/old/{mode}")
        e["published_at"] = old
        seen = SeenIndex()
        a = generate.process_entry(e, "world", st, seen)
        got = st.articles.find_one({"id": a["id"]})["publishedAt"]
        if mode == "source":
            assert got[:10] == old.strftime("%Y-%m-%d")           # exactly as before: the source's own time
        else:
            assert got[:10] == NOW.strftime("%Y-%m-%d") and got == a["createdAt"]   # our publishing time
