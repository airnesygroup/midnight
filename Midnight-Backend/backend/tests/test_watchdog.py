from datetime import datetime, timedelta, timezone

import watchdog as w

NOW = datetime(2026, 11, 2, 8, 40, tzinfo=timezone.utc)


_clock = {"t": 1000.0}


def iso(sec_ago):
    """`sec_ago` seconds before the simulated 'now' (Env.t)."""
    return (NOW + timedelta(seconds=_clock["t"] - 1000 - sec_ago)).isoformat().replace("+00:00", "Z")


class Proc:
    def __init__(self, pid=100):
        self.pid, self.code, self.killed = pid, None, False

    def poll(self):
        return self.code

    def terminate(self):
        self.code = -15

    def kill(self):
        self.code = -9


class Env:
    def __init__(self):
        _clock['t'] = 1000.0
        self.t, self.states, self.spawned, self.killed, self.events, self.alive_pids = 1000.0, {}, [], [], [], set()

    def _now(self):
        _clock['t'] = self.t
        return self.t

    def sup(self, loops=("news",), stale=1200):
        def spawn(loop):
            p = Proc(200 + len(self.spawned))
            self.spawned.append((loop, p))
            return p
        return w.Supervisor(loops, lambda l: self.states.get(l), spawn=spawn, kill=self.killed.append,
                            alive=lambda pid: pid in self.alive_pids, emit=lambda *a, **k: self.events.append(a),
                            clock=self._now, utcnow=lambda: NOW + timedelta(seconds=self._now() - 1000),
                            stale_seconds=stale, log=lambda *_: None)


def test_starts_a_loop_that_is_not_running_and_leaves_a_healthy_one_alone():
    e = Env()
    s = e.sup()
    assert s.check("news") == "started"
    e.states["news"] = {"heartbeat": iso(5), "progressAt": iso(5), "pid": 200}
    e.t += 30; e._now()
    assert s.check("news") == "ok"
    assert len(e.spawned) == 1


def test_restarts_after_a_crash_with_backoff():
    e = Env()
    s = e.sup()
    s.check("news")
    e.spawned[0][1].code = 1                       # crashed
    assert s.check("news") == "waiting"            # back-off not over yet
    e.t += 6
    assert s.check("news") == "started"
    assert len(e.spawned) == 2


def test_restarts_a_frozen_heartbeat():
    e = Env()
    s = e.sup()
    s.check("news")
    e.t += 200                                     # past the boot grace
    e.states["news"] = {"heartbeat": iso(500), "progressAt": iso(500), "pid": 200}
    assert s.check("news") == "restarted"
    assert e.spawned[0][1].code is not None and len(e.spawned) == 2


def test_restarts_a_loop_that_beats_but_makes_no_progress():
    e = Env()
    s = e.sup(stale=1200)
    s.check("news")
    e.t += 200; e._now()
    e.states["news"] = {"heartbeat": iso(3), "progressAt": iso(1500), "pid": 200}
    assert s.check("news") == "restarted"


def test_a_cooldown_is_not_a_hang():
    e = Env()
    s = e.sup(stale=1200)
    s.check("news")
    e.t += 200; e._now()
    e.states["news"] = {"heartbeat": iso(3), "progressAt": iso(10), "state": "paused", "pid": 200}
    assert s.check("news") == "ok"


def test_manual_pause_is_left_alone():
    e = Env()
    s = e.sup(stale=1200)
    s.check("news")
    e.t += 200; e._now()
    e.states["news"] = {"heartbeat": iso(3), "progressAt": iso(5000), "manualPause": True, "pid": 200}
    assert s.check("news") == "ok"


def test_never_starts_a_second_copy_next_to_one_started_elsewhere():
    e = Env()
    e.alive_pids.add(555)
    e.states["news"] = {"heartbeat": iso(10), "progressAt": iso(10), "pid": 555}
    s = e.sup()
    assert s.check("news") == "ok-external"
    assert e.spawned == []


def test_replaces_a_stuck_loop_started_elsewhere():
    e = Env()
    e.alive_pids.add(555)
    e.states["news"] = {"heartbeat": iso(10), "progressAt": iso(4000), "pid": 555}
    s = e.sup()
    assert s.check("news") == "restarted"
    assert e.killed == [555] and len(e.spawned) == 1


def test_database_down_still_starts_the_process():
    e = Env()
    s = e.sup()
    s.read_state = lambda l: (_ for _ in ()).throw(RuntimeError("mongo down"))
    assert s.check("news") == "db-down"
    assert len(e.spawned) == 1
    assert s.check("news") == "db-down" and len(e.spawned) == 1    # not started twice


def test_restarts_are_recorded():
    e = Env()
    s = e.sup()
    s.check("news")
    assert s.restarts["news"] == 1 and e.events and e.events[0][0] == "watchdog"
