/** Midnight's one loading indicator: a brand-gradient ring orbiting the crescent moon. Used for every loading state. */
type Size = "xs" | "sm" | "md" | "lg";
const SIZES: Record<Size, { size: string; stroke: string }> = {
  xs: { size: "1rem", stroke: "2px" },
  sm: { size: "1.9rem", stroke: "2.5px" },
  md: { size: "3rem", stroke: "3px" },
  lg: { size: "4.5rem", stroke: "3.5px" },
};

export function Loader({ size = "md", label, className = "" }: { size?: Size; label?: string; className?: string }) {
  const s = SIZES[size];
  const ring = (
    <span className="loader" data-size={size} style={{ ["--loader-size" as string]: s.size, ["--loader-stroke" as string]: s.stroke }} aria-hidden>
      <span className="loader-track" />
      <span className="loader-glow" />
      <span className="loader-ring" />
      <svg viewBox="0 0 24 24" className="loader-moon" fill="currentColor">
        <path d="M14.5 2.5a9.5 9.5 0 1 0 7 15.9A8 8 0 0 1 14.5 2.5Z" />
      </svg>
    </span>
  );
  if (size === "xs") return <span role="status" aria-label={label ?? "Loading"} className={`inline-flex ${className}`}>{ring}</span>;
  return (
    <span role="status" aria-label={label ?? "Loading"} className={`inline-flex flex-col items-center gap-3 ${className}`}>
      {ring}
      {label && <span className="loader-label">{label}</span>}
    </span>
  );
}

/** Centred loader filling a content area (page or panel). */
export function LoaderBlock({ label = "Loading", className = "py-16", size = "md" }: { label?: string; className?: string; size?: Size }) {
  return <div className={`grid w-full place-items-center ${className}`}><Loader size={size} label={label} /></div>;
}

/** Whole-page pending state used by the router. */
export function PageLoader() {
  return (
    <main aria-busy="true" className="grid min-h-[70vh] w-full flex-1 place-items-center px-4 pt-28 pb-24">
      <Loader size="lg" label="Loading" />
    </main>
  );
}
