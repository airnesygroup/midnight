import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { escapeRegex, pageInput, queryWords, sinceDate, slicePage, toPage } from "./admin-paging";
import { articleBulkInput, articleEditFields, articleFilter, articleInput, articleListInput, selectedArticleFilter } from "./admin-articles";
import { publicationStatus } from "./mongodb/schemas";

const srv = () => import("./admin.server");
const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;

/* ---------- Session ---------- */

export const adminMe = createServerFn({ method: "GET" }).handler(async () => {
  const { currentAdmin } = await srv();
  const me = await currentAdmin();
  return me ? { id: me.id, username: me.username, email: me.email, role: me.role } : null;
});

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ login: z.string().trim().min(1).max(254), password: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { adminDb, ipHash, audit, createSession, accounts, auditLog, verifyPassword } = await srv();
    const since = new Date(Date.now() - LOCK_MINUTES * 60_000);
    const ip = await ipHash();
    const login = data.login.toLowerCase();
    const { count, acc } = await adminDb(async (db) => {
      const count = await auditLog(db).countDocuments({ action: "login_failed", ipHash: ip, createdAt: { $gte: since } });
      const found = await accounts(db).findOne({ $or: [{ usernameLower: login }, { email: login }], disabled: false });
      const acc = found && (await verifyPassword(data.password, found.passwordHash)) ? found : null;
      if (acc) await accounts(db).updateOne({ _id: acc._id }, { $set: { lastLoginAt: new Date() } });
      return { count, acc };
    });
    if (count >= MAX_FAILED_LOGINS) {
      return { ok: false as const, error: `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.` };
    }
    if (!acc) {
      await audit(null, "login_failed", { login: data.login.slice(0, 80) });
      return { ok: false as const, error: "Wrong username or password." };
    }
    await createSession(acc._id);
    await audit({ id: acc._id, username: acc.username }, "login");
    return { ok: true as const };
  });

export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  const { endSession, currentAdmin, audit } = await srv();
  const me = await currentAdmin();
  await endSession();
  if (me) await audit(me, "logout");
  return { ok: true };
});

/* ---------- Analytics ---------- */

type Stats = import("./admin.server").Stats;

export const adminStats = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ days: z.number().int().min(1).max(365), slug: z.string().max(300).nullable().optional() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin, viewStats } = await srv();
    await requireAdmin("editor");
    return viewStats(data.days, data.slug ?? null);
  });

export const adminOverview = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin, adminDb, loadSettings, viewStats, auditLog } = await srv();
  const me = await requireAdmin("editor");
  const { withDb } = await import("./community.server");
  const [stats, settings, failed, mongo, members] = await Promise.all([
    viewStats(30),
    loadSettings(),
    adminDb((db) => auditLog(db).countDocuments({ action: "login_failed", createdAt: { $gte: new Date(Date.now() - 86_400_000) } })),
    withDb(async (m) => {
      const [published, paused, comments, commentsToday, readers] = await Promise.all([
        m.collection("articles").countDocuments({ status: "published" }),
        m.collection("articles").countDocuments({ status: "paused" }),
        m.collection("communityComments").countDocuments({ deletedAt: null }),
        m.collection("communityComments").countDocuments({ createdAt: { $gte: new Date(Date.now() - 86_400_000) } }),
        m.collection("communityProfiles").countDocuments({}),
      ]);
      return { published, paused, comments, commentsToday, readers };
    }).catch(() => null),
    me.role === "admin" ? withDb((m) => m.collection("users").countDocuments({})).catch(() => null) : Promise.resolve(null),
  ]);
  return { stats, settings, failedLogins24h: failed, mongo, members };
});

export const adminCommunityTotals = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await srv();
  await requireAdmin("editor");
  const { withDb } = await import("./community.server");
  return withDb(async (m) => {
    const [published, paused, comments, replies, likes, saves, shares, commentLikes, readers] = await Promise.all([
      m.collection("articles").countDocuments({ status: { $ne: "paused" } }),
      m.collection("articles").countDocuments({ status: "paused" }),
      m.collection("communityComments").countDocuments({ deletedAt: null, parentId: null }),
      m.collection("communityComments").countDocuments({ deletedAt: null, parentId: { $ne: null } }),
      m.collection("communityInteractions").countDocuments({ kind: "like" }),
      m.collection("communityInteractions").countDocuments({ kind: "save" }),
      m.collection("communityShares").countDocuments({}),
      m.collection("communityCommentLikes").countDocuments({}),
      m.collection("communityProfiles").countDocuments({}),
    ]);
    return { published, paused, comments, replies, likes, saves, shares, commentLikes, readers };
  });
});

