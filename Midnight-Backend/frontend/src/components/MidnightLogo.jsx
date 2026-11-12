/** The Midnight mark, identical to the site: two thin red rings around a crescent moon with two stars. Red comes from --color-brand. */
export function MidnightLogo({ size = "h-7 w-7" }) {
  return (
    <span className={`relative grid shrink-0 place-items-center rounded-full text-brand ${size}`}>
      <svg viewBox="0 0 24 24" className="absolute inset-0 h-full w-full" fill="none" stroke="currentColor" aria-hidden>
        <circle cx="12" cy="12" r="11.2" strokeWidth="1" />
        <circle cx="12" cy="12" r="9.4" strokeWidth="1" />
      </svg>
      <svg viewBox="0 0 24 24" className="h-[54%] w-[54%]" fill="currentColor" aria-hidden>
        <path d="M14.5 2.5a9.5 9.5 0 1 0 7 15.9A8 8 0 0 1 14.5 2.5Z" />
        <circle cx="17.5" cy="6.5" r="1.1" />
        <circle cx="20.5" cy="10.5" r="0.7" />
      </svg>
    </span>
  );
}

/** Hidden SVG filter the .brand-wordmark class points at (gives the wordmark its inner outline). Render once at the app root. */
export const BrandWordmarkFilter = () => (
  <svg aria-hidden="true" width="0" height="0" style={{ position: "absolute" }}>
    <filter id="brand-inline" x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
      <feMorphology in="SourceAlpha" operator="erode" radius="1.4" result="outer" />
      <feMorphology in="SourceAlpha" operator="erode" radius="2.4" result="inner" />
      <feComposite in="outer" in2="inner" operator="out" result="line" />
      <feComposite in="SourceGraphic" in2="line" operator="out" />
    </filter>
  </svg>
);
