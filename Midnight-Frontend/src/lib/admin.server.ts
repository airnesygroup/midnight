import { getCookie, setCookie, deleteCookie, getRequestHeader } from "@tanstack/react-start/server";
import type { Db } from "mongodb";
import { withDb } from "./community.server";
import { hashPassword, randomToken, sha256, verifyPassword } from "./password.server";

// Server-only: admin accounts, sessions (httpOnly cookie → hashed token), audit log and site settings, all in MongoDB.
export const ADMIN_COOKIE = "mn_admin";
const SESSION_HOURS = 12;

export type AdminRole = "admin" | "editor";
export type AdminAccount = { id: string; username: string; email: string; role: AdminRole };
export type AdminAccountDoc = {
  _id: string; username: string; usernameLower: string; email: string; passwordHash: string;
  role: AdminRole; disabled: boolean; createdAt: Date; lastLoginAt: Date | null;
};
export type AdminSessionDoc = {
  _id: string; accountId: string; tokenHash: string; ipHash: string; userAgent: string;
  createdAt: Date; lastSeenAt: Date; expiresAt: Date; revokedAt: Date | null;
};
export type AuditDoc = { _id: string; accountId: string | null; username: string | null; action: string; detail: Record<string, unknown>; ipHash: string; createdAt: Date };

export { sha256, hashPassword, verifyPassword };

export function clientIp() {
  return getRequestHeader("cf-connecting-ip") ?? getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
export const ipHash = () => sha256(`midnight-admin:${clientIp()}`);

export const accounts = (db: Db) => db.collection<AdminAccountDoc>("adminAccounts");
export const sessions = (db: Db) => db.collection<AdminSessionDoc>("adminSessions");
export const auditLog = (db: Db) => db.collection<AuditDoc>("adminAuditLog");

let adminReady = false;
/** Indexes plus the first admin, created from ADMIN_USERNAME / ADMIN_PASSWORD when no admin exists yet. */
export async function ensureAdminSetup(db: Db) {
  if (adminReady) return;
  await Promise.all([
    accounts(db).createIndex({ usernameLower: 1 }, { unique: true, name: "username_unique" }),
    accounts(db).createIndex({ email: 1 }, { unique: true, name: "email_unique" }),
    sessions(db).createIndex({ tokenHash: 1 }, { unique: true, name: "token" }),
    sessions(db).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "ttl" }),
    auditLog(db).createIndex({ createdAt: -1 }, { name: "recent" }),
    auditLog(db).createIndex({ action: 1, ipHash: 1, createdAt: -1 }, { name: "lockout" }),
    db.collection("pageViews").createIndex({ createdAt: -1 }, { name: "recent" }),
    db.collection("pageViews").createIndex({ articleSlug: 1, createdAt: -1 }, { name: "article" }),
  ]);
  if (!(await accounts(db).findOne({ role: "admin" }, { projection: { _id: 1 } }))) {
    const username = process.env["ADMIN_USERNAME"]?.trim();
    const password = process.env["ADMIN_PASSWORD"];
    if (username && password) {
      const email = (process.env["ADMIN_EMAIL"]?.trim() || `${username}@themidnightnews.com`).toLowerCase();
      await accounts(db).insertOne({
        _id: crypto.randomUUID(), username, usernameLower: username.toLowerCase(), email,
        passwordHash: await hashPassword(password), role: "admin", disabled: false, createdAt: new Date(), lastLoginAt: null,
      }).catch((e) => { if ((e as { code?: number }).code !== 11000) throw e; });
    }
  }
  adminReady = true;
}

export async function adminDb<T>(fn: (db: Db) => Promise<T>) {
  return withDb(async (db) => { await ensureAdminSetup(db); return fn(db); });
}

export async function audit(account: { id?: string | null; username?: string | null } | null, action: string, detail: Record<string, unknown> = {}) {
  const ip = await ipHash();
  await adminDb((db) => auditLog(db).insertOne({ _id: crypto.randomUUID(), accountId: account?.id ?? null, username: account?.username ?? null, action, detail, ipHash: ip, createdAt: new Date() }));
}

export async function createSession(accountId: string) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000);
  const doc: AdminSessionDoc = {
    _id: crypto.randomUUID(), accountId, tokenHash: await sha256(token), ipHash: await ipHash(),
    userAgent: (getRequestHeader("user-agent") ?? "").slice(0, 300), createdAt: new Date(), lastSeenAt: new Date(), expiresAt: expires, revokedAt: null,
  };
  await adminDb((db) => sessions(db).insertOne(doc));
  setCookie(ADMIN_COOKIE, token, { httpOnly: true, secure: true, sameSite: "none", partitioned: true, path: "/", expires });
}

export async function endSession() {
  const token = getCookie(ADMIN_COOKIE);
  if (token) {
    const tokenHash = await sha256(token);
    await adminDb((db) => sessions(db).updateOne({ tokenHash }, { $set: { revokedAt: new Date() } }));
  }
  deleteCookie(ADMIN_COOKIE, { path: "/", secure: true, sameSite: "none", partitioned: true });
}

