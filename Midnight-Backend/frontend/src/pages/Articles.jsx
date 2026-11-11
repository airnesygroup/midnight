import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, ImageOff, X } from "lucide-react";
import { api, ago, fmt } from "../api.js";
import { Badge, Empty, ErrorBox, Loader, PageTitle, SearchBox } from "../components/ui.jsx";

const PAGE = 20;

function Detail({ id, onClose }) {
  const [a, setA] = useState(null);
  useEffect(() => { api(`/posts/${id}`).then(setA).catch(() => setA(false)); }, [id]);
  // Portal to <body>: the page content is animated (transformed), which would otherwise break position:fixed.
  return createPortal(
    <>
      <div className="admin-dialog-overlay" onClick={onClose} />
      <div className="admin-dialog glass-strong shadow-float !max-w-3xl !text-left" style={{ width: "min(46rem, calc(100vw - 2rem))" }} role="dialog" aria-modal="true">
        <button type="button" className="admin-icon-btn absolute top-3 right-3" aria-label="Close" onClick={onClose}><X className="h-5 w-5" /></button>
        {a === null && <div className="flex justify-center py-10"><Loader label="Opening article" /></div>}
        {a === false && <p className="py-8 text-center text-destructive">Couldn't load this article.</p>}
        {a && (
          <div>
            <div className="mb-3 flex flex-wrap gap-2"><Badge tone="brand">{a.tag}</Badge><Badge tone="ok">{a.status}</Badge></div>
            <h2 className="pr-10 font-serif text-3xl leading-tight">{a.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{a.excerpt}</p>
            <div className="admin-meta mt-3">
              <span>{a.desk}</span><span>{a.readingMinutes} min read</span><span>published {fmt(a.publishedAt)}</span><span>voice: {a.voice}</span>
            </div>
            <img src={a.img} alt={a.imageAlt} className="mt-4 max-h-80 w-full rounded-2xl object-cover" />
            <ul className="mt-4 space-y-1.5 rounded-2xl bg-muted/60 p-4 text-sm">
              {a.summary.map((s, i) => <li key={i} className="flex gap-2"><b className="text-accent">•</b>{s}</li>)}
            </ul>
            <div className="article-body mt-5 text-[0.95rem]" dangerouslySetInnerHTML={{ __html: a.html_body }} />
            <div className="mt-4 flex flex-wrap gap-1.5">{a.hashtags.map((h) => <span key={h} className="admin-badge">{h}</span>)}</div>
            <div className="mt-5 rounded-2xl border border-border p-3 text-sm">
              <p className="admin-stat-label">Source (stored in MongoDB)</p>
              <a className="mt-1 inline-flex items-center gap-1.5 font-bold underline-offset-2 hover:underline [overflow-wrap:anywhere]" href={a.source_url} target="_blank" rel="noreferrer">
                {a.source_name} <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
              <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{a.source_url}</p>
            </div>
          </div>
        )}
      </div>
    </>,
    document.body
  );
}

export default function Articles() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);

  const load = async (offset, query, replace) => {
    setBusy(true);
    try {
      const r = await api(`/posts?sort=created&limit=${PAGE}&offset=${offset}&search=${encodeURIComponent(query)}`);
      setRows((p) => (replace ? r.items : [...p, ...r.items])); setTotal(r.total); setError(null);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  useEffect(() => { const t = setTimeout(() => load(0, q, true), 250); return () => clearTimeout(t); }, [q]);
  // pick up newly published articles while the page is open
  useEffect(() => { const t = setInterval(() => { if (!q && rows.length <= PAGE) load(0, "", true); }, 8000); return () => clearInterval(t); }, [q, rows.length]);

  return (
    <>
      <PageTitle sub={total != null ? `${total} finished article${total === 1 ? "" : "s"} in MongoDB` : "Everything the pipeline has published"}>Published articles</PageTitle>
      <SearchBox value={q} onChange={setQ} placeholder="Search title, section, source…" />
      <ErrorBox error={error} />
      {total === null && !error && <div className="flex justify-center py-16"><Loader label="Loading articles" /></div>}
      {total === 0 && <Empty>No articles match.</Empty>}
      <div className="space-y-3">
        {rows.map((a) => (
          <button key={a.id} type="button" onClick={() => setOpen(a.id)} className="admin-row glass-card group block w-full text-left">
            <img src={a.img} alt="" aria-hidden loading="lazy" className="admin-row-spill" />
            <div className="admin-media-row">
              <span className="admin-thumb admin-media-thumb bg-muted"><img src={a.img} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.opacity = 0.15; }} /></span>
              <div className="min-w-0 col-span-1">
                <p className="truncate text-base font-bold">{a.title}</p>
                <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{a.excerpt}</p>
                <div className="admin-meta mt-1.5">
                  <Badge tone="brand">{a.tag}</Badge><span>{a.source_name}</span><span>{a.readingMinutes} min</span><span title={fmt(a.createdAt)}>added {ago(a.createdAt)}</span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
      {rows.length < (total ?? 0) && (
        <div className="flex justify-center py-4">
          <button type="button" className="admin-btn" disabled={busy} onClick={() => load(rows.length, q, false)}>{busy ? <Loader size="xs" /> : "Load more"}</button>
        </div>
      )}
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
