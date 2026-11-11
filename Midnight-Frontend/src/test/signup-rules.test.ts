import { describe, expect, it } from "vitest";
import { MAX_ACCOUNTS_PER_ADDRESS, SIGNUP_WINDOW_HOURS, signupLimitReached } from "@/lib/signup-rules";

describe("sign-up limit by network address", () => {
  it("first three accounts from an address sign up instantly", () => {
    expect(signupLimitReached(0)).toBe(false);
    expect(signupLimitReached(2)).toBe(false);
  });
  it("the fourth account from the same address within the window is refused", () => {
    expect(MAX_ACCOUNTS_PER_ADDRESS).toBe(3);
    expect(signupLimitReached(3)).toBe(true);
  });
  it("accounts are counted over 24 hours", () => {
    expect(SIGNUP_WINDOW_HOURS).toBe(24);
  });
});
