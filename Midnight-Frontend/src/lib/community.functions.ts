import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { LIMITS, bioSchema, commentTextSchema, displayNameSchema, usernameSchema, canEditComment } from "./community-rules";

const slugInput = z.object({ slug: z.string().min(1).max(200).regex(/^[a-z0-9-]+$/) });
const idSchema = z.string().regex(/^[a-f0-9]{24}$/);

export type CommentDTO = {
  id: string; parentId: string | null; text: string; createdAt: string; editedAt: string | null;
  deleted: boolean; likes: number; author: { username: string; displayName: string; hue: number };
};
export type ProfileDTO = {
  username: string; displayName: string; bio: string; hue: number; memberSince: string;
  stats: { comments: number; replies: number; likesReceived: number; saved: number; liked: number; shares: number };
};

const server = () => import("./community.server");
/** Signed-in reader from the MongoDB session cookie; refuses the call otherwise. */
const requireReader = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { requireUser } = await import("./auth.server");
  const u = await requireUser();
  return next({ context: { userId: u.id, claims: { email: u.email, user_metadata: { username: u.username } } as Record<string, unknown> } });
});
const clearCacheMw = createMiddleware({ type: "function" }).server(async ({ next }) => { const r = await next(); discussionCache.clear(); return r; });
const hueFor = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

type CommentDoc = { _id?: import("mongodb").ObjectId; articleSlug: string; userId: string; parentId: string | null; textEnc: string | null; createdAt: Date; editedAt: Date | null; deletedAt: Date | null };
type InteractionDoc = { userId: string; articleSlug: string; kind: "like" | "save"; createdAt: Date };
type LikeDoc = { userId: string; commentId: string; authorId?: string; createdAt: Date };
type ProfileDoc = { _id: string; username: string; usernameLower: string; displayNameEnc: string | null; bioEnc: string | null; hue: number; createdAt: Date; updatedAt: Date };

