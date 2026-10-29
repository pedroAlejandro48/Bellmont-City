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
            Continue with Google
          </Button>
          {msg && <p className="text-center text-sm text-accent">{msg}</p>}
          {children}
        </form>
      </div>
    </div>
  );
}
