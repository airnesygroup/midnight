"""
Remote control for the two loops (news = generate.py, trends = generate_trends.py).

The loops are separate processes from the API, so the only thing they share is
MongoDB. The dashboard writes a small document per loop into `systemControl`;
each loop reads it between steps:

    {_id: "news" | "trends",
     desired:  "running" | "paused",     # what the user wants
     retryNonce: int,                    # bumped by "Go live"; a loop that sees a new
                                         #   value ends its credit-cooldown NOW and retries
     updatedAt: iso}

  Pause    desired = "paused". The loop finishes the article it is writing (so the
           credits already spent are not wasted), then stops taking new work and
           waits. It stays paused until Go live, even if every key has credit.
  Go live  desired = "running" and retryNonce + 1. If the loop was waiting out the
           credit cooldown, that wait is cut short, the cooldowns are cleared and
           the keys are tried again straight away. If they are still out of credit
           the loop goes back to cooling down (a fresh timer), so a retry never
           loops hot.
"""

from schema import now_iso

LOOPS = ("news", "trends")
RUNNING, PAUSED = "running", "paused"


class Control:
    def __init__(self, db):
        self.col = db["systemControl"]

    def get(self, loop):
        d = self.col.find_one({"_id": loop}) or {}
        return {"desired": d.get("desired", RUNNING), "retryNonce": int(d.get("retryNonce", 0)),
                "updatedAt": d.get("updatedAt")}

    def pause(self, loop):
        self.col.update_one({"_id": loop}, {"$set": {"desired": PAUSED, "updatedAt": now_iso()}}, upsert=True)
        return self.get(loop)

    def resume(self, loop):
        """Go live: run again AND retry the keys right now."""
        self.col.update_one({"_id": loop}, {"$set": {"desired": RUNNING, "updatedAt": now_iso()},
                                            "$inc": {"retryNonce": 1}}, upsert=True)
        return self.get(loop)


class Watcher:
    """The loop's side. Cheap to poll; never raises (a DB hiccup must not stop publishing)."""

    def __init__(self, control, loop):
        self.control, self.loop = control, loop
        self._nonce = None
        self._last = {"desired": RUNNING, "retryNonce": 0}

    def _read(self):
        try:
            self._last = self.control.get(self.loop)
        except Exception:
            pass                       # keep the last known wish
        if self._nonce is None:
            self._nonce = self._last["retryNonce"]   # a Go live from before we started is not a new request
        return self._last

    def paused(self):
        return self._read()["desired"] == PAUSED

    def retry_requested(self):
        """True once per Go live click."""
        n = self._read()["retryNonce"]
        if n != self._nonce:
            self._nonce = n
            return True
        return False


class NullWatcher:
    def paused(self): return False
    def retry_requested(self): return False