async function ensureProfile(db: import("mongodb").Db, userId: string, claims: Record<string, unknown>) {
  const col = db.collection<ProfileDoc>("communityProfiles");
  const existing = await col.findOne({ _id: userId });
  if (existing) return existing;
  const meta = (claims["user_metadata"] ?? {}) as Record<string, unknown>;
  const email = typeof claims["email"] === "string" ? claims["email"] : "reader";
  const wanted = usernameSchema.safeParse(meta["username"]);
  const base = (wanted.success ? wanted.data : (email.split("@")[0] ?? "").replace(/[^A-Za-z0-9_]/g, "")).slice(0, 14) || "reader";
  const { encrypt } = await server();
  const displayName = typeof meta["full_name"] === "string" ? meta["full_name"].slice(0, LIMITS.displayNameMax) : "";
  for (let i = 0; i < 6; i++) {
    const username = i === 0 && base.length >= LIMITS.usernameMin ? base : `${base.padEnd(3, "x")}${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date();
    const doc: ProfileDoc = { _id: userId, username, usernameLower: username.toLowerCase(), displayNameEnc: displayName ? await encrypt(displayName) : null, bioEnc: null, hue: hueFor(userId), createdAt: now, updatedAt: now };
    try {
      await col.insertOne(doc);
      return doc;
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      const raced = await col.findOne({ _id: userId });
      if (raced) return raced;
    }
  }
  throw new Error("Could not create your profile, please try again");
}

// Short per-isolate cache so repeat views skip a database round-trip; any write clears it.
const discussionCache = new Map<string, { at: number; value: Promise<{ comments: CommentDTO[]; counts: { likes: number; saves: number; shares: number; comments: number } }> }>();
const DISCUSSION_TTL_MS = 10_000;
export const clearDiscussionCache = () => discussionCache.clear();

/** Public: comments for one article (text decrypted server-side) plus counters. */
export const getDiscussion = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => slugInput.parse(i))
  .handler(async ({ data }) => {
    const hit = discussionCache.get(data.slug);
    if (hit && Date.now() - hit.at < DISCUSSION_TTL_MS) return hit.value;
    const value = loadDiscussion(data.slug);
    discussionCache.set(data.slug, { at: Date.now(), value });
    value.catch(() => discussionCache.delete(data.slug));
    return value;
  });

async function loadDiscussion(slug: string) {
    const data = { slug };
    const { withDb, decrypt } = await server();
    return withDb(async (db) => {
      const raw = await db.collection<CommentDoc>("communityComments").find({ articleSlug: data.slug }).sort({ createdAt: 1 }).limit(2000).toArray();
      const ids = raw.map((c) => c._id);
      const [likeAgg, profiles, likes, saves, shares] = await Promise.all([
        db.collection<LikeDoc>("communityCommentLikes").aggregate<{ _id: string; n: number }>([{ $match: { commentId: { $in: ids.map(String) } } }, { $group: { _id: "$commentId", n: { $sum: 1 } } }]).toArray(),
        db.collection<ProfileDoc>("communityProfiles").find({ _id: { $in: [...new Set(raw.map((c) => c.userId))] } }).toArray(),
        db.collection<InteractionDoc>("communityInteractions").countDocuments({ articleSlug: data.slug, kind: "like" }),
        db.collection<InteractionDoc>("communityInteractions").countDocuments({ articleSlug: data.slug, kind: "save" }),
        db.collection("communityShares").countDocuments({ articleSlug: data.slug }),
      ]);
      const likeMap = new Map(likeAgg.map((l) => [l._id, l.n]));
      const authors = new Map(await Promise.all(profiles.map(async (p) => [p._id, { username: p.username, displayName: await decrypt(p.displayNameEnc), hue: p.hue }] as const)));
      const comments: CommentDTO[] = await Promise.all(raw.map(async (c) => ({
        id: String(c._id), parentId: c.parentId ?? null, createdAt: c.createdAt.toISOString(),
        editedAt: c.editedAt ? c.editedAt.toISOString() : null, deleted: !!c.deletedAt,
        text: c.deletedAt ? "" : await decrypt(c.textEnc), likes: likeMap.get(String(c._id)) ?? 0,
        author: c.deletedAt ? { username: "deleted", displayName: "", hue: 0 } : authors.get(c.userId) ?? { username: "former_reader", displayName: "", hue: 0 },
      })));
      return { comments, counts: { likes, saves, shares, comments: raw.filter((c) => !c.deletedAt).length } };
    });
}

/** Signed-in reader's own state on one article. */
export const getMyArticleState = createServerFn({ method: "GET" })
  .middleware([requireReader])
  .inputValidator((i: unknown) => slugInput.parse(i))
  .handler(async ({ data, context }) => {
    const { withDb } = await server();
    return withDb(async (db) => {
      const [inter, mine] = await Promise.all([
        db.collection<InteractionDoc>("communityInteractions").find({ userId: context.userId, articleSlug: data.slug }).toArray(),
        db.collection<CommentDoc>("communityComments").find({ userId: context.userId, articleSlug: data.slug }, { projection: { _id: 1 } }).toArray(),
      ]);
      const mineIds = mine.map((c) => String(c._id));
      const commentIds = (await db.collection<CommentDoc>("communityComments").find({ articleSlug: data.slug }, { projection: { _id: 1 } }).toArray()).map((c) => String(c._id));
      const liked = await db.collection<LikeDoc>("communityCommentLikes").find({ userId: context.userId, commentId: { $in: commentIds } }).toArray();
      return {
        liked: inter.some((i) => i.kind === "like"), saved: inter.some((i) => i.kind === "save"),
        myCommentIds: mineIds, likedCommentIds: liked.map((l) => l.commentId),
      };
    });
  });

export const toggleInteraction = createServerFn({ method: "POST" }).middleware([clearCacheMw])
  .middleware([requireReader])
  .inputValidator((i: unknown) => slugInput.extend({ kind: z.enum(["like", "save"]) }).parse(i))
  .handler(async ({ data, context }) => {
    const { withDb } = await server();
    return withDb(async (db) => {
      await ensureProfile(db, context.userId, context.claims as Record<string, unknown>);
      const col = db.collection<InteractionDoc>("communityInteractions");
      const filter = { userId: context.userId, articleSlug: data.slug, kind: data.kind };
      const removed = await col.deleteOne(filter);
      if (removed.deletedCount === 0) {
        try { await col.insertOne({ ...filter, createdAt: new Date() }); } catch (e) { if ((e as { code?: number }).code !== 11000) throw e; }
      }
      return { active: removed.deletedCount === 0 };
    });
  });

export const toggleCommentLike = createServerFn({ method: "POST" }).middleware([clearCacheMw])
  .middleware([requireReader])
  .inputValidator((i: unknown) => z.object({ commentId: idSchema }).parse(i))
  .handler(async ({ data, context }) => {
    const { withDb } = await server();
    const { ObjectId } = await import("mongodb");
    return withDb(async (db) => {
      const c = await db.collection<CommentDoc>("communityComments").findOne({ _id: new ObjectId(data.commentId) });
      if (!c || c.deletedAt) throw new Error("That comment is no longer available");
      const col = db.collection<LikeDoc>("communityCommentLikes");
      const filter = { userId: context.userId, commentId: data.commentId };
      const removed = await col.deleteOne(filter);
      if (removed.deletedCount === 0) {
        try { await col.insertOne({ ...filter, authorId: c.userId, createdAt: new Date() }); } catch (e) { if ((e as { code?: number }).code !== 11000) throw e; }
      }
      return { active: removed.deletedCount === 0 };
    });
  });

/** Public share counter; records the reader when signed in is not required. */
export const recordShare = createServerFn({ method: "POST" }).middleware([clearCacheMw])
  .inputValidator((i: unknown) => slugInput.extend({ channel: z.enum(["native", "copy", "x", "facebook", "linkedin", "whatsapp", "email"]) }).parse(i))
  .handler(async ({ data }) => {
    const { withDb } = await server();
    return withDb(async (db) => {
      await db.collection("communityShares").insertOne({ articleSlug: data.slug, channel: data.channel, at: new Date() });
      return { ok: true };
    });
  });

export const addComment = createServerFn({ method: "POST" }).middleware([clearCacheMw])
  .middleware([requireReader])
  .inputValidator((i: unknown) => slugInput.extend({ text: commentTextSchema, parentId: idSchema.nullable() }).parse(i))
  .handler(async ({ data, context }) => {
    await (await import("./admin.server")).assertEnabled("comments_enabled");
    const { withDb, encrypt } = await server();
    const { ObjectId } = await import("mongodb");
    return withDb(async (db) => {
      await ensureProfile(db, context.userId, context.claims as Record<string, unknown>);
      const col = db.collection<CommentDoc>("communityComments");
      const since = new Date(Date.now() - LIMITS.commentBurstWindowSeconds * 1000);
      const [onArticle, recent] = await Promise.all([
        col.countDocuments({ userId: context.userId, articleSlug: data.slug, deletedAt: null }),
        col.countDocuments({ userId: context.userId, createdAt: { $gte: since } }),
      ]);
      if (onArticle >= LIMITS.commentsPerArticle) throw new Error(`You've reached the limit of ${LIMITS.commentsPerArticle} comments on this story`);
      if (recent >= LIMITS.commentBurst) throw new Error("You're commenting very quickly. Please wait a minute and try again");
      if (data.parentId) {
        let depth = 1;
        let cursor = await col.findOne({ _id: new ObjectId(data.parentId) });
        if (!cursor || cursor.articleSlug !== data.slug || cursor.deletedAt) throw new Error("The comment you're replying to is no longer available");
        while (cursor?.parentId && depth < 10) { depth++; cursor = await col.findOne({ _id: new ObjectId(cursor.parentId) }); }
        if (depth >= LIMITS.replyDepthMax) throw new Error("This thread is too deep to reply further");
      }
      const res = await col.insertOne({ articleSlug: data.slug, userId: context.userId, parentId: data.parentId, textEnc: await encrypt(data.text), createdAt: new Date(), editedAt: null, deletedAt: null });
      return { id: String(res.insertedId) };
    });
  });

