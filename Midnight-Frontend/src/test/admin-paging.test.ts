import { describe, expect, it } from "vitest";
import { escapeRegex, pageInput, slicePage, toPage } from "@/lib/admin-paging";

describe("admin batches", () => {
  it("sends 20 items per batch by default", () => {
    expect(pageInput.parse({}).limit).toBe(20);
  });
  it("never sends more than 50 items in one batch", () => {
    expect(() => pageInput.parse({ limit: 51 })).toThrow();
  });
  it("points at the next batch until everything is sent", () => {
    const all = Array.from({ length: 45 }, (_, i) => i);
    expect(slicePage(all, 0, 20).nextOffset).toBe(20);
    expect(slicePage(all, 20, 20).nextOffset).toBe(40);
    const last = slicePage(all, 40, 20);
    expect(last.rows).toEqual([40, 41, 42, 43, 44]);
    expect(last.nextOffset).toBeNull();
  });
  it("stops when a batch comes back empty", () => {
    expect(toPage([], 10, 20).nextOffset).toBeNull();
  });
  it("matches typed symbols literally", () => {
    expect(new RegExp(escapeRegex("a.b(c)")).test("axb(c)")).toBe(false);
  });
});
