import { createServerFn } from "@tanstack/react-start";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import type { Trend } from "@/data/trends";

const cdn = async (sMaxAge: number, staleWhileRevalidate: number) => (await import("./cdn-cache.server")).cachePublic(sMaxAge, staleWhileRevalidate);

/** Public read of every published trend (without bodies). Same for every visitor, so the CDN may keep it. */
export const getTrends = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { loadTrends } = await import("./trends.server");
    const trends = await loadTrends();
    await cdn(300, 3600);
    return { trends, unavailable: false };
  } catch (e) {
    console.error("trends unavailable", e);
    return { trends: [] as Trend[], unavailable: true };
  }
});

/** One trend with its text, summary and related trends. */
export const getTrendDetail = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ slug: z.string().min(1).max(300) }).parse(d))
  .handler(async ({ data }) => {
    const none = { trend: null as Trend | null, related: [] as Trend[], body: null as string[] | null, summary: [] as string[] };
    let detail;
    try {
      const { loadTrendDetail } = await import("./trends.server");
      detail = await loadTrendDetail(data.slug);
    } catch (e) {
      console.error("trends unavailable", e);
      return { ...none, bodyUnavailable: true };
    }
    if (!detail) {
      await cdn(60, 300);
      return { ...none, bodyUnavailable: false };
    }
    try {
      const { loadTrendBody } = await import("./trends.server");
      const text = await loadTrendBody(detail.trend.slug);
      await cdn(300, 3600);
      return { ...detail, body: text?.body ?? null, summary: text?.summary ?? [], bodyUnavailable: false };
    } catch (e) {
      console.error("trend body unavailable", e);
      return { ...detail, body: null as string[] | null, summary: [] as string[], bodyUnavailable: true };
    }
  });

export const trendsQuery = queryOptions({
  queryKey: ["trends"],
  queryFn: () => getTrends(),
  staleTime: 5 * 60_000,
});

export const trendDetailQuery = (slug: string) =>
  queryOptions({ queryKey: ["trend-detail", slug], queryFn: () => getTrendDetail({ data: { slug } }), staleTime: 5 * 60_000 });
