"""Offline tests for Midnight Trends: mongomock instead of Atlas, canned feeds, fake Groq."""
import os
import sys
from datetime import datetime, timezone

import mongomock
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import generate_trends as gt
import llm
import trend_sources as ts
import trend_writer as tw
from quality import Incomplete
from trend_schema import build_trend, clean_hashtags, headline_weight, validate_trend
from trend_store import TrendSeen, TrendStore

FEED_XML = b'''<?xml version="1.0"?><rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0"><channel>
<item><title>Dodgers vs Braves</title><ht:approx_traffic>200K+</ht:approx_traffic><pubDate>Wed, 22 Jul 2026 02:40:00 -0700</pubDate>
<ht:picture>https://encrypted-tbn0.gstatic.com/x</ht:picture><ht:picture_source>LT</ht:picture_source>
<ht:news_item><ht:news_item_title>Recap</ht:news_item_title><ht:news_item_url>https://espn.com/a?utm_source=x</ht:news_item_url><ht:news_item_source>ESPN</ht:news_item_source></ht:news_item></item>
<item><title>No traffic item</title></item></channel></rss>'''


def trend(query, traffic=2000, geos=("US",), news=None):
    return {"query": query, "key": ts.norm_key(query), "geo": geos[0], "geos": list(geos), "trafficMin": traffic,
            "trafficLabel": f"{traffic}+", "startedAt": None, "picture": None, "news": news or []}


def material(*names):
    return {"sources": [{"name": n, "url": f"https://{n.lower()}.example.com/story", "title": "t", "text": "word " * 200} for n in names],
            "text": "word " * 200, "images": ["https://img.example.com/a.jpg"]}


def fake_write(t, m, voice=None, feedback=None):
    return {"title": f"Why {t['query'].title()} is everywhere right now",
            "excerpt": "A complete sentence about why people are searching for this.",
            "summary": ["First complete takeaway sentence.", "Second complete takeaway sentence.", "Third complete takeaway sentence."],
            "html_body": "<p>" + "Body text here. " * 30 + "</p>" + "<p>" + "More text here. " * 30 + "</p>" + "<p>Final sentence closes it.</p>",
            "hashtags": ["Sports", "Dodgers"], "voice": "Curious Explainer"}


@pytest.fixture
def env():
    db = mongomock.MongoClient()["t"]
    store = TrendStore(db, max_attempts=3)
    store.ensure_ready()
    return db, store


def pool():
    return llm.KeyPool(["gsk_test_key_0"])


SETTINGS = {"geos": ["US"], "interval": 0, "max_attempts": 3, "blocklist": ["porn", "nude"]}


def run(store, feed, gather=None, write=fake_write, **kw):
    gather = gather or (lambda t: material("Espn", "Bbc"))
    return gt.run(count=0, forever=False, interval=0, store=store, settings=SETTINGS, fetch_feed=lambda: feed,
                  sleep=lambda s: None, log=lambda m: None, pool=pool(), gather=gather, write=write,
                  pick_images=lambda c, limit=3: (["https://img.example.com/a.jpg"], []), **kw)


# ------------------------------------------------------------------ sources
def test_feed_parsing_and_identity():
    items = ts.parse_trends_feed(FEED_XML, "US")
    assert [i["query"] for i in items] == ["Dodgers vs Braves", "No traffic item"]
    assert items[0]["trafficMin"] == 200000 and items[0]["news"][0]["source"] == "ESPN"
    assert items[0]["news"][0]["url"].startswith("https://espn.com/a")
    assert ts.norm_key("Dodgers vs Braves") == ts.norm_key("braves dodgers")
    assert ts.parse_traffic("2M+") == 2_000_000 and ts.parse_traffic("1,000+") == 1000 and ts.parse_traffic("") == 0


