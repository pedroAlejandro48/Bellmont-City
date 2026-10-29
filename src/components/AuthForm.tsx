import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { usernameSchema } from "@/lib/usernames";
import { claimUsername, type Account } from "@/platform/account";

type AuthFormProps = {
  /** The claude.ai viewer; null when the page runs outside claude.ai, where only guest play works. */
  account: Account | null;
  loading: boolean;
  onEnter: (account: Account) => void;
  children?: ReactNode;
};

// Sign-in is the viewer's claude.ai login, so there is no password to type or store here;
// "Sign up" reserves the player's unique Bellmont username for that login.
export function AuthForm({ account, loading, onEnter, children }: AuthFormProps) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [username, setUsername] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!account) return;
    if (mode === "in") {
      if (account.username) onEnter(account);
      else { setMode("up"); setMsg("No Bellmont account for this login yet. Choose a username to create one."); }
      return;
    }
    const parsed = usernameSchema.safeParse(username);
    if (!parsed.success) { setMsg("Use 3–24 letters, numbers, or underscores."); return; }
    setBusy(true);
    try {
      const result = await claimUsername(account, parsed.data);
      if (result === "claimed") onEnter({ ...account, username: parsed.data });
      else if (result === "taken") setMsg("That username is already taken.");
      else if (result === "busy") setMsg("Someone is claiming that username right now. Try again in a moment.");
      else setMsg("Your access to this game is view-only. Ask its owner to make you a Contributor.");
    } catch { setMsg("Could not create your account. Please try again."); }
    finally { setBusy(false); }
  }

  const signedInAs = account && <p className="text-center text-xs text-muted-foreground">
    Signed in with Claude{account.displayName ? <> as <span className="text-foreground">{account.displayName}</span></> : null}
  </p>;

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
          {loading ? <p className="py-3 text-center text-sm text-muted-foreground">Connecting…</p>
            : !account ? <p className="text-center text-sm text-muted-foreground">Accounts work when Bellmont City is opened on claude.ai while you're signed in there. You can still play as a guest.</p>
            : mode === "in" ? <>
              <input aria-label="Username" className="auth-input" readOnly placeholder="No account yet — sign up" value={account.username ?? ""} />
              {signedInAs}
            </>
            : account.username ? <p className="text-center text-sm text-muted-foreground">This login already has the account <span className="text-foreground">{account.username}</span>. Sign in to play.</p>
            : <>
              <input aria-label="Username" className="auth-input" autoComplete="username" required minLength={3} maxLength={24} placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
              {signedInAs}
            </>}
          {account && !(mode === "up" && account.username) && <Button disabled={busy || loading} className="w-full">
            {busy ? "…" : mode === "in" ? "Enter the city" : "Create account"}
          </Button>}
          {msg && <p className="text-center text-sm text-accent">{msg}</p>}
          {children}
        </form>
      </div>
    </div>
  );
}
