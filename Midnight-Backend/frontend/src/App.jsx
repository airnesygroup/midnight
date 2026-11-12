import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Ban, ChevronsLeft, ChevronsRight, FileText, Globe, KeyRound, Menu, Newspaper, TrendingUp, X } from "lucide-react";
import { BrandWordmarkFilter, MidnightLogo } from "./components/MidnightLogo.jsx";
import { useThemeMode } from "./components/theme.jsx";
import Live from "./pages/Live.jsx";
import Articles from "./pages/Articles.jsx";
import Reports from "./pages/Reports.jsx";
import Trends from "./pages/Trends.jsx";
import Sources from "./pages/Sources.jsx";
import Keys from "./pages/Keys.jsx";
import Review from "./pages/Review.jsx";
const Skipped = () => <Review kind="skipped" />;
const Failed = () => <Review kind="failed" />;

const TABS = [
  { id: "live", label: "Live activity", icon: Activity, view: Live },
  { id: "articles", label: "Published articles", icon: Newspaper, view: Articles },
  { id: "reports", label: "Midnight Reports", icon: FileText, view: Reports },
  { id: "trends", label: "Midnight Trends", icon: TrendingUp, view: Trends },
  { id: "skipped", label: "Skipped", icon: Ban, view: Skipped },
  { id: "failed", label: "Failed", icon: AlertTriangle, view: Failed },
  { id: "sources", label: "Sources", icon: Globe, view: Sources },
  { id: "keys", label: "API keys", icon: KeyRound, view: Keys },
];

const readTab = () => (TABS.find((t) => t.id === window.location.hash.slice(1)) || TABS[0]).id;

export default function App() {
  const [tab, setTab] = useState(readTab);
  const [drawer, setDrawer] = useState(false);
  const theme = useThemeMode();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("dash-collapsed") === "1"; } catch { return false; } });
  useEffect(() => { const f = () => setTab(readTab()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  const go = (id) => { window.location.hash = id; setDrawer(false); };
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem("dash-collapsed", c ? "0" : "1"); } catch { /* ignore */ } return !c; });
  const current = TABS.find((t) => t.id === tab);
  const View = current.view;

  const nav = (rail) => (
    <>
      <div className="mb-5 flex min-w-0 items-center gap-3 px-1">
        <MidnightLogo size="h-10 w-10" />
        <div className="admin-label min-w-0">
          <p className="brand-wordmark block text-2xl">midnight</p>
          <p className="truncate text-xs text-muted-foreground">Pipeline monitor</p>
        </div>
      </div>
      <nav className="admin-nav space-y-1">
        {TABS.map((t) => (
          <button key={t.id} type="button" className="admin-tab" data-active={tab === t.id} data-tip={rail ? t.label : undefined}
            aria-label={t.label} onClick={() => go(t.id)}>
            <t.icon /><span className="admin-label">{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="mt-3 space-y-1 border-t border-border/60 pt-3">
        <button type="button" className="admin-tab" data-tip={rail ? theme.label : undefined} aria-label={theme.label} onClick={theme.toggle}>
          <theme.Icon /><span className="admin-label">{theme.label}</span>
        </button>
        {rail && (
          <button type="button" className="admin-tab hidden lg:flex" aria-label={collapsed ? "Expand menu" : "Collapse menu"} onClick={toggle}>
            {collapsed ? <ChevronsRight /> : <ChevronsLeft />}<span className="admin-label">Collapse menu</span>
          </button>
        )}
      </div>
    </>
  );

  return (
    <div className="admin-shell aurora relative min-h-screen overflow-x-hidden">
      <BrandWordmarkFilter />
      <header className="admin-topbar glass-strong shadow-float">
        <button type="button" className="admin-icon-btn" aria-label="Open menu" onClick={() => setDrawer(true)}><Menu className="h-5 w-5" /></button>
        <p className="truncate text-center font-serif text-lg">{current.label}</p>
        <button type="button" className="admin-icon-btn" aria-label={theme.label} onClick={theme.toggle}><theme.Icon className="h-5 w-5" /></button>
      </header>
      {drawer && (
        <>
          <div className="admin-overlay" onClick={() => setDrawer(false)} />
          <aside className="admin-drawer glass-strong shadow-float admin-enter" aria-label="Menu">
            <button type="button" className="admin-icon-btn absolute top-3 right-3" aria-label="Close menu" onClick={() => setDrawer(false)}><X className="h-5 w-5" /></button>
            {nav(false)}
          </aside>
        </>
      )}
      <aside className="admin-sidebar glass-strong shadow-float" data-collapsed={collapsed}>{nav(true)}</aside>
      <main key={tab} className="admin-main admin-enter mx-auto w-full max-w-[90rem] space-y-6" data-collapsed={collapsed}>
        <View />
      </main>
    </div>
  );
}
