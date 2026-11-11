import { getCookie, setCookie, deleteCookie, getRequestHeader } from "@tanstack/react-start/server";
import type { Db } from "mongodb";
import { withDb, encrypt, decrypt } from "./community.server";
import { hashPassword, randomToken, sha256, verifyPassword } from "./password.server";
import { LIMITS } from "./community-rules";

// Server-only: reader accounts and sign-in sessions, stored in MongoDB.
export const USER_COOKIE = "mn_session";

export type UserDoc = {
  _id: string; emailHash: string; emailEnc: string; username: string; passwordHash: string;
  blocked: boolean; createdAt: Date; lastSignInAt: Date | null;
};
export type UserSessionDoc = { _id: string; userId: string; tokenHash: string; createdAt: Date; lastSeenAt: Date; expiresAt: Date; userAgent: string };
export type SessionUser = { id: string; email: string; username: string };

export const users = (db: Db) => db.collection<UserDoc>("users");
export const userSessions = (db: Db) => db.collection<UserSessionDoc>("userSessions");
export { hashPassword, verifyPassword };

/** Lookup key for an email; the readable address itself is stored encrypted. */
export const emailHash = (email: string) => sha256(`midnight-email:${email.trim().toLowerCase()}`);

let ready = false;
export async function ensureAuthIndexes(db: Db) {
  if (ready) return;
  await Promise.all([
    users(db).createIndex({ emailHash: 1 }, { unique: true, name: "email_unique" }),
    userSessions(db).createIndex({ tokenHash: 1 }, { unique: true, name: "token" }),
    userSessions(db).createIndex({ userId: 1 }, { name: "by_user" }),
    userSessions(db).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "ttl" }),
    db.collection("signupAttempts").createIndex({ createdAt: 1 }, { expireAfterSeconds: 7 * 86_400, name: "ttl" }),
    db.collection("signupAttempts").createIndex({ ipHash: 1, createdAt: -1 }, { name: "by_ip" }),
  ]);
  ready = true;
}

export const authDb = <T>(fn: (db: Db) => Promise<T>) => withDb(async (db) => { await ensureAuthIndexes(db); return fn(db); });

const idleMs = () => LIMITS.sessionIdleDays * 86_400_000;

export async function startSession(db: Db, userId: string) {
  const token = randomToken();
  const now = new Date();
  const expires = new Date(now.getTime() + idleMs());
  await userSessions(db).insertOne({ _id: crypto.randomUUID(), userId, tokenHash: await sha256(token), createdAt: now, lastSeenAt: now, expiresAt: expires, userAgent: (getRequestHeader("user-agent") ?? "").slice(0, 300) });
  await users(db).updateOne({ _id: userId }, { $set: { lastSignInAt: now } });
  setCookie(USER_COOKIE, token, { httpOnly: true, secure: true, sameSite: "none", partitioned: true, path: "/", expires });
}

export async function endUserSession(everywhere = false) {
  const token = getCookie(USER_COOKIE);
  if (token) {
    const tokenHash = await sha256(token);
    await authDb(async (db) => {
      const s = await userSessions(db).findOne({ tokenHash });
      if (!s) return;
      if (everywhere) await userSessions(db).deleteMany({ userId: s.userId });
      else await userSessions(db).deleteOne({ _id: s._id });
    });
  }
  deleteCookie(USER_COOKIE, { path: "/", secure: true, sameSite: "none", partitioned: true });
}

/** Signed-in reader from the session cookie, or null. Expiry is checked on every request; activity slides it forward. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = getCookie(USER_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  return authDb(async (db) => {
    const s = await userSessions(db).findOne({ tokenHash });
    if (!s || s.expiresAt < new Date()) return null;
    const u = await users(db).findOne({ _id: s.userId });
    if (!u || u.blocked) return null;
    // Slide the idle window at most once an hour to keep writes low.
    if (Date.now() - s.lastSeenAt.getTime() > 3_600_000) {
      const expires = new Date(Date.now() + idleMs());
      await userSessions(db).updateOne({ _id: s._id }, { $set: { lastSeenAt: new Date(), expiresAt: expires } });
      setCookie(USER_COOKIE, token, { httpOnly: true, secure: true, sameSite: "none", partitioned: true, path: "/", expires });
    }
    return { id: u._id, email: await decrypt(u.emailEnc), username: u.username };
  });
}

export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new Error("Please sign in first");
  return u;
}

export { encrypt, sha256 };
