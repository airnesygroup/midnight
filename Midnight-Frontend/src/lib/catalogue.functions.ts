import { createServerFn } from "@tanstack/react-start";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

/** Public read of every published article (without bodies) and all sections. */
export const getCatalogue = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { loadCatalogue } = await import("./catalogue.server");
    return { ...(await loadCatalogue()), unavailable: false };
  } catch (e) {
    console.error("catalogue unavailable", e);
    return { articles: [], sections: [], unavailable: true };
  }
});

export const getArticleBody = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ slug: z.string().min(1).max(300) }).parse(d))
  .handler(async ({ data }) => {
    try {
      const { loadArticleBody } = await import("./catalogue.server");
      return { body: await loadArticleBody(data.slug), unavailable: false };
    } catch (e) {
      console.error("article body unavailable", e);
      return { body: null, unavailable: true };
    }
  });

export const catalogueQuery = queryOptions({
  queryKey: ["catalogue"],
  queryFn: () => getCatalogue(),
  staleTime: 5 * 60_000,
});

export const articleBodyQuery = (slug: string) =>
  queryOptions({ queryKey: ["article-body", slug], queryFn: () => getArticleBody({ data: { slug } }), staleTime: 10 * 60_000 });