/* ---------- Articles (MongoDB) ---------- */

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

async function clearCaches() {
  const { resetCatalogueCache } = await import("./catalogue.server");
  resetCatalogueCache();
}

export const adminListArticles = createServerFn({ method: "GET" })
  .inputValidator((d) => articleListInput.parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin, viewStats } = await srv();
    await requireAdmin("editor");
    const { withDb } = await import("./community.server");
    const filter = articleFilter(data);
    const [{ docs, total, sections, sources }, stats] = await Promise.all([
      withDb(async (m) => {
        const col = m.collection("articles");
        const [docs, total, sections, sources] = await Promise.all([
          col.find(filter, { projection: { slug: 1, title: 1, section: 1, source_name: 1, status: 1, publishedAt: 1, featured: 1, img: 1 } }).sort({ publishedAt: -1, slug: 1 }).skip(data.offset).limit(data.limit).toArray(),
          col.countDocuments(filter),
          data.offset === 0 ? col.distinct("section") : Promise.resolve(null),
          data.offset === 0 ? col.distinct("source_name") : Promise.resolve(null),
        ]);
        return { docs, total, sections: sections ? (sections as unknown[]).filter((x): x is string => typeof x === "string" && !!x).sort() : null, sources: sources ? (sources as unknown[]).filter((x): x is string => typeof x === "string" && !!x).sort() : null };
      }),
      viewStats(365),
    ]);
    const views = new Map(stats.articles.map((a) => [a.slug, a]));
    const rows = docs.map((d) => ({
      slug: str(d["slug"]), title: str(d["title"]), section: str(d["section"]), status: str(d["status"]) || "published",
      source: str(d["source_name"]), featured: d["featured"] === true, img: str(d["img"]),
      publishedAt: d["publishedAt"] instanceof Date ? d["publishedAt"].toISOString() : str(d["publishedAt"]),
      views: views.get(str(d["slug"]))?.views ?? 0, visitors: views.get(str(d["slug"]))?.visitors ?? 0,
    }));
    return { ...toPage(rows, total, data.offset), sections, sources };
  });

export const adminGetArticle = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ slug: z.string().min(1).max(300) }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await srv();
    await requireAdmin("editor");
    const { withDb } = await import("./community.server");
    const d = await withDb((m) => m.collection("articles").findOne({ slug: data.slug }));
    if (!d) return null;
    return {
      slug: str(d["slug"]), title: str(d["title"]), subtitle: str(d["subtitle"]), excerpt: str(d["excerpt"]),
      body: strs(d["body"]), summary: strs(d["summary"]), section: str(d["section"]), tag: str(d["tag"]),
      img: str(d["img"]), imageAlt: str(d["imageAlt"]), featured: d["featured"] === true,
      headlineWeight: typeof d["headlineWeight"] === "number" ? d["headlineWeight"] : 0,
      status: str(d["status"]) || "published",
    };
  });

export const adminSaveArticle = createServerFn({ method: "POST" })
  .inputValidator((d) => articleInput.parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin, audit } = await srv();
    const me = await requireAdmin("editor");
    const { withDb } = await import("./community.server");
    const { slug } = data;
    const r = await withDb(async (m) => {
      const col = m.collection("articles");
      const prev = await col.findOne({ slug }, { projection: { section: 1, sections: 1, body: 1 } });
      if (!prev) return { matchedCount: 0 };
      return col.updateOne({ slug }, { $set: articleEditFields(data, { section: prev["section"], sections: prev["sections"], body: prev["body"] }) });
    });
    if (!r.matchedCount) throw new Error("That story no longer exists");
    await clearCaches();
    await audit(me, "article_edited", { slug });
    return { ok: true };
  });

