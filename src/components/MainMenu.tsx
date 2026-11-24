import { ChevronDown } from "lucide-react";
import { usePullToRefresh } from "@/lib/pullRefresh";
import { useTitleBetweenObeliskAndForm } from "@/lib/fitTitle";
import { QualityPicker } from "@/components/QualityPicker";
import { SavedRooms } from "@/components/SavedRooms";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { normalizeRoomCode } from "@/platform/rooms";
import type { RoomRequest } from "@/multiplayer/RoomGame";
import { AccountError, MIN_PASSWORD, addPassword, type Account } from "@/platform/account";
import { publishEmail } from "@/platform/friends";
import { useEffect, useLayoutEffect, useRef } from "react";
import { FriendsMenu, RoomInvites, useFriends } from "@/components/Friends";
import { PushPrompt } from "@/components/PushPrompt";
import { AvatarPicker } from "@/components/Avatar";
import { AccountMenu } from "@/components/AccountMenu";
import { chooseAvatar } from "@/platform/account";

/** After signing in: your own city, or a shared room (new, or joined by its code). */
export function MainMenu({ account, username, message, onCity, onRoom, onSignOut, onAccount }: { account: Account; username: string | null; message?: string | undefined; onCity: () => void; onRoom: (request: RoomRequest) => void; onSignOut: () => void; onAccount: (a: Account) => void }) {
  const [joining, setJoining] = useState(false);
  const friends = useFriends(account);
  // Without any picture: choose one of the game's ten (asked once; it can be changed from Profile).
  const [picking, setPicking] = useState(!account.photo);
  const pick = (url: string) => { void chooseAvatar(account, url).then((a) => { onAccount(a); setPicking(false); }).catch(() => setMsg("Could not save your picture. Please try again.")); };
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

  // The box keeps its place (and the title theirs) whatever opens in it: its slot is as tall as the box without
  // anything opened or shown in it (data-extra); what opens pushes only what's below it further down.
  const boxRef = useRef<HTMLDivElement>(null), [slotH, setSlotH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      // (Exact sizes, not whole pixels; the page may be shrunk to fit the screen: undone.)
      const m = /scale\(([\d.]+)\)/.exec(box.closest<HTMLElement>(".auth-split")?.style.transform ?? ""), k = m ? Number(m[1]) : 1;
      const h = (el: HTMLElement) => el.getBoundingClientRect().height / k;
      let extra = 0;
      // (An empty one takes no room: its margins collapse away, so it isn't counted.)
      box.querySelectorAll<HTMLElement>("[data-extra]").forEach((el) => { if (h(el) < 0.5) return; const cs = getComputedStyle(el); extra += h(el) + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom); });
      setSlotH(h(box) + parseFloat(getComputedStyle(box).marginTop) - extra);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);
  // (On a phone the keyboard doesn't pop up by itself: the code box is tapped first.)
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  // Lists that drop down (Friends, Join a room): as tall as they need, but never past the screen's bottom (a few
  // pixels above it) — longer ones scroll inside; the page itself never scrolls.
  useEffect(() => {
    const fitAll = () => document.querySelectorAll<HTMLElement>(".friends-popup:not(.chat-popup)").forEach((el) => {
      const top = el.getBoundingClientRect().top, vh = window.visualViewport?.height ?? window.innerHeight;
      el.style.maxHeight = `${Math.max(96, vh - top - 8)}px`;
    });
    fitAll();
    const mo = new MutationObserver(fitAll);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", fitAll);
    window.visualViewport?.addEventListener("resize", fitAll);
    return () => { mo.disconnect(); window.removeEventListener("resize", fitAll); window.visualViewport?.removeEventListener("resize", fitAll); };
  }, []);
  useTitleBetweenObeliskAndForm();
  usePullToRefresh();
  return (
    <div className="auth-bg auth-page menu-page flex items-center justify-center px-4">
      <QualityPicker />
      <PushPrompt account={account} />
      <AccountMenu account={account} friends={friends} onAccount={onAccount} onSignOut={onSignOut} />
      {picking && <AvatarPicker current={account.photo} google={account.google} onPick={pick} onClose={account.photo ? () => setPicking(false) : undefined} />}
      <div className="auth-split w-full max-w-sm">
        <div className="auth-titles">
          <h1 className="font-display text-center text-5xl tracking-tight text-foreground">Bellmont city</h1>
          <p className="mt-2 text-center text-sm text-muted-foreground">{username ? <>Welcome back, <span className="text-foreground" data-no-translate>{username}</span>.</> : "Real life in a game."}</p>
        </div>
        <div className="auth-box-slot" style={slotH ? { height: slotH } : undefined}>
        <div ref={boxRef} className="auth-box hud-panel mt-8 space-y-4 p-6">
          <Button type="button" className="w-full" onClick={onCity}>Go to my city</Button>
          <div className="relative">
          <div className={`flex overflow-hidden border border-input ${joining ? "rounded-t-md" : "rounded-md"}`}>
            <Button type="button" variant="outline" className="flex-1 rounded-none border-0 border-r border-input" onClick={() => onRoom({ mode: "create" })}>Create a room</Button>
            <Button type="button" variant={joining ? "secondary" : "outline"} className="flex-1 rounded-none border-0" aria-expanded={joining} onClick={() => { setJoining((v) => !v); setMsg(null); }}><span>Join a room{friends.invites.length ? <span className="friends-badge">{friends.invites.length}</span> : null}</span><ChevronDown className={`ml-1.5 h-4 w-4 shrink-0 transition-transform ${joining ? "rotate-180" : ""}`} aria-hidden /></Button>
          </div>
          {/* Join a room: a list that drops down over what's below, like Friends — the code, your rooms, invitations. */}
          {joining && <div className="friends-popup join-popup">
            <form onSubmit={join} className="flex gap-2">
              <input aria-label="Room code" className="auth-input flex-1 uppercase placeholder:normal-case" autoFocus={!coarse} autoComplete="off" spellCheck={false} maxLength={6} placeholder="Enter the room code" value={code} onChange={(e) => setCode(e.target.value)} />
              <Button type="submit" className="h-auto self-stretch">Join</Button>
            </form>
            <SavedRooms account={account} onJoin={(c) => onRoom({ mode: "join", code: c })} />
            {friends.invites.length > 0 && <RoomInvites account={account} invites={friends.invites} onJoin={(c) => onRoom({ mode: "join", code: c })} />}
          </div>}
          </div>
          <FriendsMenu account={account} data={friends} />
          {!account.usesPassword && account.email && <button type="button" onClick={() => { setPwOpen((v) => !v); setMsg(null); }} className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline">Add a password (sign in with your username)</button>}
          {!account.usesPassword && account.email && pwOpen && <form data-extra onSubmit={savePassword} className="space-y-2">
            <input aria-label="New password" className="auth-input" type="password" autoComplete="new-password" placeholder={`Create a password (${MIN_PASSWORD}+ characters)`} value={pw1} onChange={(e) => { setPw1(e.target.value); setMsg(null); }} />
            <input aria-label="Confirm password" className="auth-input" type="password" autoComplete="new-password" placeholder="Confirm the password" value={pw2} onChange={(e) => { setPw2(e.target.value); setMsg(null); }} />
            <Button type="submit" className="w-full" disabled={pwBusy || pw1.length < MIN_PASSWORD || pw1 !== pw2}>{pwBusy ? "…" : pw2 && pw1 !== pw2 ? "Passwords don't match" : "Save password"}</Button>
          </form>}
          {(msg ?? message) && <p data-extra className="text-center text-sm text-accent">{msg ?? message}</p>}
          <button type="button" onClick={onSignOut} className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline">Sign out</button>
        </div>
        </div>
      </div>
    </div>
  );
}
