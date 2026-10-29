import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { usernameSchema } from "@/lib/usernames";
import { AccountError, claimUsername, type Account } from "@/platform/account";

/** The last sign-up step: pick a unique username. Password accounts confirm the password if it isn't known. */
export function UsernameForm({ account, password, onComplete, onSignOut }: { account: Account; password: string | null; onComplete: (account: Account) => void; onSignOut: () => void }) {
  const [username, setUsername] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const askPassword = account.usesPassword && !password;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = usernameSchema.safeParse(username);
    if (!parsed.success) { setMessage("Use 3–24 letters, numbers, or underscores."); return; }
    setBusy(true); setMessage(null);
    try {
      onComplete(await claimUsername(account, parsed.data, password ?? confirm));
    } catch (error) {
      setMessage(error instanceof AccountError ? error.message : "Could not reserve your username. Please try again.");
    } finally { setBusy(false); }
  }

  return <div className="auth-bg flex min-h-screen items-center justify-center px-4">
    <div className="w-full max-w-sm">
      <h1 className="font-display text-center text-4xl text-foreground">Choose your username</h1>
      <form onSubmit={submit} className="hud-panel mt-6 space-y-4 p-6">
        <label className="block text-sm text-foreground" htmlFor="player-username">Username</label>
        <input id="player-username" className="auth-input" autoComplete="username" autoFocus required minLength={3} maxLength={24} value={username} onChange={(e) => setUsername(e.target.value)} />
        <p className="text-xs text-muted-foreground">3–24 letters, numbers, or underscores. You'll sign in with it.</p>
        {askPassword && <input aria-label="Password" className="auth-input" type="password" autoComplete="current-password" required placeholder="Confirm your password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        <Button disabled={busy} className="w-full">{busy ? "…" : "Continue"}</Button>
        {message && <p className="text-center text-sm text-accent">{message}</p>}
        <button type="button" onClick={onSignOut} className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline">Sign out</button>
      </form>
    </div>
  </div>;
}