def test_countries_are_merged_into_one_trend():
    feeds = {"US": [trend("Dodgers vs Braves", 5000, ("US",))], "GB": [trend("braves dodgers", 90000, ("GB",)), trend("Other thing", 10, ("GB",))]}
    merged = ts.fetch_all_geos(["US", "GB"], fetch=lambda g: feeds[g], sleep=lambda s: None)
    assert len(merged) == 2
    m = next(x for x in merged if "braves" in x["key"])
    assert m["geos"] == ["US", "GB"] and m["trafficMin"] == 90000


def test_bing_wrapper_is_unwrapped():
    assert ts._bing_target("https://www.bing.com/news/apiclick.aspx?ref=x&url=https%3A%2F%2Fbbc.com%2Fa%2F1&c=2") == "https://bbc.com/a/1"
    assert not ts.readable("https://www.youtube.com/watch?v=1") and ts.readable("https://bbc.com/news/1")


def test_thin_material_is_refused():
    with pytest.raises(ts.ThinMaterial):
        ts.gather_material(trend("x"), discover=lambda t: [{"url": "https://a.example.com/1", "source": "A", "title": ""}],
                           page=lambda u, s: ("short", []), sleep=lambda s: None)


# ------------------------------------------------------------------- schema
def doc(**o):
    d = build_trend(title="Why it is everywhere right now", excerpt="A complete sentence.", summary=["a.", "b.", "c."],
                    html_body="<p>One.</p><p>Two.</p><p>Three.</p>", hashtags=["Sports"], img="https://img.example.com/a.jpg",
                    source_name="ESPN", source_url="https://espn.com/a", weight=50)
    d.update(o)
    return d


def test_trend_schema_is_strict():
    assert validate_trend(doc())
    for bad in ({"extra": 1}, {"hashtags": []}, {"hashtags": ["#Sports"]}, {"img": "x.jpg"}, {"headlineWeight": 120}, {"slug": "Bad Slug"}):
        with pytest.raises(ValueError):
            validate_trend(doc(**bad))
    d = doc()
    for k in ("html_body", "section", "voice"):      # article-only keys must not exist on a trend
        assert k not in d


def test_hashtags_and_weight():
    assert clean_hashtags(["#sports", "new york", "sports"]) == ["Sports", "NewYork"]
    assert clean_hashtags([], fallback_from="Dodgers") == ["Dodgers"]
    assert headline_weight(200, 1, 1) < headline_weight(20000, 1, 1) < headline_weight(2_000_000, 5, 4) <= 100


# -------------------------------------------------------------------- writer
def test_writer_parses_and_refuses_cleanly():
    good = ("TITLE: Why the Dodgers game has everyone talking tonight\nEXCERPT: A complete teaser sentence for the post.\n"
            "SUMMARY1: First complete takeaway sentence here.\nSUMMARY2: Second complete takeaway sentence here.\n"
            "SUMMARY3: Third complete takeaway sentence here.\nHASHTAGS: sports, #Dodgers\nBODY:\n<p>a.</p>")
    t, e, s, h, b = tw.parse(good)
    assert h == ["sports", "#Dodgers"] and len(s) == 3
    with pytest.raises(tw.Unsuitable):
        tw.parse("SKIP: would need unverified claims about a private person")
    with pytest.raises(Incomplete):
        tw.parse("TITLE: only a title")


# ---------------------------------------------------------------------- loop
def test_publishes_into_trends_only_and_records_everything(env):
    db, store = env
    assert run(store, [trend("Dodgers vs Braves", 5000)]) == 1
    t = db["trends"].find_one({})
    validate_trend(t)
    assert t["hashtags"] == ["Sports", "Dodgers"] and t["status"] == "published"
    assert db["articles"].count_documents({}) == 0                 # never in the news collection
    led = db["trendLedger"].find_one({"key": ts.norm_key("Dodgers vs Braves")})
    assert led["status"] == "published" and led["trendId"] == t["id"] and led["timesSeen"] == 1


def test_never_writes_the_same_trend_twice(env):
    db, store = env
    run(store, [trend("Dodgers vs Braves")])
    assert run(store, [trend("Dodgers vs Braves"), trend("braves dodgers", geos=("GB",))]) == 0
    assert db["trends"].count_documents({}) == 1
    assert db["trendLedger"].count_documents({}) == 1              # re-ordered words / other country: same trend
    assert db["trendLedger"].find_one({})["status"] == "published"


