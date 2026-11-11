"""Hero ranking: importance score + section weighting + outlet coverage -> headlineWeight / featured."""
import os
import sys
from datetime import datetime, timezone

import mongomock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import headlines
from storage import MongoStorage
from test_pipeline import env, go  # noqa: F401  (fixtures for the pipeline test)
from test_safety import GOOD_BODY

NOW = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)


def test_compute_weight_sections_and_coverage():
    w = headlines.compute_weight
    assert w(80, "world") == 90 and w(80, "sport") == 62          # same score: world beats sport
    assert w(None, "tech") == 50 and w(None, "sport") == 22       # unscored = neutral 40 + adjustment
    assert w(70, "world", outlets=3) == 70 + 10 + 12              # +6 per extra outlet
    assert w(70, "world", outlets=9) == 70 + 10 + 18              # coverage bonus is capped
    assert w(99, "world", outlets=9) == 100 and w(2, "sport") == 0  # always within 0..100


def seed(st, specs):
    """specs: (section, llm_score, outlets) -> returns ids."""
    from schema import build_article
    book = headlines.HeadlineBook(st.db)
    ids = []
    for i, (sec, score, outlets) in enumerate(specs):
        a = build_article(title=f"Headline number {i} in the {sec} section today", excerpt="A full teaser sentence that reads as complete.",
                          summary=["One complete point here.", "Two complete point here.", "Three complete point here."],
                          html_body=GOOD_BODY, section_slug=sec, hashtags=[], img="https://i.example.com/a.jpg",
                          source_name="S0", source_url=f"https://s.example.com/{i}", voice="X",
                          published_at=f"2026-10-28T{i:02d}:00:00.000Z")
        st.publish_article(a)
        book.record_article(a["id"], sec, "S0", score)
        for o in range(1, outlets):
            book.record_coverage(a["id"], f"S{o}")
        ids.append(a["id"])
    return ids


def test_hero_gets_important_sections_not_sport():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="h"); st.ensure_ready()
    specs = [("sport", 75, 1), ("entertainment", 70, 1), ("world", 70, 3), ("politics", 70, 2), ("business", 65, 1),
             ("tech", 60, 1), ("sport", 60, 1), ("world", 55, 1), ("us", 50, 1), ("food", 60, 1)]
    ids = seed(st, specs)
    feat = headlines.refresh_headlines(st, now=NOW, settings={"featured_count": 5, "window_hours": 30, "min_weight": 45})
    assert len(feat) == 5
    featured = {a["section"] for a in st.articles.find({"featured": True})}
    assert "sport" not in featured and "entertainment" not in featured and "food" not in featured
    top = st.articles.find_one({"id": feat[0]})
    assert top["section"] == "world" and top["headlineWeight"] == 70 + 10 + 12   # 3 outlets on it
    assert st.articles.count_documents({"featured": True}) == 5
    # weights are real now: not every article is 40 any more
    assert len({a["headlineWeight"] for a in st.articles.find({})}) > 3


def test_an_exceptional_sport_story_can_still_reach_the_hero():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="h4"); st.ensure_ready()
    seed(st, [("sport", 95, 3), ("world", 40, 1), ("politics", 40, 1), ("business", 40, 1)])
    feat = headlines.refresh_headlines(st, now=NOW, settings={"featured_count": 3, "window_hours": 30, "min_weight": 45})
    assert st.articles.find_one({"id": feat[0]})["section"] == "sport"      # 95 - 18 + 12 = 89


def test_featured_flag_moves_when_a_better_story_arrives_and_old_ones_drop_out():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="h2"); st.ensure_ready()
    seed(st, [("world", 60, 1), ("politics", 60, 1), ("business", 60, 1), ("tech", 60, 1)])
    cfg = {"featured_count": 3, "window_hours": 30, "min_weight": 45}
    first = set(headlines.refresh_headlines(st, now=NOW, settings=cfg))
    assert len(first) == 3
    from schema import build_article
    a = build_article(title="Breaking: a far more important world story", excerpt="A full teaser sentence that reads as complete.",
                      summary=["One complete point here.", "Two complete point here.", "Three complete point here."],
                      html_body=GOOD_BODY, section_slug="world", hashtags=[], img="https://i.example.com/a.jpg",
                      source_name="S0", source_url="https://s.example.com/big", voice="X", published_at="2026-10-28T11:00:00.000Z")
    st.publish_article(a)
    headlines.HeadlineBook(st.db).record_article(a["id"], "world", "S0", 98)
    second = headlines.refresh_headlines(st, now=NOW, settings=cfg)
    assert second[0] == a["id"] and st.articles.count_documents({"featured": True}) == 3   # one dropped out
    # nothing inside the window: nothing stays featured
    assert headlines.refresh_headlines(st, now=datetime(2026, 11, 5, tzinfo=timezone.utc), settings=cfg) == []
    assert st.articles.count_documents({"featured": True}) == 0


def test_fewer_than_three_candidates_means_no_featured_flags():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="h3"); st.ensure_ready()
    seed(st, [("world", 80, 1), ("tech", 70, 1)])
    assert headlines.refresh_headlines(st, now=NOW) == []          # the site ignores `featured` below 3 anyway
    assert st.articles.count_documents({"featured": True}) == 0


def test_same_story_from_another_outlet_raises_the_weight_of_the_first_article(env):
    st, fetch = env
    go(st, fetch, count=50)       # A#1 (iPhone) is published, B's "Apple launches iPhone 18" is skipped as the same story
    apple = st.articles.find_one({"title": {"$regex": "iPhone"}})
    sig = headlines.HeadlineBook(st.db).get(apple["id"])
    assert sorted(sig["outlets"]) == ["A", "B"]                    # both outlets are counted
    assert apple["headlineWeight"] == headlines.compute_weight(None, "tech", outlets=2)   # 40 + 10 + 6
