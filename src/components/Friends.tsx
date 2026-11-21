import { useEffect, useState, type FormEvent } from "react";
import { Check, ChevronDown, MessageCircle, Plus, User, UserPlus, X } from "lucide-react";
import { Chat } from "@/components/Chat";
import { Button } from "@/components/ui/button";
import type { Account } from "@/platform/account";
import { LiveName } from "@/platform/liveNames";
import { Avatar } from "@/components/Avatar";
import { acceptRequest, cancelRequest, discardInvite, discardRequest, findPlayer, inviteToRoom, removeFriend, sendRequest, watchFriends, type Friend, type FriendRequest, type RoomInvite } from "@/platform/friends";

/** This player's friends, requests and invitations, kept up to date. */
export function useFriends(account: Account | null) {
  const [v, setV] = useState<{ friends: Friend[]; requests: FriendRequest[]; invites: RoomInvite[]; sent: FriendRequest[] }>({ friends: [], requests: [], invites: [], sent: [] });
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
  const [unadding, setUnadding] = useState<string | null>(null);
  /** The friend whose chat is open in the list's place (or null). */
  const [chatting, setChatting] = useState<string | null>(null);
  const { friends, requests, sent } = data;
  const chatFriend = chatting ? friends.find((f) => f.uid === chatting) ?? null : null;
  // A message notification's link (?chat=<uid>) opens that chat.
  useEffect(() => {
    const want = new URLSearchParams(location.search).get("chat");
    if (!want || !friends.some((f) => f.uid === want)) return;
    setChatting(want); setOpen(true);
    const u = new URL(location.href); u.searchParams.delete("chat"); history.replaceState(history.state, "", u);
  }, [friends]);

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
      {/* The list drops down from the Friends button over the page (nothing below moves), as one box with it. */}
      <div className={`friends-drop ${open ? "open" : ""}`}>
        <Button type="button" variant={open ? "secondary" : "outline"} className="friends-toggle w-full justify-between" aria-expanded={open} onClick={() => { setOpen((v) => !v); setUnadding(null); setChatting(null); }}>
          <span>Friends{requests.length ? <span className="friends-badge">{requests.length}</span> : null}</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </Button>
        {open && chatFriend && <div className="friends-popup chat-popup"><Chat account={account} friend={chatFriend} onBack={() => setChatting(null)} /></div>}
        {open && !chatFriend && <ul className="friends-list friends-popup">
          {requests.map((r) => <li key={`r${r.uid}`} className="friends-row request">
            <Avatar uid={r.uid} photo={r.photo} name={r.name} />
            <span><b><LiveName uid={r.uid} fallback={r.name} /></b><small>wants to be friends</small></span>
            <button type="button" className="ok" aria-label={`Accept ${r.name}`} onClick={() => void acceptRequest(account, r).catch(() => setMsg("Could not accept. Please try again."))}><Check size={15} /></button>
            <button type="button" aria-label={`Discard ${r.name}'s request`} onClick={() => void discardRequest(account, r.uid).catch(() => {})}><X size={15} /></button>
          </li>)}
          {friends.map((f) => <li key={f.uid} className="friends-row">
            <Avatar uid={f.uid} photo={f.photo} name={f.name} />
            <span><b><LiveName uid={f.uid} fallback={f.name} /></b></span>
            <button type="button" className="chat-open" aria-label={`Message ${f.name}`} onClick={() => setChatting(f.uid)}><MessageCircle size={18} strokeWidth={2.3} aria-hidden /></button>
          </li>)}
          {sent.map((r) => <li key={`s${r.uid}`} className="friends-row">
            <Avatar uid={r.uid} photo={r.photo} name={r.name} />
            <span><b><LiveName uid={r.uid} fallback={r.name} /></b><small>request sent</small></span>
            <button type="button" aria-label={`Take back the request to ${r.name}`} onClick={() => void cancelRequest(account, r.uid).catch(() => {})}><X size={15} /></button>
          </li>)}
          {!friends.length && !requests.length && !sent.length && <li className="friends-empty">No friends yet.</li>}
        </ul>}
      </div>
      <Button type="button" variant={adding ? "secondary" : "outline"} size="icon" aria-label="Add a friend" aria-expanded={adding} onClick={() => { setAdding((v) => !v); setOpen(false); setMsg(null); }}><span className="add-friend-icon" aria-hidden><User /><Plus className="plus" strokeWidth={3.2} /></span></Button>
    </div>
    {adding && <form data-extra onSubmit={add} className="mt-2 flex items-stretch gap-2">
      <input aria-label="Username or email" className="auth-input flex-1 lowercase placeholder:normal-case" autoFocus autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Username or email" value={query} onChange={(e) => setQuery(e.target.value.toLowerCase())} />
      <Button type="submit" disabled={busy} aria-label="Send friend request" className="h-auto self-stretch px-3"><UserPlus aria-hidden /></Button>
    </form>}
    {msg && <p data-extra className="mt-1 text-center text-xs text-accent">{msg}</p>}
  </div>;
}

