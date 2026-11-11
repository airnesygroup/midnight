"""Key rotation + pause, image verification, completeness gates, Midnight Report."""
import io
import os
import time
import sys
from datetime import datetime, timedelta, timezone

import mongomock
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import generate
import llm
from quality import Incomplete
import images
import quality
import report
import rewriter
from monitor import Monitor
from storage import MongoStorage

GOOD_BODY = ("<p>" + "A complete paragraph about the story. " * 12 + "</p>\n") * 3


def good_reply(title="A perfectly complete headline about it", importance="72"):
    imp = f"IMPORTANCE: {importance}\n" if importance is not None else ""
    return (f"REAL_NEWS_ARTICLE: yes\nTITLE: {title}\nEXCERPT: A full teaser sentence that reads as complete.\n"
            "SUMMARY1: The first complete takeaway for readers.\nSUMMARY2: The second complete takeaway for readers.\n"
            f"SUMMARY3: The third complete takeaway for readers.\n{imp}BODY:\n{GOOD_BODY}\n===END===")


# ---------------------------------------------------------------- keys
class Boom(Exception):
    def __init__(self, status, msg="x", retry_after=None):
        super().__init__(msg)
        self.status_code = status
        self.response = type("R", (), {"headers": {"retry-after": str(retry_after)} if retry_after else {}})()


class FakeClient:
    """behaviour: dict key -> list of outcomes (Exception to raise or (text, finish))."""
    def __init__(self, key, plan, log):
        self.key, self.plan, self.log = key, plan, log
        self.chat = type("C", (), {"completions": self})()

    def create(self, **kw):
        self.log.append(self.key)
        out = self.plan[self.key].pop(0) if len(self.plan[self.key]) > 1 else self.plan[self.key][0]
        if isinstance(out, Exception):
            raise out
        text, fin = out
        msg = type("M", (), {"content": text})()
        return type("Resp", (), {"choices": [type("Ch", (), {"message": msg, "finish_reason": fin})()]})()


def install(plan, n=3):
    log = []
    pool = llm.KeyPool([f"k{i}" for i in range(n)])
    llm.set_pool(pool)
    llm.set_client_factory(lambda key: FakeClient(key, plan, log))
    return pool, log


def test_rotates_to_next_key_when_one_runs_out():
    pool, log = install({"k0": [Boom(429, "quota exceeded", 3600)], "k1": [("ok", "stop")], "k2": [("ok", "stop")]})
    assert llm.chat("p", 100, pool=pool).text == "ok"
    assert log == ["k0", "k1"] and pool.snapshot()[0]["status"] == "cooldown"
    assert llm.chat("p", 100, pool=pool).text == "ok" and log[-1] == "k1"   # stays on k1


def test_invalid_key_is_disabled_for_good():
    pool, log = install({"k0": [Boom(401)], "k1": [("ok", "stop")], "k2": [("ok", "stop")]})
    llm.chat("p", 10, pool=pool)
    assert pool.snapshot()[0]["status"] == "invalid"


def test_all_keys_out_raises():
    pool, _ = install({f"k{i}": [Boom(429, "rate limit", 7200)] for i in range(3)})
    with pytest.raises(llm.AllKeysExhausted):
        llm.chat("p", 10, pool=pool)


def test_pipeline_pauses_then_resumes_from_first_key(monkeypatch):
    st = MongoStorage(client=mongomock.MongoClient(), db_name="p")
    st.ensure_ready()
    pool, log = install({"k0": [Boom(429, "rate limit", 7200), (good_reply(), "stop")],
                         "k1": [Boom(429, "rate limit", 7200)], "k2": [Boom(429, "rate limit", 7200)]})
    sleeps = []
    ent = {"title": "Apple unveils new iPhone 18 with bigger battery", "url": "https://a.example.com/1",
           "text": "word " * 120, "images": ["https://img.example.com/a.jpg"], "source": "A", "published_at": None}
    monkeypatch.setattr(generate, "hydrate_entry", lambda e: e)
    monkeypatch.setattr(rewriter, "pick_voice", lambda: rewriter.VOICES[0])
    n = generate.run(count=1, storage=st, sources=[("A", "https://a.example.com/feed", "tech")],
                     fetch=lambda *a, **k: [dict(ent)], pool=pool, reports=False,
                     sleep=sleeps.append, pause_seconds=7200, log=lambda m: None,
                     rewrite=lambda e: rewriter.rewrite_article(e, chat=lambda p, mt, temperature=0: llm.chat(p, mt, pool=pool)))
    # first call: all three keys rejected -> paused (in 15s slices) -> retried -> published
    assert sum(sleeps) == 7200
    assert st.db["ingestEvents"].count_documents({"kind": "paused"}) == 1
    assert st.db["ingestEvents"].count_documents({"kind": "retry"}) == 1
    assert n == 1 and st.articles.count_documents({}) == 1
    assert log.count("k0") == 2 and log[:3] == ["k0", "k1", "k0"]   # k2 is reserved for the report; retried from key 1 after the pause


# ------------------------------------------------------------ completeness
def test_truncated_or_unmarked_replies_are_rejected():
    with pytest.raises(quality.Incomplete):
        quality.strip_end_marker(good_reply(), "length")            # cut by token limit
    with pytest.raises(quality.Incomplete):
        quality.strip_end_marker(good_reply()[:-12], "stop")        # END marker missing
    assert quality.strip_end_marker(good_reply(), "stop").endswith("</p>")


def _chat(*replies):
    it = iter(replies)
    return lambda p, mt, temperature=0: llm.ChatResult(*next(it))


ART = {"title": "x", "url": "https://a.example.com/1", "text": "word " * 300, "images": ["https://i.example.com/a.jpg"], "source": "A"}


