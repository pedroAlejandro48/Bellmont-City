import { useTitleBetweenObeliskAndForm } from "@/lib/fitTitle";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { usernameSchema } from "@/lib/usernames";
import { AccountError, BODY_COLORS, MIN_PASSWORD, addPassword, claimUsername, type Account, type Gender } from "@/platform/account";

const GENDERS: { value: Gender; label: string; symbol: string }[] = [
  { value: "female", label: "Female", symbol: "♀" },
  { value: "male", label: "Male", symbol: "♂" },
];

/**
 * The last sign-up step: pick a unique username and a gender (which colours the character). Neither can be
 * changed later. Password accounts confirm the password if it isn't known. Accounts that already have a
 * username (made before genders existed) only choose the gender.
 */
export function UsernameForm({ account, password, onComplete, onSignOut }: { account: Account; password: string | null; onComplete: (account: Account) => void; onSignOut: () => void }) {
  const [username, setUsername] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsName = !account.username;
  const askPassword = needsName && account.usesPassword && !password;
  // Signed up with Google: a password too (so the username and password sign in as well), typed twice.
  const newPassword = needsName && !account.usesPassword && !!account.email;
  const [pw1, setPw1] = useState(""), [pw2, setPw2] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = needsName ? usernameSchema.safeParse(username) : { success: true as const, data: account.username! };
    if (!parsed.success) { setMessage("Use 3–24 letters, numbers, or underscores."); return; }
    if (!gender) { setMessage("Choose Female or Male."); return; }
    if (newPassword && pw1.length < MIN_PASSWORD) { setMessage(`Use a password of at least ${MIN_PASSWORD} characters.`); return; }
    if (newPassword && pw1 !== pw2) { setMessage("The passwords don't match."); return; }
    setBusy(true); setMessage(null);
    try {
      const acc = newPassword ? await addPassword(account, pw1) : account;
      onComplete(await claimUsername(acc, parsed.data, gender, newPassword ? pw1 : password ?? confirm));
    } catch (error) {
      setMessage(error instanceof AccountError ? error.message : "Could not reserve your username. Please try again.");
    } finally { setBusy(false); }
  }

  useTitleBetweenObeliskAndForm();
  return <div className="auth-bg auth-page flex items-center justify-center px-4">
    <div className="auth-split w-full max-w-sm">
      <div className="auth-titles">
        <h1 className="font-display text-center text-4xl text-foreground">{needsName ? "Choose your username" : "Choose your character"}</h1>
      </div>
      <form onSubmit={submit} className="auth-box hud-panel mt-6 space-y-4 p-6">
        {needsName && <>
          <label className="block text-sm text-foreground" htmlFor="player-username">Username</label>
          <input id="player-username" className="auth-input" autoComplete="username" autoFocus required minLength={3} maxLength={24} value={username} onChange={(e) => setUsername(e.target.value)} />
          <p className="text-xs text-muted-foreground">3–24 letters, numbers, or underscores. You'll sign in with it.</p>
        </>}
        <div className="flex overflow-hidden rounded-md border border-input" role="radiogroup" aria-label="Gender">
          {GENDERS.map(({ value, label, symbol }, i) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={gender === value}
              onClick={() => { setGender(value); setMessage(null); }}
              className={`flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${i === 0 ? "border-r border-input" : ""} ${gender === value ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent/10"}`}
            >
              {i === 0 && <span aria-hidden className="text-2xl leading-none" style={{ color: BODY_COLORS[value] }}>{symbol}</span>}
              {label}
              {i === 1 && <span aria-hidden className="text-2xl leading-none" style={{ color: BODY_COLORS[value] }}>{symbol}</span>}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{needsName ? "Your username and gender can't be changed later." : "This can't be changed later."}</p>
        {newPassword && <>
          <input aria-label="Password" className="auth-input" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} placeholder={`Create a password (${MIN_PASSWORD}+ characters)`} value={pw1} onChange={(e) => { setPw1(e.target.value); setMessage(null); }} />
          <input aria-label="Confirm password" className="auth-input" type="password" autoComplete="new-password" required placeholder="Confirm the password" value={pw2} onChange={(e) => { setPw2(e.target.value); setMessage(null); }} />
          <p className="text-xs text-muted-foreground">{pw2 && pw1 !== pw2 ? "The passwords don't match." : "Sign in later with your username (or email) and this password, or with Google."}</p>
        </>}
        {askPassword && <input aria-label="Password" className="auth-input" type="password" autoComplete="current-password" required placeholder="Confirm your password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        <Button disabled={busy || (newPassword && (pw1.length < MIN_PASSWORD || pw1 !== pw2))} className="w-full">{busy ? "…" : "Continue"}</Button>
        {message && <p className="text-center text-sm text-accent">{message}</p>}
        <button type="button" onClick={onSignOut} className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline">Sign out</button>
      </form>
    </div>
  </div>;
}
