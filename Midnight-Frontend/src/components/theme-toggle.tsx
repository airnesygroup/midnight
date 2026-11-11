import { useEffect, useState } from "react";
import { Menu, Moon, Sun } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const KEY = "midnight-theme";

/** Inline script run before paint so the saved theme never flashes. Dark is the default. */
export const themeBootScript = `try{if(localStorage.getItem("${KEY}")!=="light")document.documentElement.classList.add("dark")}catch(e){document.documentElement.classList.add("dark")}`;

export function useThemeMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    setDark(next);
    const root = document.documentElement;
    root.classList.add("theme-switching");
    root.classList.toggle("dark", next);
    try { localStorage.setItem(KEY, next ? "dark" : "light"); } catch { /* ignore */ }
    window.setTimeout(() => root.classList.remove("theme-switching"), 450);
  };
  return { dark, toggle };
}

function Row({ dark }: { dark: boolean }) {
  return (
    <>
      {dark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
      <span className="flex-1">{dark ? "Light mode" : "Dark mode"}</span>
      <span aria-hidden className="theme-switch" data-on={dark}><span className="theme-switch-knob" /></span>
    </>
  );
}

/** Theme row for the full-width section menu panel. */
export function ThemeMenuRow() {
  const { dark, toggle } = useThemeMode();
  return (
    <button type="button" role="switch" aria-checked={dark} onClick={toggle}
      className="col-span-2 flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-base font-semibold hover:bg-navigation-highlight">
      <Row dark={dark} />
    </button>
  );
}

/** Theme item inside a dropdown menu (keeps the menu open while switching). */
export function ThemeMenuItem() {
  const { dark, toggle } = useThemeMode();
  return (
    <DropdownMenuItem className="rounded-xl" onSelect={(e) => { e.preventDefault(); toggle(); }}>
      <Row dark={dark} />
    </DropdownMenuItem>
  );
}

/** Small menu for headers that have no other dropdown (signed-out compact header). */
export function ThemeMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Open menu" className="grid h-11 w-11 place-items-center rounded-full outline-none hover:bg-navigation-highlight focus-visible:ring-2 focus-visible:ring-ring">
        <Menu className="h-5 w-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="glass-strong w-52 rounded-2xl p-2">
        <ThemeMenuItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Sun/moon button shown directly on the header on large screens. */
export function ThemeHeaderButton({ className = "" }: { className?: string }) {
  const { dark, toggle } = useThemeMode();
  return (
    <button type="button" role="switch" aria-checked={dark} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} onClick={toggle}
      className={`h-11 w-11 shrink-0 place-items-center rounded-full outline-none hover:bg-navigation-highlight focus-visible:ring-2 focus-visible:ring-ring ${className}`}>
      {dark ? <Sun className="h-5 w-5" aria-hidden /> : <Moon className="h-5 w-5" aria-hidden />}
    </button>
  );
}
