/** Fixed purple header glow used on every page except articles. */
export function ColorGlow() {
  return (
    <div aria-hidden className="header-glow">
      <div className="header-glow-color" />
    </div>
  );
}
