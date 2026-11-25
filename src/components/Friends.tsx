import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useBack } from "@/lib/useBack";
import { createPortal } from "react-dom";
import { Check, ChevronDown, MessageCircle, Plus, User, UserPlus, X } from "lucide-react";
import { Chat } from "@/components/Chat";
import { watchUnread } from "@/platform/chat";
import { appKind, keyboardNavExtra } from "@/lib/appKind";
import { Button } from "@/components/ui/button";
import type { Account } from "@/platform/account";
import { LiveName } from "@/platform/liveNames";
import { Avatar } from "@/components/Avatar";
import { acceptRequest, cancelRequest, discardInvite, discardRequest, findPlayer, inviteToRoom, removeFriend, sendRequest, watchFriends, type Friend, type FriendRequest, type RoomInvite } from "@/platform/friends";
// (Open the site with ?kbdebug=1 to see, in a chat on a phone, what the browser says about its screen and keyboard.)
const kbDebug = (() => { try { if (new URLSearchParams(location.search).has("kbdebug")) sessionStorage.setItem("kbdebug", "1"); return sessionStorage.getItem("kbdebug") === "1"; } catch { return false; } })();

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
  // The phone's back button: out of a chat (and the friends list) straight back to the menu.
  useBack(chatting !== null, () => { setChatting(null); setOpen(false); });
  const { friends, requests, sent } = data;
  const chatFriend = chatting ? friends.find((f) => f.uid === chatting) ?? null : null;
  // Clicking a message card in the Windows app opens that chat.
  useEffect(() => {
    const open = (e: Event) => { const uid = (e as CustomEvent<string>).detail; if (friends.some((f) => f.uid === uid)) { setChatting(uid); setOpen(true); } };
    window.addEventListener("bellmont-open-chat", open);
    return () => window.removeEventListener("bellmont-open-chat", open);
  }, [friends]);
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
        {open && chatFriend && <ChatPopup><Chat account={account} friend={chatFriend} friends={friends} onBack={() => setChatting(null)} /></ChatPopup>}
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
            <ChatButton account={account} friend={f} onOpen={() => setChatting(f.uid)} />
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

/** A phone: the chat takes the whole screen there. */
const phoneScreen = () => typeof window !== "undefined" && matchMedia("(pointer: coarse)").matches && Math.min(window.innerWidth, window.innerHeight) < 700;

/**
 * Where an open chat shows. On a phone: the whole screen (over everything), its text box and send button at the
 * bottom — kept above the keyboard when it's up (the visible part of the screen is followed). On a computer: under
 * the Friends button, as tall as fits — never past the bottom of the window.
 */
