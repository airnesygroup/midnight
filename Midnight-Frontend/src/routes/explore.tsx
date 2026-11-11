import { absUrl } from "@/lib/site";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { BigCard, Spill } from "@/components/cards";
import { articlesInSection, sections, topNews } from "@/data/news";

export const Route = createFileRoute("/explore")({
  head: () => ({
    meta: [
      { property: "og:url", content: absUrl("/explore") },
      { title: "Explore every section — Midnight" },
      { name: "description", content: "Browse every Midnight section, from world news and tech to climate, sport and culture." },
      { property: "og:title", content: "Explore every section — Midnight" },
      { property: "og:description", content: "Browse every Midnight section, from world news and tech to climate, sport and culture." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: absUrl("/explore") }],
  }),
  component: ExplorePage,
});

function ExplorePage() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 pt-28 pb-24">
      <h1 className="text-4xl font-extrabold tracking-tight md:text-6xl">Explore</h1>
      <p className="mt-3 text-lg text-muted-foreground">Every section, all in one place.</p>
      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {sections.map((s) => {
          const list = articlesInSection(s.slug);
          const img = list.find((a) => /^(https?:)?\/\//.test(a.img) || a.img.startsWith("/"))?.img;
          return (
            <Link key={s.slug} to="/section/$slug" params={{ slug: s.slug }} className="glass-card group relative flex items-center gap-3 overflow-hidden rounded-2xl p-2.5 sm:p-3">
              {img && <Spill img={img} />}
              <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-xl bg-muted shadow-float">
                {img && <img src={img} alt="" loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-110" />}
              </div>
              <div className="relative min-w-0 flex-1">
                <p className="truncate text-base font-extrabold">{s.name}</p>
                <p className="text-xs text-muted-foreground">{list.length || "New"} stories</p>
              </div>
              <ArrowUpRight className="relative h-5 w-5 shrink-0 text-muted-foreground transition group-hover:rotate-45 group-hover:text-foreground" />
            </Link>
          );
        })}
      </div>
      <h2 className="mt-16 text-3xl font-extrabold">Editors' picks</h2>
      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {topNews(4).map((s) => (
          <BigCard key={s.slug} s={s} />
        ))}
      </div>
    </main>
  );
}