def test_rewriter_accepts_complete_article():
    out = rewriter.rewrite_article(dict(ART), chat=_chat((good_reply(), "stop")))
    assert out["title"].startswith("A perfectly") and len(out["summary"]) == 3 and out["img"]
    assert out["importance"] == 72


@pytest.mark.parametrize("imp", [None, "high", "140"], ids=["missing", "not-a-number", "over-100"])
def test_reply_without_a_valid_importance_score_is_incomplete(imp):
    bad = good_reply(importance=imp)
    with pytest.raises(quality.Incomplete):
        rewriter.rewrite_article(dict(ART), chat=_chat(*[(bad, "stop")] * 8))


def _bad_variants():
    g = good_reply()
    last_p = g.rindex("</p>")
    return [
        g.replace("SUMMARY3: The third complete takeaway for readers.\n", ""),   # missing summary
        g[:last_p] + g[last_p + 4:],                                              # unbalanced html (cut mid-element)
        g[:last_p - 20] + "</p>\n\n===END===",                                    # last sentence cut off
    ]


@pytest.mark.parametrize("bad", _bad_variants(), ids=["no-summary", "unbalanced-html", "cut-sentence"])
def test_rewriter_rejects_incomplete(bad):
    with pytest.raises(quality.Incomplete):
        rewriter.rewrite_article(dict(ART), chat=_chat(*[(bad, "stop")] * 8))


def test_rewriter_retries_after_truncation():
    out = rewriter.rewrite_article(dict(ART), chat=_chat((good_reply()[:200], "length"), (good_reply(), "stop")))
    assert out["title"]


def test_final_gate_blocks_missing_image_and_source():
    from schema import build_article
    kw = dict(title="A perfectly complete headline", excerpt="A full teaser sentence that reads as complete.",
              summary=["One complete point here.", "Two complete point here.", "Three complete point here."],
              html_body=GOOD_BODY, section_slug="tech", hashtags=["#A"], img="https://i.example.com/a.jpg",
              source_name="A", source_url="https://a.example.com/1", voice="X", published_at=None)
    assert quality.final_gate(build_article(**kw))
    with pytest.raises(ValueError):
        build_article(**{**kw, "img": None})
    a = build_article(**kw); a["img"] = "image.png"
    with pytest.raises(Exception):
        quality.final_gate(a)
    a = build_article(**kw); a["source_url"] = None
    with pytest.raises(Exception):
        quality.final_gate(a)


# ------------------------------------------------------------------ images
def png(w=800, h=450):
    from PIL import Image
    import random
    im = Image.effect_noise((w, h), 80).convert("RGB")
    b = io.BytesIO(); im.save(b, "PNG"); return b.getvalue()


class Resp:
    def __init__(self, data, status=200, ctype="image/png"):
        self.status_code, self.headers, self._d = status, {"Content-Type": ctype}, data
    def iter_content(self, n): yield self._d
    def close(self): pass


def test_image_verification():
    good = png()
    assert images.verify_image("https://i.example.com/p/photo.png", get=lambda *a, **k: Resp(good))[0]
    assert not images.verify_image("image.png")[0]                                   # not a URL
    assert not images.verify_image("https://i.example.com/logo.png", get=lambda *a, **k: Resp(good))[0]
    assert not images.verify_image("https://i.example.com/a.png", get=lambda *a, **k: Resp(good, 404))[0]
    assert not images.verify_image("https://i.example.com/a.png", get=lambda *a, **k: Resp(b"<html>nope</html>" * 2000, ctype="text/html"))[0]
    assert not images.verify_image("https://i.example.com/a.png", get=lambda *a, **k: Resp(b"notanimage" * 2000))[0]
    assert not images.verify_image("https://i.example.com/a.png", get=lambda *a, **k: Resp(png(120, 90)))[0]   # tiny
    assert not images.verify_image("https://i.example.com/a.png", get=lambda *a, **k: Resp(png(1200, 100)))[0]  # banner


# ------------------------------------------------------------------ report
def words(n, seed="detail"):
    return " ".join(f"{seed}{chr(97 + i % 9)}" for i in range(n - 1)) + " done."     # letters only: nothing for the number check to flag