def test_different_search_about_the_same_event_is_skipped(env):
    db, store = env
    run(store, [trend("Dodgers vs Braves")], gather=lambda t: material("Espn", "Bbc", "Cnn"))
    n = run(store, [trend("Freddie Freeman homer")], gather=lambda t: material("Espn", "Bbc", "Cnn"))
    assert n == 0 and db["trends"].count_documents({}) == 1
    assert "same event" in db["trendLedger"].find_one({"key": ts.norm_key("Freddie Freeman homer")})["reason"]


def test_blocked_topic_is_skipped_and_remembered(env):
    db, store = env
    assert run(store, [trend("some nude leak")]) == 0
    assert db["trendLedger"].find_one({})["status"] == "skipped" and db["trends"].count_documents({}) == 0


def test_thin_sources_retry_later_then_give_up(env):
    db, store = env
    def thin(t):
        raise ts.ThinMaterial("only 0 readable source(s)")
    key = ts.norm_key("Obscure thing")
    assert run(store, [trend("Obscure thing")], gather=thin) == 0
    e = db["trendLedger"].find_one({"key": key})
    assert e["status"] == "pending" and e["attempts"] == 1 and e["nextTryAt"]
    assert run(store, []) == 0                                     # retry time not reached: left alone
    for expected in ("pending", "skipped"):                        # retries 2 and 3, then given up
        db["trendLedger"].update_one({"key": key}, {"$set": {"nextTryAt": "2000-01-01T00:00:00.000Z"}})
        run(store, [], gather=thin)
        assert db["trendLedger"].find_one({"key": key})["status"] == expected
    db["trendLedger"].update_one({"key": key}, {"$set": {"nextTryAt": "2000-01-01T00:00:00.000Z"}})
    assert run(store, []) == 0                                     # skipped is final


def test_deferred_trend_is_written_when_sources_appear(env):
    db, store = env
    def thin(t):
        raise ts.ThinMaterial("nothing yet")
    run(store, [trend("Late bloomer")], gather=thin)
    key = ts.norm_key("Late bloomer")
    db["trendLedger"].update_one({"key": key}, {"$set": {"nextTryAt": "2000-01-01T00:00:00.000Z"}})
    assert run(store, []) == 1 and db["trendLedger"].find_one({"key": key})["status"] == "published"


def test_a_trend_seen_but_not_finished_is_picked_up_next_run(env):
    """Offline / out of credit half-way: the sighting is already in the ledger, so nothing is missed."""
    db, store = env
    def no_key(t, m, voice=None):
        raise llm.NoValidKeys("rejected")
    own = lambda t: material(t["query"].split()[0] + "a", t["query"].split()[0] + "b")   # distinct sources per trend
    assert run(store, [trend("Big merger", 900000), trend("Small earthquake", 100)], write=no_key, gather=own) == 0
    assert {e["status"] for e in db["trendLedger"].find({})} == {"seen"}
    assert run(store, [], gather=own) == 2                         # no feed needed: the ledger remembers
    assert db["trends"].count_documents({}) == 2


def test_biggest_trend_goes_first(env):
    db, store = env
    order = []
    def w(t, m, voice=None):
        order.append(t["query"]); return fake_write(t, m)
    run(store, [trend("small festival", 10), trend("huge earthquake", 5_000_000), trend("middle election", 5000)], write=w,
        gather=lambda t: material(t["query"].split()[0].title() + "x", t["query"].split()[1].title() + "y"))
    assert order == ["huge earthquake", "middle election", "small festival"]
    assert db["trends"].count_documents({}) == 3


def test_writer_declining_is_skipped_not_published(env):
    db, store = env
    def decline(t, m, voice=None):
        raise tw.Unsuitable("private person")
    assert run(store, [trend("Private person news")], write=decline) == 0
    assert db["trendLedger"].find_one({})["status"] == "skipped"


