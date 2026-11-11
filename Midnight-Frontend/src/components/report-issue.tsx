import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Moon } from "lucide-react";
import { Loader, LoaderBlock } from "@/components/loader";

import { ReportDatePicker } from "@/components/report-date-picker";
import { DataUnavailable } from "@/components/data-unavailable";
import { reportDatesQuery, reportQuery } from "@/lib/reports.functions";

export function ReportIssue() {
  const dates = useQuery(reportDatesQuery);
  const [date, setDate] = useState<string | null>(null);
  useEffect(() => { if (!date && dates.data?.dates[0]) setDate(dates.data.dates[0]); }, [dates.data, date]);
  const report = useQuery({ ...reportQuery(date ?? "1970-01-01"), enabled: !!date });
  const r = report.data?.report;

  return (
    <article className="mx-auto max-w-3xl">
      <div className="border-b border-navigation-border pb-6 text-center">
        <h1 className="font-serif text-5xl font-semibold md:text-6xl">The Midnight Report</h1>
        {date && dates.data && <ReportDatePicker value={date} dates={dates.data.dates} onChange={setDate} />}
      </div>
      {dates.isPending || (date && report.isPending) ? (
        <LoaderBlock label="Loading the report" className="mt-12 py-8" />
      ) : dates.isError || dates.data?.unavailable || report.data?.unavailable || report.isError ? (
        <DataUnavailable title="The report couldn't load right now" text="We can't reach the report archive at the moment. Please try again shortly." />
      ) : !r ? (
        <div className="glass mx-auto mt-8 flex max-w-xl flex-col items-center gap-3 rounded-[2rem] p-10 text-center">
          <Moon className="h-8 w-8 text-muted-foreground" />
          <h2 className="text-lg font-extrabold">No edition published yet</h2>
          <p className="text-sm text-muted-foreground">The latest Midnight Report will appear here as soon as it's published.</p>
        </div>
      ) : (
        <div className="glass mt-8 space-y-6 rounded-[2rem] p-6 text-lg leading-relaxed md:p-10">
          {r.introduction && <p className="font-serif text-2xl">{r.introduction}</p>}
          <h3 className="text-xl font-bold">{r.leadTitle}</h3>
          {r.leadExcerpt && <p className="text-muted-foreground">{r.leadExcerpt}</p>}
          {r.leadParagraphs.map((p, i) => <p key={i} className="text-muted-foreground">{p}</p>)}
          {r.sections.map((s, i) => (
            <section key={i} className="border-t pt-5">
              <p className="text-xs font-semibold uppercase text-muted-foreground">{s.tag}</p>
              <h3 className="mt-2 text-xl font-bold">{s.title}</h3>
              {s.paragraphs.map((p, j) => <p key={j} className="mt-3 text-muted-foreground">{p}</p>)}
            </section>
          ))}
          {r.lastWord && (
            <section className="border-t pt-5">
              <p className="text-xs font-semibold uppercase text-muted-foreground">The last word</p>
              <p className="mt-3 font-serif text-xl text-foreground/80 italic">{r.lastWord}</p>
            </section>
          )}
        </div>
      )}
    </article>
  );
}