export const editComment = createServerFn({ method: "POST" }).middleware([clearCacheMw])
  .middleware([requireReader])
  .inputValidator((i: unknown) => z.object({ commentId: idSchema, text: commentTextSchema }).parse(i))
  .handler(async ({ data, context }) => {
    const { withDb, encrypt } = await server();
    const { ObjectId } = await import("mongodb");
    return withDb(async (db) => {
      const col = db.collection<CommentDoc>("communityComments");
      const c = await col.findOne({ _id: new ObjectId(data.commentId), userId: context.userId, deletedAt: null });
      if (!c) throw new Error("You can only edit your own comments");
      if (!canEditComment(c.createdAt)) throw new Error(`Comments can only be edited within ${LIMITS.commentEditWindowMinutes} minutes of posting`);
      await col.updateOne({ _id: c._id }, { $set: { textEnc: await encrypt(data.text), editedAt: new Date() } });
      return { ok: true };
    });
  });

export const deleteComment = createServerFn({ method: "POST" }).middleware([clearCacheMw])
  .middleware([requireReader])
  .inputValidator((i: unknown) => z.object({ commentId: idSchema }).parse(i))
  .handler(async ({ data, context }) => {
    const { withDb } = await server();
    const { ObjectId } = await import("mongodb");
    return withDb(async (db) => {
      const res = await db.collection<CommentDoc>("communityComments").updateOne(
        { _id: new ObjectId(data.commentId), userId: context.userId, deletedAt: null },
        { $set: { deletedAt: new Date(), textEnc: null } },
      );
      if (res.matchedCount === 0) throw new Error("You can only delete your own comments");
      await db.collection<LikeDoc>("communityCommentLikes").deleteMany({ commentId: data.commentId });
      return { ok: true };
    });
  });

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireReader])
  .handler(async ({ context }) => {
    const { withDb, decrypt } = await server();
    return withDb(async (db) => {
      const p = await ensureProfile(db, context.userId, context.claims as Record<string, unknown>);
      const myIds = (await db.collection<CommentDoc>("communityComments").find({ userId: context.userId, deletedAt: null }, { projection: { _id: 1 } }).toArray()).map((c) => String(c._id));
      const [replies, likesReceived, saved, liked] = await Promise.all([
        db.collection<CommentDoc>("communityComments").countDocuments({ parentId: { $in: myIds }, userId: { $ne: context.userId }, deletedAt: null }),
        db.collection<LikeDoc>("communityCommentLikes").countDocuments({ commentId: { $in: myIds }, userId: { $ne: context.userId } }),
        db.collection<InteractionDoc>("communityInteractions").countDocuments({ userId: context.userId, kind: "save" }),
        db.collection<InteractionDoc>("communityInteractions").countDocuments({ userId: context.userId, kind: "like" }),
      ]);
      const profile: ProfileDTO = {
        username: p.username, displayName: await decrypt(p.displayNameEnc), bio: await decrypt(p.bioEnc), hue: p.hue,
        memberSince: p.createdAt.toISOString(),
        stats: { comments: myIds.length, replies, likesReceived, saved, liked, shares: 0 },
      };
      return profile;
    });
  });

