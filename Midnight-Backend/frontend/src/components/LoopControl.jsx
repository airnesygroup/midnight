import { useEffect, useState } from "react";
import { Pause, Play, RefreshCw } from "lucide-react";
import { post, until } from "../api.js";
import { Badge } from "./ui.jsx";

/** What the loop is doing, taking the user's Pause / Go live wish into account. */
export function loopStatus(g) {
  if (!g || !g.online) return "offline";
  if (g.state === "paused") return g.manualPause ? "manual" : "cooling";   // by you  |  out of credit
  if (g.desired === "paused") return "pausing";                           // asked to pause, finishing the current item
  if (g.state === "idle") return "idle";
  if (g.state === "stopped") return "stopped";
  return "running";
}

export function StateBadge({ g, idleText = "Idle · waiting for news" }) {
  switch (loopStatus(g)) {
    case "offline": return <Badge tone="bad">Offline</Badge>;
    case "manual": return <Badge tone="warn">Paused by you</Badge>;
    case "cooling": return <Badge tone="warn">Cooling down · auto-retry in {until(g.pausedUntil)}</Badge>;
    case "pausing": return <Badge tone="warn">Pausing · finishing the current one</Badge>;
    case "idle": return <Badge tone="brand">{idleText}</Badge>;
    case "stopped": return <Badge tone="bad">Stopped</Badge>;
    default: return <Badge tone="ok">Running</Badge>;
  }
}

/**
 * Pause / Go live for one loop ("news" | "trends"), backed by POST /api/control/:loop/pause|resume.
 *  - running            -> Pause
 *  - paused by you      -> Go live (also retries the keys immediately)
 *  - cooling down       -> Retry now (skips the wait, tries the keys again; goes back to cooling if still out of credit)
 *                          + Pause (hold it until you say otherwise)
 *  - offline            -> Go live (starts the process if it is not running)
 */
export function LoopControl({ loop, g }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [asked, setAsked] = useState(null);            // optimistic "paused" | "running" until the status poll agrees
  const status = loopStatus(g);

  useEffect(() => { if (asked && g?.desired === asked) setAsked(null); }, [g?.desired, asked]);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 9000); return () => clearTimeout(t); }, [note]);

  const call = async (action) => {
    setBusy(true); setNote(null);
    try {
      const r = await post(`/control/${loop}/${action}`);
      setAsked(action === "pause" ? "paused" : "running");
      if (action === "pause") setNote({ ok: true, text: "Pausing: it finishes the one it is writing, then stops." });
      else if (r.started) setNote({ ok: true, text: "It wasn't running, so it is starting now." });
      else setNote({ ok: true, text: "Retrying the keys now." });
    } catch (e) {
      setNote({ ok: false, text: `Couldn't reach the backend: ${e.message}` });
    } finally { setBusy(false); }
  };

  const wantsPause = (asked ?? g?.desired) === "paused";
  const showPause = !wantsPause && status !== "offline" && status !== "stopped";
  const goLabel = status === "cooling" ? "Retry now" : "Go live";
  const showGo = wantsPause || status === "cooling" || status === "offline" || status === "stopped";

  return (
    <>
      {note && <span className={`text-xs ${note.ok ? "text-muted-foreground" : "text-destructive"}`} role="status">{note.text}</span>}
      {showPause && (
        <button type="button" className="admin-btn" disabled={busy} onClick={() => call("pause")}><Pause />Pause</button>
      )}
      {showGo && (
        <button type="button" className="admin-btn" data-tone="primary" disabled={busy} onClick={() => call("resume")}>
          {status === "cooling" ? <RefreshCw /> : <Play />}{goLabel}
        </button>
      )}
    </>
  );
}
