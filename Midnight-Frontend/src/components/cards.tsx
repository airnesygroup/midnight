import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { ClampTitle, IconTip } from "@/components/news-bits";
import { canonicalStory, formatPublished, getArticle, slugify } from "@/data/news";

type Card = { img: string; tag: string; title: string; time: string };

export function SectionHeader({ title, sub, to }: { title: string; sub?: string; to?: string }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-3xl font-extrabold tracking-tight md:text-4xl">{title}</h2>
        {sub && <p className="mt-1 text-muted-foreground">{sub}</p>}
      </div>
      {to && (
        <IconTip label={`See every ${title.toLowerCase()} story`}>
          <Link to="/section/$slug" params={{ slug: to }} className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-muted-foreground transition hover:text-foreground sm:flex">
            View all <ArrowUpRight className="h-4 w-4" />
          </Link>
        </IconTip>
      )}
    </div>
  );
}

export function BigCard({ s: story }: { s: Card }) {
  const s = canonicalStory(story);
  const article = getArticle(slugify(s.title));
  const published = article ? formatPublished(article.publishedAt) : "";
  return (
    <div className="group relative isolate">
    <img src={s.img} alt="" aria-hidden loading="lazy" className="photo-glow" />
    <Link to="/article/$slug" params={{ slug: article?.slug ?? slugify(s.title) }} className="relative z-10 block h-full min-h-[300px] max-h-[520px] overflow-hidden rounded-[1.75rem] shadow-float">
      <img src={s.img} alt={s.title} loading="lazy" width={1024} height={1280} className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-105" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-5">
        <span className="glass inline-block rounded-full px-3 py-1 text-[11px] font-bold tracking-wider uppercase">{s.tag}</span>
        <h3 className="mt-3 text-xl leading-snug font-extrabold text-report-foreground"><ClampTitle text={s.title} lines={4} /></h3>
        <p className="mt-2 text-xs text-white/70">{published ? `${published} · ` : ""}{s.time} read</p>
      </div>
    </Link>
    </div>
  );
}

export function Spill({ img }: { img: string }) {
  return (
    <img src={img} alt="" aria-hidden loading="lazy" className="pointer-events-none absolute top-1/2 left-0 h-[140%] w-40 -translate-y-1/2 scale-125 object-cover opacity-45 blur-2xl saturate-150 transition duration-700 group-hover:opacity-70" />
  );
}

export function ThumbRow({ s: story, ago, tall, large, fill }: { s: Card; ago?: boolean; tall?: boolean; large?: boolean; fill?: boolean }) {
  const s = canonicalStory(story);
  const article = getArticle(slugify(s.title));
  const published = article ? formatPublished(article.publishedAt) : "";
  return (
    <Link to="/article/$slug" params={{ slug: article?.slug ?? slugify(s.title) }} className={`glass-card group relative flex items-center gap-3 overflow-hidden rounded-2xl p-2.5 sm:gap-4 sm:p-3 ${tall ? "h-full min-h-28 sm:min-h-36" : fill ? "w-full" : ""}`}>
      <Spill img={s.img} />
      <div className={`relative shrink-0 overflow-hidden rounded-xl shadow-float ${large ? "h-20 w-28 sm:h-24 sm:w-36" : tall ? "min-h-28 w-24 self-stretch sm:w-36 lg:w-32 xl:w-40" : fill ? "min-h-20 w-20 self-stretch sm:min-h-24 sm:w-24 lg:w-28" : "h-20 w-20 sm:h-24 sm:w-24"}`}>
        <img src={s.img} alt={s.title} loading="lazy" width={1024} height={1280} className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-110" />
      </div>
      <div className="relative min-w-0 flex-1">
        <p className="truncate text-[10px] font-bold tracking-wider uppercase text-muted-foreground sm:text-[11px]">{s.tag}</p>
        <h3 className="mt-0.5 text-sm leading-snug font-bold sm:text-base"><ClampTitle text={s.title} lines={tall ? 3 : 2} /></h3>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{ago ? s.time : `${published ? `${published} · ` : ""}${s.time} read`}</p>
      </div>
      <IconTip label="Read full article">
        <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-secondary">
          <ArrowUpRight className="h-4 w-4 text-muted-foreground transition group-hover:rotate-45 group-hover:text-foreground sm:h-5 sm:w-5" />
        </span>
      </IconTip>
    </Link>
  );
}
