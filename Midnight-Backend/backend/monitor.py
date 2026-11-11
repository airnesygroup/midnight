"""
Live monitoring. The pipeline (a separate process from the API) writes what
it is doing to MongoDB, and the dashboard reads it:

  ingestEvents   one document per action (visit, skip, write, publish, fail,
                 key switch, pause, report...). Expires after 14 days.
  systemState    one document, _id "generator": current status, heartbeat,
                 key health, current source, counters.
"""

import os
import threading
from datetime import datetime, timezone, timedelta

from schema import now_iso

KEEP_DAYS = 14


BEAT_EVERY = 10        # seconds between heartbeats written by the background thread


class Monitor:
    state_id = "generator"

    def __init__(self, db):
        self.events = db["ingestEvents"]
        self.state = db["systemState"]
        self._lock = threading.Lock()
        self.progress_at = now_iso()      # last time the loop REALLY did something (an event, a state push)
        self._beat_thread = None
        self._stop_beat = threading.Event()
        self.db_errors = 0
        self.last_db_error = None
        try:
            self.events.create_index("at", name="event_expiry", expireAfterSeconds=KEEP_DAYS * 86400)
        except Exception:
            pass

    def touch(self):
        """The loop is alive and working. A hung loop stops calling this, a busy one keeps calling it."""
        self.progress_at = now_iso()

    def emit(self, kind, message, level="info", **data):
        self.touch()
        try:
            self.events.insert_one({"at": datetime.now(timezone.utc), "kind": kind, "level": level,
                                    "message": str(message)[:400], "data": data})
        except Exception:
            pass  # monitoring must never break publishing

    def _write(self, fields):
        try:
            with self._lock:
                self.state.update_one({"_id": self.state_id}, {"$set": fields}, upsert=True)
            return True
        except Exception as e:  # noqa: BLE001 - a database hiccup must never stop the loop; it is counted and shown
            self.db_errors += 1
            self.last_db_error = f"{type(e).__name__}: {str(e)[:120]}"
            return False

    def set_state(self, **fields):
        self.touch()
        fields["heartbeat"] = now_iso()
        fields["progressAt"] = self.progress_at
        fields["pid"] = os.getpid()
        fields["dbErrors"] = self.db_errors
        fields["lastDbError"] = self.last_db_error
        self._write(fields)

    def beat(self):
        """Heartbeat only. `heartbeat` = the process is alive; `progressAt` = it last did real work."""
        self._write({"heartbeat": now_iso(), "progressAt": self.progress_at, "pid": os.getpid(),
                     "dbErrors": self.db_errors, "lastDbError": self.last_db_error})

    def start_heartbeat(self, every=BEAT_EVERY):
        """A background thread that keeps the heartbeat fresh while the loop is busy (a long LLM call, a slow page,
        a Selenium fetch). Without it the dashboard said 'no heartbeat' whenever one article took a while.
        It is a daemon thread and stops with the process. `progressAt` is NOT touched here, so a loop that is
        really stuck still shows as stuck (and the watchdog restarts it)."""
        if self._beat_thread and self._beat_thread.is_alive():
            return
        self._stop_beat.clear()

        def loop():
            while not self._stop_beat.wait(every):
                try:
                    self.beat()
                except Exception:  # noqa: BLE001
                    pass
        self._beat_thread = threading.Thread(target=loop, name="heartbeat", daemon=True)
        self._beat_thread.start()

    def stop_heartbeat(self):
        self._stop_beat.set()

    def get_state(self):
        return self.state.find_one({"_id": self.state_id}) or {}

    def recent(self, after=None, limit=100, kind_prefix=None):
        q = {}
        if kind_prefix:
            q["kind"] = {"$regex": "^" + kind_prefix}
        if after:
            try:
                from bson import ObjectId
                q["_id"] = {"$gt": ObjectId(after)}
            except Exception:
                pass
        cur = self.events.find(q).sort("_id", -1).limit(min(limit, 500))
        out = []
        for e in cur:
            out.append({"id": str(e["_id"]), "at": e["at"].astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") +
                        f"{e['at'].microsecond // 1000:03d}Z" if e["at"].tzinfo else e["at"].isoformat() + "Z",
                        "kind": e["kind"], "level": e.get("level", "info"),
                        "message": e["message"], "data": e.get("data", {})})
        return out


class NullMonitor:
    def touch(self): pass
    def start_heartbeat(self, *a, **k): pass
    def stop_heartbeat(self): pass
    def emit(self, *a, **k): pass
    def set_state(self, **k): pass
    def get_state(self): return {}
    def recent(self, *a, **k): return []
