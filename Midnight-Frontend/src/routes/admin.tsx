import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Activity as Activity_, BarChart3, Check, ChevronsLeft, ChevronsRight, FileText, LayoutDashboard, LogOut, Menu, MessageSquare, Minus,
  Search, ShieldCheck, Star, Trash2, UserCog, Users, UsersRound, X,
} from "lucide-react";
import { ColorGlow } from "@/components/color-glow";
import { PasswordField } from "@/components/password-field";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Loader, LoaderBlock } from "@/components/loader";
import { ConfirmProvider, useConfirm } from "@/components/admin/confirm";
import { DaysPicker, SelectMenu, type Option } from "@/components/admin/select-menu";
import {
  adminMe, adminLogin, adminLogout, adminStats, adminOverview, adminListArticles, adminGetArticle,
  adminSaveArticle, adminSetArticleStatus, adminBulkArticles, adminCommunityTotals, adminListComments, adminRemoveComment, adminListReaders,
  adminSetMemberBlocked, adminDeleteMember, adminSecurity, adminUpdateSettings, adminRevokeSession,
  adminListTeam, adminActivityLog, adminReaderActivity, adminCreateEditor, adminUpdateTeamMember, adminUpdateMyAccount,
} from "@/lib/admin.functions";
import { gaIdQuery } from "@/lib/analytics.functions";
import { matchesQuery, withinDays } from "@/lib/admin-filters";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Admin — Midnight" },
      { name: "description", content: "Midnight site administration." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Admin — Midnight" },
      { property: "og:description", content: "Midnight site administration." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <ConfirmProvider><AdminPage /></ConfirmProvider>,
});

type Me = NonNullable<Awaited<ReturnType<typeof adminMe>>>;
const err = (e: unknown) => toast.error(e instanceof Error ? e.message : "Something went wrong");
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString() : "—");
const fmtDay = (d?: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

function Shell({ children }: { children: ReactNode }) {
  return <div className="admin-shell aurora relative min-h-screen overflow-x-hidden"><ColorGlow />{children}</div>;
}

function AdminPage() {
  const me = useQuery({ queryKey: ["admin", "me"], queryFn: () => adminMe() });
  if (me.isLoading) return <Shell><LoaderBlock className="min-h-screen" size="lg" label="Opening admin" /></Shell>;
  return me.data ? <Dashboard me={me.data} /> : <Login />;
}

function Login() {
  const qc = useQueryClient();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => adminLogin({ data: { login, password } }),
    onSuccess: (r) => (r.ok ? qc.invalidateQueries({ queryKey: ["admin"] }) : setError(r.error)),
    onError: (e) => setError(e instanceof Error ? e.message : "Something went wrong"),
  });
  return (
    <Shell>
      <main className="relative z-10 mx-auto flex w-full max-w-md flex-col px-4 pt-32 pb-24">
        <a href="/" className="auth-page-title">Midnight</a>
        <div className="glass-strong rounded-[2rem] p-6 shadow-float md:p-8">
          <h1 className="text-center font-serif text-4xl">Admin sign in</h1>
          <p className="mt-2 text-center text-sm text-muted-foreground">Use your username or email to manage Midnight.</p>
          <form noValidate className="mt-6 grid gap-4" onSubmit={(e) => { e.preventDefault(); setError(null); if (!login || !password) { setError("Enter your username or email and password."); return; } m.mutate(); }}>
            <div>
              <label htmlFor="admin-login" className="auth-label">Username or email</label>
              <input id="admin-login" className="auth-input" placeholder="admin" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" />
            </div>
            <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
            {error && <p role="alert" className="auth-banner">{error}</p>}
            <button type="submit" disabled={m.isPending} className="admin-btn h-12 text-base" data-tone="primary">{m.isPending ? <><Loader size="xs" /> Signing in</> : "Sign in"}</button>
          </form>
        </div>
      </main>
    </Shell>
  );
}

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, role: "editor" },
  { id: "analytics", label: "Analytics", icon: BarChart3, role: "editor" },
  { id: "articles", label: "Articles", icon: FileText, role: "editor" },
  { id: "comments", label: "Comments", icon: MessageSquare, role: "editor" },
  { id: "readers", label: "Readers", icon: Users, role: "admin" },
  { id: "site", label: "Site & security", icon: ShieldCheck, role: "admin" },
  { id: "activity", label: "Activity", icon: Activity_, role: "admin" },
  { id: "team", label: "Team", icon: UsersRound, role: "admin" },
  { id: "account", label: "My account", icon: UserCog, role: "editor" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function Dashboard({ me }: { me: Me }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("overview");
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const logout = useMutation({ mutationFn: () => adminLogout(), onSuccess: () => { qc.clear(); location.reload(); } });
  const tabs = TABS.filter((t) => t.role === "editor" || me.role === "admin");
  const current = tabs.find((t) => t.id === tab);
  useEffect(() => { document.body.style.overflow = drawer ? "hidden" : ""; return () => { document.body.style.overflow = ""; }; }, [drawer]);
  const go = (id: Tab) => { setTab(id); setDrawer(false); window.scrollTo({ top: 0 }); };
  const signOut = async () => { if (await confirm({ title: "Sign out of admin?", confirmLabel: "Sign out" })) logout.mutate(); };

  const nav = (rail: boolean) => (
    <>
      <div className="mb-5 flex min-w-0 items-center gap-3 px-1">
        <span className="avatar-orb h-10 w-10 shrink-0 text-sm" style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>{me.username.slice(0, 1).toUpperCase()}</span>
        <div className="admin-label min-w-0">
          <a href="/" className="block font-serif text-xl leading-tight">Midnight</a>
          <p className="truncate text-xs text-muted-foreground">{me.username} · {me.role === "admin" ? "Admin" : "Editor"}</p>
        </div>
      </div>
      <nav className="admin-nav space-y-1">
        {tabs.map((t) => (
          <button key={t.id} type="button" className="admin-tab" data-active={tab === t.id} data-tip={rail ? t.label : undefined} aria-label={t.label} onClick={() => go(t.id)}>
            <t.icon /><span className="admin-label">{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="mt-3 space-y-1 border-t border-border/60 pt-3">
        {rail && (
          <button type="button" className="admin-tab hidden lg:flex" data-tip={collapsed ? "Expand menu" : undefined} aria-label={collapsed ? "Expand menu" : "Collapse menu"} onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <ChevronsRight /> : <ChevronsLeft />}<span className="admin-label">Collapse menu</span>
          </button>
        )}
        <button type="button" className="admin-tab" data-tip={rail ? "Sign out" : undefined} aria-label="Sign out" onClick={signOut}>
          <LogOut /><span className="admin-label">Sign out</span>
        </button>
      </div>
    </>
  );

  return (
    <Shell>
      <header className="admin-topbar glass-strong shadow-float">
        <button type="button" className="admin-icon-btn" aria-label="Open menu" onClick={() => setDrawer(true)}><Menu className="h-5 w-5" /></button>
        <p className="truncate text-center font-serif text-lg">{current?.label}</p>
        <span className="avatar-orb h-10 w-10 text-sm" style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>{me.username.slice(0, 1).toUpperCase()}</span>
      </header>
      {drawer && (
        <>
          <div className="admin-overlay" onClick={() => setDrawer(false)} />
          <aside className="admin-drawer glass-strong shadow-float admin-enter" aria-label="Admin menu">
            <button type="button" className="admin-icon-btn absolute top-3 right-3" aria-label="Close menu" onClick={() => setDrawer(false)}><X className="h-5 w-5" /></button>
            {nav(false)}
          </aside>
        </>
      )}
      <aside className="admin-sidebar glass-strong shadow-float" data-collapsed={collapsed}>{nav(true)}</aside>
      <main key={tab} className="admin-main admin-enter mx-auto w-full max-w-[90rem] space-y-6" data-collapsed={collapsed}>
        {tab === "overview" && <Overview />}
        {tab === "analytics" && <Analytics />}
        {tab === "articles" && <Articles />}
        {tab === "comments" && <Comments />}
        {tab === "readers" && <Readers />}
        {tab === "site" && <SiteSecurity />}
        {tab === "activity" && <Activity />}
        {tab === "team" && <Team meId={me.id} />}
        {tab === "account" && <Account me={me} />}
      </main>
    </Shell>
  );
}

/* ---------- Shared pieces ---------- */

type PageOf<T> = { rows: T[]; total: number; nextOffset: number | null };
/** Loads a list 20 at a time; the next batch arrives as the admin scrolls near the end. */
function usePaged<P extends PageOf<unknown>>(key: unknown[], fetchPage: (offset: number) => Promise<P>) {
  const q = useInfiniteQuery({
    queryKey: key, initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });
  const pages = q.data?.pages ?? [];
  return { q, first: pages[0] as P | undefined, rows: pages.flatMap((p) => p.rows) as P["rows"], total: pages[0]?.total ?? 0 };
}
function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(t); }, [value, ms]);
  return v;
}
function MoreSentinel({ q }: { q: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown } }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !q.hasNextPage) return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting && !q.isFetchingNextPage) q.fetchNextPage(); }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [q.hasNextPage, q.isFetchingNextPage, q]);
  if (!q.hasNextPage) return null;
  return <div ref={ref} className="flex justify-center py-4">{q.isFetchingNextPage ? <Loader /> : <button type="button" className="admin-btn" onClick={() => q.fetchNextPage()}>Load more</button>}</div>;
}