export const adminSetArticleStatus = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ slug: z.string().min(1).max(300), status: z.enum(["published", "paused"]) }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin, audit } = await srv();
    const me = await requireAdmin("editor");
    const { withDb } = await import("./community.server");
    const r = await withDb((m) => m.collection("articles").updateOne({ slug: data.slug }, { $set: { status: data.status, updatedAt: new Date().toISOString() } }));
    if (!r.matchedCount) throw new Error("That story no longer exists");
    await clearCaches();
    await audit(me, data.status === "paused" ? "article_paused" : "article_published", { slug: data.slug });
    return { ok: true };
  });

export const adminBulkArticles = createServerFn({ method: "POST" })
  .inputValidator((d) => articleBulkInput.parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin, audit } = await srv();
    const me = await requireAdmin("editor");
    const { withDb } = await import("./community.server");
    const slugs = [...new Set(data.slugs)];
    const count = await withDb(async (m) => {
      const col = m.collection("articles");
      const filter = selectedArticleFilter(slugs);
      if (data.action === "delete") {
        return (await col.deleteMany(filter)).deletedCount;
      }
      const fields = data.action === "publish" || data.action === "pause"
        ? { status: publicationStatus.parse(data.action === "publish" ? "published" : "paused") }
        : { featured: data.action === "feature" };
      return (await col.updateMany(filter, { $set: { ...fields, updatedAt: new Date().toISOString() } })).matchedCount;
    });
    await clearCaches();
    await audit(me, data.action === "delete" ? "article_deleted" : data.action === "feature" || data.action === "unfeature" ? "article_featured_changed" : data.action === "pause" ? "article_paused" : "article_published", { slugs, count });
    return { ok: true, count };
  });

/* ---------- Comments ---------- */

/** Finds reader ids and story slugs whose name or title contains every typed word (comment text is encrypted, so it can't be searched). */
async function matchPeopleAndStories(m: import("mongodb").Db, q: string) {
  const words = queryWords(q);
  if (!words.length) return null;
  const all = (field: string) => ({ $and: words.map((w) => ({ [field]: { $regex: escapeRegex(w), $options: "i" } })) });
  const [people, stories] = await Promise.all([
    m.collection<{ _id: string }>("communityProfiles").find(all("username"), { projection: { _id: 1 } }).limit(500).toArray(),
    m.collection("articles").find({ $or: [all("title"), all("slug")] }, { projection: { slug: 1 } }).limit(500).toArray(),
  ]);
  return { userIds: people.map((p) => String(p._id)), slugs: stories.map((a) => str(a["slug"])) };
}

export const adminListComments = createServerFn({ method: "GET" })
  .inputValidator((d) => pageInput.extend({ kind: z.enum(["all", "comment", "reply"]).default("all"), story: z.string().max(300).default("all") }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await srv();
    await requireAdmin("editor");
    const { withDb, decrypt } = await import("./community.server");
    return withDb(async (m) => {
      const filter: Record<string, unknown> = { deletedAt: null };
      if (data.kind !== "all") filter["parentId"] = data.kind === "reply" ? { $ne: null } : null;
      if (data.story !== "all") filter["articleSlug"] = data.story;
      const since = sinceDate(data.days);
      if (since) filter["createdAt"] = { $gte: since };
      const match = await matchPeopleAndStories(m, data.q);
      if (match) filter["$or"] = [{ userId: { $in: match.userIds } }, { articleSlug: { $in: match.slugs } }];
      const col = m.collection("communityComments");
      const [raw, total, storySlugs] = await Promise.all([
        col.find(filter).sort({ createdAt: -1 }).skip(data.offset).limit(data.limit).toArray(),
        col.countDocuments(filter),
        data.offset === 0 ? col.distinct("articleSlug", { deletedAt: null }) : Promise.resolve(null),
      ]);
      const slugs = [...new Set([...raw.map((c) => str(c["articleSlug"])), ...((storySlugs as string[] | null) ?? [])])];
      const [profiles, arts] = await Promise.all([
        m.collection<{ _id: string; username: string }>("communityProfiles").find({ _id: { $in: [...new Set(raw.map((c) => String(c["userId"])))] } }).toArray(),
        m.collection("articles").find({ slug: { $in: slugs } }, { projection: { slug: 1, title: 1, img: 1 } }).toArray(),
      ]);
      const names = new Map(profiles.map((p) => [p._id, p.username]));
      const artMap = new Map(arts.map((a) => [str(a["slug"]), { title: str(a["title"]), img: str(a["img"]) }]));
      const rows = await Promise.all(raw.map(async (c) => ({
        id: String(c._id), articleSlug: str(c["articleSlug"]),
        articleTitle: artMap.get(str(c["articleSlug"]))?.title || str(c["articleSlug"]), img: artMap.get(str(c["articleSlug"]))?.img ?? "", text: await decrypt(c["textEnc"] as string | null),
        author: names.get(String(c["userId"])) ?? "former_reader", createdAt: (c["createdAt"] as Date).toISOString(), isReply: !!c["parentId"],
      })));
      const stories = storySlugs ? (storySlugs as string[]).map((slug) => ({ value: slug, label: artMap.get(slug)?.title || slug })).sort((a, b) => a.label.localeCompare(b.label)) : null;
      return { ...toPage(rows, total, data.offset), stories };
    });
  });

