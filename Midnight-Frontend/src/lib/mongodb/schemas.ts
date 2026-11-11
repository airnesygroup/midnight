import { z } from "zod";

const id = z.string().min(1);
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const timestamp = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative();
const timestamps = { createdAt: timestamp.nullable(), updatedAt: timestamp.nullable() };
const document = { _id: id.optional(), schemaVersion: z.literal(1) };
const provenance = z.enum(["sample", "measured", "unknown"]);
export const publicationStatus = z.enum(["draft", "published", "paused", "archived"]);

/** Application/API documents use ISO timestamps; sessions use BSON Dates for TTL storage. */
export const articleSchema = z.object({
  ...document, id, slug, title: z.string().min(1), subtitle: z.string(), excerpt: z.string(),
  body: z.array(z.string()), html_body: z.string().min(1), summary: z.array(z.string()),
  section: slug, sections: z.array(slug).min(1).max(3).optional(), tag: z.string().min(1), category: z.string().min(1), desk: z.string(),
  img: z.string().min(1), imageAlt: z.string(), hashtags: z.array(z.string()),
  readingMinutes: z.number().int().positive(), time: z.string(),
  ...timestamps, publishedAt: timestamp.nullable(),
  source_name: z.string().nullable(), source_url: z.string().url().nullable(), voice: z.string().nullable(),
  views: count.nullable(), shares: count.nullable(), saves: count.nullable(), likes: count.nullable(), comments: count.nullable(),
  headlineWeight: z.number().min(0).max(100), featured: z.boolean(), status: publicationStatus,
  provenance: z.object({ content: provenance, publication: provenance, engagement: provenance }).strict(),
}).strict();

/** Midnight Trends: a separate collection; hashtags replace news sections/categories so trends never join the news catalogue. */
export const trendSchema = z.object({
  ...document, id, slug, title: z.string().min(1), subtitle: z.string(), excerpt: z.string(),
  body: z.array(z.string()), summary: z.array(z.string()), hashtags: z.array(z.string().min(1)).min(1),
  img: z.string().min(1), imageAlt: z.string(), readingMinutes: z.number().int().positive(), time: z.string(),
  ...timestamps, publishedAt: timestamp.nullable(),
  source_name: z.string().nullable(), source_url: z.string().url().nullable(),
  views: count.nullable(), shares: count.nullable(),
  headlineWeight: z.number().min(0).max(100), featured: z.boolean(), status: publicationStatus,
  provenance: z.object({ content: provenance, publication: provenance, engagement: provenance }).strict(),
}).strict();

export const sectionSchema = z.object({
  ...document, id, slug, name: z.string(), desc: z.string(), tags: z.array(z.string()), ...timestamps,
}).strict();
const reportSection = z.object({ tag: z.string(), title: z.string(), paragraphs: z.array(z.string()), html_body: z.string() }).strict();
export const reportSchema = z.object({
  ...document, id, slug, title: z.string(), editionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  editionTimezone: z.literal("UTC"), introduction: z.string(),
  lead: z.object({ articleId: id.nullable(), title: z.string(), excerpt: z.string(), paragraphs: z.array(z.string()), html_body: z.string() }).strict(),
  sections: z.array(reportSection), lastWord: z.string(), html_body: z.string(),
  coverImage: z.string().nullable(), coverImageAlt: z.string().nullable(),
  ...timestamps, publishedAt: timestamp.nullable(), status: publicationStatus, provenance,
}).strict();
export const infoPageSchema = z.object({
  ...document, id, slug, title: z.string(), text: z.string(),
  sections: z.array(z.object({ heading: z.string(), body: z.array(z.string()).optional(), bullets: z.array(z.string()).optional() }).strict()).optional(),
  facts: z.array(z.object({ label: z.string(), value: z.string() }).strict()).optional(), ...timestamps,
}).strict();
export const placementSchema = z.object({
  ...document, id, key: z.string(), articleIds: z.array(id), ...timestamps,
}).strict();

