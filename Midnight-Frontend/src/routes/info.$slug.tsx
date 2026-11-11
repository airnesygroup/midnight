import { absUrl } from "@/lib/site";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { infoPages } from "@/data/news";

export const Route = createFileRoute("/info/$slug")({
  loader: ({ params }) => {
    const page = infoPages[params.slug];
    if (!page) throw notFound();
    return { page };
  },
  head: ({ loaderData, params }) => {
    const p = loaderData?.page;
    const title = p ? `${p.title} — Midnight` : "Page not found — Midnight";
    const desc = p?.text ?? "This page could not be found.";
    return {
      meta: [
      { property: "og:url", content: absUrl(`/info/${params.slug}`) },
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
      links: [{ rel: "canonical", href: absUrl(`/info/${params.slug}`) }],
    };
  },
  notFoundComponent: () => (
    <main className="mx-auto max-w-3xl px-4 pt-40 pb-24 text-center">
      <h1 className="text-4xl font-extrabold">Page not found</h1>
      <Link to="/" className="mt-6 inline-block rounded-full bg-primary px-6 py-3 font-bold text-primary-foreground">Back to home</Link>
    </main>
  ),
  component: InfoPage,
});

function InfoPage() {
  const { page } = Route.useLoaderData();
  return (
    <main className="mx-auto max-w-3xl px-4 pt-28 pb-24">
      <div className="glass rounded-[2rem] p-8 md:p-12">
        <p className="text-xs font-bold tracking-wider uppercase text-muted-foreground">Midnight</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">{page.title}</h1>
        <p className="mt-6 text-lg leading-relaxed text-muted-foreground">{page.text}</p>

        {page.facts && (
          <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {page.facts.map((f) => (
              <div key={f.label} className="glass-strong rounded-2xl px-4 py-3">
                <dt className="text-xs font-bold tracking-wider uppercase text-muted-foreground">{f.label}</dt>
                <dd className="mt-1 text-sm font-semibold">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {page.sections?.map((s) => (
          <section key={s.heading} className="mt-10">
            <h2 className="text-2xl font-extrabold tracking-tight">{s.heading}</h2>
            {s.body?.map((p, i) => (
              <p key={i} className="mt-4 leading-relaxed text-muted-foreground">{p}</p>
            ))}
            {s.bullets && (
              <ul className="mt-4 space-y-2.5">
                {s.bullets.map((b) => (
                  <li key={b} className="flex gap-3 leading-relaxed text-muted-foreground">
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-primary" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <Link to="/explore" className="mt-10 inline-block rounded-full bg-primary px-6 py-3 font-bold text-primary-foreground">Explore the news</Link>
      </div>
    </main>
  );
}
