import { z } from "zod";

/** Account, discussion and session limits shared by the forms and the server. */
export const LIMITS = {
  emailMax: 254,
  usernameMin: 3,
  usernameMax: 20,
  displayNameMax: 50,
  bioMax: 280,
  passwordMin: 10,
  passwordMax: 72,
  commentMin: 1,
  commentMax: 1000,
  commentsPerArticle: 30,
  commentBurst: 5,
  commentBurstWindowSeconds: 60,
  commentEditWindowMinutes: 30,
  replyDepthMax: 3,
  sessionIdleDays: 30,
} as const;

export const usernameSchema = z
  .string()
  .trim()
  .min(LIMITS.usernameMin, `Username must be at least ${LIMITS.usernameMin} characters`)
  .max(LIMITS.usernameMax, `Username can't be longer than ${LIMITS.usernameMax} characters`)
  .regex(/^[A-Za-z0-9_]+$/, "Use only letters, numbers and underscores");

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email address")
  .max(LIMITS.emailMax, `Email can't be longer than ${LIMITS.emailMax} characters`)
  .email("Enter a complete email address, like name@example.com")
  .refine((v) => /\.[A-Za-z]{2,}$/.test(v), "That email is missing a domain ending, like .com");

export const displayNameSchema = z.string().trim().max(LIMITS.displayNameMax, `Name can't be longer than ${LIMITS.displayNameMax} characters`);
export const bioSchema = z.string().trim().max(LIMITS.bioMax, `Bio can't be longer than ${LIMITS.bioMax} characters`);

export const commentTextSchema = z
  .string()
  .trim()
  .min(LIMITS.commentMin, "Write something before posting")
  .max(LIMITS.commentMax, `Comments can't be longer than ${LIMITS.commentMax} characters`);

export type FormErrors = Partial<Record<"email" | "password" | "confirm" | "username" | "displayName" | "bio" | "current" | "next" | "form", string | null>>;

/** First validation message for a value, or null when valid. */
export function fieldError(schema: z.ZodTypeAny, value: unknown): string | null {
  const r = schema.safeParse(value);
  return r.success ? null : r.error.issues[0]?.message ?? "Invalid value";
}

export type PasswordCheck = { id: string; label: string; ok: boolean };
export type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: string; checks: PasswordCheck[]; acceptable: boolean };

const COMMON = ["password", "123456", "qwerty", "letmein", "midnight", "welcome", "admin", "iloveyou"];

export function passwordStrength(password: string, context: string[] = []): PasswordStrength {
  const lower = password.toLowerCase();
  const checks: PasswordCheck[] = [
    { id: "length", label: `At least ${LIMITS.passwordMin} characters`, ok: password.length >= LIMITS.passwordMin },
    { id: "case", label: "Upper and lower case letters", ok: /[a-z]/.test(password) && /[A-Z]/.test(password) },
    { id: "number", label: "At least one number", ok: /\d/.test(password) },
    { id: "symbol", label: "At least one symbol", ok: /[^A-Za-z0-9]/.test(password) },
    {
      id: "personal",
      label: "Not a common word or your email/username",
      ok: password.length > 0 && !COMMON.some((c) => lower.includes(c)) && !context.filter((c) => c.length >= 3).some((c) => lower.includes(c.toLowerCase())),
    },
  ];
  const passed = checks.filter((c) => c.ok).length;
  const tooLong = password.length > LIMITS.passwordMax;
  let score = Math.max(0, passed - 1) as PasswordStrength["score"];
  const [len, , , , personal] = checks as [PasswordCheck, PasswordCheck, PasswordCheck, PasswordCheck, PasswordCheck];
  if (!len.ok || !personal.ok) score = Math.min(score, 1) as PasswordStrength["score"];
  if (password.length >= 16 && score === 3) score = 4;
  const label = (["Very weak", "Weak", "Fair", "Strong", "Very strong"] as const)[score];
  return { score, label, checks, acceptable: !tooLong && checks.every((c) => c.ok) };
}

export function passwordError(password: string, context: string[] = []): string | null {
  if (!password) return "Enter a password";
  if (password.length > LIMITS.passwordMax) return `Password can't be longer than ${LIMITS.passwordMax} characters`;
  const s = passwordStrength(password, context);
  if (s.acceptable) return null;
  const msg: Record<string, string> = {
    length: `Password is too short: ${password.length} of at least ${LIMITS.passwordMin} characters`,
    case: "Password needs both an uppercase and a lowercase letter",
    number: "Password needs at least one number",
    symbol: "Password needs at least one symbol, like ! or #",
  };
  const failed = s.checks.filter((c) => !c.ok);
  const first = failed[0];
  if (!first) return "Password is too weak. Make it longer or mix in more character types";
  return msg[first.id] ?? "Password contains a common word or your email/username. Remove it";
}

/** True while a comment written at createdAt may still be edited. */
export function canEditComment(createdAt: string | Date, now: Date = new Date()) {
  return now.getTime() - new Date(createdAt).getTime() <= LIMITS.commentEditWindowMinutes * 60_000;
}
