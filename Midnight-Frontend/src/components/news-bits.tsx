import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function MidnightLogo({ size = "h-7 w-7" }: { size?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-primary text-primary-foreground ${size}`}>
      <svg viewBox="0 0 24 24" className="h-[60%] w-[60%]" fill="currentColor" aria-hidden>
        <path d="M14.5 2.5a9.5 9.5 0 1 0 7 15.9A8 8 0 0 1 14.5 2.5Z" />
        <circle cx="17.5" cy="6.5" r="1.1" />
        <circle cx="20.5" cy="10.5" r="0.7" />
      </svg>
    </span>
  );
}

/** Single-line title that slides left on card hover to reveal truncated text. */
export function ScrollTitle({ text }: { text: string }) {
  const outer = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const measure = () => {
      const inner = el.firstElementChild as HTMLElement | null;
      if (!inner) return;
      const overflow = inner.scrollWidth - el.clientWidth;
      el.style.setProperty("--shift", `${overflow > 0 ? -overflow - 8 : 0}px`);
      el.style.setProperty("--dur", `${Math.max(1.5, overflow / 40)}s`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return (
    <span ref={outer} className="scroll-title" title={text}>
      <span>{text}</span>
    </span>
  );
}

export function ClampTitle({ text, lines = 3 }: { text: string; lines?: 2 | 3 | 4 }) {
  const outer = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const measure = () => {
      const inner = el.firstElementChild as HTMLElement | null;
      if (!inner) return;
      const clone = inner.cloneNode(true) as HTMLElement;
      clone.style.cssText = "display:block;position:absolute;visibility:hidden;-webkit-line-clamp:unset;width:" + el.clientWidth + "px";
      el.appendChild(clone);
      const overflow = clone.scrollHeight - el.clientHeight;
      clone.remove();
      el.style.setProperty("--vshift", `${overflow > 0 ? -overflow : 0}px`);
      el.style.setProperty("--vdur", `${Math.max(1.5, overflow / 20)}s`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, lines]);
  return (
    <span ref={outer} className={`clamp-title clamp-title-${lines} relative`} title={text}>
      <span>{text}</span>
    </span>
  );
}

export function IconTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export const moreCategories = [
  "Politics", "Entertainment", "Travel", "Style", "Food", "Education",
  "Real Estate", "Automotive", "Weather", "Crypto", "Gaming", "Africa",
];

export function MoreMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1 outline-hidden">
        More <ChevronDown className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={14} className="glass grid w-80 grid-cols-2 gap-1 rounded-2xl border-0 p-2">
        {moreCategories.map((c) => (
          <DropdownMenuItem key={c} className="rounded-xl px-3 py-2 font-medium">
            {c}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
