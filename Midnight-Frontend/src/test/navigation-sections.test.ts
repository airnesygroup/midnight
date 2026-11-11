import { afterEach, describe, expect, it } from "vitest";
import { articles, navigationSections, sections, setCatalogue } from "@/data/news";

const original = { articles, sections };
afterEach(() => setCatalogue(original));

describe("Full category navigation", () => {
  it("includes scrolling-header categories and additional catalogue categories with their stored slugs", () => {
    setCatalogue({ articles: [], sections: [
      { slug: "world", name: "World", desc: "", tags: [] },
      { slug: "tech", name: "Technology", desc: "", tags: [] },
      { slug: "space", name: "Space", desc: "", tags: [] },
    ] });
    expect(navigationSections(["World", "Tech"])).toEqual([
      { slug: "world", name: "World" },
      { slug: "tech", name: "Technology" },
      { slug: "space", name: "Space" },
    ]);
  });

  it("keeps every existing category accessible when the catalogue is empty", () => {
    setCatalogue({ articles: [], sections: [] });
    expect(navigationSections(["World", "Politics", "Sport", "Politics", "Health & Science"])).toEqual([
      { slug: "world", name: "World" },
      { slug: "politics", name: "Politics" },
      { slug: "sport", name: "Sport" },
      { slug: "health-and-science", name: "Health & Science" },
    ]);
  });
});