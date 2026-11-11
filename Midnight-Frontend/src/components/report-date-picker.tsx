import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { filterReportDates, formatReportDate } from "@/lib/report-dates";

const PAGE = 30;

/** Pill showing the current edition's date; opens a scrollable, filterable list of past editions on click or hover. */
export function ReportDatePicker({ value, dates, onChange }: { value: string; dates: string[]; onChange: (iso: string) => void }) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [shown, setShown] = useState(PAGE);
  const closeTimer = useRef<number | null>(null);
  const canHover = useRef(false);
  const all = dates;
  const matches = useMemo(() => filterReportDates(all, { day, month, year }), [all, day, month, year]);
  const field = "search-field h-11 w-full rounded-full bg-transparent px-3 text-center text-base outline-hidden placeholder:text-muted-foreground sm:h-12 sm:px-3 sm:text-base md:h-14 md:px-4 md:text-lg";
  const reset = (fn: (v: string) => void) => (v: string) => { fn(v.replace(/\D/g, "")); setShown(PAGE); };

  // Hover-to-open only on pointer devices; touch taps keep the plain click toggle.
  useEffect(() => {
    canHover.current = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    return () => { if (closeTimer.current !== null) clearTimeout(closeTimer.current); };
  }, []);

  const inside = useRef(false);
  const cancelClose = () => { if (closeTimer.current !== null) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = window.setTimeout(() => { if (!inside.current) setOpen(false); }, 200); };
  const onEnter = () => { if (!canHover.current) return; inside.current = true; cancelClose(); setOpen(true); };
  const onLeave = () => { if (!canHover.current) return; inside.current = false; scheduleClose(); };
  // Ignore close requests while the mouse is over the button or pop-up (stops flicker).
  const onOpenChange = (next: boolean) => { if (!next && inside.current) return; setOpen(next); };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        className="pill-glass mt-5 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onPointerDown={(e) => { if (e.pointerType === "mouse" && open) e.preventDefault(); }}
        onClick={(e) => { if (canHover.current && open) e.preventDefault(); }}
      >
        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
        <time dateTime={value}>{formatReportDate(value)}</time>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={10}
        className="glass-strong w-[min(24rem,calc(100vw-2rem))] rounded-2xl border-0 p-2 sm:w-[26rem] sm:p-3 md:w-[30rem] md:p-4"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-2 p-1 sm:gap-3 sm:p-2 md:gap-4">
          <input aria-label="Day" placeholder="DD" maxLength={2} inputMode="numeric" value={day} onChange={(e) => reset(setDay)(e.target.value)} className={field} />
          <input aria-label="Month" placeholder="MM" maxLength={2} inputMode="numeric" value={month} onChange={(e) => reset(setMonth)(e.target.value)} className={field} />
          <input aria-label="Year" placeholder="YYYY" maxLength={4} inputMode="numeric" value={year} onChange={(e) => reset(setYear)(e.target.value)} className={field} />
        </div>
        <ul
          className="mt-1 max-h-64 overflow-y-auto overscroll-contain sm:mt-2 sm:max-h-96 md:max-h-[28rem]"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) setShown((n) => Math.min(n + PAGE, matches.length));
          }}
        >
          {matches.length === 0 && <li className="px-3 py-3 text-base text-muted-foreground sm:text-sm">No reports on that date.</li>}
          {matches.slice(0, shown).map((iso) => (
            <li key={iso}>
              <button
                onClick={() => { onChange(iso); setOpen(false); }}
                data-active={iso === value || undefined}
                className="nav-hover w-full rounded-xl px-3 py-2.5 text-left text-base font-medium data-[active]:bg-navigation-highlight data-[active]:font-bold sm:py-2 sm:text-base"
              >
                {formatReportDate(iso)}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
