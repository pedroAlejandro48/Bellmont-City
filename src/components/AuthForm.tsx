import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { usernameSchema } from "@/lib/usernames";
import {
  AccountError, sendPasswordReset, signInWithEmail, signInWithGoogle, signInWithUsername, signUpWithEmail, type Account,
} from "@/platform/account";

type AuthFormProps = {
  /** Signed in (or just signed up); `password` is passed along when one was typed, for choosing a username. */
  onSignedIn: (account: Account, password: string | null) => void;
  children?: ReactNode;
};

/** Google's "G" mark, in its brand colours. */
function GoogleMark() {
  return <svg viewBox="0 0 48 48" aria-hidden className="h-4 w-4">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>;
}

const message = (error: unknown) => (error instanceof AccountError ? error.message : "Something went wrong. Please try again.");

export function AuthForm({ onSignedIn, children }: AuthFormProps) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [method, setMethod] = useState<"username" | "email">("username");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try { await action(); } catch (error) { setMsg(message(error)); } finally { setBusy(false); }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      if (mode === "up") return onSignedIn(await signUpWithEmail(email, password), password);
      if (method === "email") return onSignedIn(await signInWithEmail(email, password), password);
      const name = usernameSchema.safeParse(username);
      if (!name.success) { setMsg("Incorrect username or password."); return; }
      onSignedIn(await signInWithUsername(name.data, password), password);
    });
  }

  function forgotPassword() {
    if (!email) { setMsg("Enter your email above, then tap “Forgot password”."); return; }
    void run(async () => { await sendPasswordReset(email); setMsg("Check your email for a password reset link."); });
  }

  const usingEmail = mode === "up" || method === "email";
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
          {usingEmail
            ? <input aria-label="Email" className="auth-input" type="email" autoComplete="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            : <input aria-label="Username" className="auth-input" autoComplete="username" required minLength={3} maxLength={24} placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />}
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
          <Button variant="outline" type="button" disabled={busy} className="w-full" onClick={() => void run(async () => onSignedIn(await signInWithGoogle(), null))}>
            <GoogleMark />
            {mode === "in" ? "Sign in with Google" : "Sign up with Google"}
          </Button>
          {msg && <p className="text-center text-sm text-accent">{msg}</p>}
          {children}
        </form>
      </div>
    </div>
  );
}
