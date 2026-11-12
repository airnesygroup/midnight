import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequestHeader } from "@tanstack/react-start/server";
import { estimatedBot, readingInput } from "./reader-analysis";

const input = z.object({
  path: z.string().min(1).max(500).refine((p) => p.startsWith("/") && !p.startsWith("/admin") && !/[?#]/.test(p)),
  articleSlug: z.string().max(300).nullable(),
  referrer: z.string().max(500).nullable(),
  visitorId: z.string().min(8).max(64),
  device: z.enum(["mobile", "tablet", "desktop"]).nullable(),
  pageId: z.string().uuid(), sessionId: z.string().uuid(), webdriver: z.boolean(),
});

/** Public: one visit for the site's own statistics (stored in MongoDB). */
export const recordPageView = createServerFn({ method: "POST" })
  .inputValidator((d) => input.parse(d))
  .handler(async ({ data }) => {
    const { withDb } = await import("./community.server");
    const { sha256 } = await import("./password.server");
    const token = crypto.randomUUID();
    const tokenHash = await sha256(token);
    const bot = estimatedBot(getRequestHeader("user-agent") ?? "", data.webdriver);
    await withDb((db) => db.collection("pageViews").insertOne({ ...data, isBot: bot, createdAt: new Date() }));
    await withDb((db) => db.collection("readerPages").insertOne({
      _id: data.pageId as never, path: data.path, articleSlug: data.articleSlug, visitorId: data.visitorId, sessionId: data.sessionId,
      device: data.device, isBot: bot, tokenHash, createdAt: new Date(), lastSeenAt: new Date(),
      activeMs: 0, idleMs: 0, hiddenMs: 0, scroll: 0, interactions: 0, sequence: 0,
    }));
    return { ok: true, token };
  });

/** Updates only the anonymous page owned by this unguessable, server-issued capability. */
export const recordReading = createServerFn({ method: "POST" })
  .inputValidator((d) => readingInput.parse(d))
  .handler(async ({ data }) => {
    const { withDb } = await import("./community.server");
    const { sha256 } = await import("./password.server");
    const tokenHash = await sha256(data.token);
    await withDb(async (db) => {
      const col = db.collection("readerPages");
      const page = await col.findOne({ _id: data.pageId as never, tokenHash, sequence: { $lt: data.sequence }, createdAt: { $gte: new Date(Date.now() - 86_400_000) } });
      if (!page) return;
      const elapsed = Math.max(0, Date.now() - (page["lastSeenAt"] as Date).getTime());
      const claimed = data.activeMs + data.idleMs + data.hiddenMs;
      if (claimed > elapsed + 2000) return;
      await col.updateOne({ _id: page._id, sequence: page["sequence"] }, {
        $inc: { activeMs: data.activeMs, idleMs: data.idleMs, hiddenMs: data.hiddenMs, interactions: data.interactions },
        $max: { scroll: data.scroll }, $set: { sequence: data.sequence, lastSeenAt: new Date() },
      });
    });
    return { ok: true };
  });
