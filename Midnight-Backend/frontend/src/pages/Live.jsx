import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, ImageOff, KeyRound, Pause, PenLine, Play, Radio, RefreshCw, SkipForward, Globe, Moon } from "lucide-react";
import { api, usePoll, ago, fmt } from "../api.js";
import { Badge, Empty, ErrorBox, Loader, PageTitle, Stat } from "../components/ui.jsx";
import { LoopControl, StateBadge } from "../components/LoopControl.jsx";

const KIND = {
  published: [CheckCircle2, "ok"], failed: [AlertTriangle, "bad"], skipped: [SkipForward, "muted"],
  paused: [Pause, "warn"], resumed: [Play, "ok"], retry: [RefreshCw, "brand"], key_switch: [KeyRound, "brand"], key_cooldown: [KeyRound, "warn"],
  key_invalid: [KeyRound, "bad"], writing: [PenLine, "brand"], fetching: [Globe, "muted"], image_ok: [CheckCircle2, "muted"],
  report_published: [FileText, "ok"], report_writing: [FileText, "brand"], report_deferred: [FileText, "warn"], report_retry: [RefreshCw, "warn"],
  report_failed: [FileText, "bad"], run_start: [Radio, "brand"], run_end: [Radio, "muted"], idle: [Moon, "muted"], fatal: [AlertTriangle, "bad"],
};

function Feed() {
  const [events, setEvents] = useState([]);
  const [fresh, setFresh] = useState(new Set());
  const newest = useRef(null);
  const [error, setError] = useState(null);
  const [first, setFirst] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const rows = await api(`/events?limit=120${newest.current ? `&after=${newest.current}` : ""}`);
        if (!alive) return;
        setError(null); setFirst(false);
        if (rows.length) {
          newest.current = rows[0].id;
          setFresh(new Set(rows.map((r) => r.id)));
          setEvents((prev) => [...rows, ...prev].slice(0, 300));
        }
      } catch (e) { if (alive) setError(e); }
    };
    load();
    const t = setInterval(load, 2500);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div className="admin-card min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">What the system is doing</p>
        <span className="flex items-center gap-2 text-xs text-muted-foreground"><span className="pulse" /> live</span>
      </div>
      <ErrorBox error={error} />
      {first && !error && <div className="flex justify-center py-10"><Loader label="Loading activity" /></div>}
      {!first && !events.length && <Empty>No activity yet. Start the pipeline with <code>python run.py --live</code>.</Empty>}
      <div className="max-h-[34rem] overflow-y-auto pr-1">
        {events.map((e) => {
          const [Icon, tone] = KIND[e.kind] || [Radio, "muted"];
          return (
            <div key={e.id} className={`feed-row ${fresh.has(e.id) ? "feed-new" : ""}`}>
              <span className="feed-dot" data-tone={e.level === "error" ? "bad" : e.level === "warn" ? "warn" : tone}><Icon /></span>
              <p className="min-w-0 text-sm [overflow-wrap:anywhere]">{e.message}</p>
              <span className="shrink-0 text-xs text-muted-foreground" title={fmt(e.at)}>{ago(e.at)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Recent() {
  const { data } = usePoll(() => api("/posts?sort=created&limit=6"), 6000);
  return (
    <div className="admin-card min-w-0">
      <p className="mb-3 text-sm font-semibold">Latest finished articles</p>
      {!data && <Loader size="sm" />}
      {data && !data.items.length && <p className="text-sm text-muted-foreground">Nothing published yet.</p>}
      <div className="space-y-3">
        {data?.items.map((a) => (
          <a key={a.id} href="#articles" className="group flex items-center gap-3">
            <span className="admin-thumb h-14 w-20 shrink-0 bg-muted"><img src={a.img} alt="" loading="lazy" /></span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold">{a.title}</span>
              <span className="admin-meta"><span>{a.tag}</span><span>{a.source_name}</span><span>{ago(a.createdAt)}</span></span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function Live() {
  const { data, error } = usePoll(() => api("/status"), 3000);
  const g = data?.generator;
  const secs = data ? Object.entries(data.sections).sort((a, b) => b[1] - a[1]) : [];
  const max = Math.max(1, ...secs.map(([, n]) => n));
  return (
    <>
      <PageTitle sub={g?.currentSource ? `Now visiting ${g.currentSource}` : "Real-time view of the publishing pipeline"} right={<><StateBadge g={g} /><LoopControl loop="news" g={g} /></>}>
        Live activity
      </PageTitle>
      <ErrorBox error={error} />
      {g && !g.online && (
        <div className="admin-card flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="bad">Pipeline offline</Badge>
          No heartbeat{g.heartbeat ? ` since ${ago(g.heartbeat)}` : " yet"} (the status is stale, not necessarily the terminal). The watchdog restarts a stopped or frozen loop on its own within a minute or two; or press <b>Go live</b> to start it, or run <code className="rounded bg-muted px-1.5 py-0.5">python run.py --live</code>.
        </div>
      )}
      {g?.online && g.state === "paused" && (
        <div className="admin-card flex flex-wrap items-center gap-2 text-sm">
          {g.manualPause
            ? <><Badge tone="warn">Paused by you</Badge>Nothing new is started, even with credit left. Press <b>Go live</b> to continue; it will try the keys again straight away.</>
            : <><Badge tone="warn">Cooling down</Badge>{g.pauseReason}. It retries on its own at {fmt(g.pausedUntil)}, or press <b>Retry now</b>; if the keys are still out of credit it cools down again.</>}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-4">
        <Stat label="Articles live" value={data?.articles} glow="var(--glow-pink)" sub={g ? `${g.published ?? 0} this session` : undefined} />
        <Stat label="Skipped" value={data?.totals?.skipped ?? 0} glow="var(--glow-blue)" sub="duplicates · no image" />
        <Stat label="Failed" value={data?.totals?.failed ?? 0} glow="var(--glow-lilac)" sub="incomplete · API errors" />
        <Stat label="Midnight Reports" value={data?.reports} glow="var(--glow-pink)" sub={g?.nextReportAt ? `next due ${fmt(g.nextReportAt)}` : undefined} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2"><Feed /></div>
        <div className="min-w-0 space-y-4">
          <Recent />
          <div className="admin-card min-w-0">
            <p className="mb-3 text-sm font-semibold">Articles by section</p>
            {!secs.length && <p className="text-sm text-muted-foreground">No articles yet.</p>}
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {secs.map(([s, n]) => (
                <div key={s}>
                  <div className="flex justify-between gap-2 text-sm"><span className="truncate capitalize">{s.replace(/-/g, " ")}</span><span className="tabular-nums">{n}</span></div>
                  <div className="admin-bar-track mt-1.5"><div className="admin-bar" style={{ width: `${(n / max) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
