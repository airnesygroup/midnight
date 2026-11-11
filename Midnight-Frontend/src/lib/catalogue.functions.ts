import { createServerFn } from "@tanstack/react-start";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import type { Article, Section } from "@/data/news";

/*
 * Pages load only the stories they show. Everything here is the same for every visitor, so the CDN may
 * keep each answer for a while (see cdn-cache.server.ts); per-visitor data never goes through these.
 */
const cdn = async (sMaxAge: number, staleWhileRevalidate: number) => (await import("./cdn-cache.server")).cachePublic(sMaxAge, staleWhileRevalidate);
const slugInput = z.object({ slug: z.string().min(1).max(300) });

/** Site-wide data: the section menu and the total story count. Tiny, so it rides along with every page. */
export const getSiteMeta = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { loadCatalogue } = await import("./catalogue.server");
    const c = await loadCatalogue();
    await cdn(300, 3600);
    return { sections: c.sections, storyCount: c.articles.length, unavailable: false };
  } catch (e) {
    console.error("catalogue unavailable", e);
    return { sections: [] as Section[], storyCount: 0, unavailable: true };
  }
});

/** The home page's stories only. */
export const getHomeStories = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { loadHomeStories } = await import("./catalogue.server");
    const stories = await loadHomeStories();
    await cdn(300, 3600);
    return { stories, unavailable: false };
  } catch (e) {
    console.error("home stories unavailable", e);
    return { stories: [] as Article[], unavailable: true };
  }
});

/** Every story in one section (the section page sorts and filters them itself). */
export const getSectionStories = createServerFn({ method: "GET" })
  .inputValidator((d) => slugInput.parse(d))
  .handler(async ({ data }) => {
    try {
      const { loadSectionStories } = await import("./catalogue.server");
      const stories = await loadSectionStories(data.slug);
      await cdn(300, 3600);
      return { stories, unavailable: false };
    } catch (e) {
      console.error("section stories unavailable", e);
      return { stories: [] as Article[], unavailable: true };
    }
  });

/** Explore page: one tile per section (photo + story count) and the editors' picks. */
export const getExplore = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { loadExplore } = await import("./catalogue.server");
    const explore = await loadExplore();
    await cdn(300, 3600);
    return { ...explore, unavailable: false };
  } catch (e) {
    console.error("explore unavailable", e);
    return { tiles: [] as { slug: string; count: number; img?: string }[], picks: [] as Article[], unavailable: true };
  }
});

/** Server-side search over every story; the browser never needs the whole catalogue to search it. */
export const searchStories = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ q: z.string().max(200), limit: z.number().int().min(1).max(300) }).parse(d))
  .handler(async ({ data }) => {
    try {
      const { searchStories: run } = await import("./catalogue.server");
      const found = await run(data.q, data.limit);
      await cdn(300, 3600);
      return { ...found, unavailable: false };
    } catch (e) {
      console.error("search unavailable", e);
      return { results: [] as Article[], total: 0, unavailable: true };
    }
  });

/** One story with its text, summary, "keep reading" stories and the latest stories shown under it. */
export const getArticleDetail = createServerFn({ method: "GET" })
  .inputValidator((d) => slugInput.parse(d))
  .handler(async ({ data }) => {
    const none = { article: null as Article | null, related: [] as Article[], latest: [] as Article[], body: null as string[] | null, summary: [] as string[] };
    let detail;
    try {
      const { loadArticleDetail } = await import("./catalogue.server");
      detail = await loadArticleDetail(data.slug);
    } catch (e) {
      console.error("catalogue unavailable", e);
      return { ...none, catalogueUnavailable: true, bodyUnavailable: true };
    }
    if (!detail) {
      await cdn(60, 300);
      return { ...none, catalogueUnavailable: false, bodyUnavailable: false };
    }
    try {
      const { loadArticleBody } = await import("./catalogue.server");
      const text = await loadArticleBody(detail.article.slug);
      await cdn(300, 3600);
      return { ...detail, body: text?.body ?? null, summary: text?.summary ?? [], catalogueUnavailable: false, bodyUnavailable: false };
    } catch (e) {
      console.error("article body unavailable", e);
      return { ...detail, body: null as string[] | null, summary: [] as string[], catalogueUnavailable: false, bodyUnavailable: true };
    }
  });

/** Signed-in profile page: the stories behind someone's saved, liked and commented items. Per-person, so never cached. */
export const getStoriesBySlugs = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ slugs: z.array(z.string().min(1).max(300)).max(600) }).parse(d))
  .handler(async ({ data }) => {
    try {
      const { loadStoriesBySlugs } = await import("./catalogue.server");
      return { stories: await loadStoriesBySlugs(data.slugs) };
    } catch (e) {
      console.error("stories unavailable", e);
      return { stories: [] as Article[] };
    }
  });

export const siteMetaQuery = queryOptions({ queryKey: ["site-meta"], queryFn: () => getSiteMeta(), staleTime: 5 * 60_000 });
export const homeQuery = queryOptions({ queryKey: ["home"], queryFn: () => getHomeStories(), staleTime: 60_000 });
export const exploreQuery = queryOptions({ queryKey: ["explore"], queryFn: () => getExplore(), staleTime: 60_000 });
export const sectionQuery = (slug: string) =>
  queryOptions({ queryKey: ["section", slug], queryFn: () => getSectionStories({ data: { slug } }), staleTime: 60_000 });
export const searchQuery = (q: string) =>
  queryOptions({ queryKey: ["search", q], queryFn: () => searchStories({ data: { q, limit: 200 } }), staleTime: 5 * 60_000 });
export const articleDetailQuery = (slug: string) =>
  queryOptions({ queryKey: ["article", slug], queryFn: () => getArticleDetail({ data: { slug } }), staleTime: 5 * 60_000 });
