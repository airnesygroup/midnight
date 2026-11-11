import { recordPageView } from "@/lib/page-views.functions";

let gaInstalled = false;
/** Loads gtag.js once in the browser (call from useEffect). Page views are sent by trackPageView. */
export function installGoogleAnalytics(id: string) {
  if (typeof window === "undefined" || gaInstalled) return;
  gaInstalled = true;
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params -- gtag.js needs the Arguments object
    window.dataLayer!.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", id, { send_page_view: false });
  const path = location.pathname;
  if (!path.startsWith("/admin")) window.gtag("event", "page_view", { page_path: path, page_location: location.href, page_title: document.title });
}

declare global {
  interface Window { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void }
}

function visitorId() {
  try {
    let id = localStorage.getItem("mn_vid");
    if (!id) { id = crypto.randomUUID().replace(/-/g, ""); localStorage.setItem("mn_vid", id); }
    return id;
  } catch { return "anonymous0"; }
}

function device() {
  const w = window.innerWidth;
  return w < 640 ? "mobile" : w < 1024 ? "tablet" : "desktop";
}

let lastPath = "";
/** Records one visit per path change in our own stats and in Google Analytics. Admin pages are never counted. */
export function trackPageView(path: string) {
  if (typeof window === "undefined" || path === lastPath || path.startsWith("/admin")) return;
  const ref = lastPath ? "" : document.referrer;
  lastPath = path;
  const slug = path.match(/^\/article\/([^/?#]+)/)?.[1] ?? null;
  let referrer: string | null = null;
  try { referrer = ref && new URL(ref).host !== location.host ? new URL(ref).host : null; } catch { /* ignore */ }
  void recordPageView({ data: {
    path: path.slice(0, 500), articleSlug: slug ? decodeURIComponent(slug).slice(0, 300) : null,
    referrer, visitorId: visitorId(), device: device(),
  } }).catch(() => {});
  if (window.gtag) window.gtag("event", "page_view", { page_path: path, page_location: location.href, page_title: document.title });
}