/** Current admin from the session cookie, or null. Expiry and revocation are checked on every request. */
export async function currentAdmin(): Promise<(AdminAccount & { sessionId: string }) | null> {
  const token = getCookie(ADMIN_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  return adminDb(async (db) => {
    const s = await sessions(db).findOne({ tokenHash });
    if (!s || s.revokedAt || s.expiresAt < new Date()) return null;
    const acc = await accounts(db).findOne({ _id: s.accountId });
    if (!acc || acc.disabled) return null;
    await sessions(db).updateOne({ _id: s._id }, { $set: { lastSeenAt: new Date() } });
    return { id: acc._id, username: acc.username, email: acc.email, role: acc.role, sessionId: s._id };
  });
}

/** Throws unless signed in; editors pass only when `role` is "editor". */
export async function requireAdmin(role: AdminRole = "admin") {
  const me = await currentAdmin();
  if (!me) throw new Error("Please sign in to the admin area");
  if (role === "admin" && me.role !== "admin") throw new Error("Only full admins can do this");
  return me;
}

export type SiteSettings = { maintenance_mode: boolean; maintenance_message: string; signups_enabled: boolean; comments_enabled: boolean };
export const DEFAULT_SETTINGS: SiteSettings = {
  maintenance_mode: false, maintenance_message: "We are making a few improvements. Please check back shortly.", signups_enabled: true, comments_enabled: true,
};

export async function loadSettings(): Promise<SiteSettings> {
  const doc = await withDb((db) => db.collection<SiteSettings & { _id: string }>("siteSettings").findOne({ _id: "site" }));
  return {
    maintenance_mode: doc?.maintenance_mode ?? DEFAULT_SETTINGS.maintenance_mode,
    maintenance_message: doc?.maintenance_message ?? DEFAULT_SETTINGS.maintenance_message,
    signups_enabled: doc?.signups_enabled ?? DEFAULT_SETTINGS.signups_enabled,
    comments_enabled: doc?.comments_enabled ?? DEFAULT_SETTINGS.comments_enabled,
  };
}

export async function saveSettings(s: SiteSettings) {
  await withDb((db) => db.collection<SiteSettings & { _id: string; updatedAt: Date }>("siteSettings").updateOne({ _id: "site" }, { $set: { ...s, updatedAt: new Date() } }, { upsert: true }));
}

/** Used by public write paths so a paused feature is refused on the server, not just hidden. */
export async function assertEnabled(key: "signups_enabled" | "comments_enabled") {
  const s = await loadSettings();
  if (s.maintenance_mode) throw new Error("The site is paused for maintenance right now.");
  if (!s[key]) throw new Error(key === "signups_enabled" ? "New sign-ups are paused right now." : "Comments are paused right now.");
}

/* ---------- Visit statistics (replaces the old SQL function) ---------- */

export type Stats = {
  views: number; visitors: number; today: number;
  daily: { day: string; views: number; visitors: number }[];
  paths: { path: string; views: number; visitors: number }[];
  articles: { slug: string; views: number; visitors: number }[];
  referrers: { referrer: string; views: number }[];
  devices: { device: string; views: number }[];
  hours: { hour: number; views: number }[];
};

export async function viewStats(days: number, slug?: string | null): Promise<Stats> {
  const d = Math.max(1, Math.min(days, 365));
  const match: Record<string, unknown> = { createdAt: { $gte: new Date(Date.now() - d * 86_400_000) } };
  if (slug) match["articleSlug"] = slug;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const grp = (key: unknown, limit?: number) => [
    { $group: { _id: key, views: { $sum: 1 }, v: { $addToSet: "$visitorId" } } },
    { $project: { views: 1, visitors: { $size: "$v" } } },
    { $sort: { views: -1 as const } },
    ...(limit ? [{ $limit: limit }] : []),
  ];
  const [res] = await withDb((db) => db.collection("pageViews").aggregate<{
    total: { views: number; visitors: number }[]; today: { n: number }[];
    daily: { _id: string; views: number; visitors: number }[]; paths: { _id: string; views: number; visitors: number }[];
    articles: { _id: string; views: number; visitors: number }[]; referrers: { _id: string; views: number }[];
    devices: { _id: string | null; views: number }[]; hours: { _id: number; views: number }[];
  }>([
    { $match: match },
    { $facet: {
      total: grp(null),
      today: [{ $match: { createdAt: { $gte: today } } }, { $count: "n" }],
      daily: grp({ $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }),
      paths: grp("$path", 50),
      articles: [{ $match: { articleSlug: { $ne: null } } }, ...grp("$articleSlug", 200)],
      referrers: [{ $group: { _id: { $ifNull: ["$referrer", "Direct"] }, views: { $sum: 1 } } }, { $sort: { views: -1 } }, { $limit: 20 }],
      devices: [{ $group: { _id: "$device", views: { $sum: 1 } } }],
      hours: [{ $group: { _id: { $hour: "$createdAt" }, views: { $sum: 1 } } }, { $sort: { _id: 1 } }],
    } },
  ]).toArray());
  return {
    views: res?.total[0]?.views ?? 0, visitors: res?.total[0]?.visitors ?? 0, today: res?.today[0]?.n ?? 0,
    daily: (res?.daily ?? []).map((x) => ({ day: x._id, views: x.views, visitors: x.visitors })).sort((a, b) => a.day.localeCompare(b.day)),
    paths: (res?.paths ?? []).map((x) => ({ path: x._id, views: x.views, visitors: x.visitors })),
    articles: (res?.articles ?? []).map((x) => ({ slug: x._id, views: x.views, visitors: x.visitors })),
    referrers: (res?.referrers ?? []).map((x) => ({ referrer: x._id || "Direct", views: x.views })),
    devices: (res?.devices ?? []).map((x) => ({ device: x._id ?? "unknown", views: x.views })),
    hours: (res?.hours ?? []).map((x) => ({ hour: x._id, views: x.views })),
  };
}