function ChatPopup({ children }: { children: React.ReactNode }) {
  const [phone] = useState(phoneScreen);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The keyboard's height, where the browser says (Chrome on Android: the app runs full screen, and there the page
    // isn't shrunk when the keyboard comes up — so it's measured and the chat sits right on top of it).
    // While a chat is open on a phone, the page covers the whole screen — the camera cutout's strip too — so the page,
    // the keyboard and the screen all measure from the same top edge (the chat's header keeps clear of the camera).
    const meta = phone ? document.querySelector<HTMLMetaElement>('meta[name="viewport"]') : null;
    const metaBefore = meta?.content ?? "";
    if (meta && !/viewport-fit=cover/.test(metaBefore)) meta.content = `${metaBefore}, viewport-fit=cover`;
    type VK = EventTarget & { overlaysContent: boolean; boundingRect: DOMRect };
    // (Only in the full-screen Android app: an ordinary browser shrinks its visible area for the keyboard itself, and
    // there the keyboard's reported height also counts the browser's own bottom bar it covers — too much.)
    // The app is full screen only in a game now (and in older installs everywhere): there the page fills the screen
    // and isn't shrunk for the keyboard, so the keyboard is measured; with the phone's bars showing, it works like a
    // browser.
    const fullScreen = appKind() === "android" && window.innerHeight >= screen.height - 4;
    // Brave with its toolbar along the bottom: it hides that bar under the keyboard yet still counts it, so it thinks
    // the box is under the keyboard and keeps scrolling the page while you type. There the page handles the keyboard
    // itself too (nothing scrolls), with the toolbar's height given back (48 px on two phones, +13 tuned by eye).
    const vkApi = phone ? (navigator as Navigator & { virtualKeyboard?: VK }).virtualKeyboard : undefined;
    el.classList.toggle("in-app", fullScreen);
    const before = vkApi?.overlaysContent;
    // (Looked at again whenever nothing is being typed in — the phone may have turned: Brave shows its bottom toolbar
    // only upright, so on its side it's an ordinary browser.)
    let braveBar = false, swipeBrowser = false, sideways = false, sideButtons = false, vk: VK | undefined;
    const browserKind = () => {
      const bars = window.outerHeight - window.innerHeight;
      braveBar = phone && !fullScreen && "brave" in navigator && bars >= 140 && window.innerHeight > window.innerWidth;
      // A browser (not the app) on a phone with the swipe line rather than buttons: the browser's bars around the page
      // add up to little (status + address bar + the thin line, under ~125 px; the buttons' bar makes it more), and
      // there the keyboard's top sits a few pixels higher than the browser says.
      swipeBrowser = phone && appKind() !== "android" && !braveBar && bars < 125 && window.innerHeight > window.innerWidth;
      // A browser on its side: the page reads where the keyboard is itself (the keyboard's own top edge, and its
      // height), and takes the highest of what it's told — the box always shows above the keyboard.
      sideways = phone && !fullScreen && appKind() !== "android" && window.innerWidth > window.innerHeight;
      vk = fullScreen || braveBar || sideways ? vkApi : undefined;
      // (On its side, a phone with back · home · recents has them along a side edge — the browser's window is narrower
      // than the screen; with the swipe line the window spans the screen. By eye: 10 px lower / 10 px higher.)
      sideButtons = sideways && screen.width - window.outerWidth > 16;
      if (vkApi) vkApi.overlaysContent = !!vk;
    };
    browserKind();
    let baseH = window.innerHeight;
    const fit = () => {
      if (phone) {
        // Where the free screen ends: the keyboard's top edge (not just its height — in the full-screen app the page
        // runs on under the system's bar below the keyboard), or the visible part of the screen, whichever is
        // higher; the chat ends a little above it.
        const vv = window.visualViewport, H = window.innerHeight;
        // (The height without a keyboard, again whenever nothing is being typed in — the phone may have turned.)
        if (!(document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement)) { baseH = H; browserKind(); }
        let bottom: number, kbUp: boolean, lift = 0;
        if (vk && sideways) {
          const r = vk.boundingRect;
          kbUp = !!r && r.height > 40;
          const reads = [H];
          if (kbUp) {
            reads.push(H - r.height);
            if (r.y > H * 0.1 && r.y < H) reads.push(r.y);
          }
          if (vv && vv.height < H - 40) reads.push(vv.offsetTop + vv.height);
          bottom = Math.min(...reads);
          kbUp = kbUp || H - bottom > 40;
        } else if (vk && braveBar) {
          const r = vk.boundingRect;
          kbUp = !!r && r.height > 80;
          if (kbUp) lift = 61;
          bottom = kbUp ? H - r.height + lift : H;
          // (Never lower than where the browser itself says the visible part ends, plus that toolbar.)
          if (kbUp && vv && vv.height < H - 80) bottom = Math.min(bottom, vv.offsetTop + vv.height + lift);
        } else if (vk) {
          // The full-screen app. Each way of finding the keyboard's top edge is wrong on some phones (too low or far
          // too high): of the readings that say a keyboard is up, the lowest one is used.
          const r = vk.boundingRect;
          const reads = [vv ? vv.offsetTop + vv.height : H];
          if (r && r.height > 0) { const h = r.height + keyboardNavExtra(); reads.push(r.y > 0 ? r.y - keyboardNavExtra() : H - h, H - h); }
          const up = reads.filter((b) => b < H - 80 && b > H * 0.3);
          bottom = up.length ? Math.max(...up) : H;
          kbUp = H - bottom > 80;
        } else {
          // A browser: the part of the page it says is visible (it may also scroll the page up to show the box, so
          // "keyboard up" is the visible part being much shorter than before, not where it ends).
          const vh = vv?.height ?? H;
          bottom = (vv?.offsetTop ?? 0) + vh;
          kbUp = baseH - vh > 80;
        }
        const dbg = el.querySelector<HTMLElement>(".kb-debug");
        if (dbg) { const r = vkApi?.boundingRect; dbg.textContent = `H${Math.round(H)} W${window.innerWidth} b${baseH} vv${Math.round(vv?.height ?? -1)}+${Math.round(vv?.offsetTop ?? -1)} o${window.outerWidth}x${window.outerHeight} s${screen.width}x${screen.height} kb${r ? `${Math.round(r.y)}/${Math.round(r.height)}` : "-"} side${sideways ? 1 : 0}${sideButtons ? "B" : ""} br${braveBar ? 1 : 0} end${Math.round(bottom)} up${kbUp ? 1 : 0}`; }
        const top = vk ? 0 : vv?.offsetTop ?? 0;
        el.style.top = `${top}px`;
        // (A phone on its side leaves only a strip above the keyboard: the chat shrinks to it — no minimum height that would
        // push the box under the keyboard — and in a very short strip the header steps aside for the messages and box.)
        const h = Math.max(72, bottom - top - (kbUp ? (sideways ? (sideButtons ? -16 : 14) : vk && !braveBar ? 14 : braveBar ? 11 : swipeBrowser ? 12 : 0) : 0));
        el.style.height = `${h}px`;
        el.classList.toggle("kb-tight", kbUp && h < 240);
        el.classList.toggle("kb-up", kbUp);
        return;
      }
      el.style.height = "";
      const top = el.getBoundingClientRect().top;
      // (The page's layout may be scaled down to fit: heights are set in its own units.)
      const scale = el.getBoundingClientRect().height / Math.max(1, el.offsetHeight) || 1;
      el.style.height = `${Math.max(220, Math.min(448, (window.innerHeight - top - 12) / scale))}px`;
    };
    fit();
    // (Some phones report the keyboard a moment after the text box is tapped: looked at again shortly after.)
    const later = () => { for (const ms of [80, 250, 500]) window.setTimeout(fit, ms); };
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("scroll", fit);
    vk?.addEventListener("geometrychange", fit);
    el.addEventListener("focusin", later); el.addEventListener("focusout", later);
    return () => {
      window.removeEventListener("resize", fit); window.visualViewport?.removeEventListener("resize", fit); window.visualViewport?.removeEventListener("scroll", fit);
      vk?.removeEventListener("geometrychange", fit);
      el.removeEventListener("focusin", later); el.removeEventListener("focusout", later);
      if (vkApi && before !== undefined) vkApi.overlaysContent = before;
      if (meta) meta.content = metaBefore;
    };
  }, [phone]);
  if (phone) return createPortal(<div ref={ref} className="chat-full">{kbDebug && <span className="kb-debug" aria-hidden />}{children}</div>, document.body);
  return <div ref={ref} className="friends-popup chat-popup">{children}</div>;
}

/** A friend row's message icon, with a yellow count of the messages from them not seen yet (gone once opened). */
function ChatButton({ account, friend, onOpen }: { account: Account; friend: Friend; onOpen: () => void }) {
  const [unread, setUnread] = useState(0);
  useEffect(() => watchUnread(account, friend.uid, setUnread), [account, friend.uid]);
  return <button type="button" className="chat-open" aria-label={`Message ${friend.name}`} onClick={onOpen}>
    <MessageCircle size={18} strokeWidth={2.3} aria-hidden />
    {unread > 0 && <span className="chat-badge" aria-label={`${unread} new`}>{unread > 99 ? "99+" : unread}</span>}
  </button>;
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
