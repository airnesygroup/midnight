#!/usr/bin/env python3
"""
Midnight watchdog: an independent service whose ONLY job is to keep the news loop (generate.py) and the trends
loop (generate_trends.py) alive. It does no scraping, no writing, no LLM calls.

    python watchdog.py                 supervise both loops (starts them if they are not running)
    python watchdog.py --only news     supervise one loop only

Every WATCHDOG_CHECK_SECONDS (default 30) it looks at each loop and restarts it when:
  * the process has exited or crashed                         (restart after a short back-off, 5 s .. 60 s)
  * the heartbeat in MongoDB is older than 2 minutes          (frozen / machine slept / process hung hard)
  * its PROGRESS has not moved for WATCHDOG_STALE_MINUTES     (default 20; alive but stuck on one call forever)
A cooldown is never mistaken for a hang: a cooling-down loop still reports progress every few seconds, and no
cooldown is longer than 15 minutes. A loop you paused on purpose (Pause button) is left alone.

It never starts a second copy of a loop that is healthy, even one you started yourself in another terminal.
It records every restart as a "watchdog" event (dashboard activity) and in systemState {_id: "watchdog"}.
It survives MongoDB being down: it keeps supervising the processes and just retries the database.
"""

import argparse
import os
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone

import config

HERE = os.path.dirname(os.path.abspath(__file__))
LOOPS = {
    "news": {"script": "generate.py", "state_id": "generator", "label": "News loop"},
    "trends": {"script": "generate_trends.py", "state_id": "trends", "label": "Trends loop"},
}
FRESH_SECONDS = 90         # heartbeat younger than this = alive
DEAD_SECONDS = 120         # heartbeat older than this = frozen / gone
BOOT_GRACE = 150           # a freshly started loop gets this long to report its first heartbeat
BACKOFF = (5, 10, 20, 40, 60)
HEALTHY_RESET = 300        # a loop that ran this long without trouble resets its back-off


def _age(iso_text, now):
    if not iso_text:
        return None
    try:
        return (now - datetime.fromisoformat(str(iso_text).replace("Z", "+00:00"))).total_seconds()
    except ValueError:
        return None


def pid_alive(pid):
    if not pid:
        return False
    try:
        if os.name == "nt":
            out = subprocess.run(["tasklist", "/FI", f"PID eq {int(pid)}"], capture_output=True, text=True, timeout=10).stdout
            return str(int(pid)) in out
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError, subprocess.SubprocessError):
        return False


def kill_pid(pid):
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(int(pid)), "/T", "/F"], capture_output=True, timeout=15)
        else:
            os.kill(int(pid), signal.SIGTERM)
            time.sleep(3)
            if pid_alive(pid):
                os.kill(int(pid), signal.SIGKILL)
    except Exception:  # noqa: BLE001
        pass


def spawn_loop(loop):
    return subprocess.Popen([sys.executable, LOOPS[loop]["script"], "--forever"], cwd=HERE, stdin=subprocess.DEVNULL)


