import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, ExternalLink, Globe, KeyRound, Moon, Pause, PenLine, Play, Radio, RefreshCw, SkipForward, TrendingUp, X } from "lucide-react";
import { api, usePoll, ago, fmt } from "../api.js";
import { Badge, Empty, ErrorBox, Loader, PageTitle, SearchBox, Stat } from "../components/ui.jsx";
import { LoopControl, StateBadge } from "../components/LoopControl.jsx";

const PAGE = 20;
const KIND = {
  published: [CheckCircle2, "ok"], failed: [AlertTriangle, "bad"], skipped: [SkipForward, "muted"], paused: [Pause, "warn"],
  resumed: [Play, "ok"], retry: [RefreshCw, "brand"], key_switch: [KeyRound, "brand"], key_cooldown: [KeyRound, "warn"], key_invalid: [KeyRound, "bad"],
  writing: [PenLine, "brand"], fetching: [Globe, "muted"], image_ok: [CheckCircle2, "muted"], trends_read: [TrendingUp, "brand"],
  run_start: [Radio, "brand"], run_end: [Radio, "muted"], idle: [Moon, "muted"], fatal: [AlertTriangle, "bad"],
};
const STATUS_TONE = { published: "ok", seen: "brand", pending: "warn", skipped: "muted", failed: "bad" };

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
        const rows = await api(`/trends/events?limit=120${newest.current ? `&after=${newest.current}` : ""}`);
        if (!alive) return;
        setError(null); setFirst(false);
        if (rows.length) { newest.current = rows[0].id; setFresh(new Set(rows.map((r) => r.id))); setEvents((p) => [...rows, ...p].slice(0, 300)); }
      } catch (e) { if (alive) setError(e); }
    };
    load();
    const t = setInterval(load, 2500);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return (
    <div className="admin-card min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">What the trends loop is doing</p>
        <span className="flex items-center gap-2 text-xs text-muted-foreground"><span className="pulse" /> live</span>
      </div>
      <ErrorBox error={error} />
      {first && !error && <div className="flex justify-center py-10"><Loader label="Loading activity" /></div>}
      {!first && !events.length && <Empty>No activity yet. Start it with <code>python run.py --live</code> or <code>python generate_trends.py --forever</code>.</Empty>}
      <div className="max-h-[30rem] overflow-y-auto pr-1">
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

function Detail({ id, onClose }) {
  const [t, setT] = useState(null);
  useEffect(() => { api(`/trends/${id}`).then(setT).catch(() => setT(false)); }, [id]);
  return createPortal(
    <>
      <div className="admin-dialog-overlay" onClick={onClose} />
      <div className="admin-dialog glass-strong shadow-float !max-w-3xl !text-left" style={{ width: "min(46rem, calc(100vw - 2rem))" }} role="dialog" aria-modal="true">
        <button type="button" className="admin-icon-btn absolute top-3 right-3" aria-label="Close" onClick={onClose}><X className="h-5 w-5" /></button>
        {t === null && <div className="flex justify-center py-10"><Loader label="Opening trend" /></div>}
        {t === false && <p className="py-8 text-center text-destructive">Couldn't load this trend.</p>}
        {t && (
          <div>
            <div className="mb-3 flex flex-wrap gap-2">{t.hashtags.map((h) => <Badge key={h} tone="brand">#{h}</Badge>)}<Badge tone="ok">{t.status}</Badge></div>
            <h2 className="pr-10 font-serif text-3xl leading-tight">{t.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t.excerpt}</p>
            <div className="admin-meta mt-3"><span>{t.readingMinutes} min read</span><span>published {fmt(t.publishedAt)}</span><span>weight {t.headlineWeight}</span></div>
            <img src={t.img} alt={t.imageAlt} className="mt-4 max-h-80 w-full rounded-2xl object-cover" />
            <ul className="mt-4 space-y-1.5 rounded-2xl bg-muted/60 p-4 text-sm">
              {t.summary.map((s, i) => <li key={i} className="flex gap-2"><b className="text-accent">•</b>{s}</li>)}
            </ul>
            <div className="article-body mt-5 space-y-3 text-[0.95rem]">{t.body.map((p, i) => <p key={i}>{p}</p>)}</div>
            <div className="mt-5 rounded-2xl border border-border p-3 text-sm">
              <p className="admin-stat-label">Main source (stored in MongoDB)</p>
              <a className="mt-1 inline-flex items-center gap-1.5 font-bold underline-offset-2 hover:underline [overflow-wrap:anywhere]" href={t.source_url} target="_blank" rel="noreferrer">
                {t.source_name} <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
            </div>
          </div>
        )}
      </div>
    </>,
    document.body
  );
}

function Published() {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const { data: tags } = usePoll(() => api("/trends/hashtags"), 15000);
  const load = async (offset, query, hashtag, replace) => {
    setBusy(true);
    try {
      const r = await api(`/trends?sort=created&limit=${PAGE}&offset=${offset}&search=${encodeURIComponent(query)}&hashtag=${encodeURIComponent(hashtag)}`);
      setRows((p) => (replace ? r.items : [...p, ...r.items])); setTotal(r.total); setError(null);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  useEffect(() => { const t = setTimeout(() => load(0, q, tag, true), 250); return () => clearTimeout(t); }, [q, tag]);
  useEffect(() => { const t = setInterval(() => { if (!q && !tag && rows.length <= PAGE) load(0, "", "", true); }, 8000); return () => clearInterval(t); }, [q, tag, rows.length]);
  const list = tags ? Object.entries(tags).slice(0, 14) : [];
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">{total != null ? `${total} published trend${total === 1 ? "" : "s"}` : "Published trends"}</p>
      <SearchBox value={q} onChange={setQ} placeholder="Search title or hashtag…" />
      {!!list.length && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="admin-badge" data-tone={tag ? undefined : "brand"} onClick={() => setTag("")}>All</button>
          {list.map(([h, n]) => <button key={h} type="button" className="admin-badge" data-tone={tag === h ? "brand" : undefined} onClick={() => setTag(tag === h ? "" : h)}>#{h} · {n}</button>)}
        </div>
      )}
      <ErrorBox error={error} />
      {total === null && !error && <div className="flex justify-center py-12"><Loader label="Loading trends" /></div>}
      {total === 0 && <Empty>No trends match.</Empty>}
      {rows.map((t) => (
        <button key={t.id} type="button" onClick={() => setOpen(t.slug)} className="admin-row glass-card group block w-full text-left">
          <img src={t.img} alt="" aria-hidden loading="lazy" className="admin-row-spill" />
          <div className="admin-media-row">
            <span className="admin-thumb admin-media-thumb bg-muted"><img src={t.img} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.opacity = 0.15; }} /></span>
            <div className="min-w-0 col-span-1">
              <p className="truncate text-base font-bold">{t.title}</p>
              <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{t.excerpt}</p>
              <div className="admin-meta mt-1.5">
                {t.hashtags.slice(0, 3).map((h) => <Badge key={h} tone="brand">#{h}</Badge>)}<span>{t.source_name}</span><span>{t.readingMinutes} min</span><span title={fmt(t.createdAt)}>added {ago(t.createdAt)}</span>
              </div>
            </div>
          </div>
        </button>
      ))}
      {rows.length < (total ?? 0) && (
        <div className="flex justify-center py-2"><button type="button" className="admin-btn" disabled={busy} onClick={() => load(rows.length, q, tag, false)}>{busy ? <Loader size="xs" /> : "Load more"}</button></div>
      )}
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Ledger() {
  const [status, setStatus] = useState("");
  const { data, error } = usePoll(() => api(`/trends/ledger?limit=60${status ? `&status=${status}` : ""}`), 6000, [status]);
  return (
    <div className="admin-card min-w-0">
      <p className="mb-1 text-sm font-semibold">Every trend ever seen</p>
      <p className="mb-3 text-xs text-muted-foreground">Recorded the moment Google lists it, before anything is written. Nothing is written twice.</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {["", "seen", "pending", "published", "skipped"].map((s) => (
          <button key={s || "all"} type="button" className="admin-badge" data-tone={status === s ? "brand" : undefined} onClick={() => setStatus(s)}>{s || "all"}</button>
        ))}
      </div>
      <ErrorBox error={error} />
      {!data && !error && <Loader size="sm" />}
      {data && !data.length && <p className="text-sm text-muted-foreground">Nothing here yet.</p>}
      <div className="max-h-[30rem] space-y-2.5 overflow-y-auto pr-1">
        {data?.map((e) => (
          <div key={e.key} className="text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-bold">{e.query}</span>
              <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge>
            </div>
            <div className="admin-meta">
              <span>{e.trafficLabel || "—"}</span><span>{(e.geos || []).slice(0, 6).join(" ")}{(e.geos || []).length > 6 ? " …" : ""}</span>
              <span title={fmt(e.firstSeenAt)}>first seen {ago(e.firstSeenAt)}</span>{e.attempts ? <span>{e.attempts} tr{e.attempts === 1 ? "y" : "ies"}</span> : null}
            </div>
            {e.reason && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{e.reason}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Trends() {
  const { data, error } = usePoll(() => api("/trends/status"), 3000);
  const g = data?.generator;
  const t = data?.totals || {};
  const total = Object.values(t).reduce((a, b) => a + b, 0);
  return (
    <>
      <PageTitle sub={g?.currentTrend ? `Now writing about “${g.currentTrend}”` : "What's going viral around the world, from Google Trends"} right={<><StateBadge g={g} idleText="Idle · waiting for new trends" /><LoopControl loop="trends" g={g} /></>}>
        Midnight Trends
      </PageTitle>
      <ErrorBox error={error} />
      {g && !g.online && (
        <div className="admin-card flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="bad">Trends loop offline</Badge>
          No heartbeat{g.heartbeat ? ` since ${ago(g.heartbeat)}` : " yet"} (the status is stale, not necessarily the terminal). The watchdog restarts a stopped or frozen loop on its own within a minute or two; or press <b>Go live</b> to start it, or run <code className="rounded bg-muted px-1.5 py-0.5">python run.py --live</code> or <code className="rounded bg-muted px-1.5 py-0.5">python generate_trends.py --forever</code>.
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
        <Stat label="Trends live" value={data?.trends} glow="var(--glow-pink)" sub={g ? `${g.published ?? 0} this session` : undefined} />
        <Stat label="Waiting" value={(t.seen || 0) + (t.pending || 0)} glow="var(--glow-blue)" sub="seen · retrying later" />
        <Stat label="Skipped" value={t.skipped ?? 0} glow="var(--glow-lilac)" sub="duplicates · blocked · gave up" />
        <Stat label="Ever seen" value={data ? total : undefined} glow="var(--glow-pink)" sub={g?.geos ? `${g.geos} countries watched` : undefined} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2 space-y-4"><Feed /><Published /></div>
        <div className="min-w-0"><Ledger /></div>
      </div>
    </>
  );
}
