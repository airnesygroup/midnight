import { useState } from "react";
import { api, usePoll, ago, fmt } from "../api.js";
import { Badge, Empty, ErrorBox, Loader, PageTitle, SearchBox, Stat } from "../components/ui.jsx";

const OUTCOMES = [
  { id: "", label: "All" },
  { id: "retrying", label: "Will retry" },
  { id: "abandoned", label: "Abandoned" },
  { id: "published", label: "Passed later" },
];
const TONE = { published: "ok", retrying: "warn", abandoned: "bad", queued: "muted" };
const NAME = { published: "Passed later", retrying: "Will retry", abandoned: "Abandoned", queued: "Waiting" };

function Row({ it }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="cursor-pointer" onClick={() => setOpen(!open)}>
        <td className="max-w-[28rem]">
          <div className="font-bold">{it.title || "(no title)"}</div>
          <div className="text-xs text-muted-foreground">{it.source}{it.section ? ` · ${it.section.replace(/-/g, " ")}` : ""}</div>
        </td>
        <td className="max-w-[24rem] text-sm">{it.reason || "—"}</td>
        <td className="num">{it.attempts}/{it.maxAttempts}</td>
        <td><Badge tone={TONE[it.outcome]}>{NAME[it.outcome] || it.outcome}</Badge></td>
        <td className="text-muted-foreground whitespace-nowrap">{it.lastAt ? ago(it.lastAt) : "—"}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5}>
            <div className="space-y-3 py-2 text-sm">
              <div className="font-semibold">{it.outcomeText}</div>
              {it.nextTryAt && it.outcome === "retrying" && <div>Next try: {fmt(it.nextTryAt)}</div>}
              {it.articleTitle && it.outcome === "published" && <div>Published as: {it.articleTitle}</div>}
              {it.url && <div><a className="underline" href={it.url} target="_blank" rel="noreferrer">Open the original story</a></div>}
              {it.snippet && <div className="text-muted-foreground">“{it.snippet}…”</div>}
              <div>
                <div className="font-semibold">Every reason, oldest first</div>
                <ul className="list-disc pl-5">
                  {it.reasons.length === 0 && <li>No reason recorded.</li>}
                  {it.reasons.map((r, i) => (
                    <li key={i}><span className="text-muted-foreground">{fmt(r.at)} · {r.kind}{r.attempt ? ` · try ${r.attempt}` : ""}:</span> {r.reason || "—"}</li>
                  ))}
                </ul>
              </div>
              <div className="text-muted-foreground">First seen {fmt(it.firstSeenAt)}</div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function Review({ kind }) {
  const [scope, setScope] = useState("articles");
  const [outcome, setOutcome] = useState("");
  const [q, setQ] = useState("");
  const qs = `scope=${scope}&outcome=${outcome}&search=${encodeURIComponent(q)}&limit=100`;
  const { data, error } = usePoll(() => api(`/review/${kind}?${qs}`), 10000, [kind, qs]);
  const c = data?.counts || {};
  const title = kind === "skipped" ? "Skipped" : "Failed";
  return (
    <>
      <PageTitle sub={kind === "skipped"
        ? "Stories we decided not to publish, with the reason and what finally happened to each."
        : "Stories we could not finish writing, with every reason and what finally happened to each."}>
        {title} {scope}
      </PageTitle>
      <div className="flex flex-wrap gap-2">
        {["articles", "trends"].map((s) => (
          <button key={s} type="button" className="admin-tab" data-active={scope === s} onClick={() => setScope(s)}>{s === "articles" ? "Articles" : "Trends"}</button>
        ))}
        <span className="mx-2" />
        {OUTCOMES.map((o) => (
          <button key={o.id} type="button" className="admin-tab" data-active={outcome === o.id} onClick={() => setOutcome(o.id)}>{o.label}</button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-3">
        <Stat label="Will be retried" value={c.retrying ?? 0} glow="var(--glow-blue)" />
        <Stat label="Abandoned for good" value={c.abandoned ?? 0} glow="var(--glow-pink)" />
        <Stat label="Passed later" value={c.published ?? 0} glow="var(--glow-lilac)" />
      </div>
      <SearchBox value={q} onChange={setQ} placeholder="Search title, source or reason…" />
      <ErrorBox error={error} />
      {!data && !error && <div className="flex justify-center py-16"><Loader label="Loading" /></div>}
      {data && data.items.length === 0 && <Empty>Nothing {kind} here.</Empty>}
      {data && data.items.length > 0 && (
        <div className="admin-card overflow-x-auto">
          <table className="admin-table">
            <thead><tr><th>Story</th><th>Reason</th><th className="num">Tries</th><th>Final outcome</th><th>Last</th></tr></thead>
            <tbody>{data.items.map((it, i) => <Row key={`${it.url}-${i}`} it={it} />)}</tbody>
          </table>
          <div className="p-3 text-xs text-muted-foreground">Showing {data.items.length} of {data.total}. Click a row for every reason.</div>
        </div>
      )}
    </>
  );
}