export const adminRemoveComment = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin, audit } = await srv();
    const me = await requireAdmin("editor");
    const { withDb } = await import("./community.server");
    const { ObjectId } = await import("mongodb");
    await withDb((m) => m.collection("communityComments").updateOne({ _id: new ObjectId(data.id) }, { $set: { deletedAt: new Date(), textEnc: null } }));
    const { clearDiscussionCache } = await import("./community.functions");
    clearDiscussionCache();
    await audit(me, "comment_removed", { id: data.id });
    return { ok: true };
  });

/* ---------- Readers (MongoDB profiles joined with sign-in accounts) ---------- */

export type ReaderRow = {
  id: string; username: string; email: string; joinedAt: string; lastSignIn: string | null;
  comments: number; replies: number; likes: number; saves: number; likesReceived: number; account: "active" | "blocked" | "not_moved";
};

/** Every reader with their counts, kept for one minute per server so scrolling through batches doesn't recount everything. */
let readerCache: { at: number; rows: Promise<ReaderRow[]> } | null = null;
export function clearReaderCache() { readerCache = null; }
function allReaders() {
  if (!readerCache || Date.now() - readerCache.at > 60_000) {
    const rows = loadAllReaders();
    readerCache = { at: Date.now(), rows };
    rows.catch(() => { readerCache = null; });
  }
  return readerCache.rows;
}