def newsletter_reply(n_stories, lead_words=240, story_words=90):
    """A canned, complete newsletter for n_stories stories (1 lead + n-1 sections)."""
    out = ["TITLE: The Midnight Report: a big day for markets and tech",
           "INTRODUCTION: Here is what mattered today, with every detail you need.",
           "LEAD_TITLE: Chipmakers lead a strong day on the markets",
           "LEAD_EXCERPT: A strong day for semiconductors kept the wider market confident.",
           "LEAD:", words(lead_words // 2), "", words(lead_words // 2)]
    tags = ["Technology", "Business", "World", "Politics"]
    for i in range(n_stories - 1):
        out += [f"SECTION: {tags[i % 4]} | Story {chr(97 + i)} headline written as a real news line", words(story_words)]
    out += ["LAST_WORD:", "That is the day in full. Watch the next round of data on Thursday, and we will be back tomorrow.", "===END==="]
    return "\n".join(out)


def seed_day(st, date="2026-10-28", n=24, section_cycle=("world", "politics", "business", "tech", "sport", "entertainment"),
             weights=None, created=None, start=0):
    """n articles WRITTEN on `date`. weights: list of headlineWeight per article."""
    from schema import build_article
    for i in range(start, start + n):
        sec = section_cycle[i % len(section_cycle)]
        a = build_article(title=f"Story number {i} on {date} about something important in {sec}", excerpt="A full teaser sentence that reads as complete.",
                          summary=["One complete point here.", "Two complete point here.", "Three complete point here."],
                          html_body=GOOD_BODY, section_slug=sec, hashtags=[], img="https://i.example.com/a.jpg",
                          source_name="S", source_url=f"https://s.example.com/{date}/{i}", voice="X",
                          published_at=f"{date}T0{i % 9}:00:00.000Z",
                          headline_weight=(weights[i] if weights else 60))
        a["createdAt"] = created or f"{date}T0{i % 9}:30:00.000Z"
        st.publish_article(a)


SETTINGS = {"hour": 13, "minute": 0, "lead_minutes": 30, "min_articles": 20, "max_stories": 12}


def make_sched(st, now, reply):
    return report.ReportScheduler(st, Monitor(st.db), SETTINGS, clock=lambda: now[0],
                                  chat=lambda p, mt, temperature=0: llm.ChatResult(reply(p) if callable(reply) else reply, "stop"))


def test_newsletter_uses_all_same_day_articles_and_only_the_important_ones():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="r3"); st.ensure_ready()
    seed_day(st, "2026-10-27", n=15)                               # yesterday: must NOT be used
    # 24 articles today: world/politics/business/tech are important, sport/entertainment are not
    seed_day(st, "2026-10-28", n=24)
    prompts = []
    now = [datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)]
    sched = make_sched(st, now, lambda p: prompts.append(p) or newsletter_reply(12))
    assert sched.tick() == "2026-10-28"
    p = prompts[0]
    assert "on 2026-10-27 about" not in p                          # yesterday's stories (before the window) are not used
    assert p.count("STORY ") >= 5 and "STORY 13 " not in p        # at most 12 stories
    assert "in sport" not in p and "in entertainment" not in p     # low-weight sections are left out (weight 60-18 < 50)
    assert "Details: " in p                                        # editor reads the article text, not just titles


def test_newsletter_counts_articles_already_in_the_system():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="r4"); st.ensure_ready()
    seed_day(st, "2026-10-28", n=20)        # written earlier today, before this run began
    now = [datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)]
    assert make_sched(st, now, newsletter_reply(12)).tick() == "2026-10-28"


def test_pick_important_prefers_weight_caps_tags_and_tops_up():
    docs = [{"title": f"t{i}", "tag": "World" if i < 8 else "Sport", "headlineWeight": 90 - i * 3, "publishedAt": f"2026-10-28T0{i % 9}:00:00.000Z"} for i in range(10)]
    picked = report.pick_important(docs, max_stories=12)
    assert [d["headlineWeight"] for d in picked] == sorted([d["headlineWeight"] for d in picked], reverse=True)
    assert sum(d["tag"] == "World" for d in picked) <= report.MAX_PER_TAG
    few = [{"title": f"t{i}", "tag": f"T{i}", "headlineWeight": 20, "publishedAt": "2026-10-28T01:00:00.000Z"} for i in range(8)]
    assert len(report.pick_important(few)) == report.MIN_STORIES   # nothing clears the bar: top up to the minimum only


def test_keys_accept_comma_lists_in_any_variable(monkeypatch):
    import config
    for k in list(os.environ):
        if k.startswith("GROQ_API_KEY"):
            monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("GROQ_API_KEY", "gsk_aaa111,gsk_bbb222")          # singular name holding two keys
    monkeypatch.setenv("GROQ_API_KEYS", "gsk_bbb222, gsk_ccc333;gsk_ddd444")
    monkeypatch.setenv("GROQ_API_KEY_2", "gsk_eee555")
    assert config.get_groq_keys() == ["gsk_aaa111", "gsk_bbb222", "gsk_eee555", "gsk_ccc333", "gsk_ddd444"] or \
        set(config.get_groq_keys()) == {"gsk_aaa111", "gsk_bbb222", "gsk_ccc333", "gsk_ddd444", "gsk_eee555"}
    assert len(config.get_groq_keys()) == 5          # no duplicates, nothing glued together
    monkeypatch.setenv("GROQ_API_KEYS", "your_key_here")
    assert "your_key_here" not in config.get_groq_keys()


# ------------------------------------------------- window since the last report, fact-check, voice
def test_window_starts_where_the_last_report_ended():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="w1"); st.ensure_ready()
    seed_day(st, "2026-10-28", n=24)                                   # written 00:30-08:30 on the 28th
    prompts = []
    now = [datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)]
    sched = make_sched(st, now, lambda p: prompts.append(p) or newsletter_reply(12))
    assert sched.tick() == "2026-10-28"
    run1 = st.db["reportRuns"].find_one({})
    assert run1["windowEnd"] == "2026-10-28T12:00:00.000Z" and run1["windowStart"] == "2026-10-27T12:00:00.000Z"  # no report yet: 24h back
    assert len(run1["storyIds"]) == 12 and run1["articlesInWindow"] == 24

    seed_day(st, "2026-10-28", n=20, created="2026-10-28T15:00:00.000Z", start=100)   # written AFTER report 1
    now[0] = datetime(2026, 10, 29, 12, 30, tzinfo=timezone.utc)                       # the next fixed deadline (12:30 UTC): due
    prompts.clear()
    assert sched.tick() == "2026-10-29"
    run2 = st.db["reportRuns"].find_one({"date": "2026-10-29"})
    assert run2["windowStart"] == run1["windowEnd"]                    # windows touch: nothing missed
    assert run2["articlesInWindow"] == 20                              # only what is new since the last report
    assert not set(run1["storyIds"]) & set(run2["storyIds"])           # nothing told twice
    import re
    assert re.search(r"Story number 1\d\d on", prompts[0])               # the new articles are in
    assert not re.search(r"Story number \d{1,2} on", prompts[0])          # ...and nothing from report 1's period comes back


