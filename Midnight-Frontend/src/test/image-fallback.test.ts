import { describe, expect, it } from "vitest";
import { FALLBACK_GRADIENTS, fallbackIndex } from "@/lib/image-fallback";

describe("missing photo gradients", () => {
  it("offers 20 fixed gradients", () => {
    expect(FALLBACK_GRADIENTS).toBe(20);
  });
  it("the same missing photo always gets the same gradient", () => {
    expect(fallbackIndex("asset:news-tech.jpg")).toBe(fallbackIndex("asset:news-tech.jpg"));
  });
  it("always picks one of the 20 gradients", () => {
    for (const src of ["", "asset:news-tech.jpg", "asset:news-science.jpg", "https://x.test/a.jpg", "b".repeat(500)]) {
      const i = fallbackIndex(src);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(20);
    }
  });
  it("different photos spread across several gradients", () => {
    const used = new Set(Array.from({ length: 100 }, (_, n) => fallbackIndex(`https://x.test/photo-${n}.jpg`)));
    expect(used.size).toBeGreaterThan(10);
  });
});
