// Premium hamburger: three rounded lines of decreasing length (top longest). Shared by both headers.
export function PremiumMenuIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden className={className}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="9" y1="12" x2="21" y2="12" />
      <line x1="15" y1="18" x2="21" y2="18" />
    </svg>
  );
}