def test_window_catches_up_after_downtime():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="w2"); st.ensure_ready()
    st.db["reportRuns"].insert_one({"date": "2026-10-25", "windowStart": "2026-10-24T12:00:00.000Z",
                                    "windowEnd": "2026-10-25T12:00:00.000Z"})
    seed_day(st, "2026-10-26", n=21)                                   # pipeline was off for 3 days, but these exist
    now = [datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)]
    assert make_sched(st, now, newsletter_reply(12)).tick() == "2026-10-28"
    assert st.db["reportRuns"].find_one({"date": "2026-10-28"})["articlesInWindow"] == 21


def test_report_with_invented_facts_is_rewritten_once_then_published():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="f1"); st.ensure_ready()
    seed_day(st, n=24)
    bad = newsletter_reply(12).replace("Chipmakers lead", "Chipmakers lead 47 percent")      # a number no story contains
    replies, prompts = [bad, newsletter_reply(12)], []
    def reply(p):
        prompts.append(p)
        return replies[min(len(prompts) - 1, 1)]
    now = [datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)]
    assert make_sched(st, now, reply).tick() == "2026-10-28"
    assert len(prompts) == 2 and "NOT supported by the stories" in prompts[1] and "47" in prompts[1]
    assert "47" not in st.db["reports"].find_one({"date": "2026-10-28"})["leadTitle"]


def test_report_that_keeps_inventing_facts_is_never_published():
    """Production never stops trying; the test bounds it with max_rounds. Nothing unsupported is ever returned/stored."""
    st = MongoStorage(client=mongomock.MongoClient(), db_name="f2"); st.ensure_ready()
    seed_day(st, n=24)
    bad = newsletter_reply(12).replace("kept the wider market confident.", "kept the wider market confident after 4700 new orders.")
    _, material = report.gather_material(st, ("2026-10-27T00:00:00.000Z", "2026-10-29T00:00:00.000Z"))
    rounds = []
    with pytest.raises(Incomplete):
        report.write_report(material, "2026-10-28", chat=lambda p, mt, temperature=0: llm.ChatResult(bad, "stop"),
                            max_rounds=30, sleep=NOSLEEP, on_round=lambda n, why, k: rounds.append((n, k)))
    assert len(rounds) >= 30 and min(k for _, k in rounds) == report.MIN_STORIES     # it also shrank the newsletter while trying
    assert st.db["reports"].count_documents({}) == 0


def test_report_prompt_carries_the_newsletter_voice_and_the_window():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="v1"); st.ensure_ready()
    seed_day(st, n=24)
    prompts = []
    now = [datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)]
    make_sched(st, now, lambda p: prompts.append(p) or newsletter_reply(12)).tick()
    p = prompts[0]
    assert "smart, funny friend" in p and "WIT LIVES IN THE PHRASING, NEVER IN THE FACTS" in p
    assert "no markdown" in p and "No jokes about deaths" in p
    assert "since the last edition (2026-10-27 12:00 to 2026-10-28 12:00 UTC)" in p
    assert "no rhetorical questions" not in p.lower()


# ------------------------------------- a per-minute rate limit is not "out of credit"
GROQ_TPM = ("Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` on tokens per minute (TPM): "
            "Limit 8000, Used 7900, Requested 2500. Please try again in 20s. Need more tokens? Upgrade to Dev Tier "
            "today at https://console.groq.com/settings/billing")


def test_per_minute_rate_limit_is_waited_out_not_a_two_hour_pause():
    pool, log = install({f"k{i}": [Boom(429, GROQ_TPM, 20), ("ok", "stop")] for i in range(3)})
    slept = []
    pool.clock = lambda: 1000.0 + sum(slept)                 # fake time moves only when chat() sleeps
    for k in pool.keys:
        k["until"] = 0.0
    res = llm.chat("p", 100, pool=pool, sleep=slept.append)
    assert res.text == "ok"                                  # no AllKeysExhausted, no 2h pause
    assert 0 < sum(slept) < llm.SHORT_WAIT + 5
    assert all("out of credit" not in (k["error"] or "") for k in pool.keys)


def test_real_out_of_credit_still_raises_and_a_long_daily_limit_is_not_waited_for():
    pool, _ = install({f"k{i}": [Boom(429, "insufficient credit balance", 7200)] for i in range(3)})
    with pytest.raises(llm.AllKeysExhausted):
        llm.chat("p", 10, pool=pool, sleep=lambda s: None)
    pool2, _ = install({f"k{i}": [Boom(429, "Rate limit reached ... tokens per day (TPD) ... try again in 2h", 7200)] for i in range(3)})
    with pytest.raises(llm.AllKeysExhausted):
        llm.chat("p", 10, pool=pool2, sleep=lambda s: None)


def test_image_406_is_retried_with_a_plain_accept_header_and_octet_stream_photos_are_judged_by_their_bytes():
    seen = []
    def get(u, headers=None, **k):
        seen.append(headers["Accept"])
        return Resp(png(), 406) if headers["Accept"].startswith("image/avif") else Resp(png(), 200, "binary/octet-stream")
    assert images.verify_image("https://i.example.com/p/photo.png", get=get)[0]
    assert seen[0].startswith("image/avif") and seen[1] == "*/*"
    assert not images.verify_image("https://i.example.com/p/x.png", get=lambda *a, **k: Resp(b"<html>not an image</html>" * 900, 200, "binary/octet-stream"))[0]
    assert not images.verify_image("https://i.example.com/p/x.svg", get=lambda *a, **k: Resp(png(), 200, "image/svg+xml"))[0]


def test_unknown_section_label_from_the_model_is_mapped_not_fatal():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="t1"); st.ensure_ready()
    seed_day(st, n=24)
    reply = newsletter_reply(12).replace("SECTION: Business |", "SECTION: Tech & AI |").replace("SECTION: World |", "SECTION: Global affairs |")
    now = [datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)]
    assert make_sched(st, now, reply).tick() == "2026-10-28"
    tags = {s["tag"] for s in st.db["reports"].find_one({})["sections"]}
    assert "Tech & AI" not in tags and "Global affairs" not in tags