def test_dry_run_writes_nothing(env):
    db, store = env
    assert run(store, [trend("Dodgers vs Braves")], dry_run=True) == 1
    assert db["trends"].count_documents({}) == 0 and db["trendLedger"].count_documents({}) == 0


def test_api_reads_only_published_trends(env, monkeypatch):
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    import trends_api
    from main import app
    db, store = env
    run(store, [trend("Dodgers vs Braves")])
    monkeypatch.setattr(trends_api, "_store", store)
    c = TestClient(app)
    j = c.get("/api/trends?search=dodgers").json()
    assert j["total"] == 1 and "_id" not in j["items"][0]
    assert c.get("/api/trends?hashtag=sports").json()["total"] == 1 and c.get("/api/trends?hashtag=food").json()["total"] == 0
    assert c.get(f"/api/trends/{j['items'][0]['slug']}").status_code == 200 and c.get("/api/trends/nope").status_code == 404
    assert c.get("/api/trends/status").json()["totals"]["published"] == 1
    assert c.get("/api/trends/ledger").json()[0]["status"] == "published"


# --------------------------------------------------------------- hallucination guard on trend posts
def post_with(body_extra):
    p = fake_write({"query": "big merger"}, None)
    p["html_body"] = p["html_body"].replace("Final sentence closes it.", body_extra)
    return p


def test_trend_post_with_invented_number_is_rewritten_once_then_published(env):
    db, store = env
    calls = []
    def w(t, m, voice=None, feedback=None):
        calls.append(feedback)
        return post_with("The deal is worth 47 billion dollars in total.") if not feedback else fake_write(t, m)
    assert run(store, [trend("Big merger")], write=w) == 1
    assert calls[0] is None and calls[1] and "47" in calls[1][0]


def test_trend_post_that_keeps_inventing_is_deferred_not_published(env):
    db, store = env
    w = lambda t, m, voice=None, feedback=None: post_with("The company will close 300 offices tomorrow morning.")
    assert run(store, [trend("Big merger")], write=w) == 0
    assert db["trends"].count_documents({}) == 0
    assert db["trendLedger"].find_one({})["status"] == "pending"        # retried later, never published


def test_trend_header_facts_are_allowed():
    """The countries and the search-volume floor are in the prompt, so the writer may state them."""
    import factcheck
    t = trend("Big merger", traffic=500000, geos=("US", "GB"))
    m = material("Espn", "Bbc")
    post = fake_write(t, m)
    post["html_body"] = post["html_body"].replace("Final sentence closes it.", "Searches topped 500000 in the US and GB.")
    assert factcheck.verify_trend(t, m, post, use_llm=False) == []


def test_trend_fact_check_is_corrected_over_several_rounds(env, monkeypatch):
    import factcheck
    db, store = env
    results = iter([["a claim the pages do not support"]] * 5 + [[]])
    fed = []
    monkeypatch.setattr(factcheck, "verify_trend", lambda t, m, p, **k: next(results))
    def write(t, m, voice=None, feedback=None):
        fed.append(feedback)
        return fake_write(t, m)
    assert run(store, [trend("Dodgers vs Braves", 5000)], write=write) == 1       # published after 5 rejected drafts
    assert len(fed) == 6 and fed[0] is None and all(f for f in fed[1:])


def test_created_sort_orders_by_when_we_published_not_the_source_time(env):
    db, store = env
    older_ours = doc(title="Source says new, we published first", slug="a-1", id="trend_a", createdAt="2026-10-30T08:00:00.000Z", publishedAt="2026-10-30T07:59:00.000Z")
    newer_ours = doc(title="Source says old, we published last", slug="b-1", id="trend_b", createdAt="2026-10-30T09:00:00.000Z", publishedAt="2026-10-01T00:00:00.000Z")
    db["trends"].insert_many([older_ours, newer_ours])
    assert store.list_trends(sort="newest")[0][0]["id"] == "trend_a"      # website order: the source's time
    assert store.list_trends(sort="created")[0][0]["id"] == "trend_b"     # dashboard order: when we published
