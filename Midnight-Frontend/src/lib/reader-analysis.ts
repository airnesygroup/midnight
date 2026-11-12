import { z } from "zod";

export const IDLE_MS = 60_000;
export const periodInput = z.object({ days: z.number().int().min(1).max(365).nullable() });
export function periodBounds(days: number | null, now = new Date()) {
  return { ...(days === null ? {} : { $gte: new Date(now.getTime() - days * 86_400_000) }), $lte: now };
}
export function dateMatch(field: string, days: number | null, now = new Date()) {
  return { [field]: periodBounds(days, now) };
}
/** Supports the site's ISO article dates and BSON community dates without guessing absent dates. */
export function recordedDateMatch(field: string, days: number | null, now = new Date()) {
  if (days === null) return {};
  return { $expr: { $and: [
    { $gte: [{ $convert: { input: `$${field}`, to: "date", onError: null, onNull: null } }, new Date(now.getTime() - days * 86_400_000)] },
    { $lte: [{ $convert: { input: `$${field}`, to: "date", onError: null, onNull: null } }, now] },
  ] } };
}
export function timeSlice(from: number, to: number, lastActivity: number, visible: boolean, focused: boolean) {
  const elapsed = Math.max(0, Math.min(to - from, 30_000));
  if (!visible || !focused) return { activeMs: 0, idleMs: 0, hiddenMs: elapsed };
  const activeMs = Math.max(0, Math.min(elapsed, lastActivity + IDLE_MS - Math.max(from, to - elapsed)));
  return { activeMs, idleMs: elapsed - activeMs, hiddenMs: 0 };
}
export function estimatedBot(userAgent: string, webdriver: boolean) {
  return webdriver || /bot|crawler|spider|headless|selenium|playwright|puppeteer|curl|wget|python-requests/i.test(userAgent);
}
export function readerClass(bot: boolean, activeMs: number, interactions: number) {
  return bot ? "Likely bot" : activeMs >= 10_000 && interactions > 0 ? "Active reader" : "Unconfirmed / idle";
}
export const readingInput = z.object({
  pageId: z.string().uuid(), token: z.string().uuid(), sequence: z.number().int().min(1).max(100_000),
  activeMs: z.number().int().min(0).max(30_000), idleMs: z.number().int().min(0).max(30_000), hiddenMs: z.number().int().min(0).max(30_000),
  scroll: z.number().int().min(0).max(100), interactions: z.number().int().min(0).max(1000),
}).refine((d) => d.activeMs + d.idleMs + d.hiddenMs <= 30_000);
export type ReadingInput = z.infer<typeof readingInput>;