# ------------------------------------------------ the key reserved for the Midnight Report
class Clock:
    def __init__(self): self.t = 1_000_000.0
    def __call__(self): return self.t


def mkpool(n=3, clock=None):
    clock = clock or Clock()
    return llm.KeyPool([f"k{i}" for i in range(n)], clock=clock), clock


def test_news_and_trends_never_use_the_reserved_key_but_the_report_does():
    pool, _ = mkpool(3)
    used = {pool.acquire()["key"] for _ in range(20)}
    assert pool.reserved == 2 and used == {"k0"}                     # work stays on its own keys; ties pick the LAST key to reserve
    assert pool.acquire("report")["key"] == "k2"


def test_work_pauses_when_only_the_reserved_key_is_left():
    pool, _ = mkpool(3)
    for i in (0, 1):
        pool.cooldown(pool.keys[i], 3600, "x")
    with pytest.raises(llm.AllKeysExhausted):
        pool.acquire()                                               # k2 is kept for the report
    assert pool.acquire("report")["key"] == "k2"


def test_report_falls_back_to_any_usable_key_when_the_reserved_one_is_down():
    pool, _ = mkpool(3)
    pool.acquire()
    pool.cooldown(pool.keys[2], 3600, "x")                           # reserved key rate limited
    assert pool.reserved in (0, 1)                                   # a usable key is re-reserved at once: never none
    assert pool.acquire("report")["key"] in ("k0", "k1")


def test_reserve_moves_to_the_key_with_most_credit_only_after_the_hold_and_only_if_clearly_better():
    pool, clock = mkpool(3)
    pool.acquire()
    first = pool.reserved
    pool.record_usage(pool.keys[first], 100_000)                     # the reserved key has been used a lot
    clock.t += llm.REBALANCE_SECONDS + 1
    pool.acquire()
    assert pool.reserved == first                                    # too soon: held (no flip-flopping)
    clock.t += llm.RESERVE_HOLD_SECONDS
    pool.acquire()
    assert pool.reserved != first and pool.keys[pool.reserved]["status"] == "ok"   # now handed to a fresher key
    now_res = pool.reserved
    others = [i for i in range(3) if i != now_res]
    pool.record_usage(pool.keys[now_res], 90_000)
    pool.record_usage(pool.keys[others[0]], 88_000)                  # about as used as the reserved key
    clock.t += llm.RESERVE_HOLD_SECONDS + llm.REBALANCE_SECONDS
    pool.acquire()
    assert pool.reserved == now_res                                  # not clearly better (margin): a good key is not dropped


def test_a_single_key_is_not_reserved():
    pool, _ = mkpool(1)
    assert pool.acquire()["key"] == "k0" and pool.reserved is None and not pool.snapshot()[0]["reserved"]


def test_chat_report_purpose_uses_reserved_key_and_records_usage():
    pool, log = install({f"k{i}": [("ok", "stop")] for i in range(3)})
    llm.chat("p", 10, pool=pool)
    llm.chat("p", 10, pool=pool, purpose="report")
    assert log == ["k0", "k2"] and any(x["reserved"] for x in pool.snapshot())


def test_default_cooldown_is_15_minutes(monkeypatch):
    import config
    monkeypatch.delenv("KEY_PAUSE_HOURS", raising=False)
    assert config.key_pause_seconds() == 900 and llm.QUOTA_COOLDOWN == 900


# ------------------------------------- missed reports, lateness, back-off, report-only events, delete script
def test_report_events_have_their_own_endpoint_and_are_also_in_live_activity(monkeypatch):
    from fastapi.testclient import TestClient
    import main, storage
    st = MongoStorage(client=mongomock.MongoClient(), db_name="ev"); st.ensure_ready()
    mon = Monitor(st.db)
    mon.emit("published", "Published: an article")
    mon.emit("report_failed", "Midnight Report 2026-10-28 not published: x", level="error")
    mon.emit("key_switch", "Switched to key 2")
    monkeypatch.setattr(storage, "_instance", st)
    c = TestClient(main.app)
    only = c.get("/api/reports/events").json()
    assert [e["kind"] for e in only] == ["report_failed"]
    assert {e["kind"] for e in c.get("/api/events").json()} == {"published", "report_failed", "key_switch"}
    st.db["reportRuns"].insert_one({"date": "2026-10-28", "windowEnd": "2026-10-28T12:30:00.000Z", "storyIds": ["a"], "late": False})
    runs = c.get("/api/reports/runs").json()
    assert runs[0]["date"] == "2026-10-28" and "storyIds" not in runs[0]
    assert c.get("/api/reports/2026-01-01").status_code == 404           # the date route still works


def test_clean_writer_clears_memory_not_sections_or_content_unless_asked():
    import clean_writer
    db = mongomock.MongoClient()["cw"]
    for n in clean_writer.MEMORY + clean_writer.CONTENT + ["sections", "users"]:
        db[n].insert_one({"x": 1})
    assert clean_writer.clean(db)["ingestLedger"] == 1 and db["ingestLedger"].count_documents({}) == 1   # dry run
    clean_writer.clean(db, go=True)
    assert all(db[n].count_documents({}) == 0 for n in clean_writer.MEMORY)
    assert all(db[n].count_documents({}) == 1 for n in clean_writer.CONTENT + ["sections", "users"])
    clean_writer.clean(db, include_content=True, go=True)
    assert all(db[n].count_documents({}) == 0 for n in clean_writer.CONTENT)
    assert db["sections"].count_documents({}) == 1 and db["users"].count_documents({}) == 1


