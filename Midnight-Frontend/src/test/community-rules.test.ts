import { describe, expect, it } from "vitest";
import { LIMITS, canEditComment, commentTextSchema, emailSchema, passwordError, passwordStrength, usernameSchema } from "@/lib/community-rules";

describe("account and discussion limits", () => {
  it("usernames are 3 to 20 letters, numbers or underscores", () => {
    expect(usernameSchema.safeParse("ab").success).toBe(false);
    expect(usernameSchema.safeParse("night_reader1").success).toBe(true);
    expect(usernameSchema.safeParse("a".repeat(21)).success).toBe(false);
    expect(usernameSchema.safeParse("bad name").success).toBe(false);
  });

  it("emails must be complete", () => {
    expect(emailSchema.safeParse("name@example").success).toBe(false);
    expect(emailSchema.safeParse("name@").success).toBe(false);
    expect(emailSchema.safeParse("name@example.com").success).toBe(true);
  });

  it("passwords need 10+ chars, mixed case, a number and symbol, max 72", () => {
    expect(passwordError("Short1!")).not.toBeNull();
    expect(passwordError("alllowercase1!")).not.toBeNull();
    expect(passwordError("Tr0ub4dor&Horse")).toBeNull();
    expect(passwordError("Aa1!" + "x".repeat(70))).not.toBeNull();
    expect(passwordStrength("Tr0ub4dor&Horse").acceptable).toBe(true);
  });

  it("passwords may not contain the username or a common word", () => {
    expect(passwordError("Nightreader#2026", ["nightreader"])).not.toBeNull();
    expect(passwordError("MyPassword#2026")).not.toBeNull();
  });

  it("comments are 1 to 1000 characters", () => {
    expect(commentTextSchema.safeParse("   ").success).toBe(false);
    expect(commentTextSchema.safeParse("x".repeat(1000)).success).toBe(true);
    expect(commentTextSchema.safeParse("x".repeat(1001)).success).toBe(false);
  });

  it("limits match the agreed defaults", () => {
    expect(LIMITS.commentsPerArticle).toBe(30);
    expect(LIMITS.commentBurst).toBe(5);
    expect(LIMITS.replyDepthMax).toBe(3);
    expect(LIMITS.sessionIdleDays).toBe(30);
  });

  it("comments can be edited for 30 minutes", () => {
    const now = new Date("2026-10-27T12:00:00Z");
    expect(canEditComment(new Date("2026-10-27T11:31:00Z"), now)).toBe(true);
    expect(canEditComment(new Date("2026-10-27T11:29:00Z"), now)).toBe(false);
  });
});