const H = ({ children, sub, right }: { children: ReactNode; sub?: string | undefined; right?: ReactNode }) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div className="min-w-0"><h1 className="admin-title">{children}</h1>{sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}</div>
    {right && <div className="flex shrink-0 flex-wrap gap-2">{right}</div>}
  </div>
);
const Stat = ({ label, value, glow }: { label: string; value: ReactNode; glow?: string }) => (
  <div className="admin-card admin-hover admin-stat-card relative" style={glow ? { ["--stat-glow" as string]: glow } : undefined}>
    <p className="admin-stat-label">{label}</p><p className="admin-stat">{value ?? "—"}</p>
  </div>
);
function State({ q, empty, children }: { q: { isLoading: boolean; error: unknown }; empty?: ReactNode | false; children?: ReactNode }) {
  if (q.isLoading) return <LoaderBlock />;
  if (q.error) return <div className="admin-empty text-destructive">{(q.error as Error).message}</div>;
  if (empty) return <div className="admin-empty text-muted-foreground">{empty}</div>;
  return <>{children}</>;
}
function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="admin-search">
      <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && <button type="button" aria-label="Clear search" onClick={() => onChange("")}><X className="h-4 w-4 text-muted-foreground" /></button>}
    </label>
  );
}
function Check3({ state, onClick, label }: { state: "on" | "off" | "some"; onClick: () => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={state === "some" ? "mixed" : state === "on"} aria-label={label} className="admin-check" data-state={state} onClick={onClick}>
      {state === "on" ? <Check /> : state === "some" ? <Minus /> : null}
    </button>
  );
}

/** Selection for bulk actions over the currently visible ids. */
function useSelection(visible: string[]) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const picked = visible.filter((id) => sel.has(id));
  const all: "on" | "off" | "some" = picked.length === 0 ? "off" : picked.length === visible.length ? "on" : "some";
  return {
    picked, all,
    has: (id: string) => sel.has(id),
    toggle: (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    toggleAll: () => setSel(all === "on" ? new Set() : new Set(visible)),
    clear: () => setSel(new Set()),
  };
}
function BulkBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  if (!count) return null;
  return (
    <div className="admin-bulk glass-strong shadow-float">
      <span className="px-2 text-sm font-bold">{count} selected</span>
      <div className="flex flex-1 flex-wrap justify-end gap-2">{children}<button type="button" className="admin-btn" onClick={onClear}>Clear</button></div>
    </div>
  );
}
function SelectAllRow({ s, total }: { s: ReturnType<typeof useSelection>; total: number }) {
  if (!total) return null;
  return <div className="flex items-center gap-3 px-1 text-sm text-muted-foreground"><Check3 state={s.all} onClick={s.toggleAll} label="Select all shown" /> Select all {total} shown</div>;
}
async function runAll<T>(items: T[], fn: (x: T) => Promise<unknown>) {
  const res = await Promise.allSettled(items.map(fn));
  const failed = res.filter((r) => r.status === "rejected").length;
  if (failed) toast.error(`${failed} of ${items.length} could not be updated`);
  else toast.success(`${items.length} updated`);
}
const opts = <T extends string>(all: string, values: T[]): Option<T | "all">[] => [{ value: "all", label: all }, ...values.map((v) => ({ value: v, label: v }))];

/* ---------- Overview & analytics ---------- */

function Overview() {
  const q = useQuery({ queryKey: ["admin", "overview"], queryFn: () => adminOverview() });
  if (!q.data) return <><H>Overview</H><State q={q} /></>;
  const { stats, settings, failedLogins24h, mongo, members } = q.data;
  return (
    <>
      <H sub="Last 30 days">Overview</H>
      {settings.maintenance_mode && <div className="admin-card flex flex-wrap items-center gap-2"><span className="admin-badge" data-tone="warn">Site paused</span> Visitors currently see the maintenance message.</div>}
      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-4">
        <Stat label="Page views" value={stats.views} glow="var(--glow-pink)" />
        <Stat label="Unique visitors" value={stats.visitors} glow="var(--glow-violet, var(--glow-pink))" />
        <Stat label="Views today" value={stats.today} />
        <Stat label="Readers" value={members} />
        <Stat label="Published stories" value={mongo?.published} />
        <Stat label="Paused stories" value={mongo?.paused} />
        <Stat label="Comments (new today)" value={mongo ? `${mongo.comments} (${mongo.commentsToday})` : null} />
        <Stat label="Failed admin logins, 24h" value={failedLogins24h} />
      </div>
      <ViewsChart daily={stats.daily} />
    </>
  );
}

