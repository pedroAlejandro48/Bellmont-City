import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { usernameSchema } from "@/lib/usernames";

export function UsernameForm({ userId, onComplete, onSignOut }: { userId: string; onComplete: () => void; onSignOut: () => void }) {
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = usernameSchema.safeParse(username);
    if (!parsed.success) { setMessage("Use 3–24 letters, numbers, or underscores."); return; }
    setBusy(true); setMessage(null);
    try {
      const { data: available, error: checkError } = await supabase.rpc("username_available", { candidate: parsed.data });
      if (checkError) throw checkError;
      if (!available) { setMessage("That username is already taken."); return; }
      const { error } = await supabase.from("profiles").upsert({ id: userId, username: parsed.data });
      if (error?.code === "23505") { setMessage("That username was just taken. Choose another."); return; }
      if (error) throw error;
      onComplete();
    } catch { setMessage("Could not reserve your username. Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="auth-bg flex min-h-screen items-center justify-center px-4">
    <div className="w-full max-w-sm">
      <h1 className="font-display text-center text-4xl text-foreground">Choose your username</h1>
      <form onSubmit={submit} className="hud-panel mt-6 space-y-4 p-6">
        <label className="block text-sm text-foreground" htmlFor="player-username">Username</label>
        <input id="player-username" className="auth-input" autoComplete="username" placeholder="Username" required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" value={username} onChange={(e) => setUsername(e.target.value)} />
        <Button className="w-full" disabled={busy}>{busy ? "Checking…" : "Claim username"}</Button>
        {message && <p role="alert" className="text-sm text-accent">{message}</p>}
        <Button type="button" variant="ghost" className="w-full" disabled={busy} onClick={onSignOut}>Sign out</Button>
      </form>
    </div>
  </div>;
}