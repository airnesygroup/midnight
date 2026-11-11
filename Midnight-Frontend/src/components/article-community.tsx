import { Loader } from "@/components/loader";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Heart, Link2, MessageSquare, Pencil, Reply, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/account-button";
import { useAuth } from "@/hooks/use-auth";
import { addComment, deleteComment, editComment, getDiscussion, getMyArticleState, recordShare, toggleCommentLike, toggleInteraction, type CommentDTO } from "@/lib/community.functions";
import { LIMITS, canEditComment, commentTextSchema } from "@/lib/community-rules";

const discussionKey = (slug: string) => ["discussion", slug];
const mineKey = (slug: string) => ["me", "article", slug];
/** Shared so the article page can start fetching comments before it renders. */
export const discussionQuery = (slug: string) => queryOptions({ queryKey: discussionKey(slug), queryFn: () => getDiscussion({ data: { slug } }), retry: 1, staleTime: 15_000 });

function useCommunity(slug: string) {
  const { user } = useAuth();
  const discussion = useQuery(discussionQuery(slug));
  const mine = useQuery({ queryKey: mineKey(slug), queryFn: () => getMyArticleState({ data: { slug } }), enabled: !!user });
  return { user, discussion, mine: user ? mine.data : undefined };
}

function SignInPrompt({ action, slug }: { action: string; slug: string }) {
  return (
    <span>
      <Link to="/auth" search={{ redirect: `/article/${slug}` }} className="font-bold text-primary underline">Sign in</Link> to {action}.
    </span>
  );
}