class Supervisor:
    """All the decisions, with every outside effect injectable so they can be tested without processes or a database.
      read_state(loop) -> dict (the loop's systemState document) or raises when the database is unreachable
      spawn(loop) -> process-like (poll(), terminate(), kill(), pid)
      kill_pid(pid), pid_alive(pid), emit(kind, message, level)"""

    def __init__(self, loops, read_state, spawn=spawn_loop, kill=kill_pid, alive=pid_alive, emit=None,
                 clock=time.time, utcnow=lambda: datetime.now(timezone.utc), stale_seconds=1200, log=print):
        self.loops, self.read_state, self.spawn, self.kill, self.alive = list(loops), read_state, spawn, kill, alive
        self.emit_fn, self.clock, self.utcnow, self.stale_seconds, self.log = emit, clock, utcnow, stale_seconds, log
        self.child, self.started_at, self.fails, self.next_start = {}, {}, {}, {}
        self.restarts = {l: 0 for l in self.loops}
        self.history = []

    # ----------------------------------------------------------------- helpers
    def _say(self, loop, kind, msg, level="warn"):
        self.log(f"[watchdog] {LOOPS[loop]['label']}: {msg}")
        self.history.append({"at": self.utcnow().isoformat(), "loop": loop, "kind": kind, "message": msg})
        self.history = self.history[-30:]
        if self.emit_fn:
            try:
                self.emit_fn("watchdog", f"{LOOPS[loop]['label']}: {msg}", level, loop=loop)
            except Exception:  # noqa: BLE001
                pass

    def _stop_child(self, loop):
        p = self.child.get(loop)
        if p is not None and p.poll() is None:
            try:
                p.terminate()
                for _ in range(10):
                    if p.poll() is not None:
                        break
                    time.sleep(0.5)
                if p.poll() is None:
                    p.kill()
            except Exception:  # noqa: BLE001
                pass
        self.child.pop(loop, None)

    def _start(self, loop, why):
        now = self.clock()
        if now < self.next_start.get(loop, 0):
            return False
        n = self.fails.get(loop, 0)
        try:
            self.child[loop] = self.spawn(loop)
        except Exception as e:  # noqa: BLE001
            self.fails[loop] = n + 1
            self.next_start[loop] = now + BACKOFF[min(n, len(BACKOFF) - 1)]
            self._say(loop, "start_failed", f"could not start ({type(e).__name__}: {str(e)[:100]})", "error")
            return False
        self.started_at[loop] = now
        self.restarts[loop] += 1
        self.next_start[loop] = now + BACKOFF[min(n, len(BACKOFF) - 1)]    # the NEXT restart waits at least this long
        self.fails[loop] = n + 1
        self._say(loop, "restart", f"started ({why})")
        return True

    # ------------------------------------------------------------------ one look
    def check(self, loop):
        """Look at one loop and act. Returns a short status word (for tests and the console)."""
        now_utc, now = self.utcnow(), self.clock()
        try:
            st = self.read_state(loop) or {}
            db_ok = True
        except Exception:  # noqa: BLE001 - MongoDB down: keep supervising the PROCESS
            st, db_ok = {}, False

        p = self.child.get(loop)
        running = p is not None and p.poll() is None
        if p is not None and not running:
            self._say(loop, "exited", f"process exited (code {p.poll()})", "error")
            self.child.pop(loop, None)
            p = None
        if running and now - self.started_at.get(loop, now) > HEALTHY_RESET:
            self.fails[loop] = 0

        if not db_ok:
            if not running and self.next_start.get(loop, 0) <= now and not self._someone_else(loop, st):
                self._start(loop, "database unreachable, starting the loop anyway; it keeps retrying the database")
            return "db-down"

        hb = _age(st.get("heartbeat"), now_utc)
        prog = _age(st.get("progressAt"), now_utc)
        prog = hb if prog is None else prog                    # an older loop version has no progressAt
        pid = st.get("pid")
        manual = bool(st.get("manualPause"))
        booting = running and now - self.started_at.get(loop, 0) < BOOT_GRACE

        if running:
            if booting and (hb is None or hb > DEAD_SECONDS):
                return "booting"
            if hb is None or hb > DEAD_SECONDS:
                self._say(loop, "frozen", f"no heartbeat for {int(hb) if hb is not None else '?'} s, restarting", "error")
                self._stop_child(loop)
                self.next_start[loop] = 0
                self._start(loop, "heartbeat stopped")
                return "restarted"
            if not manual and prog is not None and prog > self.stale_seconds:
                self._say(loop, "stuck", f"alive but no progress for {int(prog // 60)} min, restarting", "error")
                self._stop_child(loop)
                self.next_start[loop] = 0
                self._start(loop, "no progress")
                return "restarted"
            return "ok"

        # not our child. Is somebody else (another terminal, run.py) running a healthy one?
        if hb is not None and hb < FRESH_SECONDS and self.alive(pid):
            if not manual and prog is not None and prog > self.stale_seconds:
                self._say(loop, "stuck", f"a loop started elsewhere (pid {pid}) made no progress for {int(prog // 60)} min, restarting it", "error")
                self.kill(pid)
                self.next_start[loop] = 0
                self._start(loop, "replacing a stuck loop")
                return "restarted"
            return "ok-external"
        if hb is not None and hb < DEAD_SECONDS and self.alive(pid):
            return "ok-external"
        if hb is not None and hb >= DEAD_SECONDS and self.alive(pid):      # a process exists but has gone silent
            self._say(loop, "frozen", f"pid {pid} is silent for {int(hb)} s, restarting", "error")
            self.kill(pid)
        started = self._start(loop, "not running" if hb is None else f"no heartbeat for {int(hb)} s")
        return "started" if started else "waiting"

    def _someone_else(self, loop, st):
        return bool(st) and self.alive(st.get("pid")) and (_age(st.get("heartbeat"), self.utcnow()) or 9e9) < DEAD_SECONDS

    def step(self):
        return {loop: self.check(loop) for loop in self.loops}

    def stop_all(self):
        for loop in list(self.child):
            self._stop_child(loop)


# ------------------------------------------------------------------------- service
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=list(LOOPS), help="supervise just this loop")
    ap.add_argument("--once", action="store_true", help="look once and exit (for testing)")
    a = ap.parse_args()
    cfg = config.watchdog_settings()
    loops = [a.only] if a.only else list(LOOPS)

    from storage import get_storage
    from monitor import Monitor
    holder = {"db": None, "mon": None}

    def db():
        if holder["db"] is None:
            holder["db"] = get_storage().db
            holder["mon"] = Monitor(holder["db"])
            holder["mon"].state_id = "watchdog"
        return holder["db"]

    def read_state(loop):
        try:
            return db()["systemState"].find_one({"_id": LOOPS[loop]["state_id"]})
        except Exception:
            holder["db"] = None        # reconnect next time
            raise

    def emit(kind, msg, level="info", **d):
        try:
            db()
            holder["mon"].emit(kind, msg, level=level, **d)
        except Exception:  # noqa: BLE001
            holder["db"] = None

    sup = Supervisor(loops, read_state, emit=emit, stale_seconds=cfg["stale_seconds"])
    print(f"[watchdog] supervising {', '.join(loops)}; checking every {cfg['check_seconds']} s; "
          f"a loop with no progress for {cfg['stale_seconds'] // 60} min is restarted.")
    try:
        while True:
            res = sup.step()
            try:
                db()
                holder["mon"].set_state(state="running", loops=res, restarts=sup.restarts, recent=sup.history[-10:],
                                        checkEverySeconds=cfg["check_seconds"], staleSeconds=cfg["stale_seconds"])
            except Exception:  # noqa: BLE001
                holder["db"] = None
            if a.once:
                print(res)
                break
            time.sleep(cfg["check_seconds"])
    except KeyboardInterrupt:
        print("\n[watchdog] stopped; stopping the loops it started.")
    finally:
        sup.stop_all()


if __name__ == "__main__":
    main()
