import { useEffect, useState, type FormEvent } from "react";
import { Check, ChevronDown, Plus, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Account } from "@/platform/account";
import { acceptRequest, discardInvite, discardRequest, findPlayer, inviteToRoom, removeFriend, sendRequest, watchFriends, type Friend, type FriendRequest, type RoomInvite } from "@/platform/friends";

/** This player's friends, requests and invitations, kept up to date. */
export function useFriends(account: Account | null) {
  const [v, setV] = useState<{ friends: Friend[]; requests: FriendRequest[]; invites: RoomInvite[] }>({ friends: [], requests: [], invites: [] });
  useEffect(() => (account ? watchFriends(account, setV) : undefined), [account]);
  return v;
}

/** The Friends button: drops a list — requests at the top (✓ to accept, ✕ to discard), then friends (or "No friends
 * yet"); + opens a box to find someone by username or email and ask them. */
export function FriendsMenu({ account, data }: { account: Account; data: ReturnType<typeof useFriends> }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { friends, requests } = data;

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const who = await findPlayer(query);
      if (!who) setMsg("No player with that username or email.");
      else if (who.uid === account.id) setMsg("That's you.");
      else if (friends.some((f) => f.uid === who.uid)) setMsg(`${who.name} is already your friend.`);
      else {
        // (They already asked you: that's a yes.)
        const theirs = requests.find((r) => r.uid === who.uid);
        if (theirs) { await acceptRequest(account, theirs); setMsg(`You and ${who.name} are friends now.`); }
        else { await sendRequest(account, who.uid); setMsg(`Friend request sent to ${who.name}.`); }
        setQuery("");
      }
    } catch { setMsg("Could not send the request. Please try again."); }
    setBusy(false);
  }

  return <div className="friends">
    <div className="flex gap-2">
      <Button type="button" variant={open ? "secondary" : "outline"} className="flex-1 justify-between" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>Friends{requests.length ? <span className="friends-badge">{requests.length}</span> : null}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </Button>
      <Button type="button" variant={adding ? "secondary" : "outline"} size="icon" aria-label="Add a friend" aria-expanded={adding} onClick={() => { setAdding((v) => !v); setOpen(true); setMsg(null); }}><Plus aria-hidden /></Button>
    </div>
    {adding && <form onSubmit={add} className="mt-2 flex items-stretch gap-2">
      <input aria-label="Username or email" className="auth-input flex-1" autoFocus autoComplete="off" spellCheck={false} placeholder="Username or email" value={query} onChange={(e) => setQuery(e.target.value)} />
      <Button type="submit" disabled={busy} aria-label="Send friend request" className="h-auto self-stretch px-3"><UserPlus aria-hidden /></Button>
    </form>}
    {msg && <p className="mt-1 text-center text-xs text-accent">{msg}</p>}
    {open && <ul className="friends-list">
      {requests.map((r) => <li key={`r${r.uid}`} className="friends-row request">
        <span><b>{r.name}</b><small>wants to be friends</small></span>
        <button type="button" className="ok" aria-label={`Accept ${r.name}`} onClick={() => void acceptRequest(account, r).catch(() => setMsg("Could not accept. Please try again."))}><Check size={15} /></button>
        <button type="button" aria-label={`Discard ${r.name}'s request`} onClick={() => void discardRequest(account, r.uid).catch(() => {})}><X size={15} /></button>
      </li>)}
      {friends.map((f) => <li key={f.uid} className="friends-row">
        <span><b>{f.name}</b></span>
        <button type="button" aria-label={`Remove ${f.name}`} title="Remove friend" onClick={() => { if (window.confirm(`Remove ${f.name} from your friends?`)) void removeFriend(account, f.uid).catch(() => {}); }}><X size={15} /></button>
      </li>)}
      {!friends.length && !requests.length && <li className="friends-empty">No friends yet.</li>}
    </ul>}
  </div>;
}

/** Invitations to rooms (under "Join a room"): the room's code, who sent it, Join, and ✕ to discard it. */
export function RoomInvites({ account, invites, onJoin }: { account: Account; invites: RoomInvite[]; onJoin: (code: string) => void }) {
  if (!invites.length) return null;
  return <ul className="friends-list invites">
    {invites.map((i) => <li key={i.code} className="friends-row">
      <span><b>Room {i.code}</b><small>from {i.name}</small></span>
      <button type="button" className="ok join" onClick={() => { void discardInvite(account, i.code).catch(() => {}); onJoin(i.code); }}>Join</button>
      <button type="button" aria-label={`Discard the invitation to room ${i.code}`} onClick={() => void discardInvite(account, i.code).catch(() => {})}><X size={15} /></button>
    </li>)}
  </ul>;
}

/** In a room's share menu: friends to invite (each once). */
export function InviteFriends({ account, code }: { account: Account; code: string }) {
  const { friends } = useFriends(account);
  const [sent, setSent] = useState<Set<string>>(new Set());
  if (!friends.length) return <p className="px-3 py-2 text-xs text-muted-foreground">No friends yet. Add them from the menu (Friends +).</p>;
  return <ul className="max-h-56 overflow-y-auto">
    {friends.map((f) => <li key={f.uid} className="flex items-center justify-between gap-2 px-3 py-1.5 text-foreground">
      <span className="truncate">{f.name}</span>
      <button type="button" disabled={sent.has(f.uid)} className="rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-60"
        onClick={() => void inviteToRoom(account, f.uid, code).then(() => setSent((s) => new Set(s).add(f.uid))).catch(() => {})}>{sent.has(f.uid) ? "Invited" : "Invite"}</button>
    </li>)}
  </ul>;
}