function ViewsChart({ daily }: { daily: { day: string; views: number; visitors: number }[] }) {
  return (
    <div className="admin-card h-72 min-w-0">
      <p className="mb-2 text-sm font-semibold">Daily views and visitors</p>
      <ResponsiveContainer width="100%" height="88%">
        <AreaChart data={daily}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="day" fontSize={11} stroke="var(--muted-foreground)" />
          <YAxis fontSize={11} stroke="var(--muted-foreground)" allowDecimals={false} width={32} />
          <Tooltip />
          <Area dataKey="views" stroke="var(--foreground)" strokeWidth={2} fill="none" />
          <Area dataKey="visitors" stroke="var(--muted-foreground)" strokeWidth={2} strokeDasharray="5 4" fill="none" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function BarList({ title, rows }: { title: string; rows: { label: string; value: number; sub?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="admin-card min-w-0">
      <p className="mb-3 text-sm font-semibold">{title}</p>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No visits yet.</p>}
      <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex justify-between gap-2 text-sm"><span className="min-w-0 truncate">{r.label}</span><span className="shrink-0 tabular-nums">{r.value}{r.sub ? ` · ${r.sub}` : ""}</span></div>
            <div className="admin-bar-track mt-1.5"><div className="admin-bar" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Analytics() {
  const [days, setDays] = useState<number | null>(30);
  const d = days ?? 30;
  const q = useQuery({ queryKey: ["admin", "stats", d], queryFn: () => adminStats({ data: { days: d } }) });
  const s = q.data;
  const t = useQuery({ queryKey: ["admin", "totals"], queryFn: () => adminCommunityTotals() });
  const tt = t.data;
  const GA_ID = useQuery(gaIdQuery).data?.gaId;
  return (
    <>
      <H sub={GA_ID ? `Google Analytics is also collecting (${GA_ID}).` : "Google Analytics turns on once a measurement ID is added."}
        right={<DaysPicker value={days} onChange={setDays} align="end" />}>Analytics</H>
      <p className="admin-stat-label">All-time totals</p>
      <State q={t}>
        {tt && (
          <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <Stat label="Readers" value={tt.readers} glow="var(--glow-pink)" />
            <Stat label="Published stories" value={tt.published} />
            <Stat label="Paused stories" value={tt.paused} />
            <Stat label="Comments" value={tt.comments} />
            <Stat label="Replies" value={tt.replies} />
            <Stat label="Story likes" value={tt.likes} glow="var(--glow-pink)" />
            <Stat label="Saved stories" value={tt.saves} />
            <Stat label="Shares" value={tt.shares} />
            <Stat label="Comment likes" value={tt.commentLikes} />
            <Stat label="Comments + replies" value={tt.comments + tt.replies} />
          </div>
        )}
      </State>
      <p className="admin-stat-label">Visits in the chosen period</p>
      <State q={q}>
        {s && (
          <>
            <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-3"><Stat label="Views" value={s.views} /><Stat label="Visitors" value={s.visitors} /><Stat label="Today" value={s.today} /></div>
            <ViewsChart daily={s.daily} />
            <div className="grid gap-4 lg:grid-cols-2">
              <BarList title="Pages (URL visits)" rows={s.paths.map((p) => ({ label: p.path, value: p.views, sub: `${p.visitors} people` }))} />
              <BarList title="Stories" rows={s.articles.map((a) => ({ label: a.slug, value: a.views, sub: `${a.visitors} people` }))} />
              <BarList title="Where visitors came from" rows={s.referrers.map((r) => ({ label: r.referrer, value: r.views }))} />
              <BarList title="Devices" rows={s.devices.map((x) => ({ label: x.device, value: x.views }))} />
              <BarList title="Hour of day (UTC)" rows={s.hours.map((h) => ({ label: `${String(h.hour).padStart(2, "0")}:00`, value: h.views }))} />
            </div>
          </>
        )}
      </State>
    </>
  );
}

/* ---------- Articles ---------- */

function Articles() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const bulkArticles = useServerFn(adminBulkArticles);
  const setArticleStatus = useServerFn(adminSetArticleStatus);
  const [query, setQuery] = useState("");
  const [days, setDays] = useState<number | null>(null);
  const [section, setSection] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [status, setStatus] = useState<"all" | "draft" | "published" | "paused" | "archived">("all");
  const [featured, setFeatured] = useState<"all" | "featured" | "regular">("all");
  const [editing, setEditing] = useState<string | null>(null);
  const dq = useDebounced(query);
  const f = { q: dq, days, section, source, status, featured };
  const { q, first, rows, total } = usePaged(["admin", "articles", f], (offset) => adminListArticles({ data: { ...f, offset } }));
  const [sections, setSections] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  useEffect(() => { if (first?.sections) setSections(first.sections); }, [first?.sections]);
  useEffect(() => { if (first?.sources) setSources(first.sources); }, [first?.sources]);
  const sel = useSelection(rows.map((a) => a.slug));
  useEffect(() => { sel.clear(); }, [dq, days, section, source, status, featured]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin", "articles"] }); qc.invalidateQueries({ queryKey: ["catalogue"] }); };
  const setOne = useMutation({ mutationFn: (v: { slug: string; status: "published" | "paused" }) => setArticleStatus({ data: v }), onSuccess: () => { toast.success("Updated"); refresh(); }, onError: err });
  const batch = useMutation({
    mutationFn: (v: { slugs: string[]; action: "delete" | "publish" | "pause" | "feature" | "unfeature" }) => bulkArticles({ data: v }),
    onSuccess: (r, v) => { toast.success(`${r.count} ${r.count === 1 ? "story" : "stories"} ${v.action === "delete" ? "deleted" : "updated"}`); sel.clear(); refresh(); },
    onError: (e) => { err(e); refresh(); },
  });
  const busy = batch.isPending || setOne.isPending;

  const toggleOne = async (slug: string, title: string, paused: boolean) => {
    const next = paused ? "published" : "paused";
    if (await confirm({ title: paused ? "Publish this story?" : "Pause this story?", body: <>“{title}” will be {paused ? "visible on the site again" : "hidden from the site"}.</>, confirmLabel: paused ? "Publish" : "Pause", tone: paused ? "default" : "danger" }))
      setOne.mutate({ slug, status: next });
  };
  const bulk = async (action: "delete" | "publish" | "pause" | "feature" | "unfeature", slugs = [...sel.picked], title?: string) => {
    if (!slugs.length || busy) return;
    const label = { delete: "Delete", publish: "Publish", pause: "Pause", feature: "Feature", unfeature: "Unfeature" }[action];
    const subject = title ? `“${title}”` : `${slugs.length} ${slugs.length === 1 ? "story" : "stories"}`;
    if (!(await confirm({ title: `${label} ${subject}?`, tone: action === "delete" || action === "pause" ? "danger" : "default", confirmLabel: action === "delete" ? "Continue" : label,
      ...(action === "delete" ? { body: "The selected articles will be permanently removed from the site. Reader history is retained.", twoStep: { title: "Permanently delete?", body: subject, confirmLabel: "Delete permanently" } } : {}),
    }))) return;
    batch.mutate({ slugs, action });
  };
  if (editing) return <ArticleEditor slug={editing} onClose={() => setEditing(null)} />;
  const chips = [source !== "all" && ["Source: " + source, () => setSource("all")], section !== "all" && ["Section: " + section, () => setSection("all")], status !== "all" && ["Status: " + status, () => setStatus("all")], featured !== "all" && [featured, () => setFeatured("all")]].filter(Boolean) as [string, () => void][];
  return (
    <>
      <H sub={first ? `${rows.length} of ${total} stories shown` : "Edit any story, or pause it to hide it from the site."}>Articles</H>
      <div className="admin-filters">
        <SearchBox value={query} onChange={setQuery} placeholder="Search title, slug, section or source" />
        <DaysPicker value={days} onChange={setDays} allowAll prefix="Published" />
        <SelectMenu prefix="Section" value={section} onChange={setSection} options={opts("All sections", sections)} />
        <SelectMenu prefix="Source" value={source} onChange={setSource} options={opts("All sources", sources)} />
        <SelectMenu prefix="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "Any" }, { value: "draft", label: "Draft" }, { value: "published", label: "Published" }, { value: "paused", label: "Paused" }, { value: "archived", label: "Archived" }]} />
        <SelectMenu prefix="Type" value={featured} onChange={setFeatured} options={[{ value: "all", label: "All" }, { value: "featured", label: "Featured" }, { value: "regular", label: "Regular" }]} />
      </div>
      {chips.length > 0 && <div className="flex flex-wrap gap-2">{chips.map(([l, f]) => <span key={l} className="admin-chip">{l}<button type="button" aria-label={`Remove ${l}`} onClick={f}><X className="h-3 w-3" /></button></span>)}</div>}
      <State q={q} empty={!!first && rows.length === 0 && "No stories match these filters."}>
        <SelectAllRow s={sel} total={rows.length} />
        <div className="space-y-3">
          {rows.map((a) => (
            <div key={a.slug} className="admin-row admin-media-row glass group admin-hover" data-selected={sel.has(a.slug)}>
              {a.img && <img src={a.img} alt="" aria-hidden className="admin-row-spill" />}
              <Check3 state={sel.has(a.slug) ? "on" : "off"} onClick={() => sel.toggle(a.slug)} label={`Select ${a.title}`} />
              <div className="admin-thumb admin-media-thumb">{a.img && <img src={a.img} alt="" loading="lazy" />}</div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 font-semibold leading-snug">{a.title}</p>
                <div className="admin-meta mt-1">
                  <span className="admin-badge" data-tone={a.status === "paused" ? "warn" : "ok"}>{a.status}</span>
                  {a.featured && <span className="admin-badge">featured</span>}
                  <span>{a.section || "—"}</span><span>{fmtDay(a.publishedAt)}</span>
                  {a.source && <span>{a.source}</span>}
                  <span className="tabular-nums">{a.views} views · {a.visitors} people (1y)</span>
                </div>
              </div>
              <div className="admin-row-actions admin-media-actions">
                <button type="button" className="admin-btn" onClick={() => setEditing(a.slug)}>Edit</button>
                <Button variant="ghost" className="admin-btn" disabled={busy} onClick={() => toggleOne(a.slug, a.title, a.status !== "published")}>{a.status === "published" ? "Pause" : "Publish"}</Button>
                <Button variant="ghost" size="icon" className="admin-btn" data-tone="danger" disabled={busy} title="Delete article" aria-label={`Delete ${a.title}`} onClick={() => bulk("delete", [a.slug], a.title)}><Trash2 /></Button>
              </div>
            </div>
          ))}
        </div>
        <MoreSentinel q={q} />
      </State>
      <BulkBar count={sel.picked.length} onClear={sel.clear}>
        <Button variant="ghost" className="admin-btn" disabled={busy} onClick={() => bulk("publish")}>Publish</Button>
        <Button variant="ghost" className="admin-btn" disabled={busy} onClick={() => bulk("pause")}>Pause</Button>
        <Button variant="ghost" className="admin-btn" disabled={busy} onClick={() => bulk("feature")}><Star />Feature</Button>
        <Button variant="ghost" className="admin-btn" disabled={busy} onClick={() => bulk("unfeature")}>Unfeature</Button>
        <Button variant="ghost" className="admin-btn" data-tone="danger" disabled={busy} onClick={() => bulk("delete")}><Trash2 />Delete</Button>
      </BulkBar>
    </>
  );
}

function ArticleEditor({ slug, onClose }: { slug: string; onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const saveArticle = useServerFn(adminSaveArticle);
  const q = useQuery({ queryKey: ["admin", "article", slug], queryFn: () => adminGetArticle({ data: { slug } }) });
  const stats = useQuery({ queryKey: ["admin", "stats", 30, slug], queryFn: () => adminStats({ data: { days: 30, slug } }) });
  const [f, setF] = useState<NonNullable<typeof q.data> | null>(null);
  const a = f ?? q.data ?? null;
  const save = useMutation({
    mutationFn: () => { if (!a) throw new Error("Story not found"); const { status: _s, ...rest } = a; return saveArticle({ data: rest }); },
    onSuccess: () => { toast.success("Story saved"); qc.invalidateQueries({ queryKey: ["admin", "articles"] }); onClose(); }, onError: err,
  });
  const back = async () => { if (!f || await confirm({ title: "Leave without saving?", body: "Your changes to this story will be lost.", confirmLabel: "Discard changes", tone: "danger" })) onClose(); };
  if (!a) return <><button type="button" className="admin-btn" onClick={onClose}>← Back</button><State q={q} empty={q.data === null && "Story not found."} /></>;
  const set = <K extends keyof typeof a>(k: K, v: (typeof a)[K]) => setF({ ...a, [k]: v });
  const field = (label: string, el: ReactNode) => <label className="block min-w-0"><span className="admin-field-label">{label}</span>{el}</label>;
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="admin-btn" onClick={back}>← Back</button>
        <a className="admin-btn" href={`/article/${slug}`} target="_blank" rel="noreferrer">View on site</a>
      </div>
      <H sub={`${stats.data?.views ?? 0} views · ${stats.data?.visitors ?? 0} people in the last 30 days`}>Edit story</H>
      <div className="admin-card space-y-4">
        {a.img && <div className="admin-thumb aspect-[21/9] w-full"><img src={a.img} alt={a.imageAlt} /></div>}
        {field("Title", <input className="admin-input" value={a.title} onChange={(e) => set("title", e.target.value)} />)}
        {field("Subtitle", <input className="admin-input" value={a.subtitle} onChange={(e) => set("subtitle", e.target.value)} />)}
        {field("Excerpt", <textarea className="admin-input" rows={2} value={a.excerpt} onChange={(e) => set("excerpt", e.target.value)} />)}
        <div className="grid gap-4 sm:grid-cols-2">
          {field("Section", <input className="admin-input" value={a.section} onChange={(e) => set("section", e.target.value)} />)}
          {field("Tag", <input className="admin-input" value={a.tag} onChange={(e) => set("tag", e.target.value)} />)}
          {field("Image address", <input className="admin-input" value={a.img} onChange={(e) => set("img", e.target.value)} />)}
          {field("Image description", <input className="admin-input" value={a.imageAlt} onChange={(e) => set("imageAlt", e.target.value)} />)}
          {field("Headline priority (0–100)", <input className="admin-input" type="number" min={0} max={100} value={a.headlineWeight} onChange={(e) => set("headlineWeight", Number(e.target.value))} />)}
          <label className="flex items-center gap-3 self-end pb-2 text-sm font-semibold"><Switch checked={a.featured} onCheckedChange={(v) => set("featured", v)} /> Featured</label>
        </div>
        {field("Key points (one per line)", <textarea className="admin-input" rows={4} value={a.summary.join("\n")} onChange={(e) => set("summary", e.target.value.split("\n"))} />)}
        {field("Story text (blank line between paragraphs)", <textarea className="admin-input" rows={16} value={a.body.join("\n\n")} onChange={(e) => set("body", e.target.value.split(/\n{2,}/))} />)}
        <button type="button" className="admin-btn" data-tone="primary" disabled={save.isPending}
          onClick={async () => { if (await confirm({ title: "Save changes to this story?", body: "The new version goes live on the site straight away.", confirmLabel: "Save story" })) save.mutate(); }}>
          {save.isPending ? <><Loader size="xs" /> Saving</> : "Save story"}
        </button>
      </div>
    </>
  );
}

/* ---------- Comments ---------- */

function Comments() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [days, setDays] = useState<number | null>(null);
  const [kind, setKind] = useState<"all" | "comment" | "reply">("all");
  const [story, setStory] = useState<string>("all");
  const dq = useDebounced(query);
  const f = { q: dq, days, kind, story };
  const { q, first, rows, total } = usePaged(["admin", "comments", f], (offset) => adminListComments({ data: { ...f, offset } }));
  const [stories, setStories] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => { if (first?.stories) setStories(first.stories); }, [first?.stories]);
  const sel = useSelection(rows.map((c) => c.id));
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "comments"] });
  const rm = useMutation({ mutationFn: (id: string) => adminRemoveComment({ data: { id } }), onSuccess: () => { toast.success("Comment removed"); refresh(); }, onError: err });
  const removeOne = async (id: string) => { if (await confirm({ title: "Remove this comment?", body: "It disappears from the discussion for everyone.", confirmLabel: "Remove", tone: "danger" })) rm.mutate(id); };
  const removeMany = async () => {
    const n = sel.picked.length;
    if (!(await confirm({ title: `Remove ${n} comment${n === 1 ? "" : "s"}?`, tone: "danger", confirmLabel: "Continue", twoStep: { title: "This can’t be undone", body: `${n} comment${n === 1 ? "" : "s"} will be removed for everyone.`, confirmLabel: "Remove all" } }))) return;
    await runAll(sel.picked, (id) => adminRemoveComment({ data: { id } }));
    sel.clear(); refresh();
  };
  return (
    <>
      <H sub={first ? `${rows.length} of ${total} comments and replies shown` : undefined}>Comments</H>
      <div className="admin-filters">
        <SearchBox value={query} onChange={setQuery} placeholder="Search reader or story" />
        <DaysPicker value={days} onChange={setDays} allowAll prefix="Posted" />
        <SelectMenu prefix="Type" value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, { value: "comment", label: "Comments" }, { value: "reply", label: "Replies" }]} />
        <SelectMenu prefix="Story" value={story} onChange={setStory} options={[{ value: "all", label: "All stories" }, ...stories]} />
      </div>
      <State q={q} empty={!!first && rows.length === 0 && "No comments match these filters."}>
        <SelectAllRow s={sel} total={rows.length} />
        <div className="space-y-3">
          {rows.map((c) => (
            <div key={c.id} className="admin-row admin-media-row glass group admin-hover" data-selected={sel.has(c.id)}>
              {c.img && <img src={c.img} alt="" aria-hidden className="admin-row-spill" />}
              <Check3 state={sel.has(c.id) ? "on" : "off"} onClick={() => sel.toggle(c.id)} label="Select comment" />
              <div className="admin-thumb admin-media-thumb">{c.img && <img src={c.img} alt="" loading="lazy" />}</div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-1 text-xs font-semibold text-muted-foreground">On “{c.articleTitle}”</p>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words font-semibold leading-snug">{c.text}</p>
                <div className="admin-meta mt-1"><span className="font-semibold text-foreground">{c.author}</span>{c.isReply && <span className="admin-badge">reply</span>}<span>{fmt(c.createdAt)}</span></div>
              </div>
              <div className="admin-row-actions admin-media-actions">
                <button type="button" className="admin-btn" data-tone="danger" onClick={() => removeOne(c.id)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
        <MoreSentinel q={q} />
      </State>
      <BulkBar count={sel.picked.length} onClear={sel.clear}><button type="button" className="admin-btn" data-tone="danger" onClick={removeMany}>Remove</button></BulkBar>
    </>
  );
}

/* ---------- Readers (Midnight users) ---------- */

const ACCOUNT_LABEL = { active: "Active", blocked: "Blocked", not_moved: "Not moved yet" } as const;

type SortKey = "newest" | "oldest" | "active" | "comments" | "replies" | "likes" | "saves" | "likesReceived";
const SORTS: Option<SortKey>[] = [
  { value: "newest", label: "Newest" }, { value: "oldest", label: "Oldest" }, { value: "active", label: "Recently signed in" },
  { value: "comments", label: "Most comments" }, { value: "replies", label: "Most replies" }, { value: "likes", label: "Most likes given" },
  { value: "saves", label: "Most saved stories" }, { value: "likesReceived", label: "Most likes received" },
];

function Readers() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [days, setDays] = useState<number | null>(null);
  const [account, setAccount] = useState<"all" | keyof typeof ACCOUNT_LABEL>("all");
  const [activity, setActivity] = useState<"all" | "commented" | "silent">("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const dq = useDebounced(query);
  const f = { q: dq, days, account, activity, sort };
  const { q, first, rows } = usePaged(["admin", "members", f], (offset) => adminListReaders({ data: { ...f, offset, fresh: offset === 0 } }));
  const sel = useSelection(rows.filter((u) => u.account !== "not_moved").map((u) => u.id));
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "members"] });
  const done = { onSuccess: () => { toast.success("Updated"); refresh(); }, onError: err };
  const block = useMutation({ mutationFn: (v: { id: string; blocked: boolean }) => adminSetMemberBlocked({ data: v }), ...done });
  const del = useMutation({ mutationFn: (id: string) => adminDeleteMember({ data: { id } }), ...done });

  const blockOne = async (id: string, name: string, blocked: boolean) => {
    if (await confirm({ title: blocked ? `Block ${name}?` : `Unblock ${name}?`, body: blocked ? "They won’t be able to sign in or comment." : "They can sign in and comment again.", confirmLabel: blocked ? "Block" : "Unblock", tone: blocked ? "danger" : "default" }))
      block.mutate({ id, blocked });
  };
  const deleteOne = async (id: string, name: string) => {
    if (await confirm({ title: `Delete ${name}?`, tone: "danger", confirmLabel: "Continue", twoStep: { title: "Delete this reader for good?", body: "Their account is removed permanently. This can’t be undone.", confirmLabel: "Delete reader" } }))
      del.mutate(id);
  };
  const bulkBlock = async (blocked: boolean) => {
    const n = sel.picked.length;
    if (!(await confirm({ title: `${blocked ? "Block" : "Unblock"} ${n} reader${n === 1 ? "" : "s"}?`, tone: blocked ? "danger" : "default", confirmLabel: blocked ? "Block all" : "Unblock all" }))) return;
    await runAll(sel.picked, (id) => adminSetMemberBlocked({ data: { id, blocked } })); sel.clear(); refresh();
  };
  const bulkDelete = async () => {
    const n = sel.picked.length;
    if (!(await confirm({ title: `Delete ${n} reader${n === 1 ? "" : "s"}?`, tone: "danger", confirmLabel: "Continue", twoStep: { title: "Delete them for good?", body: `${n} account${n === 1 ? " is" : "s are"} removed permanently. This can’t be undone.`, confirmLabel: "Delete all" } }))) return;
    await runAll(sel.picked, (id) => adminDeleteMember({ data: { id } })); sel.clear(); refresh();
  };
  const notMoved = first?.notMoved ?? 0;
  return (
    <>
      <H sub={first ? `${rows.length} of ${first.total} matching · ${first.everyone} Midnight readers${notMoved ? ` · ${notMoved} haven’t moved their sign-in over yet` : ""}` : "Everyone with a Midnight reader account."}>Readers</H>
      <div className="admin-filters">
        <SearchBox value={query} onChange={setQuery} placeholder="Search name or email" />
        <DaysPicker value={days} onChange={setDays} allowAll prefix="Joined" />
        <SelectMenu prefix="Account" value={account} onChange={setAccount} options={[{ value: "all", label: "Any" }, { value: "active", label: "Active" }, { value: "blocked", label: "Blocked" }, { value: "not_moved", label: "Not moved yet" }]} />
        <SelectMenu prefix="Activity" value={activity} onChange={setActivity} options={[{ value: "all", label: "All" }, { value: "commented", label: "Has commented" }, { value: "silent", label: "No comments" }]} />
        <SelectMenu prefix="Sort" value={sort} onChange={setSort} options={SORTS} />
      </div>
      <State q={q} empty={!!first && rows.length === 0 && (first.everyone ? "No readers match these filters." : "No readers yet.")}>
        <SelectAllRow s={sel} total={sel.picked.length + rows.filter((u) => u.account !== "not_moved" && !sel.has(u.id)).length} />
        <div className="space-y-3">
          {rows.map((u) => (
            <div key={u.id} className="admin-row glass admin-hover grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 sm:flex" data-selected={sel.has(u.id)}>
              {u.account !== "not_moved" ? <Check3 state={sel.has(u.id) ? "on" : "off"} onClick={() => sel.toggle(u.id)} label={`Select ${u.username}`} /> : <span className="w-[1.3rem]" />}
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="avatar-orb h-10 w-10 shrink-0 text-sm" style={{ background: "var(--primary)" }}>{u.username.slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{u.username}</p>
                  <div className="admin-meta"><span className="min-w-0 truncate">{u.email || "No email on file"}</span><span>joined {fmtDay(u.joinedAt)}</span></div>
                  <div className="admin-meta tabular-nums"><span>{u.comments} comments</span><span>{u.replies} replies</span><span>{u.likes} likes</span><span>{u.saves} saved</span><span>{u.likesReceived} likes received</span></div>
                </div>
              </div>
              <div className="admin-row-actions col-span-2 items-center sm:justify-end">
                <span className="admin-badge" data-tone={u.account === "active" ? "ok" : u.account === "blocked" ? "bad" : "warn"}>{ACCOUNT_LABEL[u.account]}</span>
                {u.account !== "not_moved" && <>
                  <button type="button" className="admin-btn" onClick={() => blockOne(u.id, u.username, u.account !== "blocked")}>{u.account === "blocked" ? "Unblock" : "Block"}</button>
                  <button type="button" className="admin-btn" data-tone="danger" onClick={() => deleteOne(u.id, u.username)}>Delete</button>
                </>}
              </div>
            </div>
          ))}
        </div>
        <MoreSentinel q={q} />
      </State>
      <BulkBar count={sel.picked.length} onClear={sel.clear}>
        <button type="button" className="admin-btn" onClick={() => bulkBlock(false)}>Unblock</button>
        <button type="button" className="admin-btn" onClick={() => bulkBlock(true)}>Block</button>
        <button type="button" className="admin-btn" data-tone="danger" onClick={bulkDelete}>Delete</button>
      </BulkBar>
    </>
  );
}