/** What you can do about another player (in a room's people list): add them, accept or discard their request, take
 * back yours, or unadd them (asking first). */
export function FriendActions({ account, uid, name, data }: { account: Account; uid: string; name: string; data: ReturnType<typeof useFriends> }) {
  const [sure, setSure] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const friend = data.friends.some((f) => f.uid === uid), theirs = data.requests.find((r) => r.uid === uid), mine = data.sent.some((r) => r.uid === uid);
  const fail = () => setNote("Something went wrong. Please try again.");
  return <div className="friend-actions">
    {friend ? (sure ? <>
      <span>Are you sure?</span>
      <button type="button" className="pill grey" onClick={() => setSure(false)}>No</button>
      <button type="button" className="pill red" onClick={() => { setSure(false); void removeFriend(account, uid).catch(fail); }}>Yes</button>
    </> : <><span>Friends</span><button type="button" className="pill red" onClick={() => setSure(true)}>Unadd</button></>)
      : theirs ? <>
        <span>Wants to be friends</span>
        <button type="button" className="pill ok" onClick={() => void acceptRequest(account, theirs).catch(fail)}>Add</button>
        <button type="button" className="pill grey" onClick={() => void discardRequest(account, uid).catch(fail)}>Discard</button>
      </> : mine ? <>
        <span>Request sent</span>
        <button type="button" className="pill grey" onClick={() => void cancelRequest(account, uid).catch(fail)}>Cancel</button>
      </> : <button type="button" className="pill ok" onClick={() => void sendRequest(account, uid).then(() => setNote(`Request sent to ${name}.`)).catch(fail)}>Add friend</button>}
    {note && <small>{note}</small>}
  </div>;
}

/** Invitations to rooms (under "Join a room"): the room's code, who sent it, Join, and ✕ to discard it. */
export function RoomInvites({ account, invites, onJoin }: { account: Account; invites: RoomInvite[]; onJoin: (code: string) => void }) {
  if (!invites.length) return null;
  return <ul className="friends-list invites">
    {invites.map((i) => <li key={i.code} className="friends-row">
      <Avatar uid={i.from} photo={i.photo} name={i.name} />
      <span><b>Room {i.code}</b><small>from <LiveName uid={i.from} fallback={i.name} /></small></span>
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
      <span className="flex min-w-0 items-center gap-2"><Avatar uid={f.uid} photo={f.photo} name={f.name} size={24} /><LiveName uid={f.uid} fallback={f.name} className="truncate" /></span>
      <button type="button" disabled={sent.has(f.uid)} className="rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-60"
        onClick={() => void inviteToRoom(account, f.uid, code).then(() => setSent((s) => new Set(s).add(f.uid))).catch(() => {})}>{sent.has(f.uid) ? "Invited" : "Invite"}</button>
    </li>)}
  </ul>;
}
