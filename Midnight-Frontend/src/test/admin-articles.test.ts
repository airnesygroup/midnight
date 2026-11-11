import { describe, expect, it } from "vitest";
import { articleBulkInput, articleEditFields, articleFilter, articleInput, articleListInput, selectedArticleFilter } from "@/lib/admin-articles";
import { publicationStatus } from "@/lib/mongodb/schemas";

const input = { slug: "test-story", title: "Story", subtitle: "", excerpt: "", body: ["A & B"], summary: [], section: "world", tag: "World", img: "https://example.com/photo.jpg", imageAlt: "", featured: false, headlineWeight: 10 };
describe("admin article rules", () => {
  it("single deletion targets only that article", () => { expect(selectedArticleFilter(["one-story"])).toEqual({ slug: { $in: ["one-story"] } }); });
  it("bulk deletion targets only selected distinct articles", () => { expect(selectedArticleFilter(["one-story", "two-story", "one-story"])).toEqual({ slug: { $in: ["one-story", "two-story"] } }); });
  it("refuses deletion with no selection", () => { expect(articleBulkInput.safeParse({ slugs: [], action: "delete" }).success).toBe(false); });
  it("supports the Pause action in the database status contract", () => { expect(publicationStatus.parse("paused")).toBe("paused"); });
  it("searches by the stored source name", () => {
    expect(articleFilter(articleListInput.parse({ q: "BBC" })).$and?.[0]).toMatchObject({ $or: expect.arrayContaining([{ source_name: { $regex: "bbc", $options: "i" } }]) });
  });
  it("filters exactly by source before pagination", () => { expect(articleFilter(articleListInput.parse({ source: "BBC World" }))).toEqual({ $and: [{ source_name: "BBC World" }] }); });
  it("published filtering excludes drafts and archived stories", () => { expect(articleFilter(articleListInput.parse({ status: "published" }))).toEqual({ $and: [{ status: "published" }] }); });
  it("rejects invalid edited fields before MongoDB validation", () => { expect(articleInput.safeParse({ ...input, section: "World news" }).success).toBe(false); expect(articleInput.safeParse({ ...input, tag: "" }).success).toBe(false); expect(articleInput.safeParse({ ...input, img: "" }).success).toBe(false); });
  it("body edits update escaped HTML and use ISO timestamps", () => {
    const fields = articleEditFields(input, { section: "world", body: ["Old"] }, new Date("2026-11-01T17:52:00Z"));
    expect(fields).toMatchObject({ html_body: "<p>A &amp; B</p>", updatedAt: "2026-11-01T17:52:00.000Z" });
  });
  it("does not overwrite rich HTML when body is unchanged", () => { expect(articleEditFields(input, { section: "world", body: input.body })).not.toHaveProperty("html_body"); });
});