/* ---------- Site & security ---------- */

function SiteSecurity() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ["admin", "security"], queryFn: () => adminSecurity() });
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "security"] });
  const upd = useMutation({ mutationFn: (s: { maintenance_mode: boolean; maintenance_message: string; signups_enabled: boolean; comments_enabled: boolean }) => adminUpdateSettings({ data: s }), onSuccess: () => { toast.success("Saved"); setMsg(null); refresh(); }, onError: err });
  const revoke = useMutation({ mutationFn: (id: string | null) => adminRevokeSession({ data: { id } }), onSuccess: () => { toast.success("Signed out"); refresh(); }, onError: err });
  if (!q.data) return <><H>Site & security</H><State q={q} /></>;
  const s = q.data.settings;

  const flip = async (k: "maintenance_mode" | "signups_enabled" | "comments_enabled", label: string) => {
    const on = !s[k];
    const serious = k === "maintenance_mode" && on;
    const ok = await confirm(serious
      ? { title: "Pause the whole site?", tone: "danger", confirmLabel: "Continue", twoStep: { title: "Visitors will only see the pause message", body: "Every page except this dashboard is hidden until you switch this off.", confirmLabel: "Pause site" } }
      : { title: `${on ? "Turn on" : "Turn off"}: ${label}?`, confirmLabel: on ? "Turn on" : "Turn off", tone: on ? "default" : "danger" });
    if (ok) upd.mutate({ ...s, [k]: on });
  };
  const setting = (k: "maintenance_mode" | "signups_enabled" | "comments_enabled", label: string, hint: string) => (
    <div className="admin-setting">
      <div className="min-w-0"><p className="font-semibold">{label}</p><p className="text-xs text-muted-foreground">{hint}</p></div>
      <Switch checked={s[k]} aria-label={label} onCheckedChange={() => flip(k, label)} />
    </div>
  );
  return (
    <>
      <H>Site & security</H>
      <div className="admin-card">
        {setting("maintenance_mode", "Pause the whole site", "Visitors see the message below instead of the site. This dashboard keeps working.")}
        {setting("signups_enabled", "Allow new reader sign-ups", "When off, nobody can create a new account.")}
        {setting("comments_enabled", "Allow comments", "When off, nobody can post new comments or replies.")}
        <div className="space-y-2 border-t border-border/60 pt-4">
          <label className="admin-field-label" htmlFor="pause-msg">Pause message</label>
          <textarea id="pause-msg" className="admin-input" rows={2} value={msg ?? s.maintenance_message} onChange={(e) => setMsg(e.target.value)} />
          <button type="button" className="admin-btn" data-tone="primary" disabled={msg == null || upd.isPending}
            onClick={async () => { if (await confirm({ title: "Save the new pause message?", confirmLabel: "Save" })) upd.mutate({ ...s, maintenance_message: msg ?? s.maintenance_message }); }}>Save message</button>
        </div>
      </div>
      <div className="admin-card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">Signed-in admin devices</p>
          <button type="button" className="admin-btn" data-tone="danger" onClick={async () => { if (await confirm({ title: "Sign out every other device?", body: "Everyone else, including other team members, must sign in again.", tone: "danger", confirmLabel: "Sign them out" })) revoke.mutate(null); }}>Sign out all other devices</button></div>
        {q.data.sessions.map((x) => (
          <div key={x.id} className="admin-row glass flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1"><p className="font-semibold">{x.username}</p><p className="truncate text-xs text-muted-foreground">{x.device || "Unknown device"}</p>
              <div className="admin-meta"><span>Last active {fmt(x.lastSeen)}</span><span>Expires {fmt(x.expires)}</span></div></div>
            {x.id === q.data.currentSessionId ? <span className="admin-badge" data-tone="ok">This device</span>
              : <button type="button" className="admin-btn" onClick={async () => { if (await confirm({ title: `Sign out ${x.username} on this device?`, confirmLabel: "Sign out", tone: "danger" })) revoke.mutate(x.id); }}>Sign out</button>}
          </div>
        ))}
      </div>
    </>
  );
}