export function ArticleActions({ slug, title }: { slug: string; title: string }) {
  const qc = useQueryClient();
  const { user, discussion, mine } = useCommunity(slug);
  const counts = discussion.data?.counts;
  const [pop, setPop] = useState<{ like?: number; save?: number; share?: number; discuss?: number }>({});
  const bump = (k: "like" | "save" | "share" | "discuss") => setPop((p) => ({ ...p, [k]: (p[k] ?? 0) + 1 }));
  // Optimistic: flip the icon and counter instantly, roll back if the server refuses.
  const toggle = useMutation({
    mutationFn: (kind: "like" | "save") => toggleInteraction({ data: { slug, kind } }),
    onMutate: async (kind) => {
      bump(kind);
      await Promise.all([qc.cancelQueries({ queryKey: mineKey(slug) }), qc.cancelQueries({ queryKey: discussionKey(slug) })]);
      const prevMine = qc.getQueryData<MineState>(mineKey(slug));
      const prevDisc = qc.getQueryData<DiscussionState>(discussionKey(slug));
      const field = kind === "like" ? "liked" : "saved";
      const nowOn = !prevMine?.[field];
      if (prevMine) qc.setQueryData<MineState>(mineKey(slug), { ...prevMine, [field]: nowOn });
      if (prevDisc && kind === "like") qc.setQueryData<DiscussionState>(discussionKey(slug), { ...prevDisc, counts: { ...prevDisc.counts, likes: Math.max(0, prevDisc.counts.likes + (nowOn ? 1 : -1)) } });
      if (kind === "save") toast.success(nowOn ? "Saved to your profile" : "Removed from saved");
      return { prevMine, prevDisc };
    },
    onError: (e, _k, ctx) => {
      if (ctx?.prevMine) qc.setQueryData(mineKey(slug), ctx.prevMine);
      if (ctx?.prevDisc) qc.setQueryData(discussionKey(slug), ctx.prevDisc);
      toast.error((e as Error).message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: discussionKey(slug) });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const need = (action: string) => toast(<SignInPrompt action={action} slug={slug} />);

  const share = async (channel: "native" | "copy" | "x" | "facebook" | "linkedin" | "whatsapp" | "email") => {
    const url = window.location.href.split("#")[0] ?? window.location.href;
    const t = encodeURIComponent(title), u = encodeURIComponent(url);
    const targets: Record<string, string> = {
      x: `https://x.com/intent/post?text=${t}&url=${u}`, facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`, whatsapp: `https://wa.me/?text=${t}%20${u}`, email: `mailto:?subject=${t}&body=${u}`,
    };
    try {
      if (channel === "native") { if (!navigator.share) return share("copy"); await navigator.share({ title, url }); }
      else if (channel === "copy") { await navigator.clipboard.writeText(url); toast.success("Link copied"); }
      else window.open(targets[channel] ?? url, "_blank", "noopener,noreferrer");
      bump("share");
      const d = qc.getQueryData<DiscussionState>(discussionKey(slug));
      if (d) qc.setQueryData<DiscussionState>(discussionKey(slug), { ...d, counts: { ...d.counts, shares: d.counts.shares + 1 } });
      recordShare({ data: { slug, channel } }).then(() => qc.invalidateQueries({ queryKey: discussionKey(slug) })).catch(() => {});
    } catch { /* share sheet dismissed */ }
  };

  const liked = !!mine?.liked, saved = !!mine?.saved;
  const Label = ({ children }: { children: ReactNode }) => <span className="sr-only @[28rem]:not-sr-only">{children}</span>;
  const Count = ({ n }: { n: number | undefined }) => (n === undefined ? null : <span key={n} className="count-tick opacity-70">{n}</span>);
  return (
    // Always one line: below 28rem of room the text labels collapse to icons (kept for screen readers).
    <div className="@container mt-6 w-full">
    <div className="glass mx-auto flex w-fit flex-nowrap items-center justify-center gap-1 rounded-full p-1.5" aria-label="Story actions">
      <button aria-pressed={liked} onClick={() => (user ? toggle.mutate("like") : need("like stories"))} className={`action-pill ${liked ? "action-pill-on" : ""}`}>
        <Heart key={`l${pop.like ?? 0}`} className={`h-4 w-4 ${pop.like ? "icon-pop" : ""} ${liked ? "fill-current" : ""}`} /> <Label>{liked ? "Liked" : "Like"}</Label><Count n={counts?.likes} />
      </button>
      <button aria-pressed={saved} onClick={() => (user ? toggle.mutate("save") : need("save stories"))} className={`action-pill ${saved ? "action-pill-on" : ""}`}>
        <Bookmark key={`s${pop.save ?? 0}`} className={`h-4 w-4 ${pop.save ? "icon-pop" : ""} ${saved ? "fill-current" : ""}`} /> <Label>{saved ? "Saved" : "Save"}</Label>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger className="action-pill"><Share2 key={`h${pop.share ?? 0}`} className={`h-4 w-4 ${pop.share ? "icon-pop" : ""}`} /> <Label>Share</Label><Count n={counts?.shares} /></DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="glass-strong rounded-2xl p-2">
          <DropdownMenuItem className="rounded-xl" onSelect={() => share("copy")}><Link2 className="h-4 w-4" /> Copy link</DropdownMenuItem>
          {([["x", "X"], ["facebook", "Facebook"], ["linkedin", "LinkedIn"], ["whatsapp", "WhatsApp"], ["email", "Email"]] as const).map(([k, l]) => (
            <DropdownMenuItem key={k} className="rounded-xl" onSelect={() => share(k)}>{l}</DropdownMenuItem>
          ))}
          <DropdownMenuItem className="rounded-xl" onSelect={() => share("native")}>More…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <a href="#discussion" onClick={() => bump("discuss")} className="action-pill"><MessageSquare key={`d${pop.discuss ?? 0}`} className={`h-4 w-4 ${pop.discuss ? "icon-pop" : ""}`} /> <Label>Discuss</Label><Count n={counts?.comments} /></a>
    </div>
    </div>
  );
}

type MineState = { liked: boolean; saved: boolean; myCommentIds: string[]; likedCommentIds: string[] };
type DiscussionState = { comments: CommentDTO[]; counts: { likes: number; saves: number; shares: number; comments: number } };

function CommentBox({ onSubmit, initial = "", placeholder, submitLabel, onCancel, busy, compact }: { onSubmit: (t: string) => Promise<unknown>; initial?: string; placeholder: string; submitLabel: string; onCancel?: () => void; busy?: boolean; compact?: boolean }) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!onCancel) return; // only boxes opened on demand (reply/edit) jump into view
    const el = formRef.current;
    if (!el) return;
    const t = setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      el.querySelector("textarea")?.focus({ preventScroll: true });
    }, 30);
    return () => clearTimeout(t);
  }, [onCancel === undefined]);
  const over = text.length > LIMITS.commentMax;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = commentTextSchema.safeParse(text);
    if (!r.success) return setError(r.error.issues[0]?.message ?? "Invalid value");
    setError(null);
    try { await onSubmit(r.data); setText(""); } catch (err) { setError((err as Error).message); }
  };
  return (
    <form ref={formRef} onSubmit={submit} noValidate className="scroll-my-4">
      <textarea value={text} onFocus={() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })} onChange={(e) => setText(e.target.value)} rows={compact ? 1 : 3} placeholder={placeholder} aria-invalid={over || !!error}
        className={`auth-input comment-input h-auto resize-y ${compact ? "reply-input py-2" : "min-h-24 py-3"}`} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className={`text-xs ${over ? "font-bold text-destructive" : "text-muted-foreground"}`}>
          {over ? `${text.length - LIMITS.commentMax} characters over the limit` : `${text.length}/${LIMITS.commentMax}`}
        </span>
        <div className="flex gap-2">
          {onCancel && <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={onCancel}>Cancel</Button>}
          <Button type="submit" size="sm" disabled={busy || over || !text.trim()} className="rounded-full px-5 font-bold">{busy && <Loader size="xs" />}{submitLabel}</Button>
        </div>
      </div>
      {error && <p role="alert" className="auth-error">{error}</p>}
    </form>
  );
}

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

