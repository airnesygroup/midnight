import { useState } from "react";
import { CalendarDays, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { emptyPublicationDate, hasPublicationDate, publicationDateError, type PublicationDateFilter } from "@/lib/publication-date";

export function PublicationDatePicker({ value, onChange, subject }: {
  value: PublicationDateFilter;
  onChange: (value: PublicationDateFilter) => void;
  subject: "stories" | "trends";
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const error = publicationDateError(draft);
  const active = hasPublicationDate(value);
  const summary = active ? `${value.day || "DD"}/${value.month || "MM"}/${value.year || "YYYY"}` : "Date";
  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) setDraft(value); setOpen(next); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" aria-label={`Filter ${subject} by date`} className="pill-filter h-10 shrink-0 rounded-full px-4 font-bold" aria-pressed={active}>
          <CalendarDays /> {summary} <ChevronDown />
        </Button>
      </DialogTrigger>
      <DialogContent className="glass-strong w-[min(24rem,calc(100vw-2rem))] rounded-2xl border-0 p-4 sm:w-[26rem] sm:p-6 md:w-[30rem] md:p-8 [&>button:last-child]:hidden">
        <form onSubmit={(event) => { event.preventDefault(); if (!error) { onChange(draft); setOpen(false); } }}>
          <div className="mb-3 flex items-start justify-between gap-3 sm:mb-4">
            <DialogTitle className="text-sm font-bold sm:text-lg md:text-xl">Publication date</DialogTitle>
            <Button type="button" variant="ghost" aria-label="Close" onClick={() => setOpen(false)} className="search-field -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground sm:h-10 sm:w-10 [&_svg]:size-4 sm:[&_svg]:size-5"><X /></Button>
          </div>
          <DialogDescription className="sr-only">Choose a day, month and year to filter {subject}.</DialogDescription>
          <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-2 sm:gap-3 md:gap-4">
            {([['day', 'Day', 'DD', 2], ['month', 'Month', 'MM', 2], ['year', 'Year', 'YYYY', 4]] as const).map(([key, label, placeholder, maxLength]) => (
              <label key={key} className="min-w-0 text-xs font-medium text-muted-foreground sm:text-sm">
                {label}
                <Input inputMode="numeric" maxLength={maxLength} placeholder={placeholder} value={draft[key]} onChange={(event) => setDraft((prev) => ({ ...prev, [key]: event.target.value.replace(/\D/g, "") }))} className="search-field mt-1 h-11 rounded-full text-base text-center sm:h-12 sm:text-base md:h-14 md:text-lg" aria-invalid={!!error} />
              </label>
            ))}
          </div>
          {error && <p role="alert" className="mt-3 text-sm text-destructive sm:mt-4 sm:text-base">{error}</p>}
          <div className="mt-4 flex items-center justify-between gap-2 sm:mt-6 sm:gap-3">
            <Button type="button" variant="ghost" className="h-10 rounded-full px-3 text-sm sm:h-11 sm:px-4 sm:text-base" disabled={!active && !hasPublicationDate(draft)} onClick={() => { setDraft(emptyPublicationDate); onChange(emptyPublicationDate); setOpen(false); }}><X /> Clear</Button>
            <Button type="submit" className="h-10 rounded-full px-5 text-sm sm:h-11 sm:px-6 sm:text-base" disabled={!!error}>Apply</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}