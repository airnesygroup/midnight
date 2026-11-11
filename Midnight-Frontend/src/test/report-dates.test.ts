import { describe, expect, it } from "vitest";
import { filterReportDates, REPORT_PUBLICATION_HOUR_UTC } from "@/lib/report-dates";

it("sets the Midnight Report publication hour to 13 UTC", () => {
  expect(REPORT_PUBLICATION_HOUR_UTC).toBe(13);
});

describe("report date filter", () => {
  const all = ["2026-10-26", "2026-03-05", "2026-02-11", "2025-02-03", "2025-01-01"];
  it("finds one exact day/month/year", () => expect(filterReportDates(all, { day: "5", month: "3", year: "2026" })).toEqual(["2026-03-05"]));
  it("filters by month across years", () => expect(filterReportDates(all, { month: "02" })).toEqual(["2026-02-11", "2025-02-03"]));
});