async function loadAllReaders(): Promise<ReaderRow[]> {
  const { withDb, decrypt } = await import("./community.server");
  type Agg = { _id: string; n: number };
  const [profiles, counts, replyCounts, inter, received] = await withDb(async (m) => Promise.all([
    m.collection<{ _id: string; username: string; createdAt: Date }>("communityProfiles").find({}, { projection: { username: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(10000).toArray(),
    m.collection("communityComments").aggregate<Agg>([{ $match: { deletedAt: null, parentId: null } }, { $group: { _id: "$userId", n: { $sum: 1 } } }]).toArray(),
    m.collection("communityComments").aggregate<Agg>([{ $match: { deletedAt: null, parentId: { $ne: null } } }, { $group: { _id: "$userId", n: { $sum: 1 } } }]).toArray(),
    m.collection("communityInteractions").aggregate<{ _id: { u: string; k: string }; n: number }>([{ $group: { _id: { u: "$userId", k: "$kind" }, n: { $sum: 1 } } }]).toArray(),
    m.collection("communityCommentLikes").aggregate<Agg>([{ $group: { _id: "$authorId", n: { $sum: 1 } } }]).toArray(),
  ]));
  const map = (a: Agg[]) => new Map(a.map((c) => [String(c._id), c.n]));
  const rc = map(replyCounts), rec = map(received);
  const likeM = new Map<string, number>(), saveM = new Map<string, number>();
  for (const i of inter) (i._id.k === "like" ? likeM : i._id.k === "save" ? saveM : new Map()).set(String(i._id.u), i.n);
  const extra = (id: string) => ({ replies: rc.get(id) ?? 0, likes: likeM.get(id) ?? 0, saves: saveM.get(id) ?? 0, likesReceived: rec.get(id) ?? 0 });
  const users = new Map<string, { email: string; created: string; last: string | null; banned: boolean; username: string }>();
  const accounts = await withDb((m) => m.collection<import("./auth.server").UserDoc>("users").find({}, { projection: { passwordHash: 0 } }).limit(20000).toArray());
  for (const u of accounts) {
    users.set(u._id, { email: await decrypt(u.emailEnc), created: u.createdAt.toISOString(), last: u.lastSignInAt ? u.lastSignInAt.toISOString() : null, banned: !!u.blocked, username: u.username });
  }
  const n = new Map(counts.map((c) => [String(c._id), c.n]));
  const rows: ReaderRow[] = profiles.map((p) => {
    const u = users.get(String(p._id));
    users.delete(String(p._id));
    return {
      id: String(p._id), username: p.username, email: u?.email ?? "", joinedAt: (p.createdAt instanceof Date ? p.createdAt : new Date()).toISOString(),
      lastSignIn: u?.last ?? null, comments: n.get(String(p._id)) ?? 0, ...extra(String(p._id)), account: !u ? "not_moved" : u.banned ? "blocked" : "active",
    };
  });
  // Accounts that signed up but never opened their profile yet.
  for (const [id, u] of users) rows.push({ id, username: u.username || u.email.split("@")[0] || "reader", email: u.email, joinedAt: u.created, lastSignIn: u.last, comments: 0, ...extra(id), account: u.banned ? "blocked" : "active" });
  return rows;
}

export const adminListReaders = createServerFn({ method: "GET" })
  .inputValidator((d) => pageInput.extend({
    account: z.enum(["all", "active", "blocked", "not_moved"]).default("all"),
    activity: z.enum(["all", "commented", "silent"]).default("all"),
    sort: z.enum(["newest", "oldest", "active", "comments", "replies", "likes", "saves", "likesReceived"]).default("newest"),
    fresh: z.boolean().default(false),
  }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await srv();
    await requireAdmin("admin");
    if (data.fresh && data.offset === 0) clearReaderCache();
    const all = await allReaders();
    const since = sinceDate(data.days);
    const words = queryWords(data.q);
    const sort = data.sort;
    const rows = all.filter((u) => {
      const hay = `${u.username} ${u.email}`.toLowerCase();
      return words.every((w) => hay.includes(w)) && (!since || Date.parse(u.joinedAt) >= since.getTime()) &&
        (data.account === "all" || u.account === data.account) && (data.activity === "all" || (data.activity === "commented") === (u.comments + u.replies) > 0);
    }).sort((a, b) => sort === "newest" ? b.joinedAt.localeCompare(a.joinedAt) : sort === "oldest" ? a.joinedAt.localeCompare(b.joinedAt) : sort === "active" ? (b.lastSignIn ?? "").localeCompare(a.lastSignIn ?? "") : b[sort] - a[sort]);
    return { ...slicePage(rows, data.offset, data.limit), everyone: all.length, notMoved: all.filter((u) => u.account === "not_moved").length };
  });

export const adminSetMemberBlocked = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid(), blocked: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin, audit } = await srv();
    const me = await requireAdmin("admin");
    const { authDb, users, userSessions } = await import("./auth.server");
    const r = await authDb(async (db) => {
      const r = await users(db).updateOne({ _id: data.id }, { $set: { blocked: data.blocked } });
      if (data.blocked) await userSessions(db).deleteMany({ userId: data.id });
      return r;
    });
    if (!r.matchedCount) throw new Error("This reader has no sign-in account");
    clearReaderCache();
    await audit(me, data.blocked ? "member_blocked" : "member_unblocked", { id: data.id });
    return { ok: true };
  });

export const adminDeleteMember = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin, audit } = await srv();
    const me = await requireAdmin("admin");
    const { withDb } = await import("./community.server");
    await withDb((m) => Promise.all([
      m.collection("users").deleteOne({ _id: data.id as never }),
      m.collection("userSessions").deleteMany({ userId: data.id }),
      m.collection("communityProfiles").deleteOne({ _id: data.id as never }),
    ]));
    clearReaderCache();
    await audit(me, "member_deleted", { id: data.id });
    return { ok: true };
  });

/* ---------- Security & site controls ---------- */

