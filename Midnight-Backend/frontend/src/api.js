import { useEffect, useRef, useState } from "react";

export async function api(path) {
  const r = await fetch(`/api${path}`);
  if (!r.ok) {
    let detail = `${r.status}`;
    try { detail = (await r.json()).detail || detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return r.json();
}

export async function post(path) {
  const r = await fetch(`/api${path}`, { method: "POST" });
  if (!r.ok) {
    let detail = `${r.status}`;
    try { detail = (await r.json()).detail || detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return r.json();
}

/** Calls `fn` now and every `ms`; keeps the last good value if a refresh fails. */
export function usePoll(fn, ms, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try { const d = await ref.current(); if (alive) { setData(d); setError(null); } }
      catch (e) { if (alive) setError(e); }
    };
    tick();
    const t = setInterval(tick, ms);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);
  return { data, error };
}

export function ago(iso) {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

export function until(iso) {
  if (!iso) return "—";
  const s = Math.max(0, (new Date(iso).getTime() - Date.now()) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
