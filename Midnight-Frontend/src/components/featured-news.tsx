import { useEffect, useState, type FocusEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Clock } from "lucide-react";
import { formatPublished, topNews, type Article } from "@/data/news";
import { ThumbRow } from "@/components/cards";
import { EmptyCard } from "@/components/states";
import { useQuery } from "@tanstack/react-query";
import { reportDatesQuery } from "@/lib/reports.functions";

/** Fixed star positions [left%, top%, delay s] so server and browser render the same sky. */
const STARS: [number, number, number][] = [[12,18,0],[28,62,1.2],[44,30,2.4],[63,14,0.6],[78,48,1.8],[88,22,3],[20,82,2.1],[55,74,0.3],[70,86,1.5],[36,10,2.8],[92,70,0.9],[8,46,3.3]];

/** Hero lead + two side cards rotate together through the top news (by headline weight). */
export function TopNewsHero() {
  const featured = topNews();
  const { data: reportDates } = useQuery(reportDatesQuery);
  const latest = reportDates?.dates[0];
  const latestLabel = latest ? new Date(latest + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) + " · Latest edition" : reportDates ? "New editions every night" : "\u00a0";
  const [offset, setOffset] = useState(0);
  const [paused, setPaused] = useState(false);
  const [rotated, setRotated] = useState(false);
  useEffect(() => {
    if (paused || featured.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => { setRotated(true); setOffset((value) => (value + featured.length - 1) % featured.length); }, 7000);
    return () => window.clearInterval(timer);
  }, [paused, featured.length]);
  const lead = featured[offset % featured.length];
  const prev = featured[(offset + 1) % featured.length];
  const pause = { onMouseEnter: () => setPaused(true), onMouseLeave: () => setPaused(false), onFocusCapture: () => setPaused(true), onBlurCapture: (event: FocusEvent<HTMLElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false); } };
  return <section className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
    {!lead && <EmptyCard text="No top stories yet." className="min-h-[24rem]" />}
    {lead && <div className="relative isolate" {...pause}>
      {rotated && prev && prev.slug !== lead.slug && <div key={"x" + prev.slug + offset} className="hero-exit group absolute inset-0 z-0"><HeroCard story={prev} /></div>}
      <div key={lead.slug} className="hero-enter group relative z-10 h-full"><HeroCard story={lead} /></div>
    </div>}
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:h-0 lg:min-h-full lg:grid-rows-3">
    <Link to="/midnight-report" className="report-card group relative flex min-h-28 items-center gap-3 overflow-hidden rounded-2xl p-2.5 sm:min-h-36 sm:gap-4 sm:p-3">
      <div className="relative h-full min-h-20 w-24 shrink-0 self-stretch overflow-hidden rounded-xl shadow-float sm:w-36 lg:w-32 xl:w-40">
        <div aria-hidden className="report-gradient h-full w-full transition duration-700 group-hover:scale-110" />
        <div aria-hidden className="report-stars">{STARS.map(([x, y, d], i) => <i key={i} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${d}s` }} />)}</div>
      </div>
      <div className="relative min-w-0 flex-1">
        <p className="truncate text-[10px] font-bold tracking-wider uppercase opacity-70 sm:text-[11px]">The newsroom edition</p>
        <h2 className="mt-0.5 truncate text-sm font-extrabold tracking-tight sm:text-base">The Midnight Report</h2>
        <p className="mt-0.5 truncate text-xs opacity-70">{latestLabel}</p>
      </div>
      <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full"><ArrowUpRight className="h-4 w-4 opacity-80 transition group-hover:rotate-45 sm:h-5 sm:w-5" /></span>
    </Link>
    <div aria-label="Featured news" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 overflow-hidden lg:row-span-2 lg:grid-rows-2" {...pause}>
      {[1, 2].map((slot) => { const story = featured[(offset + slot) % featured.length]; return story ? <div key={story.slug} className="featured-enter min-h-0 min-w-0"><ThumbRow s={story} tall /></div> : null; })}
    </div>
  </div>
  </section>;
}

function HeroCard({ story }: { story: Article }) {
  return <>
      <img src={story.img} alt="" aria-hidden className="photo-glow" />
      <Link to="/article/$slug" params={{ slug: story.slug }} className="relative z-10 block h-full min-h-[420px] max-h-[720px] overflow-hidden rounded-[2rem] shadow-float lg:min-h-[560px]">
        <img src={story.img} alt={story.imageAlt} width={1024} height={1280} className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-6 md:p-8">
          <span className="glass rounded-full px-3 py-1 text-[11px] font-bold tracking-wider uppercase">{story.tag}</span>
          <h1 className="mt-4 max-w-2xl text-3xl leading-tight font-extrabold text-report-foreground md:text-5xl line-clamp-4">{story.title}</h1>
          <p className="mt-3 hidden max-w-xl text-white/80 md:line-clamp-2">{story.excerpt}</p>
          <p className="mt-4 flex items-center gap-2 text-sm text-white/70">{formatPublished(story.publishedAt)} · <Clock className="h-3.5 w-3.5" /> {story.time}</p>
        </div>
      </Link>
  </>;
}