function AdminActivity({ title }: { title: string }) {
  const [query, setQuery] = useState("");
  const [days, setDays] = useState<number | null>(7);
  const [who, setWho] = useState<string>("all");
  const [action, setAction] = useState<string>("all");
  const dq = useDebounced(query);
  const f = { q: dq, days, who, action };
  const { q, first, rows, total } = usePaged(["admin", "activity", "team", f], (offset) => adminActivityLog({ data: { ...f, offset } }));
  const [people, setPeople] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  useEffect(() => { if (first?.people) setPeople(first.people); if (first?.actions) setActions(first.actions); }, [first]);
  return (
    <div className="admin-card space-y-3">
      <p className="font-semibold">{title}{first ? <span className="ml-2 text-sm font-normal text-muted-foreground">{total} entries</span> : null}</p>
      <div className="admin-filters">
        <SearchBox value={query} onChange={setQuery} placeholder="Search person or action" />
        <DaysPicker value={days} onChange={setDays} allowAll />
        <SelectMenu prefix="Who" value={who} onChange={setWho} options={opts("Everyone", people)} />
        <SelectMenu prefix="Action" value={action} onChange={setAction} options={[{ value: "all", label: "All" }, ...actions.map((a) => ({ value: a, label: a.replace(/_/g, " ") }))]} />
      </div>
      <State q={q} empty={!!first && rows.length === 0 && "No activity matches these filters."}>
        <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
          {rows.map((l) => (
            <div key={l.id} className="admin-row glass flex flex-col gap-1">
              <div className="admin-meta"><span className="admin-badge" data-tone={l.action === "login_failed" ? "bad" : undefined}>{l.action.replace(/_/g, " ")}</span><span className="font-semibold text-foreground">{l.username ?? "—"}</span><span>{fmt(l.at)}</span><span className="font-mono">{l.network}</span></div>
              {l.detail !== "{}" && <p className="break-all text-xs text-muted-foreground">{l.detail}</p>}
            </div>
          ))}
          <MoreSentinel q={q} />
        </div>
      </State>
    </div>
  );
}

