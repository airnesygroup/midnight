import { z } from "zod";
import { articleSchema, reportSchema, sectionSchema, infoPageSchema, placementSchema } from "./schemas";

/** Use current Midnight names/search fields, not legacy newest/viral or ID URLs. */
export const articleListParams = z.object({
  section: z.string().optional(), category: z.string().optional(), hashtag: z.string().optional(),
  q: z.string().optional(), sort: z.enum(["latest", "oldest", "popular", "trending"]).default("latest"),
  offset: z.number().int().nonnegative().default(0), limit: z.number().int().positive().optional(),
}).strict();
export const articleListResult = z.object({ items: z.array(articleSchema), total: z.number().int().nonnegative() }).strict();
export const homeResult = z.object({ articles: z.array(articleSchema), placements: z.array(placementSchema) }).strict();
export const reportDatesResult = z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

/** Implement only on the server once MongoDB connection credentials are available. */
export interface EditorialRepository {
  listArticles(input: z.input<typeof articleListParams>): Promise<z.infer<typeof articleListResult>>;
  articleBySlug(slug: string): Promise<z.infer<typeof articleSchema> | null>;
  listSections(): Promise<z.infer<typeof sectionSchema>[]>;
  home(): Promise<z.infer<typeof homeResult>>;
  reportByDate(editionDate: string): Promise<z.infer<typeof reportSchema> | null>;
  reportDates(): Promise<string[]>;
  infoPageBySlug(slug: string): Promise<z.infer<typeof infoPageSchema> | null>;
}
