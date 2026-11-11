import { CompactMenu } from "@/components/compact-menu";
import { useEffect, useRef, useState } from "react";
import { PageLock } from "@/components/page-lock";
import { AccountButton } from "@/components/account-button";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MidnightLogo } from "@/components/news-bits";
import { articles, searchArticles } from "@/data/news";
import { searchTrends, trends } from "@/data/trends";
import { useAuth } from "@/hooks/use-auth";

/**
 * Minimal header for article, report and resource pages: logo · centred search button · report.
 * The search button opens the same search panel as the main header.
 */
export function CompactHeader() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (e.target instanceof Node && !buttonRef.current?.contains(e.target) && !panelRef.current?.contains(e.target)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, []);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const q = query.trim().toLowerCase();
  // Inside Midnight Trends the search only ever looks at trends; elsewhere it only sees news.
  const inTrends = useRouterState({ select: (st) => st.location.pathname === "/trends" || st.location.pathname.startsWith("/trends/") });
  const results = !q ? [] : inTrends
    ? searchTrends(q).slice(0, 8).map((t) => ({ slug: t.slug, title: t.title, tag: `#${t.hashtags[0] ?? "Trending"}` }))
    : searchArticles(q).slice(0, 8);
  const submit = () => {
    if (!q) return;
    setOpen(false);
    if (inTrends) navigate({ to: "/trends", search: { q: query.trim() } });
    else navigate({ to: "/search", search: { q: query.trim() } });
  };
  const label = inTrends ? "Search trends…" : "Search Midnight…";

  return (
    <>
      <PageLock active={open} onClose={() => setOpen(false)} />
      <div aria-hidden className="header-haze pointer-events-none fixed inset-x-0 top-0 z-40 h-28" />
      <header className="fixed inset-x-0 top-4 z-50 mx-auto max-w-7xl px-4">
        <nav className="glass grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-full py-2.5 pr-2.5 pl-4 sm:grid-cols-[1fr_minmax(0,28rem)_1fr] sm:pl-6">
          <Link to="/" className="flex items-center gap-2 justify-self-start text-2xl font-extrabold tracking-tight">
            <MidnightLogo />
            <span className="hidden md:inline">midnight</span>
          </Link>

          <Button variant="ghost"
            ref={buttonRef}
            aria-label={inTrends ? "Search trends" : "Search"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className={`flex h-11 w-full min-w-0 items-center justify-start gap-2.5 rounded-full search-field px-4 text-sm font-normal text-muted-foreground transition hover:bg-navigation-highlight [&_svg]:size-4 ${open ? "bg-secondary" : ""}`}
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="truncate">{label}</span>
          </Button>

          <div className="flex items-center gap-1 justify-self-end md:gap-4 lg:gap-5 xl:gap-6">
            {user ? <span className="hidden sm:inline-flex"><AccountButton compact /></span> : (
              // Small screens find The Report inside the menu instead.
              <Button asChild className="hidden h-11 rounded-full px-6 font-bold sm:inline-flex">
                <Link to="/midnight-report">The Report</Link>
              </Button>
            )}
            <CompactMenu />
          </div>
        </nav>

        {open && (
          <div ref={panelRef} className="glass mx-auto mt-3 max-w-2xl rounded-[1.75rem] p-3">
            <div className="search-field flex items-center gap-3 rounded-full px-4">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder={inTrends ? "Search trends and hashtags…" : "Search headlines, topics, sections…"}
                aria-label={inTrends ? "Search trends" : "Search articles"}
                className="min-w-0 flex-1 bg-transparent py-3 outline-hidden placeholder:text-muted-foreground"
              />
              {query && (
                <Button variant="ghost" aria-label="Clear search" onClick={() => setQuery("")} className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-navigation-highlight">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="mt-2 max-h-[60dvh] overflow-y-auto">
              {!q && <p className="px-4 py-3 text-sm text-muted-foreground">Start typing to search {inTrends ? `${trends.length} trends` : `${articles.length} stories`}. Press Enter for all results.</p>}
              {q && results.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">{inTrends ? "No trends match" : "No stories match"} “{query}”.</p>}
              {results.map((r) => (
                <Link key={r.slug} to={inTrends ? "/trends/$slug" : "/article/$slug"} params={{ slug: r.slug }} onClick={() => setOpen(false)}
                  className="flex w-full min-w-0 items-center gap-3 rounded-2xl px-4 py-2.5 text-left hover:bg-navigation-highlight">
                  <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-primary uppercase">{r.tag}</span>
                  <span className="truncate font-medium">{r.title}</span>
                </Link>
              ))}
              {results.length > 0 && (
                <Button variant="ghost" onClick={submit} className="mt-1 w-full rounded-2xl px-4 py-2.5 text-left text-sm font-semibold text-primary hover:bg-navigation-highlight">
                  See all results for “{query.trim()}” →
                </Button>
              )}
            </div>
          </div>
        )}
      </header>
    </>
  );
}
