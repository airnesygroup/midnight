import { Search, X } from "lucide-react";

/** Midnight's brand loader (same markup/classes as the Lovable app). */
export function Loader({ size = "md", label, className = "" }) {
  const sizes = { xs: ["1rem", "2px"], sm: ["1.9rem", "2.5px"], md: ["3rem", "3px"], lg: ["4.5rem", "3.5px"] };
  const [s, stroke] = sizes[size];
  const ring = (
    <span className="loader" data-size={size} style={{ "--loader-size": s, "--loader-stroke": stroke }} aria-hidden>
      <span className="loader-track" /><span className="loader-glow" /><span className="loader-ring" />
      <svg viewBox="0 0 24 24" className="loader-moon" fill="currentColor"><path d="M14.5 2.5a9.5 9.5 0 1 0 7 15.9A8 8 0 0 1 14.5 2.5Z" /></svg>
    </span>
  );
  if (size === "xs") return <span role="status" aria-label={label ?? "Loading"} className={`inline-flex ${className}`}>{ring}</span>;
  return (
    <span role="status" aria-label={label ?? "Loading"} className={`inline-flex flex-col items-center gap-3 ${className}`}>
      {ring}{label && <span className="loader-label">{label}</span>}
    </span>
  );
}

export const ColorGlow = () => <div aria-hidden className="header-glow"><div className="header-glow-color" /></div>;

export function PageTitle({ children, sub, right }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0"><h1 className="admin-title">{children}</h1>{sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}</div>
      {right && <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export const Stat = ({ label, value, glow, sub }) => (
  <div className="admin-card admin-hover admin-stat-card relative" style={glow ? { "--stat-glow": glow } : undefined}>
    <p className="admin-stat-label">{label}</p>
    <p className="admin-stat">{value ?? "—"}</p>
    {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
  </div>
);

export const Badge = ({ tone, children }) => <span className="admin-badge" data-tone={tone}>{children}</span>;

export function SearchBox({ value, onChange, placeholder }) {
  return (
    <label className="admin-search">
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {value && <button type="button" aria-label="Clear search" onClick={() => onChange("")}><X className="h-4 w-4 text-muted-foreground" /></button>}
    </label>
  );
}

export const Empty = ({ children }) => <div className="admin-empty">{children}</div>;
export const ErrorBox = ({ error }) => error ? <div className="admin-empty text-destructive">Can't reach the backend: {error.message}</div> : null;