export const adminSecurity = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin, adminDb, loadSettings, sessions: sessCol, accounts } = await srv();
  const me = await requireAdmin("admin");
  const [settings, sessions] = await Promise.all([
    loadSettings(),
    adminDb(async (db) => {
      const list = await sessCol(db).find({ revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastSeenAt: -1 }).limit(50).toArray();
      const names = new Map((await accounts(db).find({ _id: { $in: [...new Set(list.map((s) => s.accountId))] } }, { projection: { username: 1 } }).toArray()).map((a) => [a._id, a.username]));
      return list.map((s) => ({ id: s._id, created_at: s.createdAt.toISOString(), last_seen_at: s.lastSeenAt.toISOString(), expires_at: s.expiresAt.toISOString(), user_agent: s.userAgent, admin_accounts: { username: names.get(s.accountId) ?? "removed" } }));
    }),
  ]);
  return {
    settings,
    currentSessionId: me.sessionId,
    sessions: sessions.map((s) => ({ id: s.id, createdAt: s.created_at, lastSeen: s.last_seen_at, expires: s.expires_at, device: s.user_agent ?? "", username: (s.admin_accounts as unknown as { username: string }).username })),
  };
});

/* ---------- Activity: what the team did, and what readers did ---------- */

export const ADMIN_ACTIONS = [
  "login", "login_failed", "logout", "article_edited", "article_paused", "article_published", "article_deleted", "article_featured_changed", "comment_removed",
  "member_blocked", "member_unblocked", "member_deleted", "settings_changed", "session_revoked", "all_sessions_revoked",
  "editor_added", "editor_updated", "editor_removed", "account_updated",
] as const;

export const adminActivityLog = createServerFn({ method: "GET" })
  .inputValidator((d) => pageInput.extend({ who: z.string().max(100).default("all"), action: z.string().max(60).default("all") }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin, adminDb, auditLog, accounts } = await srv();
    await requireAdmin("admin");
    const and: Record<string, unknown>[] = [];
    const since = sinceDate(data.days);
    if (since) and.push({ createdAt: { $gte: since } });
    if (data.who !== "all") and.push({ username: data.who === "—" ? null : data.who });
    if (data.action !== "all") and.push({ action: data.action });
    for (const w of queryWords(data.q)) { const rx = { $regex: escapeRegex(w), $options: "i" }; and.push({ $or: [{ username: rx }, { action: rx }] }); }
    const filter = and.length ? { $and: and } : {};
    const { log, count, people } = await adminDb(async (db) => {
      const [log, count, people] = await Promise.all([
        auditLog(db).find(filter).sort({ createdAt: -1 }).skip(data.offset).limit(data.limit).toArray(),
        auditLog(db).countDocuments(filter),
        data.offset === 0 ? accounts(db).find({}, { projection: { username: 1 } }).sort({ usernameLower: 1 }).toArray().then((r) => r.map((a) => a.username)) : Promise.resolve(null),
      ]);
      return { log, count, people };
    });
    const rows = log.map((l) => ({ id: l._id, username: l.username, action: l.action, detail: JSON.stringify(l.detail ?? {}), network: (l.ipHash ?? "").slice(0, 8), at: l.createdAt.toISOString() }));
    return { ...toPage(rows, count, data.offset), people, actions: data.offset === 0 ? [...ADMIN_ACTIONS] : null };
  });

export type ReaderActivityKind = "comment" | "reply" | "story_like" | "save" | "comment_like";

