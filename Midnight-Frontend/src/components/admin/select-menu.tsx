import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, CalendarRange } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { DAY_PRESETS, MAX_DAYS, daysLabel, parseDays } from "@/lib/admin-filters";

export type Option<T> = { value: T; label: string; hint?: string };

/** Moves focus between menu items with the arrow keys. */
function onMenuKeys(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-menu-item]")];
  if (!items.length) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
  items[next]?.focus();
}

function Trigger({ prefix, value, icon }: { prefix?: string | undefined; value: string; icon?: ReactNode | undefined }) {
  return (
    <Popover.Trigger className="admin-select">
      {icon}
      {prefix && <span className="admin-select-prefix">{prefix}</span>}
      <span className="admin-select-value">{value}</span>
      <ChevronDown className="admin-select-chevron" />
    </Popover.Trigger>
  );
}

/** Midnight's own single-choice dropdown. */
export function SelectMenu<T extends string | number | null>({ prefix, value, options, onChange, icon, align = "start" }: {
  prefix?: string; value: T; options: Option<T>[]; onChange: (v: T) => void; icon?: ReactNode; align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <Popover.Root modal open={open} onOpenChange={setOpen}>
      <Trigger prefix={prefix} value={current?.label ?? ""} icon={icon} />
      <Popover.Portal>
        <Popover.Content align={align} sideOffset={8} collisionPadding={12} className="admin-menu" onKeyDown={onMenuKeys}
          onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus(); }}>
          <div role="listbox" aria-label={prefix}>
            {options.map((o) => (
              <button key={String(o.value)} type="button" role="option" data-menu-item aria-selected={o.value === value} className="admin-menu-item"
                onClick={() => { onChange(o.value); setOpen(false); }}>
                <span className="min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block truncate text-xs font-medium text-muted-foreground">{o.hint}</span>}
                </span>
                {o.value === value && <Check className="admin-menu-check" />}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Time range dropdown: quick presets plus any exact number of days. `null` = all time (only when allowAll). */
export function DaysPicker({ value, onChange, allowAll = false, max = MAX_DAYS, prefix, align = "start" }: {
  value: number | null; onChange: (v: number | null) => void; allowAll?: boolean; max?: number; prefix?: string; align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pick = (v: number | null) => { onChange(v); setOpen(false); setTyped(""); setError(null); };
  const apply = () => {
    const n = parseDays(typed, max);
    if (n == null) { setError(`Enter a whole number from 1 to ${max}`); inputRef.current?.focus(); return; }
    pick(n);
  };
  const presets: (number | null)[] = [...(allowAll ? [null] : []), ...DAY_PRESETS.filter((d) => d <= max)];
  const isCustom = value != null && !presets.includes(value);
  return (
    <Popover.Root modal open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <Trigger prefix={prefix} value={daysLabel(value)} icon={<CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" />} />
      <Popover.Portal>
        <Popover.Content align={align} sideOffset={8} collisionPadding={12} className="admin-menu" onKeyDown={onMenuKeys}
          onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus(); }}>
          <p className="admin-menu-heading">Quick ranges</p>
          <div role="listbox" aria-label="Time range">
            {presets.map((d) => (
              <button key={String(d)} type="button" role="option" data-menu-item aria-selected={d === value} className="admin-menu-item" onClick={() => pick(d)}>
                {daysLabel(d)}
                {d === value && <Check className="admin-menu-check" />}
              </button>
            ))}
          </div>
          <div className="admin-menu-sep" />
          <p className="admin-menu-heading">Exact number of days</p>
          <form className="flex items-center gap-2 px-1.5 pb-1.5" onSubmit={(e) => { e.preventDefault(); apply(); }}>
            <div className="admin-search h-10 flex-1 px-3">
              <span className="text-sm font-semibold text-muted-foreground">Last</span>
              <input ref={inputRef} inputMode="numeric" aria-label="Number of days" placeholder={isCustom ? String(value) : "e.g. 27"} value={typed}
                onChange={(e) => { setTyped(e.target.value.replace(/[^\d]/g, "").slice(0, 4)); setError(null); }} className="w-full text-sm font-bold" />
              <span className="text-sm font-semibold text-muted-foreground">days</span>
            </div>
            <button type="submit" className="admin-btn min-h-10" data-tone="primary">Apply</button>
          </form>
          {error && <p role="alert" className="px-3 pb-2 text-xs font-semibold text-destructive">{error}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
