import { absUrl } from "@/lib/site";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { BigCard, ThumbRow } from "@/components/cards";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PublicationDatePicker } from "@/components/publication-date-filter";
import { emptyPublicationDate, filterByPublicationDate, hasPublicationDate } from "@/lib/publication-date";

const SORTS = [["latest", "Latest"], ["oldest", "Oldest"], ["popular", "Popular"], ["trending", "Trending"]] as const;
import { ArrowUpRight, Newspaper } from "lucide-react";
import { articlesInSection, getSection, sortSectionArticles, type SectionSort } from "@/data/news";

export const Route = createFileRoute("/section/$slug")({
  loader: ({ params }) => {
    const section = getSection(params.slug);
    if (!section) throw notFound();
    return { section };
  },
  head: ({ loaderData, params }) => {
    const s = loaderData?.section;
    const title = s ? `${s.name} news — Midnight` : "Section not found — Midnight";
    const desc = s?.desc ?? "This section could not be found.";
    return {
      meta: [
      { property: "og:url", content: absUrl(`/section/${params.slug}`) },
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: [{ rel: "canonical", href: absUrl(`/section/${params.slug}`) }],
    };
  },
  notFoundComponent: () => (
    <main className="mx-auto max-w-3xl px-4 pt-40 pb-24 text-center">
      <h1 className="text-4xl font-extrabold">Section not found</h1>
      <Link to="/explore" className="mt-6 inline-block rounded-full bg-primary px-6 py-3 font-bold text-primary-foreground">Explore all sections</Link>
    </main>
  ),
  component: SectionPage,
});

function SectionPage() {
  const { section } = Route.useLoaderData();
  const [sort, setSort] = useState<SectionSort>("latest");
  const [date, setDate] = useState(emptyPublicationDate);
  const all = articlesInSection(section.slug);
  const list = sortSectionArticles(filterByPublicationDate(all, date), sort);
  const [top, ...rest] = list;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pt-28 pb-24">
      <header className="glass grid grid-cols-[minmax(0,1fr)] gap-5 rounded-[1.5rem] px-6 py-7 md:px-8 md:py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">{section.name}</h1>
          <p className="mt-2 min-w-0 text-sm text-muted-foreground md:text-base">{section.desc}</p>
        </div>
        <div className="pill-scroll pill-scroll-curved min-w-0 overflow-x-auto py-1 lg:max-w-xl">
          <div className="flex w-max items-center gap-2">
          <div role="group" aria-label="Sort stories" className="flex w-max items-center gap-1.5 rounded-full border border-navigation-border bg-navigation-highlight p-1 shadow-glass">
            {SORTS.map(([value, label]) => (
              <Button variant="ghost" key={value} type="button" aria-pressed={sort === value} onClick={() => setSort(value)} className={`h-9 shrink-0 rounded-full px-4 py-2 text-sm whitespace-nowrap transition ${sort === value ? 'bg-primary font-bold text-primary-foreground shadow-float' : 'pill-soft font-medium text-foreground/80 hover:text-foreground'}`}>{label}</Button>
            ))}
          </div>
          <PublicationDatePicker value={date} onChange={setDate} subject="stories" />
          </div>
        </div>
      </header>

      {top ? (
        <div className="mt-8 space-y-6">
          {/* The lead photo keeps a fixed shape; extra stories flow below it instead of stretching it. */}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="aspect-[4/5] sm:aspect-[4/3] lg:aspect-[6/5] lg:self-start [&>div]:h-full">
              <BigCard s={top} />
            </div>
            <div className="space-y-3">
              {rest.slice(0, 6).map((a) => (
                <ThumbRow key={a.slug} s={a} />
              ))}
            </div>
          </div>
          {rest.length > 6 && <MoreStories key={`${section.slug}-${sort}-${date.day}-${date.month}-${date.year}`} items={rest.slice(6)} />}
        </div>
      ) : (
        <section className="mt-8">
          <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-lg border bg-card p-8 text-center">
            <Newspaper className="h-8 w-8 text-muted-foreground" />
            <h2 className="text-xl font-extrabold">{hasPublicationDate(date) ? 'No stories match that date' : all.length ? 'No ranked stories yet' : section.slug === 'opinion' ? 'No opinions in this section yet' : 'No news articles in this category yet'}</h2>
            <p className="max-w-md text-muted-foreground">{hasPublicationDate(date) ? 'Try another publication date.' : all.length ? 'Readership counts are not available for this section yet.' : "We don’t have any news covering this category yet."}</p>
            {hasPublicationDate(date) && <Button variant="secondary" onClick={() => setDate(emptyPublicationDate)}>Clear date filter</Button>}
            <Button asChild variant="secondary"><Link to="/explore">Explore other sections <ArrowUpRight /></Link></Button>
          </div>
        </section>
      )}
    </main>
  );
}

const PAGE = 10;

/** Infinite scroll: render a page of stories at a time and add more as the reader nears the end. */
function MoreStories({ items }: { items: Parameters<typeof ThumbRow>[0]["s"][] }) {
  const [count, setCount] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  const done = count >= items.length;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || done) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setCount((c) => Math.min(items.length, c + PAGE));
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [done, items.length]);
  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
        {items.slice(0, count).map((a) => <ThumbRow key={(a as { slug?: string }).slug ?? a.title} s={a} />)}
      </div>
      {!done && (
        <div ref={sentinel} className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2" aria-label="Loading more stories">
          {[0, 1].map((i) => <span key={i} className="skeleton h-20 rounded-2xl" />)}
        </div>
      )}
    </>
  );
}
