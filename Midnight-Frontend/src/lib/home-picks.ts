import { createHomepageSelection } from "./homepage-selection";
import { inSectionOf, latestOf, topNewsOf, type Article, type Section } from "@/data/news";

/* Home-page maximums per block; blocks show fewer when the database has fewer stories. */
export const HOME_COUNTS = { ticker: 6, latest: 6, world: 5, politicsTop: 3, politics: 8, editors: 4, categoryTop: 3, categoryColumn: 6, tech: 15, business: 15, climate: 15, sport: 15, culture: 15, healthScience: 15, food: 15, travel: 15, style: 15, entertainment: 15, opinion: 4 } as const;

/**
 * Chooses every story the home page shows, in the order the page claims them (a story never repeats).
 * The server runs this on the full catalogue and sends only the chosen stories; the page runs it again
 * on what it received and gets the same answer.
 */
export function buildHome(list: readonly Article[], secs: readonly Section[]) {
  const C = HOME_COUNTS;
  const hero = topNewsOf(list);
  const ticker = latestOf(list, C.ticker);
  const select = createHomepageSelection(hero);
  const editors = select([...latestOf(list)].sort((a, b) => b.headlineWeight - a.headlineWeight), C.editors);
  const latest = select(latestOf(list), C.latest);
  const pick = (slug: string, n: number) => select(inSectionOf(list, secs, slug), n);
  const world = pick("world", C.world), politics = pick("politics", C.politics), tech = pick("tech", C.tech);
  const business = pick("business", C.business), climate = pick("climate", C.climate), sport = pick("sport", C.sport);
  const culture = pick("culture", C.culture), healthScience = pick("health-and-science", C.healthScience);
  const food = pick("food", C.food), travel = pick("travel", C.travel), style = pick("style", C.style), entertainment = pick("entertainment", C.entertainment);
  const opinion = pick("opinion", C.opinion);
  return { hero, ticker, editors, latest, world, politics, tech, business, climate, sport, culture, healthScience, food, travel, style, entertainment, opinion };
}