const READER_KIND = { comment: "commented", reply: "replied", story_like: "liked a story", save: "saved a story", comment_like: "liked a comment" } as const;
function ReaderActivity() {
  const [query, setQuery] = useState("");
  const [days, setDays] = useState<number | null>(7);
  const [kind, setKind] = useState<"all" | keyof typeof READER_KIND>("all");
  const dq = useDebounced(query);
  const f = { q: dq, days, kind };
  const { q, first, rows, total } = usePaged(["admin", "activity", "readers", f], (offset) => adminReaderActivity({ data: { ...f, offset } }));
  return (
    <div className="admin-card space-y-3">
      <p className="font-semibold">Reader activity{first ? <span className="ml-2 text-sm font-normal text-muted-foreground">{total} actions</span> : null}</p>
      <div className="admin-filters">
        <SearchBox value={query} onChange={setQuery} placeholder="Search reader or story" />
        <DaysPicker value={days} onChange={setDays} allowAll />
        <SelectMenu prefix="Type" value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, ...(Object.keys(READER_KIND) as (keyof typeof READER_KIND)[]).map((k) => ({ value: k, label: READER_KIND[k] }))]} />
      </div>
      <State q={q} empty={!!first && rows.length === 0 && "No reader activity matches these filters."}>
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="admin-row glass flex items-center gap-3">
              <div className="admin-thumb h-10 w-10 shrink-0">{r.img && <img src={r.img} alt="" loading="lazy" />}</div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-1 text-sm"><span className="font-semibold">{r.reader}</span> {READER_KIND[r.kind]}{r.articleTitle ? <> on “{r.articleTitle}”</> : null}</p>
                <div className="admin-meta"><span>{fmt(r.at)}</span></div>
              </div>
            </div>
          ))}
          <MoreSentinel q={q} />
        </div>
      </State>
    </div>
  );
}

