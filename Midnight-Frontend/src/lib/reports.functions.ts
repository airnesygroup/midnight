import { createServerFn } from "@tanstack/react-start";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

// Report data is the same for every visitor, so the CDN may keep it (see cdn-cache.server.ts).
const cdn = async (sMaxAge: number, staleWhileRevalidate: number) => (await import("./cdn-cache.server")).cachePublic(sMaxAge, staleWhileRevalidate);

export const getReportDates = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { listReportDates } = await import("./reports.server");
    const dates = await listReportDates();
    await cdn(300, 3600);
    return { dates, unavailable: false };
  } catch (e) {
    console.error("reports unavailable", e);
    return { dates: [] as string[], unavailable: true };
  }
});

export const getReport = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ data }) => {
    try {
      const { loadReport } = await import("./reports.server");
      const report = await loadReport(data.date);
      await cdn(300, 3600);
      return { report, unavailable: false };
    } catch (e) {
      console.error("report unavailable", e);
      return { report: null, unavailable: true };
    }
  });

export const reportDatesQuery = queryOptions({ queryKey: ["report-dates"], queryFn: () => getReportDates(), staleTime: 5 * 60_000 });
export const reportQuery = (date: string) => queryOptions({ queryKey: ["report", date], queryFn: () => getReport({ data: { date } }), staleTime: 10 * 60_000 });
