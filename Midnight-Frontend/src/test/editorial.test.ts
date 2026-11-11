import { describe, expect, it } from 'vitest';
import { articles, articlesInSection, canonicalStory, getArticle, getSection, relatedArticles, sortSectionArticles, topNews, type Article } from '@/data/news';

describe('editorial browsing rules', () => {
  it('business contains business stories alone', () => {
    const business = articlesInSection('business');
    expect(business.length).toBeGreaterThan(0);
    expect(business.every((article) => article.tag === 'Business' || (article.sections ?? []).includes('business'))).toBe(true);
  });
  it('opinion respects stored section membership and configured category tags', () => {
    const section = getSection('opinion');
    expect(section).toBeDefined();
    expect(articlesInSection('opinion').every((article) => article.section === 'opinion' || article.sections?.includes('opinion') || section?.tags.includes(article.tag))).toBe(true);
  });
  it('Africa shows only Africa-section stories', () => {
    expect(articlesInSection('africa').every((a) => a.section === 'africa' || (a.sections ?? []).includes('africa'))).toBe(true);
  });
  it('keep reading stays within the viewed category and excludes the current story', () => {
    for (const article of articles) {
      const section = getSection(article.section);
      expect(relatedArticles(article).every((other) => (other.section === article.section || (other.sections ?? []).includes(article.section) || section?.tags.includes(other.tag)) && other.slug !== article.slug)).toBe(true);
    }
    const article = articlesInSection('business')[0];
    expect(article && relatedArticles(article).length).toBeGreaterThan(0);
  });
  it('listing images use the same image as the opened article', () => {
    const article = getArticle(articles[0]?.slug ?? '');
    expect(article).toBeDefined();
    if (!article) throw new Error('Missing fixture');
    expect(canonicalStory({ ...article, img: 'incorrect-image' }).img).toBe(article.img);
  });
  const base = articles[0];
  if (!base) throw new Error('Missing fixture');
  const fixtures: Article[] = [
    { ...base, slug: 'a', publishedAt: '2026-10-25T12:00:00Z', views: 100, shares: 60 },
    { ...base, slug: 'b', publishedAt: '2026-10-26T12:00:00Z', views: 500, shares: 10 },
    { ...base, slug: 'c', publishedAt: '2026-10-24T12:00:00Z', views: 200, shares: 90 },
  ];
  it('latest sorts newest first', () => expect(sortSectionArticles(fixtures, 'latest').map((a) => a.slug)).toEqual(['b', 'a', 'c']));
  it('oldest sorts oldest first', () => expect(sortSectionArticles(fixtures, 'oldest').map((a) => a.slug)).toEqual(['c', 'a', 'b']));
  it('most popular uses readership counts', () => expect(sortSectionArticles(fixtures, 'popular').map((a) => a.slug)).toEqual(['b', 'c', 'a']));
  it('trending uses views per minute since publication, not shares', () => {
    const now = Date.parse('2026-10-26T12:00:00Z');
    const t: Article[] = [
      { ...base, slug: 'old-big', publishedAt: '2026-10-23T12:00:00Z', views: 4320, shares: 999 }, // 1/min
      { ...base, slug: 'new-small', publishedAt: '2026-10-26T11:00:00Z', views: 600, shares: 1 }, // 10/min
    ];
    expect(sortSectionArticles(t, 'trending', now).map((a) => a.slug)).toEqual(['new-small', 'old-big']);
  });
  it('top news is ordered by headline weight', () => {
    const top = topNews();
    expect(top.length).toBeGreaterThan(0);
    for (let i = 1; i < top.length; i++) {
      const previous = top[i - 1];
      const current = top[i];
      if (!previous || !current) throw new Error('Missing top-news entry');
      expect(previous.headlineWeight).toBeGreaterThanOrEqual(current.headlineWeight);
    }
  });
  it('every article carries the full schema and no writer', () => {
    for (const a of articles) {
      for (const key of ['id', 'slug', 'title', 'subtitle', 'excerpt', 'section', 'tag', 'desk', 'img', 'imageAlt', 'time', 'publishedAt', 'updatedAt'] as const) expect(a[key]).toBeTruthy();
      expect(Number.isFinite(Date.parse(a.publishedAt))).toBe(true);
      expect(a.views === null || a.views >= 0).toBe(true);
      expect(a.shares === null || a.shares >= 0).toBe(true);
      expect('author' in a).toBe(false);
    }
  });
  it('real section sort: latest is newest first by publication date', () => {
    const sorted = sortSectionArticles(articlesInSection('business'), 'latest');
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (!previous || !current) throw new Error('Missing sorted entry');
      expect(Date.parse(previous.publishedAt)).toBeGreaterThanOrEqual(Date.parse(current.publishedAt));
    }
  });
  it('top news respects the requested display limit without limiting stored featured flags', () => {
    expect(topNews(6)).toHaveLength(Math.min(6, articles.length));
    expect(topNews(1)).toHaveLength(1);
    expect(topNews(1)[0]?.slug).toBe(topNews(6)[0]?.slug);
  });
});