function Activity() {
  const [view, setView] = useState<"admin" | "readers">("admin");
  return (
    <>
      <H sub="What your team changed, and what readers are doing.">Activity</H>
      <div className="admin-filters">
        <SelectMenu prefix="Show" value={view} onChange={setView} options={[{ value: "admin", label: "Admin activity" }, { value: "readers", label: "Reader activity" }]} />
      </div>
      {view === "admin" ? <AdminActivity title="Admin activity" /> : <ReaderActivity />}
    </>
  );
}

/* ---------- Team ---------- */

function Team({ meId }: { meId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ["admin", "team"], queryFn: () => adminListTeam() });
  const [n, setN] = useState({ username: "", email: "", password: "" });
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | "admin" | "editor">("all");
  const [status, setStatus] = useState<"all" | "active" | "disabled">("all");
  const [days, setDays] = useState<number | null>(null);
  const [pwFor, setPwFor] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "team"] });
  const add = useMutation({ mutationFn: () => adminCreateEditor({ data: n }), onSuccess: () => { toast.success("Editor added"); setN({ username: "", email: "", password: "" }); setAdding(false); refresh(); }, onError: err });
  const upd = useMutation({ mutationFn: (v: { id: string; disabled?: boolean; remove?: boolean; password?: string }) => adminUpdateTeamMember({ data: v }), onSuccess: () => { toast.success("Updated"); refresh(); }, onError: err });
  const all = q.data ?? [];
  const others = all.filter((t) => t.id !== meId);
  const rows = others.filter((t) => matchesQuery([t.username, t.email], query) && (role === "all" || t.role === role) && (status === "all" || (status === "disabled") === t.disabled) && withinDays(t.last_login_at, days));
  const manageable = rows.filter((t) => t.role !== "admin");
  const sel = useSelection(manageable.map((t) => t.id));
  const bulk = async (kind: "disable" | "enable" | "remove") => {
    const k = sel.picked.length; const pl = k === 1 ? "" : "s";
    const ok = await confirm(kind === "remove"
      ? { title: `Remove ${k} team member${pl}?`, tone: "danger", confirmLabel: "Continue", twoStep: { title: "Remove them for good?", body: "They lose admin access immediately. This can’t be undone.", confirmLabel: "Remove" } }
      : { title: `${kind === "disable" ? "Disable" : "Enable"} ${k} team member${pl}?`, tone: kind === "disable" ? "danger" : "default", confirmLabel: kind === "disable" ? "Disable" : "Enable" });
    if (!ok) return;
    await runAll(sel.picked, (id) => adminUpdateTeamMember({ data: kind === "remove" ? { id, remove: true } : { id, disabled: kind === "disable" } }));
    sel.clear(); refresh();
  };
  return (
    <>
      <H sub="Editors can manage stories and comments and see analytics. Only admins change site settings, readers and the team."
        right={<button type="button" className="admin-btn" data-tone="primary" onClick={() => setAdding(!adding)}>{adding ? "Close" : "Add team member"}</button>}>Team</H>
      {adding && (
        <form className="admin-card admin-enter grid gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))_auto]" onSubmit={async (e) => { e.preventDefault(); if (await confirm({ title: `Add ${n.username || "this person"} as an editor?`, body: "They can sign in to this dashboard straight away.", confirmLabel: "Add editor" })) add.mutate(); }}>
          <input className="admin-input" placeholder="Username" value={n.username} onChange={(e) => setN({ ...n, username: e.target.value })} />
          <input className="admin-input" placeholder="Email" type="email" value={n.email} onChange={(e) => setN({ ...n, email: e.target.value })} />
          <input className="admin-input" type="password" placeholder="Password (8+ characters)" value={n.password} onChange={(e) => setN({ ...n, password: e.target.value })} />
          <button className="admin-btn min-h-11" data-tone="primary" disabled={add.isPending}>Add editor</button>
        </form>
      )}
      {others.length > 0 && (
        <div className="admin-filters">
          <SearchBox value={query} onChange={setQuery} placeholder="Search name or email" />
          <SelectMenu prefix="Role" value={role} onChange={setRole} options={[{ value: "all", label: "Any" }, { value: "admin", label: "Admin" }, { value: "editor", label: "Editor" }]} />
          <SelectMenu prefix="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "Any" }, { value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }]} />
          <DaysPicker value={days} onChange={setDays} allowAll prefix="Signed in" />
        </div>
      )}
      <State q={q} empty={q.data && (others.length === 0
        ? <><UsersRound className="h-8 w-8" /><p className="font-semibold text-foreground">No team members yet.</p><p>Add new ones with “Add team member”.</p></>
        : rows.length === 0 && "No team members match these filters.")}>
        <SelectAllRow s={sel} total={manageable.length} />
        <div className="space-y-3">
          {rows.map((t) => (
            <div key={t.id} className="admin-row glass admin-hover space-y-3" data-selected={sel.has(t.id)}>
              <div className="flex flex-wrap items-center gap-3">
                {t.role !== "admin" ? <Check3 state={sel.has(t.id) ? "on" : "off"} onClick={() => sel.toggle(t.id)} label={`Select ${t.username}`} /> : <span className="w-[1.3rem]" />}
                <span className="avatar-orb h-10 w-10 shrink-0 text-sm" style={{ background: "var(--primary)" }}>{t.username.slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{t.username}</p>
                  <div className="admin-meta"><span className="min-w-0 truncate">{t.email}</span><span>{t.role}</span><span>last sign-in {fmt(t.last_login_at)}</span></div>
                </div>
                <span className="admin-badge" data-tone={t.disabled ? "bad" : "ok"}>{t.disabled ? "Disabled" : "Active"}</span>
                {t.role !== "admin" && (
                  <div className="admin-row-actions w-full sm:w-auto">
                    <button type="button" className="admin-btn" onClick={async () => { if (await confirm({ title: `${t.disabled ? "Enable" : "Disable"} ${t.username}?`, tone: t.disabled ? "default" : "danger", confirmLabel: t.disabled ? "Enable" : "Disable" })) upd.mutate({ id: t.id, disabled: !t.disabled }); }}>{t.disabled ? "Enable" : "Disable"}</button>
                    <button type="button" className="admin-btn" onClick={() => { setPwFor(pwFor === t.id ? null : t.id); setNewPw(""); }}>Reset password</button>
                    <button type="button" className="admin-btn" data-tone="danger" onClick={async () => { if (await confirm({ title: `Remove ${t.username}?`, tone: "danger", confirmLabel: "Continue", twoStep: { title: "Remove for good?", body: "They lose admin access immediately. This can’t be undone.", confirmLabel: "Remove" } })) upd.mutate({ id: t.id, remove: true }); }}>Remove</button>
                  </div>
                )}
              </div>
              {pwFor === t.id && (
                <form className="flex flex-col gap-2 sm:flex-row" onSubmit={async (e) => { e.preventDefault(); if (newPw.length < 8) { toast.error("Use at least 8 characters"); return; } if (await confirm({ title: `Set a new password for ${t.username}?`, confirmLabel: "Set password" })) { upd.mutate({ id: t.id, password: newPw }); setPwFor(null); } }}>
                  <input className="admin-input" type="password" autoFocus placeholder="New password (8+ characters)" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
                  <button className="admin-btn min-h-11" data-tone="primary">Save password</button>
                </form>
              )}
            </div>
          ))}
        </div>
      </State>
      <BulkBar count={sel.picked.length} onClear={sel.clear}>
        <button type="button" className="admin-btn" onClick={() => bulk("enable")}>Enable</button>
        <button type="button" className="admin-btn" onClick={() => bulk("disable")}>Disable</button>
        <button type="button" className="admin-btn" data-tone="danger" onClick={() => bulk("remove")}>Remove</button>
      </BulkBar>
      <AdminActivity title="Admin activity" />
    </>
  );
}

