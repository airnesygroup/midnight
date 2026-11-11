import { describe, expect, it } from "vitest";
import { formatPublishedShort } from "@/data/news";

const now = new Date("2026-10-26T12:00:00Z");
describe("article published date", () => {
  it("omits the year for current-year stories", () => {
    expect(formatPublishedShort("2026-10-15T17:47:00Z", now)).toBe("15th October");
  });
  it("shows the year for stories from past years", () => {
    expect(formatPublishedShort("2025-03-02T09:00:00Z", now)).toBe("2nd March 2025");
  });
});
