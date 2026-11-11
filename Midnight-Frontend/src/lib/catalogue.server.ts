import type { Document } from "mongodb";
import { withDb } from "./community.server";
import type { Article, Catalogue, Section } from "@/data/news";

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : new Date(0).toISOString());

export function toArticle(d: Document, withBody = false): Article {
  const readingMinutes = num(d["readingMinutes"]) ?? 3;
  return {
    id: str(d["id"], String(d["_id"])),
    slug: str(d["slug"]),
    title: str(d["title"]),
    subtitle: str(d["subtitle"]),
    excerpt: str(d["excerpt"]),
    body: withBody ? strs(d["body"]) : [],
    summary: strs(d["summary"]),
    section: str(d["section"]),
    sections: strs(d["sections"]).length ? strs(d["sections"]).slice(0, 3) : [str(d["section"])],
    tag: str(d["tag"], str(d["category"])),
    desk: str(d["desk"]),
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

// Per-isolate cache: serve the catalogue from memory and refresh in the background,
// so pages never wait on a fresh database connection after the first request.
const FRESH_MS = 60_000;
const MAX_STALE_MS = 10 * 60_000;
let cached: { at: number; value: Catalogue } | null = null;
let inflight: Promise<Catalogue> | null = null;

function refreshCatalogue() {
  inflight ??= fetchCatalogue()
    .then((value) => { cached = { at: Date.now(), value }; return value; })
    .finally(() => { inflight = null; });
  return inflight;
}

export async function loadCatalogue(): Promise<Catalogue> {
  const age = cached ? Date.now() - cached.at : Infinity;
  if (cached && age < FRESH_MS) return cached.value;
  if (cached && age < MAX_STALE_MS) { refreshCatalogue().catch(() => {}); return cached.value; }
  return refreshCatalogue();
}

const bodyCache = new Map<string, { at: number; value: string[] | null }>();

async function fetchCatalogue(): Promise<Catalogue> {
  return withDb(async (db) => {
    const [docs, secs] = await Promise.all([
      db.collection("articles").find(PUBLISHED, { projection: { body: 0, html_body: 0, hashtags: 0 } }).sort({ publishedAt: -1 }).limit(1000).toArray(),
      db.collection("sections").find({}, { projection: { slug: 1, name: 1, desc: 1, tags: 1 } }).toArray(),
    ]);
    const sections: Section[] = secs.map((s) => ({ slug: str(s["slug"]), name: str(s["name"]), desc: str(s["desc"]), tags: strs(s["tags"]) }));
    return { articles: docs.map((d) => toArticle(d)).filter((a) => a.slug && a.title), sections };
  });
}

export async function loadArticleBody(slug: string): Promise<string[] | null> {
  const hit = bodyCache.get(slug);
  if (hit && Date.now() - hit.at < MAX_STALE_MS) return hit.value;
  const value = await fetchArticleBody(slug);
  if (bodyCache.size > 500) bodyCache.clear();
  bodyCache.set(slug, { at: Date.now(), value });
  return value;
}

async function fetchArticleBody(slug: string): Promise<string[] | null> {
  return withDb(async (db) => {
    const d = await db.collection("articles").findOne({ ...PUBLISHED, slug }, { projection: { body: 1 } });
    return d ? strs(d["body"]) : null;
  });
}

/** Drops this isolate's cached catalogue and bodies so admin edits show on the next request. */
export function resetCatalogueCache() { cached = null; bodyCache.clear(); }
