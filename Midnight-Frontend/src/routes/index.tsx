import { absUrl } from "@/lib/site";
import { createFileRoute, Link } from "@tanstack/react-router";
import { TopNewsHero } from "@/components/featured-news";
import { Button } from "@/components/ui/button";
import { BigCard, SectionHeader, ThumbRow } from "@/components/cards";
import { EmptyCard } from "@/components/states";
import { addArticles, articles, sections, type Article } from "@/data/news";
import { buildHome, HOME_COUNTS } from "@/lib/home-picks";
import { homeQuery } from "@/lib/catalogue.functions";
import { DataUnavailable } from "@/components/data-unavailable";

export { HOME_COUNTS };

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { property: "og:url", content: absUrl("/") },
      { title: "Midnight — Latest news, world, tech, climate & sport" },
      { name: "description", content: "Midnight brings you clear, concise news on world affairs, technology, climate and sport — straight to the point, without the jargon." },
      { property: "og:title", content: "Midnight — Latest news, world, tech, climate & sport" },
      { property: "og:description", content: "Clear, concise news on world affairs, technology, climate and sport — straight to the point." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: absUrl("/") }],
  }),
  // Only the stories this page shows are fetched (not the whole catalogue).
  loader: ({ context }) => context.queryClient.ensureQueryData(homeQuery),
  component: Index,
});

