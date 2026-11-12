import { withDb } from "./community.server";
import { dateMatch } from "./reader-analysis";

type Visit = { _id: string; visitor: string; started: Date; ended: Date; pages: number; stories: string[]; activeMs: number; readingMs: number; idleMs: number; hiddenMs: number; interactions: number; scroll: number; bot: boolean; path: string[] };
const visitStages = [
  { $sort: { createdAt: 1 as const, _id: 1 as const } },
  { $group: { _id: "$sessionId", visitor: { $first: "$visitorId" }, started: { $min: "$createdAt" }, ended: { $max: "$lastSeenAt" }, pages: { $sum: 1 }, stories: { $addToSet: "$articleSlug" },
    activeMs: { $sum: "$activeMs" }, readingMs: { $sum: { $cond: [{ $ne: ["$articleSlug", null] }, "$activeMs", 0] } }, idleMs: { $sum: "$idleMs" }, hiddenMs: { $sum: "$hiddenMs" }, interactions: { $sum: "$interactions" }, scroll: { $max: "$scroll" }, bot: { $max: "$isBot" }, path: { $push: "$path" } } },
];
export async function readerAnalysis(days: number | null) {
  return withDb(async (db) => {
    const [result] = await db.collection("readerPages").aggregate<{
      totals: { visits: number; visitors: string[]; pages: number; activeMs: number; readingMs: number; idleMs: number; hiddenMs: number; active: number; bots: number; unconfirmed: number; single: number; multipleStories: number }[];
      recent: Visit[]; journeys: { _id: string[]; n: number }[]; depth: { _id: number; n: number }[];
    }>([
      { $match: dateMatch("createdAt", days) }, ...visitStages,
      { $set: { stories: { $filter: { input: "$stories", as: "s", cond: { $ne: ["$$s", null] } } } } },
      { $facet: {
        totals: [{ $group: { _id: null, visits: { $sum: 1 }, visitors: { $addToSet: "$visitor" }, pages: { $sum: "$pages" },
          activeMs: { $sum: { $cond: ["$bot", 0, "$activeMs"] } }, readingMs: { $sum: { $cond: ["$bot", 0, "$readingMs"] } }, idleMs: { $sum: { $cond: ["$bot", 0, "$idleMs"] } }, hiddenMs: { $sum: { $cond: ["$bot", 0, "$hiddenMs"] } },
          active: { $sum: { $cond: [{ $and: [{ $eq: ["$bot", false] }, { $gte: ["$activeMs", 10_000] }, { $gt: ["$interactions", 0] }] }, 1, 0] } },
          bots: { $sum: { $cond: ["$bot", 1, 0] } }, unconfirmed: { $sum: { $cond: [{ $and: [{ $eq: ["$bot", false] }, { $or: [{ $lt: ["$activeMs", 10_000] }, { $eq: ["$interactions", 0] }] }] }, 1, 0] } },
          single: { $sum: { $cond: [{ $and: [{ $eq: ["$bot", false] }, { $eq: ["$pages", 1] }] }, 1, 0] } }, multipleStories: { $sum: { $cond: [{ $and: [{ $eq: ["$bot", false] }, { $gte: [{ $size: "$stories" }, 2] }] }, 1, 0] } },
        } }],
        recent: [{ $sort: { started: -1 } }, { $limit: 50 }],
        journeys: [{ $match: { bot: false } }, { $group: { _id: { $slice: ["$path", 10] }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 15 }],
        depth: [{ $match: { bot: false } }, { $group: { _id: "$pages", n: { $sum: 1 } } }, { $sort: { _id: 1 } }],
      } },
    ]).toArray();
    const t = result?.totals[0];
    const tracked = await db.collection("readerPages").findOne({}, { sort: { createdAt: 1 }, projection: { createdAt: 1 } });
    return {
      since: tracked?.["createdAt"] instanceof Date ? tracked["createdAt"].toISOString() : null,
      visits: t?.visits ?? 0, visitors: t?.visitors.length ?? 0, pages: t?.pages ?? 0, active: t?.active ?? 0, bots: t?.bots ?? 0, unconfirmed: t?.unconfirmed ?? 0,
      activeMs: t?.activeMs ?? 0, readingMs: t?.readingMs ?? 0, idleMs: t?.idleMs ?? 0, hiddenMs: t?.hiddenMs ?? 0, single: t?.single ?? 0, multipleStories: t?.multipleStories ?? 0,
      journeys: (result?.journeys ?? []).map((j) => ({ path: j._id, visits: j.n })), depth: (result?.depth ?? []).map((d) => ({ pages: d._id, visits: d.n })),
      recent: (result?.recent ?? []).map((v) => ({ id: v._id.slice(0, 8), started: v.started.toISOString(), pages: v.pages, stories: v.stories.length, activeMs: v.activeMs, readingMs: v.readingMs, idleMs: v.idleMs, hiddenMs: v.hiddenMs, interactions: v.interactions, scroll: v.scroll, bot: v.bot, path: v.path.slice(0, 50), durationMs: Math.max(0, v.ended.getTime() - v.started.getTime()) })),
    };
  });
}