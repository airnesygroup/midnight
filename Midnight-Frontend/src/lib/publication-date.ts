export type PublicationDateFilter = { day: string; month: string; year: string };
export const emptyPublicationDate: PublicationDateFilter = { day: "", month: "", year: "" };
export const hasPublicationDate = (filter: PublicationDateFilter) => Object.values(filter).some(Boolean);

export function publicationDateError({ day, month, year }: PublicationDateFilter): string | undefined {
  if (day && (!/^\d{1,2}$/.test(day) || Number(day) < 1 || Number(day) > 31)) return "Enter a day from 1 to 31.";
  if (month && (!/^\d{1,2}$/.test(month) || Number(month) < 1 || Number(month) > 12)) return "Enter a month from 1 to 12.";
  if (year && (!/^\d{4}$/.test(year) || Number(year) < 1)) return "Enter a four-digit year.";
  if (day && month) {
    const maxDay = new Date(Date.UTC(Number(year || "2000"), Number(month), 0)).getUTCDate();
    if (Number(day) > maxDay) return "That day does not exist in this month.";
  }
  return undefined;
}

/** Match the UTC publication date, consistent with dates printed on story cards. */
export function filterByPublicationDate<T extends { publishedAt?: string }>(items: T[], filter: PublicationDateFilter): T[] {
  if (!hasPublicationDate(filter)) return [...items];
  if (publicationDateError(filter)) return [];
  return items.filter(({ publishedAt }) => {
    if (!publishedAt) return false;
    const date = new Date(publishedAt);
    if (!Number.isFinite(date.getTime())) return false;
    return (!filter.day || date.getUTCDate() === Number(filter.day))
      && (!filter.month || date.getUTCMonth() + 1 === Number(filter.month))
      && (!filter.year || date.getUTCFullYear() === Number(filter.year));
  });
}