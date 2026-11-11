import { describe, expect, it } from "vitest";
import { articles, footerSections, getArticle, infoPages, searchArticles, sectionForTag, slugify } from "@/data/news";

describe("site pages", () => {
  it("every article slug resolves to its article", () => {
    for (const a of articles) expect(getArticle(a.slug)?.slug).toBe(a.slug);
  });
  it("every non-section footer link has a page", () => {
    for (const col of footerSections.filter((c) => c.heading !== "Sections"))
      for (const l of col.links) expect(infoPages[slugify(l)]).toBeDefined();
  });
  it("podcasts and films pages are gone", () => {
    expect(infoPages["podcasts"]).toBeUndefined();
    expect(infoPages["midnight-films"]).toBeUndefined();
  });
  it("Technology footer link goes to the tech section", () => {
    expect(sectionForTag("Technology").slug).toBe("tech");
  });
  it("search finds a story by a word in its headline", () => {
    const a = articles[0]!;
    const word = a.title.split(/\s+/).find((w) => w.length > 4) ?? a.title;
    expect(searchArticles(word).map((x) => x.slug)).toContain(a.slug);
  });
});