export const adminReaderActivity = createServerFn({ method: "GET" })
  .inputValidator((d) => pageInput.extend({ kind: z.enum(["all", "comment", "reply", "story_like", "save", "comment_like"]).default("all") }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await srv();
    await requireAdmin("admin");
    const { withDb } = await import("./community.server");
    return withDb(async (m) => {
      const since = sinceDate(data.days);
      const match = await matchPeopleAndStories(m, data.q);
      const pipeline: Record<string, unknown>[] = [
        { $match: { deletedAt: null } },
        { $project: { _id: 0, id: { $toString: "$_id" }, userId: 1, articleSlug: 1, createdAt: 1, kind: { $cond: [{ $ifNull: ["$parentId", false] }, "reply", "comment"] } } },
        { $unionWith: { coll: "communityInteractions", pipeline: [{ $match: { kind: { $in: ["like", "save"] } } }, { $project: { _id: 0, id: { $toString: "$_id" }, userId: 1, articleSlug: 1, createdAt: 1, kind: { $cond: [{ $eq: ["$kind", "like"] }, "story_like", "save"] } } }] } },
        { $unionWith: { coll: "communityCommentLikes", pipeline: [{ $project: { _id: 0, id: { $toString: "$_id" }, userId: 1, commentId: 1, createdAt: 1, kind: "comment_like" } }] } },
      ];
      const after: Record<string, unknown> = {};
      if (data.kind !== "all") after["kind"] = data.kind;
      if (since) after["createdAt"] = { $gte: since };
      if (match) after["$or"] = [{ userId: { $in: match.userIds } }, { articleSlug: { $in: match.slugs } }];
      if (Object.keys(after).length) pipeline.push({ $match: after });
      const [res] = await m.collection("communityComments").aggregate<{ rows: { id: string; userId: string; articleSlug?: string; commentId?: string; createdAt: Date; kind: ReaderActivityKind }[]; total: { n: number }[] }>([
        ...pipeline,
        { $facet: { rows: [{ $sort: { createdAt: -1, id: -1 } }, { $skip: data.offset }, { $limit: data.limit }], total: [{ $count: "n" }] } },
      ]).toArray();
      const raw = res?.rows ?? [];
      // Comment likes point at a comment; find which story it belongs to.
      const { ObjectId } = await import("mongodb");
      const likedIds = raw.filter((r) => r.commentId && /^[a-f0-9]{24}$/.test(r.commentId)).map((r) => new ObjectId(r.commentId));
      const liked = likedIds.length ? await m.collection("communityComments").find({ _id: { $in: likedIds } }, { projection: { articleSlug: 1 } }).toArray() : [];
      const likedSlug = new Map(liked.map((c) => [String(c._id), str(c["articleSlug"])]));
      const slugOf = (r: (typeof raw)[number]) => r.articleSlug ?? (r.commentId ? likedSlug.get(r.commentId) ?? "" : "");
      const [profiles, arts] = await Promise.all([
        m.collection<{ _id: string; username: string }>("communityProfiles").find({ _id: { $in: [...new Set(raw.map((r) => String(r.userId)))] } }, { projection: { username: 1 } }).toArray(),
        m.collection("articles").find({ slug: { $in: [...new Set(raw.map(slugOf).filter(Boolean))] } }, { projection: { slug: 1, title: 1, img: 1 } }).toArray(),
      ]);
      const names = new Map(profiles.map((p) => [String(p._id), p.username]));
      const artMap = new Map(arts.map((a) => [str(a["slug"]), { title: str(a["title"]), img: str(a["img"]) }]));
      const rows = raw.map((r) => {
        const slug = slugOf(r);
        return { id: `${r.kind}-${r.id}`, kind: r.kind, reader: names.get(String(r.userId)) ?? "former_reader", articleSlug: slug, articleTitle: artMap.get(slug)?.title || slug, img: artMap.get(slug)?.img ?? "", at: r.createdAt instanceof Date ? r.createdAt.toISOString() : "" };
      });
      return toPage(rows, res?.total[0]?.n ?? 0, data.offset);
    });
  });

export const adminUpdateSettings = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({
    maintenance_mode: z.boolean(), maintenance_message: z.string().trim().max(500),
    signups_enabled: z.boolean(), comments_enabled: z.boolean(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin, saveSettings, audit } = await srv();
    const me = await requireAdmin("admin");
    await saveSettings(data);
    await audit(me, "settings_changed", data);
    return { ok: true };
  });

export const adminRevokeSession = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin, adminDb, sessions, audit } = await srv();
    const me = await requireAdmin("admin");
    const now = new Date();
    // null = sign out every other device
    await adminDb((db) => data.id
      ? sessions(db).updateOne({ _id: data.id }, { $set: { revokedAt: now } })
      : sessions(db).updateMany({ revokedAt: null, _id: { $ne: me.sessionId } }, { $set: { revokedAt: now } }));
    await audit(me, data.id ? "session_revoked" : "all_sessions_revoked", {});
    return { ok: true };
  });

/* ---------- Team (admin accounts) ---------- */

