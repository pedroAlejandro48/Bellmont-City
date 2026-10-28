import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { UsernameForm } from "@/components/UsernameForm";
import { signInWithUsername } from "@/lib/accounts.functions";
import { usernameLoginSchema } from "@/lib/usernames";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Bellmont City — Sign in" },
      { name: "description", content: "An open-world downtown with a real day and night cycle. Sign in to save your progress." },
      { property: "og:title", content: "Bellmont City" },
      { property: "og:description", content: "An open-world downtown with a real day and night cycle." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<"username" | "email">("username");
  const [username, setUsername] = useState("");
  const usernameLogin = useServerFn(signInWithUsername);
  const account = useQuery({ queryKey: ["player-account"], queryFn: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return null;
    const profile = await supabase.from("profiles").select("username").eq("id", data.user.id).maybeSingle();
    if (profile.error) throw profile.error;
    if (profile.data?.username) void navigate({ to: "/play" });
    return { id: data.user.id, username: profile.data?.username };
  } });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
    if (mode === "up") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) setMsg(error.message);
      else if (data.user && data.user.identities && data.user.identities.length === 0)
        setMsg("This email already has an account. Sign in instead, or use “Forgot password” to set a new one.");
      else if (!data.session) setMsg("Check your email to confirm your account, then sign in.");
    } else if (method === "email") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg(error.message);
    } else {
      const parsed = usernameLoginSchema.safeParse({ username, password });
      if (!parsed.success) { setMsg("Enter a valid username and password."); return; }
      const result = await usernameLogin({ data: parsed.data });
      if (result.error) setMsg(result.error);
      else if (result.tokens) {
        const { error } = await supabase.auth.setSession(result.tokens);
        if (error) setMsg("Could not complete sign-in. Please try again.");
      }
    }
    await account.refetch();
    } catch { setMsg("Could not sign in. Please try again."); }
    finally { setBusy(false); }
  }

  async function forgotPassword() {
    if (!email) { setMsg("Enter your email above, then tap “Forgot password”."); return; }
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setMsg(error ? error.message : "Check your email for a password reset link.");
    } catch { setMsg("Could not send the reset email. Please try again."); }
    finally { setBusy(false); }
  }

  async function google() {
    setMsg(null);
    try {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (r.error) setMsg(r.error.message ?? "Google sign-in failed");
    else if (!r.redirected) await account.refetch();
    } catch { setMsg("Google sign-in failed. Please try again."); }
  }

  if (account.data && !account.data.username) return <UsernameForm userId={account.data.id} onComplete={() => { void account.refetch(); }} onSignOut={async () => {
    await supabase.auth.signOut(); await account.refetch();
  }} />;

  return (
    <div className="auth-bg flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-center text-5xl tracking-tight text-foreground">Bellmont city</h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">Ten minutes of sun. Ten minutes of moon. Real life in a game.</p>
        <form onSubmit={submit} className="hud-panel mt-8 space-y-4 p-6">
          <div className="flex gap-1 rounded-md bg-muted p-1">
            {(["in", "up"] as const).map((m) => (
              <Button
                key={m}
                type="button"
                variant="ghost"
                onClick={() => { setMode(m); setMsg(null); }}
                className={`flex-1 rounded px-3 py-1.5 text-sm transition ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                {m === "in" ? "Sign in" : "Sign up"}
              </Button>
            ))}
          </div>
          {mode === "in" && <div className="flex gap-1 rounded-md bg-muted p-1" aria-label="Sign-in method">
            {(["username", "email"] as const).map((value) => <Button key={value} type="button" variant={method === value ? "default" : "ghost"} className="flex-1" aria-pressed={method === value} onClick={() => { setMethod(value); setMsg(null); }}>{value === "username" ? "Username" : "Email"}</Button>)}
          </div>}
          {mode === "up" || method === "email" ? <input aria-label="Email" className="auth-input" type="email" autoComplete="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} /> : <input aria-label="Username" className="auth-input" autoComplete="username" required minLength={3} maxLength={24} placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />}
          <input aria-label="Password" className="auth-input" type="password" autoComplete={mode === "up" ? "new-password" : "current-password"} required minLength={mode === "up" ? 6 : 1} maxLength={256} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button disabled={busy} className="w-full">
            {busy ? "…" : mode === "in" ? "Enter the city" : "Create account"}
          </Button>
          {mode === "in" && method === "email" && (
            <button type="button" onClick={forgotPassword} disabled={busy} className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline">
              Forgot password?
            </button>
          )}
          <div className="text-center text-xs text-muted-foreground">or</div>
          <Button variant="outline" type="button" onClick={google} className="w-full">
            Continue with Google
          </Button>
          {msg && <p className="text-center text-sm text-accent">{msg}</p>}
          {account.isError && <Button type="button" variant="outline" onClick={() => { void account.refetch(); }}>Retry account loading</Button>}
        </form>
      </div>
    </div>
  );
}