/* ---------- My account ---------- */

function Account({ me }: { me: Me }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [f, setF] = useState({ username: me.username, email: me.email, currentPassword: "", newPassword: "" });
  const m = useMutation({
    mutationFn: () => adminUpdateMyAccount({ data: { ...f, newPassword: f.newPassword || undefined } }),
    onSuccess: (r) => { if (!r.ok) { toast.error(r.error); return; } toast.success("Saved"); setF({ ...f, currentPassword: "", newPassword: "" }); qc.invalidateQueries({ queryKey: ["admin", "me"] }); },
    onError: err,
  });
  return (
    <>
      <H sub="Change your username, email or password at any time.">My account</H>
      <form className="admin-card max-w-xl space-y-4" onSubmit={async (e) => { e.preventDefault(); if (await confirm({ title: "Save changes to your account?", body: f.newPassword ? "You’ll use the new password next time you sign in." : undefined, confirmLabel: "Save" })) m.mutate(); }}>
        <label className="block"><span className="admin-field-label">Username</span><input className="admin-input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></label>
        <label className="block"><span className="admin-field-label">Email</span><input className="admin-input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="block"><span className="admin-field-label">New password</span><input className="admin-input" type="password" placeholder="Leave empty to keep" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></label>
        <label className="block"><span className="admin-field-label">Current password (required)</span><input className="admin-input" type="password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></label>
        <button className="admin-btn" data-tone="primary" disabled={m.isPending}>{m.isPending ? <><Loader size="xs" /> Saving</> : "Save changes"}</button>
      </form>
    </>
  );
}