export const getMyLibrary = createServerFn({ method: "GET" })
  .middleware([requireReader])
  .handler(async ({ context }) => {
    const { withDb, decrypt } = await server();
    return withDb(async (db) => {
      const [inter, comments] = await Promise.all([
        db.collection<InteractionDoc>("communityInteractions").find({ userId: context.userId }).sort({ createdAt: -1 }).limit(200).toArray(),
        db.collection<CommentDoc>("communityComments").find({ userId: context.userId, deletedAt: null }).sort({ createdAt: -1 }).limit(200).toArray(),
      ]);
      return {
        saved: inter.filter((i) => i.kind === "save").map((i) => ({ slug: i.articleSlug, at: i.createdAt.toISOString() })),
        liked: inter.filter((i) => i.kind === "like").map((i) => ({ slug: i.articleSlug, at: i.createdAt.toISOString() })),
        comments: await Promise.all(comments.map(async (c) => ({ id: String(c._id), slug: c.articleSlug, text: await decrypt(c.textEnc), at: c.createdAt.toISOString(), isReply: !!c.parentId }))),
      };
    });
  });

export const updateMyProfile = createServerFn({ method: "POST" }).middleware([clearCacheMw])
  .middleware([requireReader])
  .inputValidator((i: unknown) => z.object({ username: usernameSchema, displayName: displayNameSchema, bio: bioSchema }).parse(i))
  .handler(async ({ data, context }) => {
    const { withDb, encrypt } = await server();
    return withDb(async (db) => {
      await ensureProfile(db, context.userId, context.claims as Record<string, unknown>);
      try {
        await db.collection<ProfileDoc>("communityProfiles").updateOne({ _id: context.userId }, { $set: {
          username: data.username, usernameLower: data.username.toLowerCase(),
          displayNameEnc: data.displayName ? await encrypt(data.displayName) : null,
          bioEnc: data.bio ? await encrypt(data.bio) : null, updatedAt: new Date(),
        } });
        await db.collection("users").updateOne({ _id: context.userId as never }, { $set: { username: data.username } });
      } catch (e) {
        if ((e as { code?: number }).code === 11000) return { ok: false as const, error: "That username is already taken" };
        throw e;
      }
      return { ok: true as const };
    });
  });

export const checkUsername = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => z.object({ username: usernameSchema }).parse(i))
  .handler(async ({ data }) => {
    const { withDb } = await server();
    return withDb(async (db) => ({ available: !(await db.collection("communityProfiles").findOne({ usernameLower: data.username.toLowerCase() }, { projection: { _id: 1 } })) }));
  });

/** Permanently removes the caller's community data and sign-in account. */
export const deleteMyAccount = createServerFn({ method: "POST" }).middleware([clearCacheMw])
  .middleware([requireReader])
  .handler(async ({ context }) => {
    const { withDb } = await server();
    await withDb(async (db) => {
      const uid = context.userId;
      await db.collection<CommentDoc>("communityComments").updateMany({ userId: uid }, { $set: { deletedAt: new Date(), textEnc: null } });
      await Promise.all([
        db.collection<InteractionDoc>("communityInteractions").deleteMany({ userId: uid }),
        db.collection<LikeDoc>("communityCommentLikes").deleteMany({ userId: uid }),
        db.collection("communityProfiles").deleteOne({ _id: uid as never }),
      ]);
    });
    const { authDb, users, userSessions, endUserSession } = await import("./auth.server");
    await authDb(async (db) => { await Promise.all([users(db).deleteOne({ _id: context.userId }), userSessions(db).deleteMany({ userId: context.userId })]); });
    await endUserSession();
    return { ok: true };
  });
