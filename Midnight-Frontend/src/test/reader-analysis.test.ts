import { describe, expect, it } from "vitest";
import { estimatedBot, periodBounds, readerClass, recordedDateMatch, readingInput, timeSlice } from "../lib/reader-analysis";

describe("analytics periods", () => {
  const now = new Date("2026-11-05T06:07:00Z");
  it("Overview includes the first recorded day, with no 30-day lower bound", () => {
    expect(periodBounds(null, now)).toEqual({ $lte: now });
  });
  it("24-hour analytics uses exactly the previous 24 hours, not the calendar day", () => {
    expect(periodBounds(1, now)).toEqual({ $gte: new Date("2026-11-04T06:07:00Z"), $lte: now });
  });
  it("filters stored article dates through date conversion rather than BSON-only comparison", () => {
    expect(recordedDateMatch("publishedAt", 1, now).$expr?.$and[0]).toEqual({ $gte: [{ $convert: { input: "$publishedAt", to: "date", onError: null, onNull: null } }, new Date("2026-11-04T06:07:00Z")] });
  });
});
describe("actual reader activity", () => {
  it("does not count a hidden tab as reading", () => {
    expect(timeSlice(0, 10_000, 0, false, true)).toEqual({ activeMs: 0, idleMs: 0, hiddenMs: 10_000 });
  });
  it("does not count an unfocused tab as reading", () => {
    expect(timeSlice(0, 10_000, 0, true, false)).toEqual({ activeMs: 0, idleMs: 0, hiddenMs: 10_000 });
  });
  it("stops active reading after inactivity and splits the interval", () => {
    expect(timeSlice(55_000, 65_000, 0, true, true)).toEqual({ activeMs: 5000, idleMs: 5000, hiddenMs: 0 });
  });
  it("does not turn a sleeping computer into hours of reading", () => {
    expect(timeSlice(0, 3_600_000, 0, true, true)).toEqual({ activeMs: 0, idleMs: 30_000, hiddenMs: 0 });
  });
  it("opening a page alone is not proof of an active reader", () => {
    expect(readerClass(false, 30_000, 0)).toBe("Unconfirmed / idle");
    expect(readerClass(false, 10_000, 1)).toBe("Active reader");
  });
  it("keeps automated browser visits out of active readers", () => {
    expect(estimatedBot("Mozilla/5.0", true)).toBe(true);
    expect(estimatedBot("Googlebot", false)).toBe(true);
    expect(readerClass(true, 60_000, 10)).toBe("Likely bot");
  });
  it("rejects inflated reading reports", () => {
    expect(readingInput.safeParse({ pageId: "c968198a-e6c1-46e4-91c5-9f3c7f27a334", token: "c968198a-e6c1-46e4-91c5-9f3c7f27a334", sequence: 1, activeMs: 30_000, idleMs: 1, hiddenMs: 0, scroll: 0, interactions: 0 }).success).toBe(false);
  });
});