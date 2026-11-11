import { describe, expect, it } from "vitest";
import { daysLabel, matchesQuery, parseDays, withinDays } from "@/lib/admin-filters";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("admin time filter", () => {
  it("accepts any exact number of days the admin types", () => {
    expect(parseDays("1")).toBe(1);
    expect(parseDays("2")).toBe(2);
    expect(parseDays(" 27 ")).toBe(27);
  });
  it("rejects zero, negatives, decimals and words", () => {
    for (const v of ["0", "-3", "2.5", "abc", ""]) expect(parseDays(v)).toBeNull();
  });
  it("caps the number of days at one year", () => {
    expect(parseDays("900")).toBe(365);
  });
  it("27 days keeps something from 26 days ago and drops 28 days ago", () => {
    expect(withinDays(daysAgo(26), 27, NOW)).toBe(true);
    expect(withinDays(daysAgo(28), 27, NOW)).toBe(false);
  });
  it("all time keeps everything", () => {
    expect(withinDays(daysAgo(5000), null, NOW)).toBe(true);
  });
  it("labels the range", () => {
    expect(daysLabel(27)).toBe("Last 27 days");
    expect(daysLabel(null)).toBe("All time");
  });
});

describe("admin search", () => {
  it("needs every word to match, in any field, ignoring case", () => {
    expect(matchesQuery(["Election day in Israel", "world"], "israel WORLD")).toBe(true);
    expect(matchesQuery(["Election day in Israel", "world"], "israel sport")).toBe(false);
  });
});
