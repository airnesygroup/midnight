/** Pure helpers behind the admin search, time and filter controls. */

export const MAX_DAYS = 365;
const DAY_MS = 86_400_000;

/** Turns what an admin typed ("27", " 3 ") into a whole number of days, capped at `max`; null when not a positive whole number. */
export function parseDays(input: string, max = MAX_DAYS): number | null {
  const t = input.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  if (n < 1) return null;
  return Math.min(n, max);
}

/** True when the date falls inside the last `days` days; `null` days means "all time". */
export function withinDays(iso: string | null | undefined, days: number | null, now = Date.now()): boolean {
  if (days == null) return true;
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t >= now - days * DAY_MS && t <= now + DAY_MS;
}

export function daysLabel(days: number | null): string {
  if (days == null) return "All time";
  if (days === 1) return "Last 24 hours";
  if (days === 365) return "Last year";
  return `Last ${days} days`;
}

/** Every word of the query must appear somewhere in the fields (case-insensitive). */
export function matchesQuery(fields: (string | null | undefined)[], query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

export const DAY_PRESETS = [1, 7, 14, 30, 90, 365] as const;
