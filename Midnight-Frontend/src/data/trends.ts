/*
 * Midnight Trends catalogue. Trends live in their own MongoDB "trends" collection
 * and are deliberately detached from the news catalogue: they never appear in
 * sections, the general search, or news article recommendations.
 */
import { slugify, type SectionSort } from "./news";

/** Every trend carries the full set of fields below; hashtags replace news sections/categories. */
export type Trend = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  excerpt: string;
  /** Loaded per trend on the detail page; empty in listings. */
  body: string[];
  /** One-minute recap shown in the Summary tab. */
  summary: string[];
  /** Trend grouping; completely separate from news sections and categories. */
  hashtags: string[];
  img: string;
  imageAlt: string;
  readingMinutes: number;
  time: string;
  publishedAt: string;
  updatedAt: string;
  /** Measured readership; null when not yet measured. */
  views: number | null;
  shares: number | null;
  /** Editorial importance 0–100 set by the newsroom. */
  headlineWeight: number;
  featured: boolean;
  sourceName: string | null;
  sourceUrl: string | null;
};

export let trends: Trend[] = [];
let bySlug = new Map<string, Trend>();

export function setTrends(list: Trend[]) {
  if (list === trends) return;
  trends = list;
  bySlug = new Map();
  for (const t of trends) { bySlug.set(t.slug, t); bySlug.set(slugify(t.title), t); }
}

export const getTrend = (slug: string) => bySlug.get(slug);
/** Display label for cards: the first hashtag. */
export const trendTag = (t: Trend) => t.hashtags[0] ?? "Trending";

const byNewest = (a: Trend, b: Trend) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.slug.localeCompare(b.slug);

/** Every hashtag in use, most-used first, then alphabetical. */
export function trendHashtags(): string[] {
  const counts = new Map<string, number>();
  for (const t of trends) for (const h of t.hashtags) counts.set(h, (counts.get(h) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([h]) => h);
}

export const trendsInHashtag = (hashtag: string) => {
  const h = hashtag.trim().toLowerCase();
  return trends.filter((t) => t.hashtags.some((x) => x.toLowerCase() === h)).sort(byNewest);
};

/** Same reader-facing sorts as news sections; trending = views per minute since publication. */
export function sortTrends(list: Trend[], sort: SectionSort, now = Date.now()): Trend[] {
  const perMinute = (t: Trend) => (t.views ?? 0) / Math.max(1, (now - Date.parse(t.publishedAt)) / 60_000);
  const value = (t: Trend) => sort === "popular" ? (t.views ?? 0) : sort === "trending" ? perMinute(t) : Date.parse(t.publishedAt);
  const dir = sort === "oldest" ? 1 : -1;
  return [...list].sort((a, b) => dir * (value(a) - value(b)) || a.slug.localeCompare(b.slug));
}

/** Trends-only search; the general news search never sees these. */
export const searchTrends = (q: string) => {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  return trends.filter((tr) => `${tr.title} ${tr.hashtags.join(" ")} ${tr.excerpt}`.toLowerCase().includes(t)).sort(byNewest);
};

export const relatedTrends = (trend: Trend) =>
  trends.filter((other) => other.slug !== trend.slug && other.hashtags.some((h) => trend.hashtags.includes(h))).sort(byNewest).slice(0, 4);

/** Community data (likes, saves, comments) is namespaced so a trend never shares counters with a news story. */
export const trendDiscussionSlug = (slug: string) => `trends--${slug}`;
export const TRENDS_DISCUSSION_PREFIX = "trends--";