# ------------------------------------------- the report never gives up, and an hourly loop keeps it timely
NOSLEEP = lambda *_: None


def _sched(st, now, reply, **kw):
    return report.ReportScheduler(st, Monitor(st.db), SETTINGS, clock=lambda: now[0], sleep=NOSLEEP,
                                  chat=lambda p, mt, temperature=0: llm.ChatResult(reply(p) if callable(reply) else reply, "stop"), **kw)


def _run(st, date, written):
    st.db["reportRuns"].insert_one({"date": date, "windowEnd": written, "writtenAt": written})


def test_report_is_due_at_the_fixed_1230_utc_deadline_not_24h_after_the_last_one():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="due"); st.ensure_ready()
    now = [datetime(2026, 10, 30, 8, 0, tzinfo=timezone.utc)]
    sched = _sched(st, now, newsletter_reply(12))
    assert sched.is_due()                                                    # never written one: due
    _run(st, "2026-10-29", "2026-10-29T14:10:00.000Z")                       # yesterday's was written LATE, at 14:10
    assert not sched.is_due()
    now[0] = datetime(2026, 10, 30, 12, 29, tzinfo=timezone.utc)             # 22h19m after it: not drifted into "due"
    assert not sched.is_due()
    now[0] = datetime(2026, 10, 30, 12, 30, tzinfo=timezone.utc)             # the fixed deadline: edition 13:00 minus 30 min
    assert sched.is_due() and sched.due_target()[0] == "2026-10-30"
    assert sched.next_info()["nextReportAt"] == "2026-10-30T12:30:00.000Z"
    assert sched.next_info()["nextReportEditionTime"] == "2026-10-30T13:00:00.000Z"


def test_a_late_report_does_not_move_tomorrows_deadline():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="nodrift"); st.ensure_ready()
    seed_day(st, "2026-10-30", n=24)
    now = [datetime(2026, 10, 30, 14, 0, tzinfo=timezone.utc)]               # the pipeline only got going at 14:00
    sched = _sched(st, now, newsletter_reply(12))
    _run(st, "2026-10-29", "2026-10-29T12:31:00.000Z")
    assert sched.tick() == "2026-10-30"                                      # caught up at once, 90 min after the deadline
    assert st.db["reportRuns"].find_one({"date": "2026-10-30"})["late"] is True
    assert sched.next_info()["nextReportAt"] == "2026-10-31T12:30:00.000Z"    # tomorrow is still 12:30, not 14:00
    now[0] = datetime(2026, 10, 31, 12, 29, tzinfo=timezone.utc)
    assert not sched.is_due()
    now[0] = datetime(2026, 10, 31, 12, 30, tzinfo=timezone.utc)
    assert sched.is_due()


def test_a_missed_deadline_is_caught_up_as_soon_as_the_pipeline_is_back():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="catch"); st.ensure_ready()
    _run(st, "2026-10-28", "2026-10-28T12:35:00.000Z")
    now = [datetime(2026, 10, 30, 8, 0, tzinfo=timezone.utc)]                # down through the 29th's 12:30 deadline
    sched = _sched(st, now, newsletter_reply(12))
    assert sched.due_target()[0] == "2026-10-29" and sched.due_target()[2] == "catch-up"
    seed_day(st, "2026-10-29", n=24)
    assert sched.tick() == "2026-10-29" and st.db["reports"].count_documents({}) == 1
    assert not sched.is_due()                                                # and nothing doubled up
    assert sched.next_info()["nextReportAt"] == "2026-10-30T12:30:00.000Z"


def test_the_first_report_written_early_is_not_followed_by_another_the_same_day():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="early"); st.ensure_ready()
    seed_day(st, "2026-10-30", n=24)
    now = [datetime(2026, 10, 30, 8, 0, tzinfo=timezone.utc)]
    sched = _sched(st, now, newsletter_reply(12))
    assert sched.tick() == "2026-10-30"
    for h, m in ((9, 0), (12, 30), (13, 5), (23, 0)):
        now[0] = datetime(2026, 10, 30, h, m, tzinfo=timezone.utc)
        assert not sched.is_due()                                            # one edition per date
    now[0] = datetime(2026, 10, 31, 8, 0, tzinfo=timezone.utc)               # 24h after: NOT due, no drift to 08:00
    assert not sched.is_due()
    now[0] = datetime(2026, 10, 31, 12, 30, tzinfo=timezone.utc)
    assert sched.is_due()


def test_24_hour_check_writes_todays_report_if_a_whole_day_passed_with_nothing():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="safety"); st.ensure_ready()
    _run(st, "2026-10-29", "2026-10-29T10:00:00.000Z")                       # (early run that satisfied the 29th)
    now = [datetime(2026, 10, 30, 10, 59, tzinfo=timezone.utc)]              # before the 30th's deadline
    sched = _sched(st, now, newsletter_reply(12))
    assert not sched.is_due()                                                # 24h59m
    now[0] = datetime(2026, 10, 30, 11, 0, tzinfo=timezone.utc)              # 25h with nothing written
    assert sched.due_target()[0] == "2026-10-30" and sched.due_target()[2] == "safety"


def test_not_due_means_no_model_call():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="nd"); st.ensure_ready()
    seed_day(st, "2026-10-30", n=24)
    st.db["reportRuns"].insert_one({"date": "2026-10-30", "windowEnd": "2026-10-30T10:00:00.000Z", "writtenAt": "2026-10-30T10:00:00.000Z"})
    calls = []
    now = [datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)]
    assert _sched(st, now, lambda p: calls.append(p) or newsletter_reply(12)).tick() is None and calls == []


