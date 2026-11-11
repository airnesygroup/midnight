import { useEffect, useState } from "react";
import { api, usePoll, fmt, ago } from "../api.js";
import { Badge, Empty, ErrorBox, Loader, PageTitle } from "../components/ui.jsx";

function Newsletter({ date }) {
  const [r, setR] = useState(null);
  useEffect(() => { setR(null); api(`/reports/${date}`).then(setR).catch(() => setR(false)); }, [date]);
  if (r === null) return <div className="flex justify-center py-16"><Loader label="Opening report" /></div>;
  if (r === false) return <Empty>Couldn't load this edition.</Empty>;
  return (
    <article className="space-y-5">
      <div className="report-card report-gradient relative overflow-hidden rounded-[2rem] p-6 md:p-9">
        <div className="report-stars" aria-hidden>{Array.from({ length: 24 }).map((_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 100}%`, animationDelay: `${(i % 7) * 0.5}s` }} />)}</div>
        <p className="relative text-xs font-bold tracking-widest uppercase opacity-70">The Midnight Report · {r.date}</p>
        <h2 className="relative mt-2 font-serif text-4xl leading-tight md:text-5xl">{r.title}</h2>
        <p className="relative mt-3 max-w-2xl text-base opacity-85">{r.introduction}</p>
      </div>
      <div className="admin-card">
        <Badge tone="brand">Lead story</Badge>
        <h3 className="mt-2 font-serif text-3xl leading-tight">{r.leadTitle}</h3>
        <p className="mt-2 text-sm font-semibold text-muted-foreground">{r.leadExcerpt}</p>
        <div className="article-body mt-4">{r.leadParagraphs.map((p, i) => <p key={i}>{p}</p>)}</div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {r.sections.map((s, i) => (
          <div key={i} className="admin-card admin-hover">
            <Badge tone="brand">{s.tag}</Badge>
            <h4 className="mt-2 font-serif text-2xl leading-snug">{s.title}</h4>
            <div className="article-body mt-3 text-sm">{s.paragraphs.map((p, j) => <p key={j}>{p}</p>)}</div>
          </div>
        ))}
      </div>
      <div className="admin-card">
        <p className="admin-stat-label">The last word</p>
        <p className="mt-2 font-serif text-2xl leading-snug">{r.lastWord}</p>
      </div>
    </article>
  );
}

const TONE = { report_published: "ok", report_writing: "brand", report_deferred: "warn", report_retry: "warn", report_failed: "bad" };
const LABEL = { report_published: "Published", report_writing: "Writing", report_deferred: "Waiting", report_retry: "Retrying", report_failed: "Failed" };

/** Only the Midnight Report's own events: waiting for stories, writing, failed (with the reason), deferred, published. */
function ReportActivity() {
  const { data, error } = usePoll(() => api("/reports/events?limit=60"), 5000);
  const runs = usePoll(() => api("/reports/runs?limit=5"), 15000).data;
  const last = runs?.[0];
  return (
    <div className="admin-card min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Report activity</p>
        <span className="flex items-center gap-2 text-xs text-muted-foreground"><span className="pulse" /> live</span>
      </div>
      {last && (
        <p className="mb-3 text-xs text-muted-foreground">
          Last report: edition {last.date}, written {fmt(last.writtenAt)}
          {last.late ? <> · <Badge tone="warn">{`late by ${last.lateByMinutes} min`}</Badge></> : null}
          {" "}· covered {fmt(last.windowStart)} → {fmt(last.windowEnd)} ({last.articlesInWindow} articles)
        </p>
      )}
      <ErrorBox error={error} />
      {data && !data.length && <Empty>No report activity yet. It appears here as soon as the report is waiting, writing, fails or is published.</Empty>}
      <div className="max-h-[22rem] overflow-y-auto pr-1">
        {data?.map((e) => (
          <div key={e.id} className="feed-row">
            <Badge tone={TONE[e.kind]}>{LABEL[e.kind] || e.kind.replace("report_", "")}</Badge>
            <p className="min-w-0 text-sm [overflow-wrap:anywhere]">{e.message}</p>
            <span className="shrink-0 text-xs text-muted-foreground" title={fmt(e.at)}>{ago(e.at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Reports() {
  const { data, error } = usePoll(() => api("/reports"), 15000);
  const status = usePoll(() => api("/status"), 15000).data;
  const [sel, setSel] = useState(null);
  const date = sel || data?.[0]?.date;
  return (
    <>
      <PageTitle sub={status?.generator?.nextReportAt ? `Next report is written ${fmt(status.generator.nextReportAt)} and out by ${fmt(status.generator.nextReportEditionTime || status.generator.nextReportAt)} (fixed schedule, checked every hour)` : `A new report is written every day at 12:30 UTC and out by 13:00 UTC (fixed schedule, checked every hour)`}>
        Midnight Reports
      </PageTitle>
      <ErrorBox error={error} />
      <ReportActivity />
      {!data && !error && <div className="flex justify-center py-16"><Loader label="Loading reports" /></div>}
      {data && !data.length && <Empty>No report yet. The first one is written once 20 stories exist since the last report; it keeps only the important ones.</Empty>}
      {data?.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            {data.map((r) => (
              <button key={r.date} type="button" className="admin-btn" data-tone={r.date === date ? "primary" : undefined} onClick={() => setSel(r.date)}>{r.date}</button>
            ))}
          </div>
          {date && <Newsletter date={date} />}
        </>
      )}
    </>
  );
}
