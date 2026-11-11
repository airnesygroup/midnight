import { absUrl } from "@/lib/site";
import { EmptyCard } from "@/components/states";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Search } from "lucide-react";
import { z } from "zod";
import { ThumbRow } from "@/components/cards";
import { searchArticles } from "@/data/news";

export const Route = createFileRoute("/search")({
  validateSearch: (s) => z.object({ q: z.string().optional() }).parse({ q: typeof s["q"] === "string" ? s["q"] : undefined }),
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, follow" },
      { property: "og:url", content: absUrl("/search") },
      { title: "Search — Midnight" },
      { name: "description", content: "Search every Midnight story by headline, topic, or section." },
      { property: "og:title", content: "Search — Midnight" },
      { property: "og:description", content: "Search every Midnight story by headline, topic, or section." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: absUrl("/search") }],
  }),
  component: SearchPage,
});

function SearchPage() {
  const { q = "" } = Route.useSearch();
  const navigate = useNavigate();
  const [value, setValue] = useState(q);
  const results = searchArticles(q);

  return (
    <main className="mx-auto max-w-4xl px-4 pt-28 pb-24">
      <h1 className="text-4xl font-extrabold tracking-tight md:text-5xl">Search</h1>
      <form
        className="glass mt-6 flex items-center gap-3 rounded-full p-2 pl-5"
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ to: "/search", search: { q: value.trim() || undefined } });
        }}
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Search headlines, topics, sections…" className="min-w-0 flex-1 bg-transparent py-2 outline-hidden placeholder:text-muted-foreground" />
        <button className="shrink-0 rounded-full bg-primary px-6 py-3 font-bold text-primary-foreground">Search</button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        {q ? `${results.length} ${results.length === 1 ? "result" : "results"} for “${q}”` : "Type something to search every story."}
      </p>
      <div className="mt-4 space-y-3">
        {q && results.length === 0 && <EmptyCard icon="search" text={`No stories match “${q}”. Try another word.`} />}
        {results.map((a) => (
          <ThumbRow key={a.slug} s={a} />
        ))}
      </div>
    </main>
  );
}
