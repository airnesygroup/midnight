import { describe, expect, it } from 'vitest';
import { createHomepageSelection } from '@/lib/homepage-selection';

describe('homepage article placement', () => {
  it('does not repeat hero or already featured stories in another section and fills from remaining stories', () => {
    const story = (slug: string) => ({ slug });
    const select = createHomepageSelection([story('hero')]);
    const first = select(['hero', 'shared', 'shared', 'first'].map(story), 2);
    const second = select(['shared', 'hero', 'first', 'second', 'third'].map(story), 2);
    expect(first.map(s => s.slug)).toEqual(['shared', 'first']);
    expect(second.map(s => s.slug)).toEqual(['second', 'third']);
  });
});