import { createServerFn } from "@tanstack/react-start";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

/** Public read of every published trend (without bodies). */
export const getTrends = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { loadTrends } = await import("./trends.server");
    return { trends: await loadTrends(), unavailable: false };
  } catch (e) {
    console.error("trends unavailable", e);
    return { trends: [], unavailable: true };
  }
});

export const getTrendBody = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ slug: z.string().min(1).max(300) }).parse(d))
  .handler(async ({ data }) => {
    try {
      const { loadTrendBody } = await import("./trends.server");
      return { body: await loadTrendBody(data.slug), unavailable: false };
    } catch (e) {
      console.error("trend body unavailable", e);
      return { body: null, unavailable: true };
    }
  });

export const trendsQuery = queryOptions({
  queryKey: ["trends"],
  queryFn: () => getTrends(),
  staleTime: 5 * 60_000,
});

export const trendBodyQuery = (slug: string) =>
  queryOptions({ queryKey: ["trend-body", slug], queryFn: () => getTrendBody({ data: { slug } }), staleTime: 10 * 60_000 });
