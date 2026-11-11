import type { Document } from "mongodb";
import { withDb } from "./community.server";
import { inSectionOf, latestOf, relatedOf, searchOf, slugify, topNewsOf, type Article, type Catalogue, type Section } from "@/data/news";
import { buildHome } from "./home-picks";

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : new Date(0).toISOString());

/** `slim` leaves out fields no listing page shows (summary, subtitle, source links), which shrinks the catalogue sent on every page. */
export function toArticle(d: Document, withBody = false, slim = false): Article {
  const readingMinutes = num(d["readingMinutes"]) ?? 3;
  return {
    id: str(d["id"], String(d["_id"])),
    slug: str(d["slug"]),
    title: str(d["title"]),
    subtitle: slim ? "" : str(d["subtitle"]),
    excerpt: str(d["excerpt"]),
    body: withBody ? strs(d["body"]) : [],
    summary: slim ? [] : strs(d["summary"]),
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
    sourceName: !slim && typeof d["source_name"] === "string" ? d["source_name"] : null,
    sourceUrl: !slim && typeof d["source_url"] === "string" ? d["source_url"] : null,
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

export type ArticleText = { body: string[]; summary: string[] };
const bodyCache = new Map<string, { at: number; value: ArticleText | null }>();

async function fetchCatalogue(): Promise<Catalogue> {
  return withDb(async (db) => {
    const [docs, secs] = await Promise.all([
      db.collection("articles").find(PUBLISHED, { projection: { body: 0, html_body: 0, hashtags: 0, summary: 0, subtitle: 0, source_url: 0, source_name: 0 } }).sort({ publishedAt: -1 }).limit(1000).toArray(),
      db.collection("sections").find({}, { projection: { slug: 1, name: 1, desc: 1, tags: 1 } }).toArray(),
    ]);
    const sections: Section[] = secs.map((s) => ({ slug: str(s["slug"]), name: str(s["name"]), desc: str(s["desc"]), tags: strs(s["tags"]) }));
    return { articles: docs.map((d) => toArticle(d, false, true)).filter((a) => a.slug && a.title), sections };
  });
}

export async function loadArticleBody(slug: string): Promise<ArticleText | null> {
  const hit = bodyCache.get(slug);
  if (hit && Date.now() - hit.at < MAX_STALE_MS) return hit.value;
  const value = await fetchArticleBody(slug);
  if (bodyCache.size > 500) bodyCache.clear();
  bodyCache.set(slug, { at: Date.now(), value });
  return value;
}

async function fetchArticleBody(slug: string): Promise<ArticleText | null> {
  return withDb(async (db) => {
    const d = await db.collection("articles").findOne({ ...PUBLISHED, slug }, { projection: { body: 1, summary: 1 } });
    return d ? { body: strs(d["body"]), summary: strs(d["summary"]) } : null;
  });
}

/*
 * Per-page reads. Each one runs the site's normal rules on the full in-memory catalogue and returns only
 * what that page will show, so a page never carries stories it does not display.
 */
let homeMemo: { src: Catalogue; value: Article[] } | null = null;

/** The home page's stories: exactly the ones buildHome() picks, nothing else. */
export async function loadHomeStories(): Promise<Article[]> {
  const c = await loadCatalogue();
  if (homeMemo?.src === c) return homeMemo.value;
  const seen = new Set<string>();
  const out: Article[] = [];
  for (const list of Object.values(buildHome(c.articles, c.sections))) {
    for (const a of list) if (!seen.has(a.slug)) { seen.add(a.slug); out.push(a); }
  }
  homeMemo = { src: c, value: out };
  return out;
}

export async function loadSectionStories(slug: string): Promise<Article[]> {
  const c = await loadCatalogue();
  return inSectionOf(c.articles, c.sections, slug);
}

const hasPhoto = (img: string) => /^(https?:)?\/\//.test(img) || img.startsWith("/");

export async function loadExplore() {
  const c = await loadCatalogue();
  const tiles = c.sections.map((s) => {
    const list = inSectionOf(c.articles, c.sections, s.slug);
    const img = list.find((a) => hasPhoto(a.img))?.img;
    return { slug: s.slug, count: list.length, ...(img ? { img } : {}) };
  });
  return { tiles, picks: topNewsOf(c.articles, 4) };
}

export async function searchStories(q: string, limit: number) {
  const c = await loadCatalogue();
  const found = searchOf(c.articles, q);
  return { results: found.slice(0, limit), total: found.length };
}

/** The story, its "keep reading" stories and the latest stories shown under it. Matches a slug or a headline slug. */
export async function loadArticleDetail(slug: string) {
  const c = await loadCatalogue();
  const article = c.articles.find((a) => a.slug === slug) ?? c.articles.find((a) => slugify(a.title) === slug) ?? null;
  if (!article) return null;
  const related = relatedOf(c.articles, c.sections, article);
  const seen = new Set([article.slug, ...related.map((r) => r.slug)]);
  const latest = latestOf(c.articles, 12).filter((r) => !seen.has(r.slug)).slice(0, 4);
  return { article, related, latest };
}

export async function loadStoriesBySlugs(slugs: readonly string[]): Promise<Article[]> {
  const c = await loadCatalogue();
  const want = new Set(slugs);
  return c.articles.filter((a) => want.has(a.slug));
}

/** Drops this isolate's cached catalogue and bodies so admin edits show on the next request. */
export function resetCatalogueCache() { cached = null; homeMemo = null; bodyCache.clear(); }
