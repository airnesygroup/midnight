"""Pause / Go live control (control.py + the hold/retry logic in generate.py).
Offline, like the other tests:  python -m pytest backend/tests -q"""
import os
import sys

import mongomock
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import generate
import llm
from control import Control, Watcher
from test_pipeline import env, go, fake_pool  # noqa: F401  (env is a fixture)


class Wish:
    """A hand-driven stand-in for the dashboard buttons (same interface as control.Watcher)."""

    def __init__(self):
        self.want_paused, self.clicks, self._seen = False, 0, 0

    def paused(self):
        return self.want_paused

    def retry_requested(self):
        if self.clicks != self._seen:
            self._seen = self.clicks
            return True
        return False

    def pause(self):
        self.want_paused = True

    def go_live(self):
        self.want_paused = False
        self.clicks += 1


def kinds(st):
    return [e["kind"] for e in st.db["ingestEvents"].find().sort("_id", 1)]


def ok_rewrite(e, voice=None):
    return {"title": e["title"] + " — analysis", "excerpt": "An excerpt that is a complete sentence about it.",
            "summary": ["First complete takeaway sentence.", "Second complete takeaway sentence.",
                        "Third complete takeaway sentence."],
            "html_body": "<p>" + "Body text here. " * 40 + "</p>", "img": e["images"][0],
            "source_url": e["url"], "source_name": e["source"], "voice": "Explainer"}


# ------------------------------------------------------------ Control / Watcher
def test_control_pause_resume_and_retry_click_counts_once():
    c = Control(mongomock.MongoClient()["t"])
    assert c.get("news") == {"desired": "running", "retryNonce": 0, "updatedAt": None}
    w = Watcher(c, "news")
    assert w.paused() is False and w.retry_requested() is False
    c.pause("news")
    assert w.paused() is True and c.get("trends")["desired"] == "running"   # loops are independent
    c.resume("news")
    assert w.paused() is False
    assert w.retry_requested() is True and w.retry_requested() is False      # one retry per click


def test_old_go_live_click_is_not_a_new_request_after_restart():
    c = Control(mongomock.MongoClient()["t"])
    c.resume("news")
    assert Watcher(c, "news").retry_requested() is False


# ------------------------------------------------------------------ the loop
def test_pause_with_credit_left_stops_new_work_until_go_live(env):
    st, fetch = env
    wish, seen_while_paused = Wish(), []

    def rewrite(e, voice=None):
        if not wish.want_paused and not seen_while_paused:
            wish.pause()                         # Pause pressed while the first article is being written
        return ok_rewrite(e)

    def sleep(s):                                # only reached while held
        seen_while_paused.append(st.articles.count_documents({}))
        wish.go_live()

    n, _ = go(st, fetch, count=50, rewrite=rewrite, control=wish, sleep=sleep)
    assert seen_while_paused and seen_while_paused[0] == 1     # the article in hand finished, nothing new started
    assert n >= 2                                              # and Go live carried on
    k = kinds(st)
    assert "paused" in k and "resumed" in k


def test_go_live_cuts_the_credit_cooldown_short_and_retries(env):
    st, fetch = env
    wish, calls, sleeps = Wish(), [], []

    def rewrite(e, voice=None):
        calls.append(1)
        if len(calls) == 1:
            raise llm.AllKeysExhausted()
        return ok_rewrite(e)

    def sleep(s):
        sleeps.append(s)
        if len(sleeps) == 2:
            wish.go_live()                       # pressed a few seconds into a 2 hour cooldown

    n, _ = go(st, fetch, count=50, rewrite=rewrite, control=wish, sleep=sleep, pause_seconds=7200)
    assert n >= 1 and "retry" in kinds(st)
    assert len(sleeps) < 50                      # not 7200 / 3 slices


def test_retry_that_is_still_out_of_credit_cools_down_again(env):
    st, fetch = env
    wish, calls, sleeps = Wish(), [], []

    def rewrite(e, voice=None):
        calls.append(1)
        if len(calls) <= 2:
            raise llm.AllKeysExhausted()
        return ok_rewrite(e)

    def sleep(s):
        sleeps.append(s)
        if len(sleeps) in (2, 6):
            wish.go_live()

    n, _ = go(st, fetch, count=50, rewrite=rewrite, control=wish, sleep=sleep, pause_seconds=7200)
    msgs = [e["message"] for e in st.db["ingestEvents"].find({"kind": "paused"}).sort("_id", 1)]
    assert len(msgs) == 2 and msgs[1].startswith("Retry failed")
    assert n >= 1


# --------------------------------------------------------------------- the API
def test_http_control(env, monkeypatch):
    from fastapi.testclient import TestClient
    import storage, main
    st, _ = env
    monkeypatch.setattr(storage, "_instance", st)
    started = []
    monkeypatch.setattr(main.subprocess, "Popen", lambda cmd, **kw: started.append(cmd) or type("P", (), {"poll": lambda s: None})())
    main._spawned.clear()
    c = TestClient(main.app)

    assert c.post("/api/control/nope/pause").status_code == 404
    assert c.post("/api/control/news/pause").json()["control"]["desired"] == "paused"
    assert c.get("/api/status").json()["generator"]["desired"] == "paused"
    assert c.get("/api/trends/status").json()["generator"]["desired"] == "running"   # independent loops

    r = c.post("/api/control/news/resume").json()
    assert r["control"]["desired"] == "running" and r["control"]["retryNonce"] == 1
    assert r["started"] is True and started and started[0][-2:] == ["generate.py", "--forever"]   # not running -> started

    again = c.post("/api/control/news/resume").json()
    assert again["started"] is False and len(started) == 1                          # already booting: not started twice

    # a loop with a fresh heartbeat is left alone (it picks the wish up itself)
    from schema import now_iso
    st.db["systemState"].update_one({"_id": "trends"}, {"$set": {"heartbeat": now_iso(), "state": "paused"}}, upsert=True)
    assert c.post("/api/control/trends/resume").json()["started"] is False
    assert c.get("/api/control").json()["trends"]["online"] is True
