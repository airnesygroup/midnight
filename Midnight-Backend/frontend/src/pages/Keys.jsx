import { api, usePoll, until } from "../api.js";
import { Badge, Empty, ErrorBox, Loader, PageTitle } from "../components/ui.jsx";

const TONE = { ok: "ok", cooldown: "warn", invalid: "bad" };
const TEXT = { ok: "Available", cooldown: "Out of credit / rate-limited", invalid: "Rejected (invalid key)" };

export default function Keys() {
  const { data, error } = usePoll(() => api("/status"), 3000);
  const g = data?.generator;
  const keys = g?.keys || [];
  const maxUses = Math.max(1, ...keys.map((k) => k.uses));
  return (
    <>
      <PageTitle sub="Keys are used in order. One key (the one with the most credit left) is reserved for the Midnight Report and is never used for articles or trends. When every other key is out, the pipeline pauses for 15 minutes and tries again.">API keys</PageTitle>
      <ErrorBox error={error} />
      {!data && !error && <div className="flex justify-center py-16"><Loader label="Loading keys" /></div>}
      {data && !keys.length && <Empty>No key information yet. It appears once the pipeline is running.</Empty>}
      {g?.state === "paused" && !g.manualPause && g.pausedUntil && <div className="admin-card text-sm"><Badge tone="warn">All keys out</Badge> Cooling down until {new Date(g.pausedUntil).toLocaleTimeString()} ({until(g.pausedUntil)} left), then it retries. Use <b>Retry now</b> on the Live activity page to skip the wait.</div>}
      {g?.state === "paused" && g.manualPause && <div className="admin-card text-sm"><Badge tone="warn">Paused by you</Badge> The keys are not being used. Press <b>Go live</b> on the Live activity page to continue.</div>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {keys.map((k) => (
          <div key={k.label} className="admin-card admin-hover">
            <div className="flex items-center justify-between gap-2"><p className="font-bold">{k.label.split(" (")[0]}</p><span className="flex items-center gap-1.5">{k.reserved && <Badge tone="brand">Reserved for report</Badge>}<Badge tone={TONE[k.status]}>{k.status}</Badge></span></div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{k.label.match(/\((.*)\)/)?.[1]}</p>
            <p className="mt-3 text-sm">{TEXT[k.status]}</p>
            {k.status === "cooldown" && <p className="text-xs text-muted-foreground">Usable again in {Math.ceil(k.retryInSeconds / 60)} min</p>}
            {k.error && <p className="mt-1 text-xs text-muted-foreground">{k.error}</p>}
            <div className="mt-3 flex justify-between text-xs text-muted-foreground"><span>Tokens used, last 24h</span><span className="tabular-nums">{(k.tokens24h || 0).toLocaleString()}</span></div>
            <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>Requests this session</span><span className="tabular-nums">{k.uses}</span></div>
            <div className="admin-bar-track mt-1.5"><div className="admin-bar" style={{ width: `${(k.uses / maxUses) * 100}%` }} /></div>
          </div>
        ))}
      </div>
    </>
  );
}
