import { absUrl, SITE_NAME } from "@/lib/site";
import { useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, Clock } from "lucide-react";
import { useImagePalette } from "@/hooks/use-image-palette";
import { ThumbRow } from "@/components/cards";
import { JumpArrow } from "@/components/jump-arrow";
import { ArticleActions, Discussion, discussionQuery } from "@/components/article-community";
import { type Article, catalogueUnavailable, formatPublishedShort, getArticle, getSection, latestArticles, relatedArticles } from "@/data/news";
import { articleBodyQuery } from "@/lib/catalogue.functions";

export const Route = createFileRoute("/article/$slug")({
  loader: async ({ params, context }) => {
    const found = getArticle(params.slug);
    if (!found) {
      if (catalogueUnavailable) return { article: null, bodyUnavailable: true };
      throw notFound();
    }
    // Comments load in parallel with the story text (browser navigation only).
    if (typeof window !== "undefined") void context.queryClient.prefetchQuery(discussionQuery(found.slug));
    const { body, unavailable } = await context.queryClient.ensureQueryData(articleBodyQuery(found.slug));
    return { article: { ...found, body: body ?? [] }, bodyUnavailable: unavailable };
  },
  head: ({ loaderData, params }) => {
    const a = loaderData?.article;
    const title = a ? `${a.title} — Midnight` : "Story not found — Midnight";
    const desc = a?.excerpt ?? "This story could not be found.";
    return {
      meta: [
      { property: "og:url", content: absUrl(`/article/${params.slug}`) },
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary_large_image" },
        ...(a ? [{ property: "article:published_time", content: a.publishedAt }, { property: "article:modified_time", content: a.updatedAt || a.publishedAt }, { property: "article:section", content: a.tag }] : []),
        ...(a && /^https:\/\//.test(a.img) ? [{ property: "og:image", content: a.img }, { name: "twitter:image", content: a.img }] : []),
      ],
      links: [{ rel: "canonical", href: absUrl(`/article/${params.slug}`) }],
      scripts: a ? [{
        type: "application/ld+json",
        children: JSON.stringify([
          { "@context": "https://schema.org", "@type": "NewsArticle", headline: a.title, description: a.excerpt, datePublished: a.publishedAt, dateModified: a.updatedAt || a.publishedAt, articleSection: a.tag, ...(/^https:\/\//.test(a.img) ? { image: [a.img] } : {}), mainEntityOfPage: absUrl(`/article/${params.slug}`), url: absUrl(`/article/${params.slug}`), author: { "@type": "Organization", name: SITE_NAME, url: absUrl("/") }, publisher: { "@type": "NewsMediaOrganization", name: SITE_NAME, url: absUrl("/") } },
          { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: absUrl("/") },
            { "@type": "ListItem", position: 2, name: a.tag, item: absUrl(`/section/${a.section}`) },
            { "@type": "ListItem", position: 3, name: a.title, item: absUrl(`/article/${params.slug}`) },
          ] },
        ]),
      }] : [],
    };
  },
  notFoundComponent: () => (
    <main className="mx-auto max-w-3xl px-4 pt-40 pb-24 text-center">
      <h1 className="text-4xl font-extrabold">We couldn't find that story</h1>
      <p className="mt-3 text-muted-foreground">It may have moved or been removed.</p>
      <Link to="/" className="mt-6 inline-block rounded-full bg-primary px-6 py-3 font-bold text-primary-foreground">Back to home</Link>
    </main>
  ),
  component: ArticlePage,
});

function ArticlePage() {
  const { article, bodyUnavailable } = Route.useLoaderData();
  if (!article) return <main className="mx-auto max-w-7xl px-4 pb-24" />;
  return <ArticleView a={article} bodyUnavailable={!!bodyUnavailable} />;
}

function ArticleView({ a, bodyUnavailable }: { a: Article; bodyUnavailable: boolean }) {
  const section = getSection(a.section);
  const related = relatedArticles(a);
  const seen = new Set([a.slug, ...related.map((r) => r.slug)]);
  const latest = latestArticles(12).filter((r) => !seen.has(r.slug)).slice(0, 4);
  useImagePalette(a.img);
  const [view, setView] = useState<"full" | "summary">("full");

  return (
    <main className="mx-auto max-w-7xl px-4 pt-28 pb-24">
      <div aria-hidden className="header-glow"><img src={a.img} alt="" /></div>
      <article className="mx-auto max-w-4xl">
        <h1 className="mx-auto max-w-2xl text-center font-serif text-4xl leading-[1.1] font-semibold md:text-5xl">{a.title}</h1>
        <header className="group relative isolate mt-8">
          <img src={a.img} alt="" aria-hidden className="photo-glow" />
          <div className="relative z-10 overflow-hidden rounded-[2.25rem] shadow-float">
            <img src={a.img} alt={a.title} width={1024} height={1280} className="absolute inset-0 h-full w-full object-cover transition duration-[1.5s] group-hover:scale-[1.03]" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
            <div className="relative flex min-h-[380px] flex-col justify-end p-5 sm:p-6 md:min-h-[480px] md:p-10">
              <div className="max-w-2xl">
                <Link to="/" className="inline-flex w-fit items-center gap-2 rounded-full border border-white/30 bg-black/30 px-4 py-2 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-black/45">
                  <ArrowLeft className="h-4 w-4" /> Back to home
                </Link>
                <p className="mt-4 font-serif text-lg leading-snug text-white/90 italic sm:text-xl md:text-2xl">{a.excerpt}</p>
                <nav aria-label="Breadcrumb" className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/80">
                  <Link to="/section/$slug" params={{ slug: a.section }} className="rounded-full border border-white/30 bg-black/30 px-3 py-1 text-[11px] font-bold tracking-wider text-white uppercase backdrop-blur-md">
                    {section?.name ?? a.tag}
                  </Link>
                  <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {a.time} read</span>
                  <span aria-hidden className="h-1 w-1 rounded-full bg-white/60" />
                  <time dateTime={a.publishedAt}>{formatPublishedShort(a.publishedAt)}</time>
                </nav>
              </div>
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-3xl">
          <ArticleActions slug={a.slug} title={a.title} />
          <div role="tablist" aria-label="Reading mode" className="glass mx-auto mt-8 flex w-fit gap-1 rounded-full p-1.5">
            {([["full", "Full article"], ["summary", "Summary"]] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                className={`rounded-full px-4 py-2.5 text-sm font-bold whitespace-nowrap transition sm:px-6 ${view === k ? "bg-primary text-primary-foreground shadow-float" : "nav-hover text-muted-foreground"}`}>
                {label}{k === "summary" && <span className="ml-1.5 font-medium opacity-70">· 1 min</span>}
              </button>
            ))}
          </div>
          <div className="glass mt-6 space-y-5 rounded-[2rem] p-6 text-lg leading-relaxed md:p-10">
            {view === "full" && bodyUnavailable ? <p className="text-center text-base text-muted-foreground">The full story couldn't load right now. Please try again shortly.</p> : view === "full" && a.body.length === 0 ? <p className="text-center text-base text-muted-foreground">The full text of this story isn't available yet.</p> : view === "summary" && a.summary.length === 0 ? <p className="text-center text-base text-muted-foreground">A summary isn't available for this story yet.</p> : view === "full" ? a.body.map((p, i) => (
              <p key={i} className={i === 0 ? "first-letter:float-left first-letter:mr-2 first-letter:font-serif first-letter:text-6xl first-letter:leading-none" : ""}>{p}</p>
            )) : (
              <ul className="space-y-4">
                {a.summary.map((p, i) => (
                  <li key={i} className="flex gap-3"><span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" />{p}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </article>
      <Discussion slug={a.slug} />
      <JumpArrow />
      {related.length > 0 && <section className="mx-auto mt-16 max-w-3xl">
        <h2 className="text-2xl font-extrabold">Keep reading</h2>
        <div className="mt-5 space-y-3">
          {related.map((r) => (
            <ThumbRow key={r.slug} s={r} />
          ))}
        </div>
        {section && <Link to="/section/$slug" params={{ slug: section.slug }} className="mt-5 inline-block font-bold text-primary hover:underline">More from {section.name} →</Link>}
      </section>}
      {latest.length > 0 && <section className="mx-auto mt-12 max-w-3xl">
        <h2 className="text-2xl font-extrabold">Latest from Midnight</h2>
        <div className="mt-5 space-y-3">
          {latest.map((r) => <ThumbRow key={r.slug} s={r} />)}
        </div>
      </section>}
    </main>
  );
}
