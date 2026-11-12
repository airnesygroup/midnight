import { recordPageView, recordReading } from "@/lib/page-views.functions";
import { timeSlice } from "./reader-analysis";

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
    window.dataLayer?.push(arguments);
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
  } catch { return crypto.randomUUID().replace(/-/g, ""); }
}

function device() {
  const w = window.innerWidth;
  return w < 640 ? "mobile" : w < 1024 ? "tablet" : "desktop";
}

let lastPath = "";
let stopReading: (() => void) | undefined;
let visitId: string | undefined;
let visitLastActivity = 0;
/** Records one visit per path change in our own stats and in Google Analytics. Admin pages are never counted. */
export function trackPageView(path: string) {
  if (typeof window === "undefined" || path === lastPath) return;
  stopReading?.();
  stopReading = undefined;
  if (path.startsWith("/admin")) { lastPath = path; return; }
  const ref = lastPath ? "" : document.referrer;
  lastPath = path;
  const slug = path.match(/^\/article\/([^/?#]+)/)?.[1] ?? null;
  let referrer: string | null = null;
  try { referrer = ref && new URL(ref).host !== location.host ? new URL(ref).host : null; } catch { /* ignore */ }
  if (!visitId || Date.now() - visitLastActivity > 30 * 60_000) visitId = crypto.randomUUID();
  visitLastActivity = Date.now();
  const pageId = crypto.randomUUID();
  let stopped = false, token: string | undefined, sequence = 0;
  let previous = performance.now(), lastActivity = previous;
  let visible = document.visibilityState === "visible", focused = document.hasFocus();
  let activeMs = 0, idleMs = 0, hiddenMs = 0, interactions = 0, scroll = 0;
  const sample = () => {
    const now = performance.now();
    const slice = timeSlice(previous, now, lastActivity, visible, focused);
    activeMs += slice.activeMs; idleMs += slice.idleMs; hiddenMs += slice.hiddenMs;
    previous = now;
  };
  const send = () => {
    sample();
    if (!token) return;
    const total = activeMs + idleMs + hiddenMs;
    const scale = total > 30_000 ? 30_000 / total : 1;
    void recordReading({ data: { pageId, token, sequence: ++sequence,
      activeMs: Math.floor(activeMs * scale), idleMs: Math.floor(idleMs * scale), hiddenMs: Math.floor(hiddenMs * scale),
      scroll, interactions: Math.min(1000, interactions),
    } }).catch(() => {});
    activeMs = 0; idleMs = 0; hiddenMs = 0; interactions = 0;
  };
  const activity = (e: Event) => {
    if (!e.isTrusted) return;
    sample(); lastActivity = performance.now(); visitLastActivity = Date.now();
    if (e.type !== "pointermove") interactions++;
    if (e.type === "scroll") {
      const article = document.querySelector(".article-body");
      const rect = article?.getBoundingClientRect();
      const fraction = rect ? (innerHeight - rect.top) / rect.height : (scrollY + innerHeight) / Math.max(1, document.documentElement.scrollHeight);
      scroll = Math.max(scroll, Math.min(100, Math.round(fraction * 100)));
    }
  };
  const visibility = () => { send(); visible = document.visibilityState === "visible"; focused = document.hasFocus(); };
  const focus = () => { sample(); focused = document.hasFocus(); };
  const events = ["pointermove", "pointerdown", "keydown", "scroll", "touchstart"];
  for (const event of events) window.addEventListener(event, activity, { passive: true });
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("focus", focus); window.addEventListener("blur", focus);
  window.addEventListener("pagehide", send);
  const timer = window.setInterval(send, 30_000); // 30 s (the server accepts up to 30 s per update): half the calls, same totals
  stopReading = () => {
    stopped = true; send(); clearInterval(timer);
    for (const event of events) window.removeEventListener(event, activity);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("focus", focus); window.removeEventListener("blur", focus); window.removeEventListener("pagehide", send);
  };
  void recordPageView({ data: {
    path: path.slice(0, 500), articleSlug: slug ? decodeURIComponent(slug).slice(0, 300) : null,
    referrer, visitorId: visitorId(), device: device(), pageId, sessionId: visitId, webdriver: navigator.webdriver === true,
  } }).then((r) => { token = r.token; if (stopped) send(); }).catch(() => {});
  if (window.gtag) window.gtag("event", "page_view", { page_path: path, page_location: location.href, page_title: document.title });
}
