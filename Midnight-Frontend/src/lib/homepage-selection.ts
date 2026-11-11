/** Claim stories in display order, reserving the rotating hero pool first. */
export function createHomepageSelection(reserved: readonly { slug: string }[]) {
  const used = new Set(reserved.map((story) => story.slug));
  return <T extends { slug: string }>(stories: readonly T[], limit: number): T[] => {
    const selected: T[] = [];
    for (const story of stories) {
      if (selected.length >= limit) break;
      if (used.has(story.slug)) continue;
      used.add(story.slug);
      selected.push(story);
    }
    return selected;
  };
}