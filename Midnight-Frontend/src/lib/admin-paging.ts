/** Shared rules for loading admin lists in batches instead of all at once. */
import { z } from "zod";

export const PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

export const pageInput = z.object({
  offset: z.number().int().min(0).max(100_000).default(0),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(PAGE_SIZE),
  q: z.string().max(200).default(""),
  days: z.number().int().min(1).max(365).nullable().default(null),
});

export type Page<T> = { rows: T[]; total: number; nextOffset: number | null };

/** Builds one batch: where the next batch starts, or null when everything has been sent. */
export function toPage<T>(rows: T[], total: number, offset: number): Page<T> {
  const end = offset + rows.length;
  return { rows, total, nextOffset: rows.length > 0 && end < total ? end : null };
}

/** Cuts one batch out of an already filtered and sorted list. */
export function slicePage<T>(all: T[], offset: number, limit: number): Page<T> {
  return toPage(all.slice(offset, offset + limit), all.length, offset);
}

/** Escapes typed text so it is matched literally inside a database pattern. */
export function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function queryWords(q: string) {
  return q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
}

export function sinceDate(days: number | null, now = Date.now()) {
  return days == null ? null : new Date(now - days * 86_400_000);
}
