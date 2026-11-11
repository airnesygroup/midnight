import { absUrl } from "@/lib/site";
import { useHoverMenu } from "@/hooks/use-hover-menu";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type * as React from "react";
import { z } from "zod";
import { ArrowUpRight, ChevronDown, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicationDatePicker } from "@/components/publication-date-filter";
import { emptyPublicationDate, filterByPublicationDate, hasPublicationDate } from "@/lib/publication-date";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TrendBigCard, TrendThumbRow } from "@/components/trend-cards";
import { searchTrends, setTrends, sortTrends, trendHashtags, trends, trendsInHashtag, type Trend } from "@/data/trends";
import { trendsQuery } from "@/lib/trends.functions";
import type { SectionSort } from "@/data/news";

const SORTS = [["latest", "Latest"], ["oldest", "Oldest"], ["popular", "Popular"], ["trending", "Trending"]] as const;

export const Route = createFileRoute("/trends/")({
  validateSearch: (s) =>
    z.object({ tag: z.string().optional(), q: z.string().optional() }).parse({
      tag: typeof s["tag"] === "string" ? s["tag"] : undefined,
      q: typeof s["q"] === "string" ? s["q"] : undefined,
    }),
  head: () => ({
    meta: [
      { property: "og:url", content: absUrl("/trends") },
      { title: "Midnight Trends — what's going viral around the world" },
      { name: "description", content: "Here's what's going viral and trending around the world right now — kept separate from the daily news." },
      { property: "og:title", content: "Midnight Trends — what's going viral around the world" },
      { property: "og:description", content: "Here's what's going viral and trending around the world right now — kept separate from the daily news." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: absUrl("/trends") }],
  }),
  loader: async ({ context }) => (await context.queryClient.ensureQueryData(trendsQuery)).trends,
  component: TrendsPage,
});

function TrendsPage() {
  // Loader data is sent with the page, so trends are present on the very first render.
  setTrends(Route.useLoaderData());
  const { tag, q } = Route.useSearch();
  const navigate = useNavigate({ from: "/trends/" });
  const [sort, setSort] = useState<SectionSort>("latest");
  const [date, setDate] = useState(emptyPublicationDate);
  const tagsMenu = useHoverMenu();
  const hashtags = trendHashtags();
  const active = tag && hashtags.some((h) => h.toLowerCase() === tag.toLowerCase()) ? tag : undefined;

  let list: Trend[] = active ? trendsInHashtag(active) : [...trends];
  if (q?.trim()) list = searchTrends(q).filter((t) => !active || list.includes(t));
  list = sortTrends(filterByPublicationDate(list, date), sort);
  const [top, ...rest] = list;

  const setTag = (value?: string) => navigate({ search: (prev) => ({ ...prev, tag: value }) });

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pt-28 pb-24">
      <header className="glass grid grid-cols-[minmax(0,1fr)] gap-5 rounded-[1.5rem] px-6 py-7 md:px-8 md:py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight md:text-4xl">
            <Flame className="h-8 w-8 shrink-0 text-primary" /> Midnight Trends
          </h1>
          <p className="mt-2 min-w-0 text-sm text-muted-foreground md:text-base">Here's what's going viral and trending around the world right now.</p>
          {q?.trim() && <p className="mt-2 text-sm font-semibold">{list.length} {list.length === 1 ? "trend" : "trends"} matching “{q.trim()}”</p>}
        </div>
        <div className="pill-scroll pill-scroll-curved min-w-0 overflow-x-auto py-1 lg:max-w-xl">
          <div className="flex w-max items-center gap-2">
            <DropdownMenu modal={false} open={tagsMenu.open} onOpenChange={tagsMenu.onOpenChange}>
              <DropdownMenuTrigger {...tagsMenu.trigger} className="pill-filter flex shrink-0 items-center gap-1.5 h-9 rounded-full px-4 text-sm font-bold whitespace-nowrap">
                {active ? `#${active}` : "All hashtags"} <ChevronDown className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent {...tagsMenu.content} align="end" sideOffset={10} className="glass max-h-80 w-64 overflow-y-auto rounded-2xl border-0 p-2">
                <DropdownMenuItem onSelect={() => setTag(undefined)} className={`rounded-xl px-3 py-2 font-medium focus:bg-navigation-highlight focus:text-foreground ${!active ? "font-bold" : ""}`}>
                  All hashtags
                </DropdownMenuItem>
                {hashtags.map((h) => (
                  <DropdownMenuItem key={h} onSelect={() => setTag(h)} className={`rounded-xl px-3 py-2 font-medium focus:bg-navigation-highlight focus:text-foreground ${active === h ? "font-bold" : ""}`}>
                    #{h}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <div role="group" aria-label="Sort trends" className="flex w-max items-center gap-1.5 rounded-full border border-navigation-border bg-navigation-highlight p-1 shadow-glass">
              {SORTS.map(([value, label]) => (
                <Button variant="ghost" key={value} type="button" aria-pressed={sort === value} onClick={() => setSort(value)} className={`h-9 shrink-0 rounded-full px-4 py-2 text-sm whitespace-nowrap transition ${sort === value ? "bg-primary font-bold text-primary-foreground shadow-float" : "pill-soft font-medium text-foreground/80 hover:text-foreground"}`}>{label}</Button>
              ))}
            </div>
            <PublicationDatePicker value={date} onChange={setDate} subject="trends" />
          </div>
        </div>
      </header>

      {top ? (
        <div className="mt-8 space-y-6">
          {/* The lead photo keeps a fixed shape; extra trends flow below it instead of stretching it. */}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="aspect-[4/5] sm:aspect-[4/3] lg:aspect-[6/5] lg:self-start [&>div]:h-full">
              <TrendBigCard t={top} />
            </div>
            <div className="space-y-3">
              {rest.slice(0, 6).map((t) => (
                <TrendThumbRow key={t.slug} t={t} />
              ))}
            </div>
          </div>
          {rest.length > 6 && <MoreTrends key={`${active ?? "all"}-${q ?? ""}-${sort}-${date.day}-${date.month}-${date.year}`} items={rest.slice(6)} />}
        </div>
      ) : (
        <section className="mt-8">
          <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-lg border bg-card p-8 text-center">
            <Flame className="h-8 w-8 text-muted-foreground" />
            <h2 className="text-xl font-extrabold">{hasPublicationDate(date) || q?.trim() || active ? "No trends match that filter" : "No trends yet"}</h2>
            <p className="max-w-md text-muted-foreground">{hasPublicationDate(date) || q?.trim() || active ? "Try a different date, hashtag or search." : "When something starts going viral around the world, you'll find it here."}</p>
            {hasPublicationDate(date) && <Button variant="secondary" onClick={() => setDate(emptyPublicationDate)}>Clear date filter</Button>}
            {(q?.trim() || active) && <Button asChild variant="secondary"><Link to="/trends" search={{}}>See all trends <ArrowUpRight /></Link></Button>}
          </div>
        </section>
      )}
    </main>
  );
}

const PAGE = 10;

/** Infinite scroll: render a page of trends at a time and add more as the reader nears the end. */
function MoreTrends({ items }: { items: Trend[] }) {
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
        {items.slice(0, count).map((t) => <TrendThumbRow key={t.slug} t={t} />)}
      </div>
      {!done && (
        <div ref={sentinel} className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2" aria-label="Loading more trends">
          {[0, 1].map((i) => <span key={i} className="skeleton h-20 rounded-2xl" />)}
        </div>
      )}
    </>
  );
}
