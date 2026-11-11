import { absUrl } from "@/lib/site";
import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Loader, LoaderBlock } from "@/components/loader";

import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/password-field";
import { useAuth } from "@/hooks/use-auth";
import { checkUsername } from "@/lib/community.functions";
import { instantSignUp, signIn } from "@/lib/signup.functions";
import { LIMITS, emailSchema, passwordError, usernameSchema, type FormErrors, fieldError } from "@/lib/community-rules";

const search = z.object({ redirect: z.string().optional(), mode: z.enum(["signin", "signup"]).optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: (s) => search.parse(s),
  head: () => ({
    meta: [
      { property: "og:url", content: absUrl("/auth") },
      { title: "Sign in or join — Midnight" },
      { name: "description", content: "Sign in to Midnight to save stories, like articles and join the discussion." },
      { property: "og:title", content: "Sign in or join — Midnight" },
      { property: "og:description", content: "Save stories, like articles and join the discussion on Midnight." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "canonical", href: absUrl("/auth") }],
  }),
  component: AuthPage,
});

const safePath = (p?: string) => (p && p.startsWith("/") && !p.startsWith("//") ? p : "/profile");

function friendly(message: string) {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "That email and password don't match. Check both and try again.";
    if (m.includes("already registered") || m.includes("already been registered")) return "An account with this email already exists. Try signing in instead.";
  if (m.includes("pwned") || m.includes("leaked") || m.includes("compromised")) return "This password has appeared in a data breach. Please choose a different one.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Please wait a few minutes and try again.";
  return message;
}

function AuthPage() {
  const { redirect, mode: initial } = Route.useSearch();
  const navigate = useNavigate();
  const { user, loading, refresh } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">(initial ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [username, setUsername] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nameStatus, setNameStatus] = useState<"idle" | "checking" | "free" | "taken">("idle");

  useEffect(() => {
    if (!loading && user) navigate({ to: safePath(redirect), replace: true });
  }, [user, loading, redirect, navigate]);

  useEffect(() => {
    if (mode !== "signup" || !usernameSchema.safeParse(username).success) { setNameStatus("idle"); return; }
    setNameStatus("checking");
    const t = setTimeout(() => {
      checkUsername({ data: { username } }).then((r) => setNameStatus(r.available ? "free" : "taken")).catch(() => setNameStatus("idle"));
    }, 450);
    return () => clearTimeout(t);
  }, [username, mode]);

  const switchMode = (m: typeof mode) => { setMode(m); setErrors({}); setFormError(null); };

  const validate = () => {
    const e: FormErrors = {};
    const em = emailSchema.safeParse(email);
    e.email = em.success ? null : em.error.issues[0]?.message ?? "Invalid value";
    if (mode === "signin") e.password = password ? null : "Enter your password";
    if (mode === "signup") {
      const un = usernameSchema.safeParse(username);
      e.username = !un.success ? un.error.issues[0]?.message ?? "Invalid value" : nameStatus === "taken" ? "That username is already taken" : null;
      e.password = passwordError(password, [(email.split("@")[0] ?? ""), username]);
      e.confirm = confirm === password ? null : "Passwords don't match";
    }
    setErrors(e);
    return Object.values(e).every((v) => !v);
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      if (mode === "signin") {
        const res = await signIn({ data: { email: email.trim(), password } });
        if (!res.ok) throw new Error(res.error);
        await refresh();
      } else if (mode === "signup") {
        const res = await instantSignUp({ data: { email: email.trim(), password, username: username.trim() } });
        if (res.status === "created") {
          await refresh();
        } else {
          throw new Error(`Only ${res.limit} new accounts can be created from one network per day. Please try again tomorrow.`);
        }
      }
    } catch (e) {
      setFormError(friendly((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-32 pb-24">
      <p className="auth-page-title">{mode === "signup" ? "Sign up" : "Sign in"}</p>
      <div className="glass-strong rounded-[2rem] p-6 shadow-float md:p-8">
        <div role="tablist" className="flex gap-1 rounded-full bg-secondary p-1">
          {(["signin", "signup"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => switchMode(m)}
              className={`flex-1 rounded-full py-2.5 text-sm font-bold transition ${mode === m ? "bg-primary text-primary-foreground shadow-float" : "text-muted-foreground"}`}>
              {m === "signin" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>
        <h1 className="mt-6 text-center font-serif text-4xl">{mode === "signin" ? "Welcome back" : "Join Midnight"}</h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">{mode === "signin" ? "Pick up where you left off." : "Save stories, like articles and join the discussion."}</p>
        <form onSubmit={submit} noValidate className="mt-6 grid gap-4">
          <div>
            <label htmlFor="email" className="auth-label">Email</label>
            <input id="email" type="email" autoComplete="email" value={email} maxLength={LIMITS.emailMax + 20}
              onChange={(e) => setEmail(e.target.value)} onBlur={() => email && setErrors((x) => ({ ...x, email: emailSchema.safeParse(email).success ? null : fieldError(emailSchema, email) }))}
              aria-invalid={!!errors.email} className="auth-input" placeholder="name@example.com" />
            {errors.email && <p role="alert" className="auth-error">{errors.email}</p>}
          </div>
          {mode === "signup" && (
            <div>
              <label htmlFor="username" className="auth-label">Username</label>
              <input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)}
                aria-invalid={!!errors.username} className="auth-input" placeholder="night_reader" />
              <div className="mt-1 flex justify-between text-xs">
                <span className={nameStatus === "taken" ? "text-destructive" : nameStatus === "free" ? "text-success" : "text-muted-foreground"}>
                  {nameStatus === "checking" ? "Checking…" : nameStatus === "taken" ? "Already taken" : nameStatus === "free" ? "Available" : "Letters, numbers and underscores"}
                </span>
                <span className={username.length > LIMITS.usernameMax ? "text-destructive" : "text-muted-foreground"}>{username.length}/{LIMITS.usernameMax}</span>
              </div>
              {errors.username && <p role="alert" className="auth-error">{errors.username}</p>}
            </div>
          )}
          <PasswordField label="Password" value={password} onChange={setPassword} error={errors.password}
            autoComplete={mode === "signup" ? "new-password" : "current-password"} showStrength={mode === "signup"}
            context={[(email.split("@")[0] ?? ""), username]} maxLength={LIMITS.passwordMax} />
          {mode === "signup" && (
            <PasswordField label="Confirm password" value={confirm} onChange={setConfirm} error={errors.confirm} autoComplete="new-password" />
          )}
          {formError && <p role="alert" className="auth-banner">{formError}</p>}
          <Button type="submit" disabled={busy} className="h-12 rounded-full text-base font-bold">
            {busy && <Loader size="xs" />}
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
          {mode === "signup" && <p className="text-center text-xs text-muted-foreground">By joining you agree to our <Link to="/info/$slug" params={{ slug: "terms" }} className="underline">terms</Link>.</p>}
        </form>
      </div>
    </main>
  );
}
