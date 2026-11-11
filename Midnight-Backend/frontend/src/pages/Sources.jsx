import { useState } from "react";
import { api, usePoll, ago } from "../api.js";
import { Badge, ErrorBox, Loader, PageTitle, SearchBox, Stat } from "../components/ui.jsx";

export default function Sources() {
  const { data, error } = usePoll(() => api("/sources"), 8000);
  const [q, setQ] = useState("");
  const rows = (data || []).filter((s) => `${s.name} ${s.section} ${s.site}`.toLowerCase().includes(q.toLowerCase()));
  const sites = data ? new Set(data.map((s) => s.site)).size : null;
  const used = data ? data.filter((s) => s.published > 0).length : null;
  return (
    <>
      <PageTitle sub="One article per source, in turn. Never several in a row from the same site.">Sources</PageTitle>
      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-3">
        <Stat label="News sites" value={sites} glow="var(--glow-pink)" />
        <Stat label="Feeds" value={data?.length} glow="var(--glow-blue)" />
        <Stat label="Feeds that have published" value={used} glow="var(--glow-lilac)" />
      </div>
      <SearchBox value={q} onChange={setQ} placeholder="Search source or section…" />
      <ErrorBox error={error} />
      {!data && !error && <div className="flex justify-center py-16"><Loader label="Loading sources" /></div>}
      {data && (
        <div className="admin-card overflow-x-auto">
          <table className="admin-table">
            <thead><tr><th>Source</th><th>Section</th><th className="num">Published</th><th className="num">Skipped</th><th className="num">Failed</th><th>Last activity</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.name}>
                  <td className="font-bold">{s.name}</td>
                  <td><Badge tone="brand">{s.section.replace(/-/g, " ")}</Badge></td>
                  <td className="num">{s.published}</td><td className="num">{s.skipped}</td>
                  <td className="num">{s.failed ? <span className="text-destructive font-bold">{s.failed}</span> : 0}</td>
                  <td className="text-muted-foreground">{s.lastAt ? ago(s.lastAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
