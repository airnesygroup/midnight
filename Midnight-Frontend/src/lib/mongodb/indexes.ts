export type CollectionIndex = {
  key: Record<string, 1 | -1 | "text">;
  name: string;
  unique?: boolean;
  expireAfterSeconds?: number;
};
const unique = (name: string, key: CollectionIndex["key"]): CollectionIndex => ({ name, key, unique: true });
export const collectionIndexes: Record<string, CollectionIndex[]> = {
  articles: [unique("article_id", { id: 1 }), unique("article_slug", { slug: 1 }),
    { name: "section_publication", key: { status: 1, tag: 1, publishedAt: -1, slug: 1 } },
    { name: "popular", key: { status: 1, views: -1, slug: 1 } },
    { name: "headlines", key: { status: 1, featured: 1, headlineWeight: -1 } },
    { name: "hashtags", key: { status: 1, hashtags: 1 } }],
  trends: [unique("trend_id", { id: 1 }), unique("trend_slug", { slug: 1 }),
    { name: "trend_publication", key: { status: 1, publishedAt: -1, slug: 1 } },
    { name: "trend_popular", key: { status: 1, views: -1, slug: 1 } },
    { name: "trend_hashtags", key: { status: 1, hashtags: 1, publishedAt: -1 } }],
  sections: [unique("section_slug", { slug: 1 })], reports: [unique("report_id", { id: 1 }), unique("report_date", { editionDate: 1 })],
  infoPages: [unique("info_slug", { slug: 1 })], placements: [unique("placement_key", { key: 1 })],
  profiles: [unique("profile_user", { userId: 1 })], userRoles: [unique("user_role", { userId: 1, role: 1 })],
  comments: [unique("comment_id", { id: 1 }), { name: "discussion", key: { articleId: 1, status: 1, createdAt: 1 } },
    { name: "replies", key: { parentId: 1, createdAt: 1 } }, { name: "profile_comments", key: { userId: 1, createdAt: -1 } }],
  articleInteractions: [unique("one_interaction", { userId: 1, articleId: 1, kind: 1 }), { name: "profile_library", key: { userId: 1, kind: 1, createdAt: -1 } }],
  commentLikes: [unique("one_comment_like", { userId: 1, commentId: 1 })],
  shareEvents: [unique("share_id", { id: 1 }), { name: "article_shares", key: { articleId: 1, occurredAt: -1 } }],
  viewEvents: [unique("view_digest", { articleId: 1, deduplicationDigest: 1 })],
  sessions: [unique("session_digest", { tokenDigest: 1 }), { name: "session_expiry", key: { expiresAt: 1 }, expireAfterSeconds: 0 }],
  policies: [unique("policy_key", { key: 1 })],
  rateLimits: [unique("limit_key", { key: 1 }), { name: "rate_expiry", key: { expiresAt: 1 }, expireAfterSeconds: 0 }],
  auditEvents: [{ name: "audit_time", key: { occurredAt: -1 } }],
};
