import { createServerFn } from "@tanstack/react-start";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

export const getReportDates = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { listReportDates } = await import("./reports.server");
    return { dates: await listReportDates(), unavailable: false };
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
      return { report: await loadReport(data.date), unavailable: false };
    } catch (e) {
      console.error("report unavailable", e);
      return { report: null, unavailable: true };
    }
  });

export const reportDatesQuery = queryOptions({ queryKey: ["report-dates"], queryFn: () => getReportDates(), staleTime: 5 * 60_000 });
export const reportQuery = (date: string) => queryOptions({ queryKey: ["report", date], queryFn: () => getReport({ data: { date } }), staleTime: 10 * 60_000 });
