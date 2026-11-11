import { absUrl, SITE_NAME } from "@/lib/site";
import { useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, Clock } from "lucide-react";
import { useImagePalette } from "@/hooks/use-image-palette";
import { TrendThumbRow } from "@/components/trend-cards";
import { JumpArrow } from "@/components/jump-arrow";
import { ArticleActions, Discussion, discussionQuery } from "@/components/article-community";
import { formatPublishedShort } from "@/data/news";
import { getTrend, relatedTrends, setTrends, trendDiscussionSlug, type Trend } from "@/data/trends";
import { trendBodyQuery, trendsQuery } from "@/lib/trends.functions";

export const Route = createFileRoute("/trends/$slug")({
  loader: async ({ params, context }) => {
    const all = (await context.queryClient.ensureQueryData(trendsQuery)).trends;
    setTrends(all);
    const found = getTrend(params.slug);
    if (!found) throw notFound();
    // Comments load in parallel with the trend text (browser navigation only).
    if (typeof window !== "undefined") void context.queryClient.prefetchQuery(discussionQuery(trendDiscussionSlug(found.slug)));
    const { body, unavailable } = await context.queryClient.ensureQueryData(trendBodyQuery(found.slug));
    return { trend: { ...found, body: body ?? [] }, bodyUnavailable: unavailable, all };
  },
  head: ({ loaderData, params }) => {
    const t = loaderData?.trend;
    const title = t ? `${t.title} — Midnight Trends` : "Trend not found — Midnight";
    const desc = t?.excerpt ?? "This trend could not be found.";
    return {
      meta: [
        { property: "og:url", content: absUrl(`/trends/${params.slug}`) },
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary_large_image" },
        ...(t ? [{ property: "article:published_time", content: t.publishedAt }, { property: "article:modified_time", content: t.updatedAt || t.publishedAt }, { property: "article:section", content: "Midnight Trends" }] : []),
        ...(t && /^https:\/\//.test(t.img) ? [{ property: "og:image", content: t.img }, { name: "twitter:image", content: t.img }] : []),
      ],
      links: [{ rel: "canonical", href: absUrl(`/trends/${params.slug}`) }],
      scripts: t ? [{
        type: "application/ld+json",
        children: JSON.stringify([
          { "@context": "https://schema.org", "@type": "NewsArticle", headline: t.title, description: t.excerpt, datePublished: t.publishedAt, dateModified: t.updatedAt || t.publishedAt, articleSection: "Midnight Trends", keywords: t.hashtags.join(", "), ...(/^https:\/\//.test(t.img) ? { image: [t.img] } : {}), mainEntityOfPage: absUrl(`/trends/${params.slug}`), url: absUrl(`/trends/${params.slug}`), author: { "@type": "Organization", name: SITE_NAME, url: absUrl("/") }, publisher: { "@type": "NewsMediaOrganization", name: SITE_NAME, url: absUrl("/") } },
          { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: absUrl("/") },
            { "@type": "ListItem", position: 2, name: "Midnight Trends", item: absUrl("/trends") },
            { "@type": "ListItem", position: 3, name: t.title, item: absUrl(`/trends/${params.slug}`) },
          ] },
        ]),
      }] : [],
    };
  },
  notFoundComponent: () => (
    <main className="mx-auto max-w-3xl px-4 pt-40 pb-24 text-center">
      <h1 className="text-4xl font-extrabold">We couldn't find that trend</h1>
      <p className="mt-3 text-muted-foreground">It may have moved or cooled off.</p>
      <Link to="/trends" className="mt-6 inline-block rounded-full bg-primary px-6 py-3 font-bold text-primary-foreground">Back to Midnight Trends</Link>
    </main>
  ),
  component: TrendPage,
});

function TrendPage() {
  const { trend, bodyUnavailable, all } = Route.useLoaderData();
  setTrends(all);
  return <TrendView t={trend} bodyUnavailable={!!bodyUnavailable} />;
}

function TrendView({ t, bodyUnavailable }: { t: Trend; bodyUnavailable: boolean }) {
  const related = relatedTrends(t);
  const discussionSlug = trendDiscussionSlug(t.slug);
  useImagePalette(t.img);
  const [view, setView] = useState<"full" | "summary">("full");

  return (
    <main className="mx-auto max-w-7xl px-4 pt-28 pb-24">
      <div aria-hidden className="header-glow"><img src={t.img} alt="" /></div>
      <article className="mx-auto max-w-4xl">
        <h1 className="mx-auto max-w-2xl text-center font-serif text-4xl leading-[1.1] font-semibold md:text-5xl">{t.title}</h1>
        <header className="group relative isolate mt-8">
          <img src={t.img} alt="" aria-hidden className="photo-glow" />
          <div className="relative z-10 overflow-hidden rounded-[2.25rem] shadow-float">
            <img src={t.img} alt={t.title} width={1024} height={1280} className="absolute inset-0 h-full w-full object-cover transition duration-[1.5s] group-hover:scale-[1.03]" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
            <div className="relative flex min-h-[380px] flex-col justify-end p-5 sm:p-6 md:min-h-[480px] md:p-10">
              <div className="max-w-2xl">
                <Link to="/trends" className="inline-flex w-fit items-center gap-2 rounded-full border border-white/30 bg-black/30 px-4 py-2 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-black/45">
                  <ArrowLeft className="h-4 w-4" /> Back to trends
                </Link>
                <p className="mt-4 font-serif text-lg leading-snug text-white/90 italic sm:text-xl md:text-2xl">{t.excerpt}</p>
                <nav aria-label="Breadcrumb" className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/80">
                  {t.hashtags.map((h) => (
                    <Link key={h} to="/trends" search={{ tag: h }} className="rounded-full border border-white/30 bg-black/30 px-3 py-1 text-[11px] font-bold tracking-wider text-white uppercase backdrop-blur-md">
                      #{h}
                    </Link>
                  ))}
                  <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {t.time} read</span>
                  <span aria-hidden className="h-1 w-1 rounded-full bg-white/60" />
                  <time dateTime={t.publishedAt}>{formatPublishedShort(t.publishedAt)}</time>
                </nav>
              </div>
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-3xl">
          <ArticleActions slug={discussionSlug} title={t.title} />
          <div role="tablist" aria-label="Reading mode" className="glass mx-auto mt-8 flex w-fit gap-1 rounded-full p-1.5">
            {([["full", "Full article"], ["summary", "Summary"]] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                className={`rounded-full px-4 py-2.5 text-sm font-bold whitespace-nowrap transition sm:px-6 ${view === k ? "bg-primary text-primary-foreground shadow-float" : "nav-hover text-muted-foreground"}`}>
                {label}{k === "summary" && <span className="ml-1.5 font-medium opacity-70">· 1 min</span>}
              </button>
            ))}
          </div>
          <div className="glass mt-6 space-y-5 rounded-[2rem] p-6 text-lg leading-relaxed md:p-10">
            {view === "full" && bodyUnavailable ? <p className="text-center text-base text-muted-foreground">The full story couldn't load right now. Please try again shortly.</p> : view === "full" && t.body.length === 0 ? <p className="text-center text-base text-muted-foreground">The full text of this trend isn't available yet.</p> : view === "summary" && t.summary.length === 0 ? <p className="text-center text-base text-muted-foreground">A summary isn't available for this trend yet.</p> : view === "full" ? t.body.map((p, i) => (
              <p key={i} className={i === 0 ? "first-letter:float-left first-letter:mr-2 first-letter:font-serif first-letter:text-6xl first-letter:leading-none" : ""}>{p}</p>
            )) : (
              <ul className="space-y-4">
                {t.summary.map((p, i) => (
                  <li key={i} className="flex gap-3"><span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" />{p}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </article>
      <Discussion slug={discussionSlug} />
      <JumpArrow />
      {related.length > 0 && <section className="mx-auto mt-16 max-w-3xl">
        <h2 className="text-2xl font-extrabold">More trends like this</h2>
        <div className="mt-5 space-y-3">
          {related.map((r) => (
            <TrendThumbRow key={r.slug} t={r} />
          ))}
        </div>
        <Link to="/trends" className="mt-5 inline-block font-bold text-primary hover:underline">More from Midnight Trends →</Link>
      </section>}
    </main>
  );
}
