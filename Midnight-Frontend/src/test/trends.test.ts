import { describe, expect, it, beforeEach } from "vitest";
import { setTrends, searchTrends, sortTrends, trendHashtags, trendsInHashtag, trendDiscussionSlug, type Trend } from "@/data/trends";
import { searchArticles } from "@/data/news";
import { trendSchema } from "@/lib/mongodb/schemas";

const make = (slug: string, o: Partial<Trend> = {}): Trend => ({
  id: slug, slug, title: `Zzqx ${slug}`, subtitle: "", excerpt: "", body: [], summary: [], hashtags: ["Fashion"],
  img: "x", imageAlt: "", readingMinutes: 2, time: "2 min", publishedAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
  views: null, shares: null, headlineWeight: 0, featured: false, sourceName: null, sourceUrl: null, ...o,
});

describe("Midnight Trends", () => {
  beforeEach(() => setTrends([
    make("a", { publishedAt: "2026-10-03T00:00:00Z", views: 5 }),
    make("b", { publishedAt: "2026-10-01T00:00:00Z", views: 50, hashtags: ["Food"] }),
    make("c", { publishedAt: "2026-10-02T00:00:00Z", views: 1, hashtags: ["Fashion", "Food"] }),
  ]));

  it("never appears in the general news search", () => {
    expect(searchArticles("zzqx")).toHaveLength(0);
    expect(searchTrends("zzqx").map((t) => t.slug)).toEqual(["a", "c", "b"]);
  });
  it("filters by hashtag only within trends", () => {
    expect(trendsInHashtag("food").map((t) => t.slug)).toEqual(["c", "b"]);
    expect(trendHashtags()).toEqual(["Fashion", "Food"]);
  });
  it("sorts latest, oldest and popular", () => {
    const l = trendsInHashtag("fashion").concat(trendsInHashtag("food"));
    expect(sortTrends(l, "latest").map((t) => t.slug)[0]).toBe("a");
    expect(sortTrends(l, "oldest").map((t) => t.slug)[0]).toBe("b");
    expect(sortTrends(l, "popular").map((t) => t.slug)[0]).toBe("b");
  });
  it("keeps trend discussions apart from news discussions", () => {
    expect(trendDiscussionSlug("a")).not.toBe("a");
  });
  it("requires at least one hashtag in stored trends", () => {
    const shape = trendSchema.shape.hashtags;
    expect(shape.safeParse([]).success).toBe(false);
    expect(shape.safeParse(["Fashion"]).success).toBe(true);
  });
});