export const adminListTeam = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin, adminDb, accounts } = await srv();
  await requireAdmin("admin");
  const list = await adminDb((db) => accounts(db).find({}, { projection: { passwordHash: 0 } }).sort({ createdAt: 1 }).toArray());
  return list.map((a) => ({ id: a._id, username: a.username, email: a.email, role: a.role, disabled: a.disabled, created_at: a.createdAt.toISOString(), last_login_at: a.lastLoginAt ? a.lastLoginAt.toISOString() : null }));
});

const pw = z.string().min(8, "Use at least 8 characters").max(200);

export const adminCreateEditor = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ username: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_.-]+$/), email: z.string().trim().email().max(254), password: pw }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin, adminDb, accounts, hashPassword, audit } = await srv();
    const me = await requireAdmin("admin");
    const passwordHash = await hashPassword(data.password);
    try {
      await adminDb((db) => accounts(db).insertOne({ _id: crypto.randomUUID(), username: data.username, usernameLower: data.username.toLowerCase(), email: data.email.toLowerCase(), passwordHash, role: "editor", disabled: false, createdAt: new Date(), lastLoginAt: null }));
    } catch (e) {
      throw new Error((e as { code?: number }).code === 11000 ? "That username or email is already used" : "Could not add this person");
    }
    await audit(me, "editor_added", { username: data.username });
    return { ok: true };
  });

export const adminUpdateTeamMember = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid(), disabled: z.boolean().optional(), remove: z.boolean().optional(), password: pw.optional() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin, adminDb, accounts, sessions, hashPassword, audit } = await srv();
    const me = await requireAdmin("admin");
    if (data.id === me.id) throw new Error("Use My account to change your own login");
    const passwordHash = data.password ? await hashPassword(data.password) : null;
    const target = await adminDb(async (db) => {
      const target = await accounts(db).findOne({ _id: data.id }, { projection: { username: 1, role: 1 } });
      if (!target) throw new Error("Account not found");
      if (target.role === "admin" && (data.remove || data.disabled)) throw new Error("Full admin accounts cannot be removed here");
      if (data.remove) {
        await accounts(db).deleteOne({ _id: data.id });
        await sessions(db).deleteMany({ accountId: data.id });
        return { ...target, removed: true };
      }
      if (data.disabled !== undefined) {
        await accounts(db).updateOne({ _id: data.id }, { $set: { disabled: data.disabled } });
        if (data.disabled) await sessions(db).updateMany({ accountId: data.id, revokedAt: null }, { $set: { revokedAt: new Date() } });
      }
      if (passwordHash) await accounts(db).updateOne({ _id: data.id }, { $set: { passwordHash } });
      return { ...target, removed: false };
    });
    if (target.removed) {
      await audit(me, "editor_removed", { username: target.username });
      return { ok: true };
    }
    await audit(me, "editor_updated", { username: target.username, disabled: data.disabled, passwordReset: !!data.password });
    return { ok: true };
  });

export const adminUpdateMyAccount = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({
    username: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_.-]+$/),
    email: z.string().trim().email().max(254),
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().max(200).optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin, adminDb, accounts, hashPassword, verifyPassword, audit } = await srv();
    const me = await requireAdmin("editor");
    if (data.newPassword && data.newPassword.length < 8) return { ok: false as const, error: "A new password needs at least 8 characters." };
    const res = await adminDb(async (db) => {
      const acc = await accounts(db).findOne({ _id: me.id });
      if (!acc || !(await verifyPassword(data.currentPassword, acc.passwordHash))) return "Your current password is not right.";
      const patch: Record<string, unknown> = { username: data.username, usernameLower: data.username.toLowerCase(), email: data.email.toLowerCase() };
      if (data.newPassword) patch["passwordHash"] = await hashPassword(data.newPassword);
      try { await accounts(db).updateOne({ _id: me.id }, { $set: patch }); } catch (e) {
        return (e as { code?: number }).code === 11000 ? "That username or email is already used." : "Could not save.";
      }
      return null;
    });
    if (res) return { ok: false as const, error: res };
    await audit(me, "account_updated", { username: data.username, passwordChanged: !!data.newPassword });
    return { ok: true as const };
  });

/* ---------- Public: site status for the maintenance screen ---------- */

export const getSiteStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { loadSettings, DEFAULT_SETTINGS } = await srv();
  return loadSettings().catch(() => ({ ...DEFAULT_SETTINGS, maintenance_message: "" }));
});
