import { ThemeMenuRow, ThemeHeaderButton } from "@/components/theme-toggle";
import { PremiumMenuIcon } from "@/components/premium-menu-icon";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PageLock } from "@/components/page-lock";
import { useHoverMenu } from "@/hooks/use-hover-menu";
import { AccountButton } from "@/components/account-button";
import { Link, useNavigate } from "@tanstack/react-router";
import { articles, navigationSections, searchArticles, slugify } from "@/data/news";
import { ChevronDown, Search, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { IconTip, MidnightLogo, moreCategories } from "@/components/news-bits";
import { useAuth } from "@/hooks/use-auth";

const mainItems = ["World", "Politics", "Tech", "US", "Europe", "Africa", "Asia", "Middle East", "Latin America", "Oceania", "Business", "Climate", "Opinion"];
const allCategories = () => navigationSections([...mainItems, "Sport", "Culture", "Health & Science", ...moreCategories]);
const describe = (c: string) => `Show ${c.toLowerCase()} news only`;

type Cfg = { strip: boolean; more: boolean; signIn: boolean; wordmark: boolean; report: boolean };

// Ordered from most to least content; first config that fits wins.
const configs: Cfg[] = [
  { strip: true, more: true, signIn: true, wordmark: true, report: true },
  { strip: true, more: true, signIn: false, wordmark: true, report: true },
  { strip: true, more: true, signIn: false, wordmark: false, report: true },
  { strip: true, more: false, signIn: false, wordmark: false, report: true },
  { strip: true, more: false, signIn: false, wordmark: false, report: false },
  { strip: false, more: false, signIn: false, wordmark: false, report: false },
];
const MIN_STRIP = 90;


const slugOf = (name: string) => slugify(name);

function MoreCategories() {
  const { open, byHover, onOpenChange, close, trigger, content } = useHoverMenu();
  return (
    <>
    <PageLock active={open && !byHover} onClose={close} />
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger {...trigger} className="flex items-center gap-1 whitespace-nowrap outline-hidden">
        More <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        {...content}
        align="end"
        sideOffset={14}
        className="glass grid max-h-[min(70dvh,var(--radix-dropdown-menu-content-available-height))] w-80 max-w-[calc(100vw-2rem)] grid-cols-2 gap-1 overflow-y-auto overscroll-contain rounded-2xl border-0 p-2"
      >
        {allCategories().map((c) => (
          <DropdownMenuItem key={c.slug} asChild className="nav-hover min-w-0 rounded-xl px-3 py-2 font-medium whitespace-normal focus:bg-navigation-highlight focus:text-foreground data-[status=active]:bg-navigation-highlight data-[status=active]:font-bold data-[status=active]:text-foreground">
            <Link to="/section/$slug" params={{ slug: c.slug }}>{c.name}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );
}

export function SiteHeader() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cfg, setCfg] = useState<Cfg>(configs[0] ?? { strip: false, more: false, signIn: false, wordmark: false, report: false });
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const searchPanelRef = useRef<HTMLDivElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => { if (event.target instanceof Node && !searchPanelRef.current?.contains(event.target) && !searchButtonRef.current?.contains(event.target)) setSearchOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);


  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSearchOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const m = measureRef.current;
    if (!nav || !m) return;
    const compute = () => {
      // Small screens: no moving strip — the search bar fills the header instead.
      if (window.innerWidth < 768) {
        setCfg({ strip: false, more: false, signIn: false, wordmark: false, report: false });
        return;
      }
      const w = (k: string) => (m.querySelector(`[data-m="${k}"]`) as HTMLElement | null)?.offsetWidth ?? 0;
      const avail = nav.clientWidth - 24 - 10; // nav padding
      const NAVGAP = 24;
      const GAP = 8;
      const ICON = 44;
      const fits = (c: Cfg) => {
        const needsBurger = !c.strip || !c.more;
        const left = 28 + (c.wordmark ? GAP + w("wordmark") : 0) + (c.more ? NAVGAP + w("More") : 0) + (c.strip ? 32 + MIN_STRIP : 0);
        const right = ICON + (c.signIn ? GAP + w("signin") + w("searchbar") - ICON : 0) + (c.report ? GAP + w("report") : 0) + (needsBurger ? GAP + ICON : 0);
        return left + 16 + right <= avail;
      };
      setCfg(configs.find(fits) ?? { strip: false, more: false, signIn: false, wordmark: false, report: false });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(nav);
    window.addEventListener("resize", compute);
    document.fonts?.ready.then(compute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", compute);
    };
  }, []);

  const needsBurger = !cfg.strip || !cfg.more;
  const q = query.trim().toLowerCase();
  const results = searchArticles(q).slice(0, 8);
  const submit = () => {
    if (!q) return;
    setSearchOpen(false);
    navigate({ to: "/search", search: { q: query.trim() } });
  };

  return (
    <>
    <PageLock active={menuOpen || searchOpen} onClose={() => { setMenuOpen(false); setSearchOpen(false); }} />
    <div aria-hidden className="header-haze pointer-events-none fixed inset-x-0 top-0 z-40 h-28" />
    <header ref={headerRef} className="fixed inset-x-0 top-4 z-50 mx-auto max-w-7xl px-4">
      {/* Invisible copies used to measure natural widths */}
      <div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute -z-10 flex whitespace-nowrap">
        <span data-m="wordmark" className="text-2xl font-extrabold tracking-tight">midnight</span>
        <span data-m="More" className="flex items-center gap-1 text-[15px] font-medium">More <ChevronDown className="h-4 w-4" /></span>
        <span data-m="signin" className="px-4 font-medium">Sign in</span>
        <span data-m="searchbar" className="inline-block w-52 xl:w-64" />
        <span data-m="report" className="px-6 font-bold">The Report</span>
      </div>

      <nav ref={navRef} className="glass flex items-center justify-between gap-3 rounded-full py-2.5 pr-2.5 pl-6 sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-6">
            <Link to="/" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="flex shrink-0 items-center gap-2 text-2xl font-extrabold tracking-tight">
              <MidnightLogo />
              {cfg.wordmark && <span className="hidden md:inline">midnight</span>}
            </Link>
          {(
            <Button variant="ghost"
              ref={searchButtonRef}
              aria-label="Search"
              aria-expanded={searchOpen}
              onClick={() => {
                setSearchOpen((o) => !o);
                setMenuOpen(false);
              }}
              className={`flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-full search-field px-4 text-sm text-muted-foreground transition hover:bg-navigation-highlight [&_svg]:size-4 ${cfg.signIn ? "md:hidden" : ""} ${searchOpen ? "bg-secondary" : ""}`}
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="truncate">Search Midnight…</span>
            </Button>
          )}
          {cfg.strip && (
            <div className="nav-strip hidden min-w-0 flex-1 overflow-hidden lg:block">
              <ul className="animate-nav-strip flex w-max items-center text-[15px] font-medium whitespace-nowrap">
                {[0, 1].map((copy) =>
                  ["Explore", "Trends", ...mainItems, "The Midnight Report"].map((i) => (
                    <li key={`${copy}-${i}`} className="pr-6" aria-hidden={copy === 1}>
                        {i === "The Midnight Report" ? <Link to="/midnight-report" tabIndex={copy ? -1 : 0} className="nav-text px-2 py-1">{i}</Link> : i === "Explore" ? (
                          <Link to="/explore" tabIndex={copy ? -1 : 0} activeProps={{ className: "nav-text-active" }} className="nav-text px-2 py-1">Explore</Link>
                        ) : i === "Trends" ? (
                          <Link to="/trends" tabIndex={copy ? -1 : 0} activeProps={{ className: "nav-text-active" }} className="nav-text px-2 py-1">Trends</Link>
                        ) : (
                          <Link to="/section/$slug" params={{ slug: slugOf(i) }} tabIndex={copy ? -1 : 0} activeProps={{ className: "nav-text-active" }} className="nav-text px-2 py-1">{i}</Link>
                        )}
                    </li>
                  )),
                )}
              </ul>
            </div>
          )}
          {cfg.more && (
            <div className="hidden shrink-0 text-[15px] font-medium lg:block">
              <MoreCategories />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0 sm:gap-2 md:gap-4 lg:gap-5 xl:gap-6">
          {cfg.signIn && (
            <Button variant="ghost"
              ref={searchButtonRef}
              aria-label="Search"
              aria-expanded={searchOpen}
              onClick={() => {
                setSearchOpen((o) => !o);
                setMenuOpen(false);
              }}
              className={`hidden h-12 w-52 items-center gap-2.5 rounded-full search-field px-4 text-sm text-muted-foreground transition hover:bg-navigation-highlight md:flex xl:w-64 [&_svg]:size-4 ${searchOpen ? "bg-secondary" : ""}`}
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="truncate">Search Midnight…</span>
            </Button>
          )}
          {/* Only on the header when the menu button is gone; otherwise it lives inside the menu. */}
          {!needsBurger && <ThemeHeaderButton className="hidden lg:grid" />}
          {cfg.signIn && <div className="hidden md:block"><AccountButton /></div>}
          {cfg.report && (
            <Button asChild className="hidden h-11 rounded-full px-6 font-bold md:inline-flex"><Link to="/midnight-report">The Report</Link></Button>
          )}
          {(
            <IconTip label={menuOpen ? "Close menu" : "Open all sections"}>
              <Button variant="ghost"
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                aria-expanded={menuOpen}
                onClick={() => {
                  setMenuOpen((o) => !o);
                  setSearchOpen(false);
                }}
                className={`grid h-12 w-12 place-items-center rounded-full border hover:bg-navigation-highlight [&_svg]:size-7 ${menuOpen ? "border-border bg-navigation-highlight shadow-sm" : "border-transparent"} ${needsBurger ? "" : "lg:hidden"}`}
              >
                {menuOpen ? <X className="h-7 w-7" /> : <PremiumMenuIcon className="h-7 w-7" />}
              </Button>
            </IconTip>
          )}
        </div>
      </nav>

      {searchOpen && (
        <div ref={searchPanelRef} className="glass mx-auto mt-3 max-w-2xl rounded-[1.75rem] p-3">
          <div className="search-field flex items-center gap-3 rounded-full px-4">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search headlines, topics, sections…"
              className="min-w-0 flex-1 bg-transparent py-3 outline-hidden placeholder:text-muted-foreground"
            />
            {query && (
              <IconTip label="Clear search">
                <Button variant="ghost" aria-label="Clear search" onClick={() => setQuery("")} className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-navigation-highlight">
                  <X className="h-4 w-4" />
                </Button>
              </IconTip>
            )}
          </div>
          <div className="mt-2 max-h-[60dvh] overflow-y-auto">
            {!q && <p className="px-4 py-3 text-sm text-muted-foreground">Start typing to search {articles.length} stories. Press Enter for all results.</p>}
            {q && results.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No stories match “{query}”.</p>}
            {results.map((r) => (
              <Link
                key={r.slug}
                to="/article/$slug"
                params={{ slug: r.slug }}
                onClick={() => setSearchOpen(false)}
                className="flex w-full min-w-0 items-center gap-3 rounded-2xl px-4 py-2.5 text-left hover:bg-navigation-highlight"
              >
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

      {menuOpen && (
        <div aria-label="All sections" className="glass mt-3 flex max-h-[calc(100dvh-7rem)] flex-col overflow-hidden rounded-[1.75rem]">
          <ul className="grid min-h-0 gap-1 overflow-y-auto overscroll-contain p-4 text-base font-semibold sm:grid-cols-2">
            <li>
              <Link to="/explore" onClick={() => setMenuOpen(false)} activeProps={{ className: "nav-selected font-extrabold" }} className="block rounded-xl px-4 py-2.5 hover:bg-navigation-highlight">Explore</Link>
            </li>
            <li>
              <Link to="/trends" onClick={() => setMenuOpen(false)} activeProps={{ className: "nav-selected font-extrabold" }} className="block rounded-xl px-4 py-2.5 hover:bg-navigation-highlight">Midnight Trends</Link>
            </li>
            {allCategories().map((section) => (
              <li key={section.slug}>
                <Link to="/section/$slug" params={{ slug: section.slug }} onClick={() => setMenuOpen(false)} activeProps={{ className: "nav-selected font-extrabold" }} className="block rounded-xl px-4 py-2.5 hover:bg-navigation-highlight">{section.name}</Link>
              </li>
            ))}
          </ul>
          <div aria-label="Menu actions" className="grid shrink-0 grid-cols-2 items-center gap-3 border-t border-navigation-border px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <ThemeMenuRow />
            {user || loading ? <AccountButton onNavigate={() => setMenuOpen(false)} /> : (
              <Button asChild variant="outline" className="h-11 rounded-full font-semibold">
                <Link to="/auth" search={{ mode: "signup" }} onClick={() => setMenuOpen(false)}>Sign up</Link>
              </Button>
            )}
            <Button asChild className="h-11 rounded-full font-bold"><Link to="/midnight-report" onClick={() => setMenuOpen(false)}>The Report</Link></Button>
          </div>
        </div>
      )}
    </header>
    </>
  );
}
