import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { ClampTitle, IconTip, ScrollTitle } from "@/components/news-bits";
import { Spill } from "@/components/cards";
import { formatPublished } from "@/data/news";
import { trendTag, type Trend } from "@/data/trends";

/** Trend cards mirror the news cards but always link into /trends and label by hashtag. */

export function TrendBigCard({ t }: { t: Trend }) {
  const published = formatPublished(t.publishedAt);
  return (
    <div className="group relative isolate">
      <img src={t.img} alt="" aria-hidden loading="lazy" className="photo-glow" />
      <Link to="/trends/$slug" params={{ slug: t.slug }} className="relative z-10 block h-full min-h-[300px] max-h-[520px] overflow-hidden rounded-[1.75rem] shadow-float">
        <img src={t.img} alt={t.title} loading="lazy" width={1024} height={1280} className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-5">
          <span className="glass inline-block rounded-full px-3 py-1 text-[11px] font-bold tracking-wider uppercase">#{trendTag(t)}</span>
          <h3 className="mt-3 text-xl leading-snug font-extrabold text-white"><ClampTitle text={t.title} /></h3>
          <p className="mt-2 text-xs text-white/70">{published ? `${published} · ` : ""}{t.time} read</p>
        </div>
      </Link>
    </div>
  );
}

export function TrendThumbRow({ t, fill }: { t: Trend; fill?: boolean }) {
  const published = formatPublished(t.publishedAt);
  return (
    <Link to="/trends/$slug" params={{ slug: t.slug }} className={`glass-card group relative flex items-center gap-3 overflow-hidden rounded-2xl p-2.5 sm:gap-4 sm:p-3 ${fill ? "w-full" : ""}`}>
      <Spill img={t.img} />
      <div className={`relative shrink-0 overflow-hidden rounded-xl shadow-float ${fill ? "h-14 w-20 sm:h-16 sm:w-24 lg:h-auto lg:min-h-16 lg:self-stretch lg:w-28" : "h-14 w-20 sm:h-16 sm:w-24"}`}>
        <img src={t.img} alt={t.title} loading="lazy" width={1024} height={1280} className={`h-full w-full object-cover transition duration-700 group-hover:scale-110 ${fill ? "lg:absolute lg:inset-0" : ""}`} />
      </div>
      <div className="relative min-w-0 flex-1">
        <p className="truncate text-[10px] font-bold tracking-wider uppercase text-muted-foreground sm:text-[11px]">#{trendTag(t)}</p>
        <h3 className="mt-0.5 text-sm font-bold sm:text-base"><ScrollTitle text={t.title} /></h3>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{published ? `${published} · ` : ""}{t.time} read</p>
      </div>
      <IconTip label="Read full trend">
        <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-secondary">
          <ArrowUpRight className="h-4 w-4 text-muted-foreground transition group-hover:rotate-45 group-hover:text-foreground sm:h-5 sm:w-5" />
        </span>
      </IconTip>
    </Link>
  );
}