export function Discussion({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const { user, discussion, mine } = useCommunity(slug);
  const [sort, setSort] = useState<"newest" | "oldest" | "top">("newest");
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: discussionKey(slug) }), qc.invalidateQueries({ queryKey: ["me"] })]);
  const post = useMutation({
    mutationFn: (v: { text: string; parentId: string | null }) => addComment({ data: { slug, ...v } }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: discussionKey(slug) });
      const prev = qc.getQueryData<DiscussionState>(discussionKey(slug));
      const name = user?.username || user?.email?.split("@")[0] || "you";
      const temp: CommentDTO = { id: `temp-${Date.now()}`, parentId: v.parentId, text: v.text, createdAt: new Date().toISOString(), editedAt: null, deleted: false, likes: 0, author: { username: name, displayName: name, hue: 280 } };
      if (prev) qc.setQueryData<DiscussionState>(discussionKey(slug), { comments: [...prev.comments, temp], counts: { ...prev.counts, comments: prev.counts.comments + 1 } });
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(discussionKey(slug), ctx.prev); toast.error((e as Error).message); },
    onSettled: refresh,
  });

  const tree = useMemo(() => {
    const all = discussion.data?.comments ?? [];
    const kids = new Map<string | null, CommentDTO[]>();
    for (const c of all) kids.set(c.parentId, [...(kids.get(c.parentId) ?? []), c]);
    const roots = [...(kids.get(null) ?? [])];
    roots.sort((a, b) => sort === "top" ? b.likes - a.likes : sort === "oldest" ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt));
    return { roots, kids };
  }, [discussion.data, sort]);

  const myCount = mine?.myCommentIds.length ?? 0;
  return (
    <section id="discussion" className="glass discussion-card mx-auto mt-16 max-w-3xl scroll-mt-28 rounded-[2rem] p-6 md:p-8">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold">Discussion</h2>
          <p className="text-sm text-muted-foreground">{discussion.data ? `${discussion.data.counts.comments} comment${discussion.data.counts.comments === 1 ? "" : "s"}` : discussion.isError ? "Unavailable" : "Loading…"}</p>
        </div>
        <div className="glass flex gap-1 rounded-full p-1">
          {(["newest", "top", "oldest"] as const).map((s) => (
            <button key={s} onClick={() => setSort(s)} className={`rounded-full px-4 py-1.5 text-xs font-bold capitalize ${sort === s ? "bg-primary text-primary-foreground" : "nav-hover text-muted-foreground"}`}>{s}</button>
          ))}
        </div>
      </div>
      <div className="mt-5 shrink-0 pb-5 sm:pb-6 md:pb-8">
        {user ? (
          myCount >= LIMITS.commentsPerArticle
            ? <p className="text-sm text-muted-foreground">You've reached the limit of {LIMITS.commentsPerArticle} comments on this story.</p>
            : <CommentBox placeholder="Share your perspective…" submitLabel="Post comment" busy={post.isPending} onSubmit={(text) => post.mutateAsync({ text, parentId: null })} />
        ) : (
          <p className="text-sm text-muted-foreground"><SignInPrompt action="join the discussion" slug={slug} /></p>
        )}
      </div>
      <div className="discussion-scroll mt-5">
        {discussion.isPending && (
          <ul className="grid gap-5" aria-label="Loading comments">
            {[0, 1, 2].map((i) => <li key={i} className="flex gap-3"><span className="skeleton h-8 w-8 shrink-0 rounded-full" /><span className="grid flex-1 gap-2"><span className="skeleton h-3 w-1/3" /><span className="skeleton h-3 w-full" /><span className="skeleton h-3 w-2/3" /></span></li>)}
          </ul>
        )}
        {discussion.isError && <p className="py-6 text-center text-sm text-muted-foreground">Comments couldn't load right now. <button className="font-bold text-primary underline" onClick={() => discussion.refetch()}>Retry</button></p>}
        {discussion.data && tree.roots.length === 0 && <p className="py-6 text-center text-muted-foreground">No comments yet. Start the conversation.</p>}
        {tree.roots.length > 0 && (
          <ul className="grid gap-3">
            {tree.roots.map((c) => <CommentItem key={c.id} c={c} kids={tree.kids} depth={1} slug={slug} mine={mine} onChange={refresh} post={post.mutateAsync} />)}
          </ul>
        )}
      </div>
    </section>
  );
}

