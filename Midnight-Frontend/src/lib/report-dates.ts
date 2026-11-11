/** Helpers for Midnight Report edition dates; the dates themselves come from MongoDB. */
export function filterReportDates(dates: string[], f: { day?: string; month?: string; year?: string }) {
  const pad = (v: string) => v.padStart(2, "0");
  return dates.filter((iso) => {
    const [y = "", m = "", d = ""] = iso.split("-");
    if (f.year && !y.startsWith(f.year)) return false;
    if (f.month && m !== pad(f.month)) return false;
    if (f.day && d !== pad(f.day)) return false;
    return true;
  });
}

export const REPORT_PUBLICATION_HOUR_UTC = 13;

export function formatReportDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })} · ${String(REPORT_PUBLICATION_HOUR_UTC).padStart(2, "0")}:00 UTC`;
}
