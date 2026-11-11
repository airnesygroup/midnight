import type { Document } from "mongodb";
import { withDb } from "./community.server";
import type { Trend } from "@/data/trends";

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : new Date(0).toISOString());

export function toTrend(d: Document, withBody = false): Trend {
  const readingMinutes = num(d["readingMinutes"]) ?? 3;
  return {
    id: str(d["id"], String(d["_id"])),
    slug: str(d["slug"]),
    title: str(d["title"]),
    subtitle: str(d["subtitle"]),
    excerpt: str(d["excerpt"]),
    body: withBody ? strs(d["body"]) : [],
    summary: strs(d["summary"]),
    hashtags: strs(d["hashtags"]),
    img: str(d["img"]),
    imageAlt: str(d["imageAlt"], str(d["title"])),
    readingMinutes,
    time: str(d["time"], `${readingMinutes} min`),
    publishedAt: iso(d["publishedAt"] ?? d["createdAt"]),
    updatedAt: iso(d["updatedAt"] ?? d["publishedAt"]),
    views: num(d["views"]),
    shares: num(d["shares"]),
    headlineWeight: num(d["headlineWeight"]) ?? 0,
    featured: d["featured"] === true,
    sourceName: typeof d["source_name"] === "string" ? d["source_name"] : null,
    sourceUrl: typeof d["source_url"] === "string" ? d["source_url"] : null,
  };
}

const PUBLISHED = { status: "published" };

// Per-isolate cache, same stale-while-revalidate pattern as the news catalogue.
const FRESH_MS = 60_000;
const MAX_STALE_MS = 10 * 60_000;
let cached: { at: number; value: Trend[] } | null = null;
let inflight: Promise<Trend[]> | null = null;

function refreshTrends() {
  inflight ??= fetchTrends()
    .then((value) => { cached = { at: Date.now(), value }; return value; })
    .finally(() => { inflight = null; });
  return inflight;
}

export async function loadTrends(): Promise<Trend[]> {
  const age = cached ? Date.now() - cached.at : Infinity;
  if (cached && age < FRESH_MS) return cached.value;
  if (cached && age < MAX_STALE_MS) { refreshTrends().catch(() => {}); return cached.value; }
  return refreshTrends();
}

const bodyCache = new Map<string, { at: number; value: string[] | null }>();

async function fetchTrends(): Promise<Trend[]> {
  return withDb(async (db) => {
    const docs = await db.collection("trends").find(PUBLISHED, { projection: { body: 0, html_body: 0 } }).sort({ publishedAt: -1 }).limit(1000).toArray();
    return docs.map((d) => toTrend(d)).filter((t) => t.slug && t.title);
  });
}

export async function loadTrendBody(slug: string): Promise<string[] | null> {
  const hit = bodyCache.get(slug);
  if (hit && Date.now() - hit.at < MAX_STALE_MS) return hit.value;
  const value = await fetchTrendBody(slug);
  if (bodyCache.size > 500) bodyCache.clear();
  bodyCache.set(slug, { at: Date.now(), value });
  return value;
}

async function fetchTrendBody(slug: string): Promise<string[] | null> {
  return withDb(async (db) => {
    const d = await db.collection("trends").findOne({ ...PUBLISHED, slug }, { projection: { body: 1 } });
    return d ? strs(d["body"]) : null;
  });
}

/** Drops this isolate's cached trends and bodies so new generated trends show on the next request. */
export function resetTrendsCache() { cached = null; bodyCache.clear(); }