const REPLY_PAGE = 5;

type Mine = { myCommentIds: string[]; likedCommentIds: string[] } | undefined;

function CommentItem({ c, kids, depth, slug, mine, onChange, post }: { c: CommentDTO; kids: Map<string | null, CommentDTO[]>; depth: number; slug: string; mine: Mine; onChange: () => Promise<unknown>; post: (v: { text: string; parentId: string | null }) => Promise<unknown> }) {
  const { user } = useAuth();
  const [mode, setMode] = useState<"view" | "reply" | "edit">("view");
  const isMine = !!mine?.myCommentIds.includes(c.id);
  const serverLiked = !!mine?.likedCommentIds.includes(c.id);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const liked = optimistic ?? serverLiked;
  const likeCount = c.likes + (optimistic === null ? 0 : (optimistic ? 1 : 0) - (serverLiked ? 1 : 0));
  const like = useMutation({
    mutationFn: () => toggleCommentLike({ data: { commentId: c.id } }),
    onMutate: () => { setOptimistic(!liked); },
    onError: (e) => { setOptimistic(null); toast.error((e as Error).message); },
    onSuccess: async () => { await onChange(); setOptimistic(null); },
  });
  const edit = useMutation({ mutationFn: (text: string) => editComment({ data: { commentId: c.id, text } }), onSuccess: () => { setMode("view"); onChange(); } });
  const del = useMutation({ mutationFn: () => deleteComment({ data: { commentId: c.id } }), onSuccess: () => { toast.success("Comment deleted"); onChange(); }, onError: (e) => toast.error((e as Error).message) });
  const replies = [...(kids.get(c.id) ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const [shown, setShown] = useState(0);
  const [open, setOpen] = useState(false);
  const name = c.author.displayName || c.author.username;

  return (
    <li className="comment-card">
      <article className={`${c.id.startsWith("temp-") ? "comment-pending" : "comment-enter"}`}>
        {c.deleted ? <p className="text-sm text-muted-foreground italic">This comment was deleted.</p> : (
          <>
            <header className="flex items-center gap-3">
              <UserAvatar name={name} hue={c.author.hue} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{name} <span className="font-medium text-muted-foreground">@{c.author.username}</span></p>
                <p className="text-xs text-muted-foreground"><time dateTime={c.createdAt}>{ago(c.createdAt)}</time>{c.editedAt && " · edited"}</p>
              </div>
            </header>
            {mode === "edit"
              ? <div className="mt-3"><CommentBox initial={c.text} placeholder="Edit your comment" submitLabel="Save" busy={edit.isPending} onCancel={() => setMode("view")} onSubmit={(t) => edit.mutateAsync(t)} /></div>
              : <p className="mt-3 whitespace-pre-wrap break-words leading-relaxed">{c.text}</p>}
            <div className="mt-3 flex flex-wrap gap-1 text-xs font-semibold">
              <button onClick={() => (user ? (!c.id.startsWith("temp-") && !like.isPending && like.mutate()) : toast(<SignInPrompt action="like comments" slug={slug} />))} aria-pressed={liked} className={`comment-action ${liked ? "text-primary" : ""}`}>
                <Heart className={`h-3.5 w-3.5 ${liked ? "fill-current icon-pop" : ""}`} />{likeCount > 0 && <span>{likeCount}</span>}
              </button>
              {depth < LIMITS.replyDepthMax ? (
                <button aria-expanded={open} onClick={() => { if (open && mode !== "reply" && user) { setMode("reply"); return; } const next = !open; setOpen(next); setShown(next ? REPLY_PAGE : 0); setMode(next && user ? "reply" : "view"); }} className={`comment-action ${open ? "text-primary" : ""}`}><Reply className="h-3.5 w-3.5" /> {replies.length > 0 ? `${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : "Reply"}</button>
              ) : null}
              {isMine && canEditComment(c.createdAt) && mode !== "edit" && <button onClick={() => setMode("edit")} className="comment-action"><Pencil className="h-3.5 w-3.5" /> Edit</button>}
              {isMine && (
                <AlertDialog>
                  <AlertDialogTrigger asChild><button className="comment-action hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /> Delete</button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this comment?</AlertDialogTitle>
                      <AlertDialogDescription>It will be removed from the discussion. This can't be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep it</AlertDialogCancel>
                      <AlertDialogAction data-tone="solid-danger" onClick={() => del.mutate()}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </>
        )}
        {open && (mode === "reply" || !user) && (
          <div className="mt-3">{user
            ? <CommentBox compact placeholder={`Reply to ${name}…`} submitLabel="Reply" onCancel={() => { setOpen(false); setShown(0); setMode("view"); }} onSubmit={async (text) => { await post({ text, parentId: c.id }); setMode("view"); setShown((n) => Math.max(n, Math.min(replies.length + 1, n + REPLY_PAGE))); }} />
            : <p className="text-sm text-muted-foreground"><SignInPrompt action="reply" slug={slug} /></p>}</div>
        )}
        {open && shown > 0 && replies.length > 0 && (
          <ul className="mt-4 grid gap-4">
            {replies.slice(0, shown).map((r) => <CommentItem key={r.id} c={r} kids={kids} depth={depth + 1} slug={slug} mine={mine} onChange={onChange} post={post} />)}
            <li className="flex flex-wrap gap-1 text-xs font-bold">
              {shown < replies.length && <button onClick={() => setShown((n) => n + REPLY_PAGE)} className="comment-action text-primary">Show more ({replies.length - shown})</button>}
              <button onClick={() => { setOpen(false); setShown(0); setMode("view"); }} className="comment-action">Hide replies</button>
            </li>
          </ul>
        )}
      </article>
    </li>
  );
}

