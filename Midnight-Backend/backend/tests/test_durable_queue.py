"""Nothing scraped is lost; every skip/failure has a history and a final outcome."""
from datetime import datetime, timedelta, timezone

import generate
import storage as storage_mod
from tests.test_pipeline import env, go, FEEDS, SOURCES, SOURCES as _S  # noqa: F401  (env fixture)


def test_scraped_entries_are_saved_the_moment_they_are_scraped(env):
    st, fetch = env
    go(st, fetch, count=1)
    queued_or_done = st.ledger.count_documents({})
    # every entry of the feeds that were read is in the ledger, not just the one that was published
    assert queued_or_done >= 3
    assert st.ledger.count_documents({"status": "queued", "entry.text": {"$exists": True}}) >= 1


def test_a_retryable_failure_is_kept_not_forgotten(env, monkeypatch):
    st, fetch = env
    real = generate.rewrite_article

    def down(e, voice=None):
        raise RuntimeError("groq down")
    monkeypatch.setattr(generate, "rewrite_article", down)
    go(st, fetch, count=50)
    row = st.ledger.find_one({"sourceUrl": "https://a.example.com/news/1"})
    assert row["status"] == "failed" and row["retryable"] is True and row["nextTryAt"]
    assert row["history"][0]["status"] == "failed" and "groq down" in row["history"][0]["reason"]
    assert storage_mod.outcome_of(row) == "retrying"
    assert "entry" in row                                    # the text is kept so it can be written later

    # restart + time passes: the story is owed and comes back, even if the feed forgot it
    st.ledger.update_one({"_id": row["_id"]}, {"$set": {"nextTryAt": "2000-01-01T00:00:00Z"}})
    monkeypatch.setattr(generate, "rewrite_article", real)
    gone = lambda name, url, limit=15: []                    # the feed no longer lists anything
    go(st, gone, count=50)
    row = st.ledger.find_one({"sourceUrl": "https://a.example.com/news/1"})
    assert row["status"] == "published" and storage_mod.outcome_of(row) == "published"
    assert [h["status"] for h in row["history"]][-1] == "published" and len(row["history"]) >= 2
    review = st.review("failed")
    item = [i for i in review["items"] if i["url"] == "https://a.example.com/news/1"][0]
    assert item["outcome"] == "published" and "Passed later" in item["outcomeText"]


def test_a_story_that_keeps_failing_is_abandoned_after_the_limit(env, monkeypatch):
    st, fetch = env
    monkeypatch.setenv("ITEM_MAX_ATTEMPTS", "2")
    for i in range(2):
        r = st.record(source_name="A", source_url="https://a.example.com/x", source_title="X story", section="tech",
                      status="failed", reason="LLMError: boom", retryable=True)
    assert r["retrying"] is False and "gave up after 2 tries" in r["reason"]
    row = st.ledger.find_one({"sourceUrl": "https://a.example.com/x"})
    assert storage_mod.outcome_of(row) == "abandoned" and "entry" not in row
    item = st.review("failed")["items"][0]
    assert item["outcome"] == "abandoned" and "never be retried" in item["outcomeText"] and len(item["reasons"]) == 2


def test_permanent_skip_is_abandoned_at_once_and_a_waiting_retry_is_not_seen(env):
    st, fetch = env
    st.record(source_name="A", source_url="https://a.example.com/p", source_title="P", section="tech",
              status="skipped", reason="source text too thin")
    st.record(source_name="A", source_url="https://a.example.com/q", source_title="Q story here", section="tech",
              status="failed", reason="boom", retryable=True)
    from dedupe import SeenIndex
    seen = SeenIndex()
    st.load_seen(seen)
    assert seen.has_url("https://a.example.com/p") and not seen.has_url("https://a.example.com/q")
    sk = st.review("skipped")
    assert sk["items"][0]["outcome"] == "abandoned" and sk["counts"]["abandoned"] == 1


def test_trend_review_shows_reasons_and_final_outcome():
    import mongomock
    from trend_store import TrendStore
    ts = TrendStore(mongomock.MongoClient()["t"], 3)
    ts.ensure_ready()
    for k in ("a", "b", "c"):
        ts.sight({"key": k, "query": f"trend {k}", "trafficMin": 10, "geos": ["US"], "news": [{"url": "https://x.example/1"}]})
    ts.set_status("a", "skipped", "blocked topic")
    ts.defer("b", "no image")
    for _ in range(3):
        ts.defer("c", "thin sources")
    sk = ts.review("skipped")
    assert {i["title"]: i["outcome"] for i in sk["items"]}["trend a"] == "abandoned"
    fl = {i["title"]: i for i in ts.review("failed")["items"]}
    assert fl["trend b"]["outcome"] == "retrying" and "Will be retried" in fl["trend b"]["outcomeText"]
    assert fl["trend c"]["outcome"] == "abandoned" and len(fl["trend c"]["reasons"]) == 3
    assert fl["trend b"]["url"] == "https://x.example/1"


def test_writer_flag_not_an_article_is_skipped_for_good_and_missing_flag_is_retried(env, monkeypatch):
    import realcheck
    import pytest
    from quality import Incomplete
    with pytest.raises(realcheck.NotNews) as e:
        realcheck.require_flag("REAL_NEWS_ARTICLE: no - cookie consent text")
    assert "cookie consent" in str(e.value)
    with pytest.raises(Incomplete):
        realcheck.require_flag("TITLE: x")
    realcheck.require_flag("REAL_NEWS_ARTICLE: yes\nTITLE: x")

    st, fetch = env

    def blob(e, voice=None):
        raise realcheck.NotNews("navigation menu")
    monkeypatch.setattr(generate, "rewrite_article", blob)
    go(st, fetch, count=50)
    row = st.ledger.find_one({"sourceUrl": "https://a.example.com/news/1"})
    assert row["status"] == "skipped" and "not a real news article" in row["reason"]
    assert storage_mod.outcome_of(row) == "abandoned"


def test_trend_writer_turns_the_flag_into_unsuitable():
    import pytest
    import trend_writer as tw

    def chat(prompt, max_tokens, temperature=0.4):
        import llm
        return llm.ChatResult("REAL_NEWS_ARTICLE: no - just a list of links", "stop")
    with pytest.raises(tw.Unsuitable) as e:
        tw.write_trend({"query": "q", "geos": ["US"]}, {"text": "links " * 200, "sources": [{"name": "X"}]}, chat=chat)
    assert "not a real news article" in str(e.value)
