import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({
  path: z.string().min(1).max(500).refine((p) => !p.startsWith("/admin")),
  articleSlug: z.string().max(300).nullable(),
  referrer: z.string().max(500).nullable(),
  visitorId: z.string().min(8).max(64),
  device: z.enum(["mobile", "tablet", "desktop"]).nullable(),
});

/** Public: one visit for the site's own statistics (stored in MongoDB). */
export const recordPageView = createServerFn({ method: "POST" })
  .inputValidator((d) => input.parse(d))
  .handler(async ({ data }) => {
    const { withDb } = await import("./community.server");
    await withDb((db) => db.collection("pageViews").insertOne({ ...data, createdAt: new Date() }));
    return { ok: true };
  });
