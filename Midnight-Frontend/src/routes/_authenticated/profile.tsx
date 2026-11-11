import { absUrl } from "@/lib/site";
import { Loader } from "@/components/loader";
import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Bookmark, Heart, LogOut, MessageSquare, Reply, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { changePassword } from "@/lib/signup.functions";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { PasswordField } from "@/components/password-field";
import { UserAvatar } from "@/components/account-button";
import { Spill } from "@/components/cards";
import { useAuth } from "@/hooks/use-auth";
import { getArticle } from "@/data/news";
import { deleteMyAccount, getMyLibrary, getMyProfile, updateMyProfile } from "@/lib/community.functions";
import { LIMITS, bioSchema, displayNameSchema, passwordError, usernameSchema, type FormErrors, fieldError } from "@/lib/community-rules";

const profileQuery = queryOptions({ queryKey: ["me", "profile"], queryFn: () => getMyProfile() });
const libraryQuery = queryOptions({ queryKey: ["me", "library"], queryFn: () => getMyLibrary() });

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { property: "og:url", content: absUrl("/profile") },
      { title: "Your profile — Midnight" },
      { name: "description", content: "Your Midnight profile, saved stories, likes and comments." },
      { property: "og:title", content: "Your profile — Midnight" },
      { property: "og:description", content: "Your Midnight profile, saved stories, likes and comments." },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "canonical", href: absUrl("/profile") }],
  }),
  component: ProfilePage,
});

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function ProfilePage() {
  const { user, signOut } = useAuth();
  const profile = useQuery(profileQuery);
  const library = useQuery(libraryQuery);
  const [tab, setTab] = useState<"saved" | "liked" | "comments" | "settings">("saved");

  if (profile.isError) return <main className="mx-auto max-w-3xl flex-1 px-4 pt-36 pb-24 text-center"><h1 className="font-serif text-4xl">We couldn't load your profile</h1><p className="mt-3 text-muted-foreground">Please try again in a moment.</p><Button className="mt-6 rounded-full" onClick={() => profile.refetch()}>Try again</Button></main>;
  if (!profile.data) return <main className="grid flex-1 place-items-center pt-36 pb-24"><Loader size="lg" label="Loading" /></main>;
  const p = profile.data;
  const name = p.displayName || p.username;
  const stats = [
    { icon: Bookmark, label: "Saved", value: p.stats.saved },
    { icon: Heart, label: "Liked", value: p.stats.liked },
    { icon: MessageSquare, label: "Comments", value: p.stats.comments },
    { icon: Reply, label: "Replies received", value: p.stats.replies },
    { icon: Sparkles, label: "Likes on comments", value: p.stats.likesReceived },
  ];

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-28 pb-24">
      <section className="profile-hero relative overflow-hidden rounded-[2.25rem] p-6 shadow-float md:p-10">
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center">
          <UserAvatar name={name} hue={p.hue} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-serif text-4xl md:text-5xl">{name}</h1>
            <p className="mt-1 font-semibold opacity-80">@{p.username} · Member since {fmtDate(p.memberSince)}</p>
            {p.bio && <p className="mt-3 max-w-xl opacity-90">{p.bio}</p>}
          </div>
          <Button variant="secondary" className="rounded-full" onClick={() => setTab("settings")}>Edit profile</Button>
        </div>
        <dl className="relative mt-8 grid grid-cols-2 gap-3 sm:grid-cols-5 [&>div:last-child]:col-span-2 sm:[&>div:last-child]:col-span-1">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl bg-background/15 p-4 backdrop-blur-md">
              <s.icon className="h-4 w-4 opacity-80" />
              <dd className="mt-2 text-3xl font-extrabold">{s.value}</dd>
              <dt className="text-xs font-semibold opacity-80">{s.label}</dt>
            </div>
          ))}
        </dl>
      </section>

      <div role="tablist" aria-label="Profile sections" className="glass mx-auto mt-8 grid w-full max-w-md grid-cols-4 gap-1 rounded-full p-1.5 sm:flex sm:w-fit sm:max-w-none">
        {([["saved", "Saved"], ["liked", "Liked"], ["comments", "Comments"], ["settings", "Settings"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-full px-1 py-2.5 text-[13px] font-bold whitespace-nowrap transition sm:px-5 sm:text-sm ${tab === k ? "bg-primary text-primary-foreground shadow-float" : "nav-hover text-muted-foreground"}`}>{l}</button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "settings" ? <Settings profile={p} email={user?.email ?? ""} onSignOut={signOut} /> :
          !library.data ? <div className="grid place-items-center py-16"><Loader label="Loading" /></div> :
          tab === "comments" ? <CommentList items={library.data.comments} /> :
          <StoryList kind={tab} items={tab === "saved" ? library.data.saved : library.data.liked} empty={tab === "saved" ? "Stories you save will appear here." : "Stories you like will appear here."} />}
      </div>
    </main>
  );
}

/** One card design for saved, liked and comment entries: photo on the left with a colour spill. */
function LibraryCard({ slug, hash, eyebrow, title, body }: { slug: string; hash?: string; eyebrow: string; title: string; body?: string }) {
  const a = getArticle(slug);
  return (
    <Link to="/article/$slug" params={{ slug }} {...(hash ? { hash } : {})} className="glass-card group relative flex items-start gap-3 overflow-hidden rounded-2xl p-2.5 sm:gap-4 sm:p-3">
      {a && <Spill img={a.img} />}
      {a && (
        <div className="relative h-20 w-24 shrink-0 self-stretch overflow-hidden rounded-xl shadow-float sm:w-32">
          <img src={a.img} alt="" loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-110" />
        </div>
      )}
      <div className="relative min-w-0 flex-1 py-1">
        <p className="truncate text-[11px] font-bold tracking-wider text-muted-foreground uppercase">{eyebrow}</p>
        <p className="mt-0.5 line-clamp-2 font-bold sm:truncate">{title}</p>
        {body && <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-sm text-muted-foreground sm:line-clamp-3">{body}</p>}
      </div>
      <ArrowUpRight className="relative mt-2 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:rotate-45 group-hover:text-foreground" />
    </Link>
  );
}

function StoryList({ kind, items, empty }: { kind: "saved" | "liked"; items: { slug: string; at: string }[]; empty: string }) {
  const stories = items.map((i) => ({ ...i, a: getArticle(i.slug) })).filter((x) => x.a);
  if (!stories.length) return <EmptyState text={empty} />;
  return (
    <ul className="grid gap-3">
      {stories.map(({ slug, at, a }) => (
        <li key={slug}>
          <LibraryCard slug={slug} eyebrow={`${a!.tag} · ${kind === "saved" ? "Saved" : "Liked"} ${fmtDate(at)}`} title={a!.title} body={a!.excerpt} />
        </li>
      ))}
    </ul>
  );
}

function CommentList({ items }: { items: { id: string; slug: string; text: string; at: string; isReply: boolean }[] }) {
  if (!items.length) return <EmptyState text="Your comments will appear here once you join a discussion." />;
  return (
    <ul className="grid gap-3">
      {items.map((c) => (
        <li key={c.id}>
          <LibraryCard slug={c.slug} hash="discussion" eyebrow={`${c.isReply ? "Replied on" : "Commented on"} · ${fmtDate(c.at)}`} title={getArticle(c.slug)?.title ?? "a story"} body={c.text} />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="glass rounded-[2rem] px-6 py-16 text-center">
      <p className="text-muted-foreground">{text}</p>
      <Button asChild className="mt-5 rounded-full"><Link to="/explore">Explore stories</Link></Button>
    </div>
  );
}

function Counter({ n, max }: { n: number; max: number }) {
  return <span className={`text-xs ${n > max ? "font-bold text-destructive" : "text-muted-foreground"}`}>{n}/{max}</span>;
}

function Settings({ profile, email, onSignOut }: { profile: { username: string; displayName: string; bio: string }; email: string; onSignOut: (everywhere?: boolean) => Promise<void> }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(profile);
  const [errors, setErrors] = useState<FormErrors>({});
  useEffect(() => setForm(profile), [profile]);

  const save = useMutation({
    mutationFn: () => updateMyProfile({ data: { username: form.username.trim(), displayName: form.displayName.trim(), bio: form.bio.trim() } }),
    onSuccess: async (r) => {
      if (!r.ok) return setErrors({ username: r.error });
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
      toast.success("Profile saved");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = {
      username: fieldError(usernameSchema, form.username),
      displayName: fieldError(displayNameSchema, form.displayName),
      bio: fieldError(bioSchema, form.bio),
    };
    setErrors(next);
    if (!Object.values(next).some(Boolean)) save.mutate();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={submit} noValidate className="glass rounded-[2rem] p-6 md:p-8">
        <h2 className="text-xl font-extrabold">Public profile</h2>
        <div className="mt-5 grid gap-4">
          <div>
            <div className="flex justify-between"><label htmlFor="pf-u" className="auth-label">Username</label><Counter n={form.username.length} max={LIMITS.usernameMax} /></div>
            <input id="pf-u" className="auth-input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} aria-invalid={!!errors.username} />
            {errors.username && <p role="alert" className="auth-error">{errors.username}</p>}
          </div>
          <div>
            <div className="flex justify-between"><label htmlFor="pf-n" className="auth-label">Display name</label><Counter n={form.displayName.length} max={LIMITS.displayNameMax} /></div>
            <input id="pf-n" className="auth-input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} aria-invalid={!!errors.displayName} />
            {errors.displayName && <p role="alert" className="auth-error">{errors.displayName}</p>}
          </div>
          <div>
            <div className="flex justify-between"><label htmlFor="pf-b" className="auth-label">Bio</label><Counter n={form.bio.length} max={LIMITS.bioMax} /></div>
            <textarea id="pf-b" rows={4} className="auth-input h-auto resize-none py-3" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} aria-invalid={!!errors.bio} />
            {errors.bio && <p role="alert" className="auth-error">{errors.bio}</p>}
          </div>
          <Button type="submit" disabled={save.isPending} className="h-12 rounded-full font-bold">{save.isPending && <Loader size="xs" />}Save changes</Button>
        </div>
      </form>
      <div className="grid gap-6">
        <ChangePassword email={email} />
        <section className="glass rounded-[2rem] p-6 md:p-8">
          <h2 className="flex items-center gap-2 text-xl font-extrabold"><ShieldCheck className="h-5 w-5" /> Account & sessions</h2>
          <p className="mt-2 text-sm text-muted-foreground">Signed in as <strong className="text-foreground">{email}</strong>. You stay signed in on this device until you sign out, or after {LIMITS.sessionIdleDays} days without a visit.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="secondary" className="rounded-full" onClick={() => onSignOut()}><LogOut className="h-4 w-4" /> Sign out</Button>
            <Button variant="outline" className="rounded-full" onClick={() => onSignOut(true)}>Sign out on all devices</Button>
          </div>
          <DeleteAccount onDone={() => onSignOut()} />
        </section>
      </div>
    </div>
  );
}

function ChangePassword({ email }: { email: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = { current: current ? null : "Enter your current password", next: passwordError(next, [(email.split("@")[0] ?? "")]) ?? (next === current ? "New password must be different" : null), confirm: confirm === next ? null : "Passwords don't match" };
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    const res = await changePassword({ data: { current, next } }).catch((e: Error) => ({ ok: false as const, error: e.message }));
    setBusy(false);
    if (!res.ok) return setErrors({ form: res.error });
    setCurrent(""); setNext(""); setConfirm("");
    toast.success("Password changed");
  };
  return (
    <form onSubmit={submit} noValidate className="glass rounded-[2rem] p-6 md:p-8">
      <h2 className="text-xl font-extrabold">Change password</h2>
      <div className="mt-5 grid gap-4">
        <PasswordField label="Current password" value={current} onChange={setCurrent} error={errors.current} autoComplete="current-password" />
        <PasswordField label="New password" value={next} onChange={setNext} error={errors.next} autoComplete="new-password" showStrength context={[(email.split("@")[0] ?? "")]} maxLength={LIMITS.passwordMax} />
        <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} error={errors.confirm} autoComplete="new-password" />
        {errors.form && <p role="alert" className="auth-banner">{errors.form}</p>}
        <Button type="submit" disabled={busy} className="h-12 rounded-full font-bold">{busy && <Loader size="xs" />}Update password</Button>
      </div>
    </form>
  );
}

function DeleteAccount({ onDone }: { onDone: () => void }) {
  const del = useMutation({ mutationFn: () => deleteMyAccount(), onSuccess: () => { toast.success("Your account was deleted"); onDone(); }, onError: (e) => toast.error((e as Error).message) });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild><Button variant="ghost" className="mt-4 rounded-full text-destructive"><Trash2 className="h-4 w-4" /> Delete account</Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>Your profile, saved stories and likes are removed and your comments are deleted. This can't be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep account</AlertDialogCancel>
          <AlertDialogAction data-tone="solid-danger" onClick={() => del.mutate()}>Delete forever</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
