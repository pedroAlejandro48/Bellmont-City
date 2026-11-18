import { usePullToRefresh } from "@/lib/pullRefresh";
import { useTitleBetweenObeliskAndForm } from "@/lib/fitTitle";
import { QualityPicker } from "@/components/QualityPicker";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { normalizeRoomCode } from "@/platform/rooms";
import type { RoomRequest } from "@/multiplayer/RoomGame";
import { AccountError, MIN_PASSWORD, addPassword, type Account } from "@/platform/account";
import { publishEmail } from "@/platform/friends";
import { useEffect } from "react";
import { FriendsMenu, RoomInvites, useFriends } from "@/components/Friends";
import { PushPrompt } from "@/components/PushPrompt";

/** After signing in: your own city, or a shared room (new, or joined by its code). */
export function MainMenu({ account, username, message, onCity, onRoom, onSignOut, onAccount }: { account: Account; username: string | null; message?: string | undefined; onCity: () => void; onRoom: (request: RoomRequest) => void; onSignOut: () => void; onAccount: (a: Account) => void }) {
  const [joining, setJoining] = useState(false);
  const friends = useFriends(account);
  useEffect(() => { publishEmail(account); }, [account]);
  // A Google account without a password: one can be added (then the username and password sign in too).
  const [pwOpen, setPwOpen] = useState(false), [pw1, setPw1] = useState(""), [pw2, setPw2] = useState(""), [pwBusy, setPwBusy] = useState(false);
  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (pw1.length < MIN_PASSWORD) { setMsg(`Use a password of at least ${MIN_PASSWORD} characters.`); return; }
    if (pw1 !== pw2) { setMsg("The passwords don't match."); return; }
    setPwBusy(true);
    try { onAccount(await addPassword(account, pw1)); setPwOpen(false); setMsg("Password added. You can now sign in with your username and password."); }
    catch (error) { setMsg(error instanceof AccountError ? error.message : "Could not add the password. Please try again."); }
    setPwBusy(false);
  }
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  function join(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (!normalized) { setMsg("Room codes are 6 letters and numbers."); return; }
    onRoom({ mode: "join", code: normalized });
  }

  useTitleBetweenObeliskAndForm();
  usePullToRefresh();
  return (
    <div className="auth-bg auth-page flex items-center justify-center px-4">
      <QualityPicker />
      <PushPrompt account={account} />
      <div className="auth-split w-full max-w-sm">
        <div className="auth-titles">
          <h1 className="font-display text-center text-5xl tracking-tight text-foreground">Bellmont city</h1>
          <p className="mt-2 text-center text-sm text-muted-foreground">{username ? <>Welcome back, <span className="text-foreground">{username}</span>.</> : "Twenty minutes of sun. Twenty minutes of moon. Real life in a game."}</p>
        </div>
        <div className="auth-box hud-panel mt-8 space-y-4 p-6">
          <Button type="button" className="w-full" onClick={onCity}>Go to my city</Button>
          <div className="flex overflow-hidden rounded-md border border-input">
            <Button type="button" variant="outline" className="flex-1 rounded-none border-0 border-r border-input" onClick={() => onRoom({ mode: "create" })}>Create a room</Button>
            <Button type="button" variant={joining ? "secondary" : "outline"} className="flex-1 rounded-none border-0" aria-expanded={joining} onClick={() => { setJoining((v) => !v); setMsg(null); }}>Join a room{friends.invites.length ? <span className="friends-badge">{friends.invites.length}</span> : null}</Button>
          </div>
          {joining && <form onSubmit={join} className="flex gap-2">
            <input aria-label="Room code" className="auth-input flex-1 uppercase placeholder:normal-case" autoFocus autoComplete="off" spellCheck={false} maxLength={6} placeholder="Enter the room code" value={code} onChange={(e) => setCode(e.target.value)} />
            <Button type="submit">Join</Button>
          </form>}
          {joining && <RoomInvites account={account} invites={friends.invites} onJoin={(c) => onRoom({ mode: "join", code: c })} />}
          <FriendsMenu account={account} data={friends} />
          {!account.usesPassword && account.email && (pwOpen ? <form onSubmit={savePassword} className="space-y-2">
            <input aria-label="New password" className="auth-input" type="password" autoComplete="new-password" placeholder={`Create a password (${MIN_PASSWORD}+ characters)`} value={pw1} onChange={(e) => { setPw1(e.target.value); setMsg(null); }} />
            <input aria-label="Confirm password" className="auth-input" type="password" autoComplete="new-password" placeholder="Confirm the password" value={pw2} onChange={(e) => { setPw2(e.target.value); setMsg(null); }} />
            <Button type="submit" className="w-full" disabled={pwBusy || pw1.length < MIN_PASSWORD || pw1 !== pw2}>{pwBusy ? "…" : pw2 && pw1 !== pw2 ? "Passwords don't match" : "Save password"}</Button>
          </form> : <button type="button" onClick={() => { setPwOpen(true); setMsg(null); }} className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline">Add a password (sign in with your username)</button>)}
          {(msg ?? message) && <p className="text-center text-sm text-accent">{msg ?? message}</p>}
          <button type="button" onClick={onSignOut} className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline">Sign out</button>
        </div>
      </div>
    </div>
  );
}