// Future-only contracts: no sign-up, sign-in or interaction handlers exist yet.
// Passwords belong to the future auth provider, NEVER in profiles or API DTOs.
export const profileSchema = z.object({
  ...document, id, userId: id, displayName: z.string().nullable(), username: z.string().nullable(),
  avatarUrl: z.string().url().nullable(), preferences: z.record(z.union([z.string(), z.boolean(), z.number()])), ...timestamps,
}).strict();
export const roleSchema = z.object({
  ...document, id, userId: id, role: z.enum(["reader", "admin"]), grantedBy: id.nullable(), ...timestamps,
}).strict();
export const commentSchema = z.object({
  ...document, id, articleId: id, userId: id, parentId: id.nullable(), rootId: id.nullable(),
  text: z.string().min(1), status: z.enum(["visible", "pending", "removed"]),
  likes: count, ...timestamps, deletedAt: timestamp.nullable(),
}).strict();
export const interactionSchema = z.object({
  ...document, id, userId: id, articleId: id, kind: z.enum(["like", "save"]), ...timestamps,
}).strict();
export const commentLikeSchema = z.object({ ...document, id, userId: id, commentId: id, ...timestamps }).strict();
export const shareSchema = z.object({
  ...document, id, articleId: id, userId: id.nullable(), channel: z.string(), occurredAt: timestamp,
}).strict();
export const viewSchema = z.object({
  ...document, id, articleId: id, deduplicationDigest: z.string().min(1), occurredAt: timestamp,
}).strict();
export const sessionSchema = z.object({
  ...document, id, userId: id, tokenDigest: z.string().min(1), ...timestamps,
  lastSeenAt: timestamp, idleExpiresAt: timestamp, expiresAt: timestamp, revokedAt: timestamp.nullable(),
}).strict();
export const policySchema = z.object({
  ...document, id, key: z.literal("security"), enabled: z.boolean(),
  // null = undecided, NOT unlimited. Enabling is rejected until all limits are chosen.
  maxCommentCharacters: z.number().int().positive().nullable(),
  maxCommentsPerWindow: z.number().int().positive().nullable(), commentWindowSeconds: z.number().int().positive().nullable(),
  sessionIdleSeconds: z.number().int().positive().nullable(), sessionAbsoluteSeconds: z.number().int().positive().nullable(),
  ...timestamps,
}).strict().superRefine((policy, ctx) => {
  if (policy.enabled && [policy.maxCommentCharacters, policy.maxCommentsPerWindow, policy.commentWindowSeconds, policy.sessionIdleSeconds, policy.sessionAbsoluteSeconds].some((v) => v === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose discussion and session limits before enabling these features" });
  }
  if (policy.sessionIdleSeconds !== null && policy.sessionAbsoluteSeconds !== null && policy.sessionIdleSeconds > policy.sessionAbsoluteSeconds) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Idle expiry must not exceed absolute expiry" });
  }
});
export const rateLimitSchema = z.object({
  ...document, id, key: z.string(), userId: id, action: z.string(), count, windowStartedAt: timestamp, expiresAt: timestamp,
}).strict();
export const auditSchema = z.object({
  ...document, id, actorId: id.nullable(), action: z.string(), targetId: id.nullable(), occurredAt: timestamp,
}).strict();

export const collectionSchemas = {
  articles: articleSchema, trends: trendSchema, sections: sectionSchema, reports: reportSchema, infoPages: infoPageSchema,
  placements: placementSchema, profiles: profileSchema, userRoles: roleSchema, comments: commentSchema,
  articleInteractions: interactionSchema, commentLikes: commentLikeSchema, shareEvents: shareSchema,
  viewEvents: viewSchema, sessions: sessionSchema, policies: policySchema, rateLimits: rateLimitSchema, auditEvents: auditSchema,
};
export type ArticleDocument = z.infer<typeof articleSchema>;
export type TrendDocument = z.infer<typeof trendSchema>;
export type ReportDocument = z.infer<typeof reportSchema>;
