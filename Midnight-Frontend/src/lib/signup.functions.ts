import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { MAX_ACCOUNTS_PER_ADDRESS, SIGNUP_WINDOW_HOURS, signupLimitReached } from "./signup-rules";
import { LIMITS } from "./community-rules";

const auth = () => import("./auth.server");

const signUpInput = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(LIMITS.passwordMax),
  username: z.string().trim().min(3).max(30),
});

const clientIp = () =>
  getRequestHeader("cf-connecting-ip") ?? getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

/** Who is signed in (from the httpOnly session cookie), or null. */
export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  const { currentUser } = await auth();
  return currentUser().catch(() => null);
});

/**
 * Creates an account instantly and signs it in; no email is ever sent. A network address
 * that already created MAX_ACCOUNTS_PER_ADDRESS accounts in the window is refused.
 */
export const instantSignUp = createServerFn({ method: "POST" })
  .inputValidator((d) => signUpInput.parse(d))
  .handler(async ({ data }) => {
    await (await import("./admin.server")).assertEnabled("signups_enabled");
    const { authDb, users, emailHash, encrypt, hashPassword, startSession, sha256 } = await auth();
    const ipHash = await sha256(`midnight-signup:${clientIp()}`);
    return authDb(async (db) => {
      const since = new Date(Date.now() - SIGNUP_WINDOW_HOURS * 3600_000);
      const count = await db.collection("signupAttempts").countDocuments({ ipHash, createdAt: { $gte: since } });
      if (signupLimitReached(count)) return { status: "limited" as const, limit: MAX_ACCOUNTS_PER_ADDRESS };
      const id = crypto.randomUUID();
      try {
        await users(db).insertOne({
          _id: id, emailHash: await emailHash(data.email), emailEnc: await encrypt(data.email.toLowerCase()),
          username: data.username, passwordHash: await hashPassword(data.password), blocked: false, createdAt: new Date(), lastSignInAt: null,
        });
      } catch (e) {
        if ((e as { code?: number }).code === 11000) throw new Error("An account with this email already exists. Try signing in instead.");
        throw e;
      }
      await db.collection("signupAttempts").insertOne({ ipHash, createdAt: new Date() });
      await startSession(db, id);
      return { status: "created" as const };
    });
  });

/** Signs in with email + password; explains precisely whether the account or the password is wrong. */
export const signIn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { authDb, users, emailHash, verifyPassword, startSession } = await auth();
    return authDb(async (db) => {
      const u = await users(db).findOne({ emailHash: await emailHash(data.email) });
      if (!u) return { ok: false as const, error: "There's no account with this email. Check the spelling or create an account." };
      if (!(await verifyPassword(data.password, u.passwordHash))) return { ok: false as const, error: "Incorrect password for this email. Check it and try again." };
      if (u.blocked) return { ok: false as const, error: "This account has been suspended. Please contact us for help." };
      await startSession(db, u._id);
      return { ok: true as const };
    });
  });

export const signOut = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ everywhere: z.boolean().default(false) }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { endUserSession } = await auth();
    await endUserSession(data.everywhere);
    return { ok: true };
  });

export const changePassword = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ current: z.string().min(1).max(200), next: z.string().min(8).max(LIMITS.passwordMax) }).parse(d))
  .handler(async ({ data }) => {
    const { requireUser, authDb, users, verifyPassword, hashPassword } = await auth();
    const me = await requireUser();
    return authDb(async (db) => {
      const u = await users(db).findOne({ _id: me.id });
      if (!u || !(await verifyPassword(data.current, u.passwordHash))) return { ok: false as const, error: "Your current password is incorrect" };
      await users(db).updateOne({ _id: me.id }, { $set: { passwordHash: await hashPassword(data.next) } });
      return { ok: true as const };
    });
  });