def test_overdue_report_keeps_correcting_until_it_passes():
    """Cut off, thin, too few stories, then fact-check failures: 6 bad drafts in a row, no waiting, then success."""
    st = MongoStorage(client=mongomock.MongoClient(), db_name="never"); st.ensure_ready()
    seed_day(st, "2026-10-30", n=24)
    now = [datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)]
    drafts = iter([newsletter_reply(10).replace("\n===END===", ""), newsletter_reply(10, story_words=15), newsletter_reply(4),
                   newsletter_reply(10).replace("\n===END===", ""), newsletter_reply(10, story_words=15), newsletter_reply(4)])
    prompts = []
    def reply(p):
        prompts.append(p)
        return next(drafts, None) or newsletter_reply(12)
    sched = _sched(st, now, reply)
    assert sched.tick() == "2026-10-30"                                     # returned only once it was stored
    assert len(prompts) == 7 and st.db["reports"].count_documents({}) == 1
    assert st.db["ingestEvents"].count_documents({"kind": "report_retry"}) == 7
    assert st.db["reportRuns"].count_documents({}) == 1
    assert max(len(p) for p in prompts) < len(prompts[0]) + 3000           # feedback does not pile up round after round
    assert not st.db["ingestEvents"].count_documents({"kind": "report_failed"})


def test_factcheck_rejection_is_corrected_not_postponed(monkeypatch):
    monkeypatch.setenv("FACTCHECK_LLM", "on"); monkeypatch.setenv("FACTCHECK_MODE", "strict")
    st = MongoStorage(client=mongomock.MongoClient(), db_name="fc"); st.ensure_ready()
    seed_day(st, "2026-10-30", n=24)
    now = [datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)]
    state = {"n": 0, "seen_feedback": False}
    def chat(p, mt, temperature=0):
        if "strict fact-checker" in p:
            state["n"] += 1
            if state["n"] <= 3:
                return llm.ChatResult("VERDICT: FAIL\nUNSUPPORTED:\n- the Congolese president welcomed the sanctions\n===END===", "stop")
            return llm.ChatResult("VERDICT: PASS\nUNSUPPORTED:\n- none\n===END===", "stop")
        state["seen_feedback"] |= "Congolese president welcomed the sanctions" in p
        return llm.ChatResult(newsletter_reply(12), "stop")
    sched = report.ReportScheduler(st, Monitor(st.db), SETTINGS, clock=lambda: now[0], sleep=NOSLEEP, chat=chat)
    assert sched.tick() == "2026-10-30" and state["seen_feedback"]


def test_report_waits_only_for_a_key_then_carries_on():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="key"); st.ensure_ready()
    seed_day(st, "2026-10-30", n=24)
    now = [datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)]
    calls, waits = {"n": 0}, []
    def chat(p, mt, temperature=0):
        calls["n"] += 1
        if calls["n"] <= 3:
            raise llm.AllKeysExhausted(time.time() + 1000)
        return llm.ChatResult(newsletter_reply(12), "stop")
    sched = report.ReportScheduler(st, Monitor(st.db), SETTINGS, clock=lambda: now[0], sleep=waits.append, chat=chat)
    assert sched.tick() == "2026-10-30"
    assert waits == [60, 60, 60]                                            # seconds, never the old 15 minutes


def test_too_few_stories_checks_again_in_5_minutes_and_loop_wakes_hourly():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="few"); st.ensure_ready()
    seed_day(st, "2026-10-30", n=3)
    now = [datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)]
    sched = _sched(st, now, newsletter_reply(12))
    loop = report.ReportLoop(sched, sleep=NOSLEEP)
    assert loop.run_once() == report.PENDING_CHECK_SECONDS and st.db["reports"].count_documents({}) == 0
    seed_day(st, "2026-10-30", n=24, start=3)
    assert loop.run_once() == report.CHECK_EVERY_SECONDS and st.db["reports"].count_documents({}) == 1   # written; next look in 1 h
    assert loop.run_once() == report.CHECK_EVERY_SECONDS and st.db["reports"].count_documents({}) == 1   # not due: nothing new


def test_loop_wakes_hourly_but_sooner_when_the_deadline_is_nearer():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="wake"); st.ensure_ready()
    _run(st, "2026-10-29", "2026-10-29T12:31:00.000Z")
    now = [datetime(2026, 10, 30, 3, 0, tzinfo=timezone.utc)]
    loop = report.ReportLoop(_sched(st, now, newsletter_reply(12)), sleep=NOSLEEP)
    assert loop.run_once() == report.CHECK_EVERY_SECONDS                     # 9.5 h to go: look again in an hour
    now[0] = datetime(2026, 10, 30, 12, 10, tzinfo=timezone.utc)
    assert loop.run_once() == 20 * 60                                        # 20 min to go: wake exactly at 12:30


def test_loop_survives_an_exception_and_the_next_report_follows_at_the_next_deadline():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="again"); st.ensure_ready()
    seed_day(st, "2026-10-30", n=24)
    now = [datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)]
    sched = _sched(st, now, newsletter_reply(12))
    loop = report.ReportLoop(sched, sleep=NOSLEEP)
    real = sched.tick
    sched.tick = lambda: (_ for _ in ()).throw(RuntimeError("db hiccup"))
    assert loop.run_once() == 60 and st.db["ingestEvents"].count_documents({"kind": "report_failed"}) == 1
    sched.tick = real
    loop.run_once()
    assert st.db["reports"].count_documents({}) == 1
    now[0] = datetime(2026, 10, 31, 12, 29, tzinfo=timezone.utc)
    seed_day(st, "2026-10-31", n=24, created="2026-10-31T09:00:00.000Z")
    loop.run_once(); assert st.db["reports"].count_documents({}) == 1       # 12:29: not yet
    now[0] = datetime(2026, 10, 31, 12, 30, tzinfo=timezone.utc)
    loop.run_once(); assert st.db["reports"].count_documents({}) == 2       # 12:30: next one


