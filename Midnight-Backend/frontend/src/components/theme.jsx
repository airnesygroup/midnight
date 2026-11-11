import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

// Same key and behaviour as the Midnight site (Lovable app): dark is the default, the choice is remembered.
export const THEME_KEY = "midnight-theme";

const subscribe = (cb) => {
  const o = new MutationObserver(cb);
  o.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => o.disconnect();
};
const isDark = () => document.documentElement.classList.contains("dark");

export function useThemeMode() {
  const dark = useSyncExternalStore(subscribe, isDark, () => true);
  const toggle = () => {
    const next = !isDark();
    const root = document.documentElement;
    root.classList.add("theme-switching");
    root.classList.toggle("dark", next);
    try { localStorage.setItem(THEME_KEY, next ? "dark" : "light"); } catch { /* ignore */ }
    window.setTimeout(() => root.classList.remove("theme-switching"), 450);
  };
  return { dark, toggle, label: dark ? "Light mode" : "Dark mode", Icon: dark ? Sun : Moon };
}
