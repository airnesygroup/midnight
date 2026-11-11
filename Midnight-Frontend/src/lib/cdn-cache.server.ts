import { setResponseHeader } from "@tanstack/react-start/server";

/** Internal marker header: set by public server functions, read and removed by src/server.ts. */
export const CDN_TTL_HEADER = "x-cdn-ttl";

/**
 * Marks a PUBLIC server-function answer as safe for Vercel's CDN to keep, so repeat requests are served
 * at the edge without waking a function (no origin transfer, no CPU, no invocation).
 *
 * This only sets a marker. src/server.ts turns it into a real Cache-Control header, and only for browser
 * requests to /_serverFn. When the same function runs while a page is being rendered, the marker is
 * dropped, so it can never make a page (a profile, an admin screen, a redirect) publicly cacheable.
 * Only use it for data that is identical for every visitor, never for anything per-user.
 * Never throws: failing to set a header must not turn a good response into an error.
 */
export function cachePublic(sMaxAge: number, staleWhileRevalidate: number) {
  try {
    setResponseHeader(CDN_TTL_HEADER, `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`);
  } catch (e) {
    console.error("cachePublic: could not mark response as cacheable", e);
  }
}
