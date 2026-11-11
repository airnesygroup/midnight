import { describe, expect, it } from "vitest";
import { absUrl, CONTACT_EMAIL } from "@/lib/site";

describe("public site address", () => {
  it("builds absolute links on themidnightnews.com", () => {
    expect(absUrl("/article/x")).toBe("https://themidnightnews.com/article/x");
    expect(absUrl()).toBe("https://themidnightnews.com/");
  });
  it("uses the themidnightnews.com email domain", () => {
    expect(CONTACT_EMAIL).toBe("hello@themidnightnews.com");
  });
});
