import { describe, expect, it } from "vitest";
import { emptyPublicationDate, filterByPublicationDate, publicationDateError } from "@/lib/publication-date";

const stories = [
  { slug: "october", publishedAt: "2026-10-31T14:00:00Z" },
  { slug: "previous-year", publishedAt: "2025-10-31T23:59:00Z" },
  { slug: "other-day", publishedAt: "2026-10-30T12:00:00Z" },
  { slug: "other-month", publishedAt: "2026-03-31T12:00:00Z" },
  { slug: "unknown", publishedAt: "" },
];
describe("publication date filters for stories and trends", () => {
  it("combines typed day, month and year", () => expect(filterByPublicationDate(stories, { day: "31", month: "10", year: "2026" }).map(s => s.slug)).toEqual(["october"]));
  it("filters a month without requiring a day or year", () => expect(filterByPublicationDate(stories, { day: "", month: "10", year: "" }).map(s => s.slug)).toEqual(["october", "previous-year", "other-day"]));
  it("filters a day independently", () => expect(filterByPublicationDate(stories, { day: "31", month: "", year: "" }).map(s => s.slug)).toEqual(["october", "previous-year", "other-month"]));
  it("matches the year exactly", () => expect(filterByPublicationDate(stories, { day: "", month: "", year: "2025" }).map(s => s.slug)).toEqual(["previous-year"]));
  it("clearing restores stories with unknown dates", () => expect(filterByPublicationDate(stories, emptyPublicationDate)).toEqual(stories));
  it("uses the UTC date printed on story cards", () => expect(filterByPublicationDate([{ publishedAt: "2026-11-01T01:00:00+03:00" }], { day: "31", month: "10", year: "2026" })).toHaveLength(1));
  it("rejects impossible calendar dates", () => expect(publicationDateError({ day: "31", month: "2", year: "2026" })).toBeDefined());
  it("accepts leap day only in leap years", () => {
    expect(publicationDateError({ day: "29", month: "2", year: "2024" })).toBeUndefined();
    expect(publicationDateError({ day: "29", month: "2", year: "2026" })).toBeDefined();
  });
  it("keeps article and trend date selections independent", () => {
    expect(filterByPublicationDate(stories, { day: "", month: "3", year: "" }).map(s => s.slug)).toEqual(["other-month"]);
    expect(filterByPublicationDate(stories, emptyPublicationDate)).toHaveLength(5);
  });
});