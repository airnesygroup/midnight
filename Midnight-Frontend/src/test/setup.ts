import "@testing-library/jest-dom/vitest";

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Data-backed checks read the live MongoDB catalogue when it is configured.
import { setCatalogue } from "@/data/news";
if (process.env["MONGODB_URI"]) {
  const { loadCatalogue } = await import("@/lib/catalogue.server");
  setCatalogue(await loadCatalogue());
}