# ------------------------------------- articles / trends / images try 5-10 times before giving up
def test_writer_makes_up_to_five_attempts_at_a_complete_draft():
    calls = []
    def chat(p, mt, temperature=0):
        calls.append(temperature)
        return llm.ChatResult(good_reply()[:200], "length") if len(calls) < 5 else llm.ChatResult(good_reply(), "stop")
    assert rewriter.rewrite_article(dict(ART), chat=chat)["title"] and len(calls) == 5


def test_retry_settings_are_clamped_to_5_10(monkeypatch):
    import config
    for k, v, want in (("FACTCHECK_ROUNDS", "2", 5), ("FACTCHECK_ROUNDS", "99", 10), ("IMAGE_TRIES", "1", 5), ("IMAGE_TRIES", "7", 7)):
        monkeypatch.setenv(k, v)
        assert config.retry_settings()[{"FACTCHECK_ROUNDS": "factcheck_rounds", "IMAGE_TRIES": "image_tries"}[k]] == want
    monkeypatch.delenv("FACTCHECK_ROUNDS"); monkeypatch.delenv("IMAGE_TRIES")
    r = config.retry_settings()
    assert r["factcheck_rounds"] == 8 and r["image_tries"] == 10


def test_image_check_retries_a_network_hiccup_but_not_a_bad_image():
    good = png(1200, 700)
    calls = {"n": 0}
    def flaky(*a, **k):
        calls["n"] += 1
        if calls["n"] < 3:
            raise ConnectionError("reset")
        return Resp(good)
    ok, why, _ = images.verify_image("https://i.example.com/p/photo.png", get=flaky, sleep=lambda s: None)
    assert ok and calls["n"] == 3
    calls["n"] = 0
    def tiny(*a, **k):
        calls["n"] += 1
        return Resp(png(120, 90))
    assert not images.verify_image("https://i.example.com/a.png", get=tiny, sleep=lambda s: None)[0] and calls["n"] == 1   # bad image: no retry


def test_image_search_tries_up_to_ten_candidates():
    good = png(1200, 700)
    seen = []
    def get(u, *a, **k):
        seen.append(u)
        return Resp(good) if u.endswith("/9.png") else Resp(good, 404)
    urls = [f"https://i.example.com/p/{i}.png" for i in range(12)]
    got, rejected = images.pick_verified_images(urls, limit=1, get=get)
    assert got == ["https://i.example.com/p/9.png"] and len(rejected) == 9


def test_hydrate_looks_at_the_page_when_the_feed_images_are_bad(monkeypatch):
    import scraper
    monkeypatch.setattr(scraper, "POLITE_DELAY", 0)
    monkeypatch.setattr(scraper, "_scrape_html_fallback", lambda url, src: ("page text " * 200, ["https://i.example.com/p/hero.png"]))
    monkeypatch.setattr(images, "verify_image", lambda u, get=None, referer=None, tries=3, sleep=None:
                        (True, "ok", u) if u.endswith("hero.png") else (False, "too small (10x10)", None))
    e = {"url": "https://s.example.com/a", "source": "S", "text": "t" * 2000, "images": ["https://i.example.com/p/bad.png"]}
    assert scraper.hydrate_entry(e, sleep=lambda s: None)["images"] == ["https://i.example.com/p/hero.png"]
    monkeypatch.setattr(images, "verify_image", lambda *a, **k: (False, "request failed (ReadTimeout)", None))
    with pytest.raises(images.NoVerifiedImage) as ei:
        scraper.hydrate_entry({"url": "https://s.example.com/a", "source": "S", "text": "t" * 2000, "images": ["https://i.example.com/p/bad.png"]},
                              sleep=lambda s: None)
    assert ei.value.transient is True                                        # network trouble only: worth another go later


def test_rejection_feedback_tells_the_model_what_to_do():
    assert "DELETE these numbers" in report.coach("NOT supported by the stories: numbers not in the source: 2.5") and "2.5" in report.coach("numbers not in the source: 2.5")
    assert "200-320" in report.coach("lead story is 127 words (needs 100-450)")
    assert report.coach("introduction missing/cut off") == "introduction missing/cut off"



def test_bulk_scrape_flags_default_to_six_months_and_source_time(monkeypatch):
    import config
    monkeypatch.delenv("SCRAPE_MAX_AGE_DAYS", raising=False); monkeypatch.delenv("PUBLISHED_AT_MODE", raising=False)
    assert config.scrape_settings() == {"max_age_days": 183.0, "published_at_mode": "source"}
    monkeypatch.setenv("SCRAPE_MAX_AGE_DAYS", "1"); monkeypatch.setenv("PUBLISHED_AT_MODE", "OWN")
    assert config.scrape_settings() == {"max_age_days": 1.0, "published_at_mode": "own"}
    monkeypatch.setenv("SCRAPE_MAX_AGE_DAYS", "oops"); monkeypatch.setenv("PUBLISHED_AT_MODE", "banana")
    assert config.scrape_settings() == {"max_age_days": 183.0, "published_at_mode": "source"}


def test_created_sort_orders_articles_by_when_we_published_not_the_source_time():
    st = MongoStorage(client=mongomock.MongoClient(), db_name="srt"); st.ensure_ready()
    seed_day(st, "2026-10-28", n=3, created="2026-10-28T09:00:00.000Z")
    seed_day(st, "2026-10-20", n=1, start=50, created="2026-10-28T11:00:00.000Z")   # old source story, published by us last
    newest, _ = st.list_posts(sort="newest", limit=1)
    created, _ = st.list_posts(sort="created", limit=1)
    assert "2026-10-20" in created[0]["title"] and "2026-10-20" not in newest[0]["title"]