function Index() {
  const C = HOME_COUNTS;
  const { stories, unavailable } = Route.useLoaderData();
  addArticles(stories);
  if (unavailable) return <main className="mx-auto max-w-7xl px-4 pt-28 pb-24"><DataUnavailable /></main>;
  const { ticker: tickerStories, editors: editorsPicks, latest, world, politics: politicsNews, tech: technology, business: businessNews, climate: climateNews, sport: sportNews, culture: cultureNews, healthScience, food: foodNews, travel: travelNews, style: styleNews, entertainment: entertainmentNews, opinion } = buildHome(articles, sections);
  const show = (list: Article[]) => list.length > 0;
  return (
    <>

      {/* Ticker */}
      <div className="mx-auto max-w-7xl px-4 pt-28">
        <div className="glass flex items-center overflow-hidden rounded-full px-4 py-2">
          <span className="live-badge relative z-10 flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold tracking-wider uppercase">
            <span className="h-2 w-2 animate-pulse rounded-full bg-live" /> Live
          </span>
          {/* No flex gap: the ticker's ")"-shaped mask (1rem, same as the strip's px-4) is the only space between the Live badge and where headlines vanish, so it equals the strip-edge-to-badge gap. */}
          <div className="ticker-window min-w-0 flex-1 overflow-hidden rounded-r-full py-1.5 pr-3">

            <div className="animate-ticker flex w-max gap-10 text-sm font-medium whitespace-nowrap">
              {tickerStories.length === 0 && <span className="text-muted-foreground">No live updates yet.</span>}
              {[...tickerStories, ...tickerStories].map((a, i) => (
                <span key={i} className="text-muted-foreground" aria-hidden={i >= tickerStories.length}>
                  <span className="mr-10 text-foreground">•</span>
                  <Link to="/article/$slug" params={{ slug: a.slug }} tabIndex={i >= tickerStories.length ? -1 : 0} className="transition hover:text-foreground">{a.title}</Link>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-16 px-4 pt-8 pb-24">
        <TopNewsHero />

        {/* Editors' picks: directly after the hero's featured articles. */}
        {show(editorsPicks) && (
        <section>
          <SectionHeader title="Editors' picks" sub="Hand-selected by our newsroom" />
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {editorsPicks.map((s) => (
              <BigCard key={s.slug} s={s} />
            ))}
          </div>
        </section>)}

        {/* Latest + World */}
        <section className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <div className="glass rounded-[2rem] p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-extrabold">Latest</h2>
              <span className="flex items-center gap-2 text-sm font-semibold text-live">
                <span className="h-2 w-2 animate-pulse rounded-full bg-live" /> Updating
              </span>
            </div>
            <div className="mt-5 space-y-3">
              {latest.length === 0 && <EmptyCard />}
              {latest.map((l) => (
                <ThumbRow key={l.slug} s={l} />
              ))}
            </div>
          </div>
          {/* World cards stretch to match the Latest column height. Do not change this sizing. */}
          <div className="glass flex flex-col rounded-[2rem] p-4 sm:p-6">
            <SectionHeader to="world" title="World" sub="The stories shaping the week" />
            <div className="mt-5 flex flex-1 flex-col gap-3">
              {world.length === 0 && <EmptyCard />}
              {world.map((s) => (
                <div key={s.slug} className="flex flex-1"><ThumbRow s={s} fill /></div>
              ))}
            </div>
          </div>
        </section>

        {/* Politics: big image cards under the title first, then the card list with no second title. */}
        {show(politicsNews) && (
        <section className="space-y-8">
          <div>
            <SectionHeader to="politics" title="Politics" sub="Power, policy and the people behind them" />
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              {politicsNews.slice(0, C.politicsTop).map((s) => (
                <BigCard key={s.slug} s={s} />
              ))}
            </div>
          </div>
          {politicsNews.length > C.politicsTop && (
          <div className="glass rounded-[2rem] p-4 sm:p-6">
            <div className="flex flex-col gap-3">
              {politicsNews.slice(C.politicsTop).map((s) => (
                <ThumbRow key={s.slug} s={s} large />
              ))}
            </div>
          </div>)}
        </section>)}

        {/* Each category owns its big-photo row and both untitled card columns. */}
        {[
          { slug: "tech", title: "Technology", sub: "Chips, code and the companies behind them", stories: technology },
          { slug: "business", title: "Business", stories: businessNews },
          { slug: "climate", title: "Climate", stories: climateNews },
          { slug: "sport", title: "Sport", sub: "Results, rivalries and the science of winning", stories: sportNews },
          { slug: "culture", title: "Culture", stories: cultureNews },
          { slug: "health-and-science", title: "Health & Science", stories: healthScience },
          { slug: "food", title: "Food", stories: foodNews },
          { slug: "travel", title: "Travel", stories: travelNews },
          { slug: "style", title: "Style", stories: styleNews },
          { slug: "entertainment", title: "Entertainment", stories: entertainmentNews },
        ].filter(({ stories }) => show(stories)).map(({ slug, title, sub, stories }) => {
          const remaining = stories.slice(C.categoryTop);
          const split = Math.min(C.categoryColumn, Math.ceil(remaining.length / 2));
          const columns = [remaining.slice(0, split), remaining.slice(split)].filter((column) => column.length > 0);
          return (
            <section key={slug} className="space-y-8">
              <div>
                <SectionHeader to={slug} title={title} {...(sub ? { sub } : {})} />
                <div className="mt-8 grid gap-6 md:grid-cols-3">
                  {stories.slice(0, C.categoryTop).map((s) => (
                    <BigCard key={s.slug} s={s} />
                  ))}
                </div>
              </div>
              {columns.length > 0 && (
                <div className={columns.length === 2 ? "grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2" : "grid grid-cols-[minmax(0,1fr)] gap-6"}>
                  {columns.map((column, i) => (
                    <div key={i} className="glass rounded-[2rem] p-4 sm:p-6">
                      <div className="flex flex-col gap-3">
                        {column.map((s) => (
                          <ThumbRow key={s.slug} s={s} large />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {/* Opinion */}
        {show(opinion) && (
        <section className="glass rounded-[2rem] p-6 md:p-10">
          <SectionHeader to="opinion" title="Opinion" sub="Argument and analysis from our columnists" />
          <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {opinion.map((o) => (
              <Link key={o.slug} to="/article/$slug" params={{ slug: o.slug }} className="group block">
                <p className="font-serif text-xl leading-snug italic">“{o.title}”</p>
                <p className="mt-3 text-xs font-bold tracking-wider uppercase text-muted-foreground">Opinion · {o.desk}</p>
              </Link>
            ))}
          </div>
        </section>)}

        {/* Midnight Report CTA */}
        <section>
          <div className="glass rounded-[2.5rem] px-6 py-14 text-center">
            <h2 className="text-4xl font-extrabold tracking-tight md:text-5xl">
              Read <span className="font-serif font-normal italic">without</span> the noise.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-lg text-muted-foreground">Clear, independent journalism and the daily brief.</p>
            <Button asChild className="mt-8 rounded-full"><Link to="/midnight-report">Read the Midnight Report</Link></Button>
          </div>
        </section>
      </main>

    </>
  );
}
