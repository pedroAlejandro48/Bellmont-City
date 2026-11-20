import { useState, type FormEvent } from "react";
import { RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarPicker, EditableAvatar } from "@/components/Avatar";
import { AccountError, changeUsername, chooseAvatar, deleteAccount, type Account } from "@/platform/account";
import { removeFriend } from "@/platform/friends";
import { usernameSchema } from "@/lib/usernames";
import { LANGS, currentLang, setLang } from "@/i18n";
import { QUALITIES, readQuality, saveQuality, type Quality } from "@/game/quality";
import { enablePush, pushPermission, registerDevice } from "@/platform/push";
import type { useFriends } from "@/components/Friends";
import { exitApp, inMobileApp, inWindowsApp } from "@/components/InstallApp";
import { playPullRefresh } from "@/lib/pullRefresh";

/**
 * The player's picture in the top-left corner of the menu: tap it for Profile (picture, username, friends, deleting
 * the account) or Settings (language, graphics, notifications).
 */
export function AccountMenu({ account, friends, onAccount, onSignOut }: { account: Account; friends: ReturnType<typeof useFriends>; onAccount: (a: Account) => void; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"profile" | "settings" | null>(null);
  const name = account.username ?? "";
  return <>
    <div className="account-menu">
      <button type="button" className="account-pic" aria-label="Your account" aria-expanded={open} onClick={() => setOpen((v) => !v)}><Avatar photo={account.photo} name={name} size={40} /></button>
      {/* (Windows app: refresh, with its key under it while the pointer is on it.) */}
      {/* The apps: Refresh. Pointed at, the arrow slides out from behind the word, spinning, and the button widens
          (all back again when the pointer leaves). Windows shows "Ctrl + R" under it; on a phone, pressing it plays
          the pull-to-refresh arrow down from the top, then the game reloads. */}
      {(inWindowsApp() || inMobileApp()) && <span className="account-refresh-wrap">
        <button type="button" className="account-refresh" onClick={() => (inWindowsApp() ? location.reload() : playPullRefresh())}>
          <span className="refresh-word">Refresh</span>
          <RotateCw size={17} className="refresh-arrow" aria-hidden />
        </button>
        {inWindowsApp() && <span className="hover-tip" aria-hidden data-no-translate>Ctrl + R</span>}
      </span>}
      {open && <ul className="hud-panel account-drop">
        <li><button type="button" onClick={() => { setPanel("profile"); setOpen(false); }}>Profile</button></li>
        <li><button type="button" onClick={() => { setPanel("settings"); setOpen(false); }}>Settings</button></li>
        {inWindowsApp() && <li><button type="button" className="account-exit" onClick={exitApp}>Exit</button></li>}
      </ul>}
    </div>
    {panel === "profile" && <Profile account={account} friends={friends} onAccount={onAccount} onSignOut={onSignOut} onClose={() => setPanel(null)} />}
    {panel === "settings" && <Settings onClose={() => setPanel(null)} />}
  </>;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="install-help" role="dialog" aria-label={title} onClick={onClose}>
    <div className="install-card sheet" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="install-x" aria-label="Close" onClick={onClose}><X size={18} /></button>
      <b>{title}</b>
      <div className="sheet-body">{children}</div>
    </div>
  </div>;
}

function Profile({ account, friends, onAccount, onSignOut, onClose }: { account: Account; friends: ReturnType<typeof useFriends>; onAccount: (a: Account) => void; onSignOut: () => void; onClose: () => void }) {
  const [picking, setPicking] = useState(false);
  const [newName, setNewName] = useState(""), [pw, setPw] = useState(""), [nameMsg, setNameMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [unadding, setUnadding] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false), [delPw, setDelPw] = useState(""), [delMsg, setDelMsg] = useState<string | null>(null);

  async function rename(e: FormEvent) {
    e.preventDefault();
    const parsed = usernameSchema.safeParse(newName);
    if (!parsed.success) { setNameMsg("Use 3–24 letters, numbers, or underscores."); return; }
    setBusy(true); setNameMsg(null);
    try { onAccount(await changeUsername(account, parsed.data, pw)); setNameMsg("Username changed."); setNewName(""); setPw(""); }
    catch (err) { setNameMsg(err instanceof AccountError ? err.message : "Could not change your username. Please try again."); }
    setBusy(false);
  }
  async function remove() {
    setBusy(true); setDelMsg(null);
    try { await deleteAccount(account, account.usesPassword ? delPw : null); onClose(); onSignOut(); }
    catch (err) { setDelMsg(err instanceof AccountError ? err.message : "Could not delete your account. Please try again."); }
    setBusy(false);
  }

  return <Sheet title="Profile" onClose={onClose}>
    <div className="profile-head">
      <EditableAvatar photo={account.photo} name={account.username ?? ""} size={64} onEdit={() => setPicking(true)} />
      <div><b data-no-translate>{account.username}</b>{account.email && <small data-no-translate>{account.email}</small>}<button type="button" className="link" onClick={() => setPicking(true)}>Change picture</button></div>
    </div>

    <p className="sheet-label">Change username</p>
    {account.usesPassword ? <form onSubmit={rename} className="space-y-2">
      <input aria-label="New username" className="auth-input" autoComplete="off" placeholder="New username" value={newName} onChange={(e) => setNewName(e.target.value)} />
      <input aria-label="Password" className="auth-input" type="password" autoComplete="current-password" placeholder="Your password" value={pw} onChange={(e) => setPw(e.target.value)} />
      <Button type="submit" className="w-full" disabled={busy || !newName || !pw}>Change username</Button>
      {nameMsg && <p className="text-center text-xs text-accent">{nameMsg}</p>}
    </form> : <p className="text-xs text-muted-foreground">Add a password first (on the menu: Add a password), then you can change your username with it.</p>}

    <p className="sheet-label">Manage friends</p>
    {friends.friends.length ? <ul className="friends-list">
      {friends.friends.map((f) => <li key={f.uid} className="friends-row">
        <Avatar uid={f.uid} photo={f.photo} name={f.name} />
        {unadding === f.uid ? <>
          <span><b>Are you sure?</b></span>
          <button type="button" className="pill grey" onClick={() => setUnadding(null)}>No</button>
          <button type="button" className="pill red" onClick={() => { setUnadding(null); void removeFriend(account, f.uid).catch(() => {}); }}>Yes</button>
        </> : <>
          <span><b data-no-translate>{f.name}</b></span>
          <button type="button" className="pill red" onClick={() => setUnadding(f.uid)}>Unadd</button>
        </>}
      </li>)}
    </ul> : <p className="text-xs text-muted-foreground">No friends yet.</p>}

    <p className="sheet-label danger">Delete account</p>
    {!deleting ? <Button type="button" variant="destructive" className="w-full" onClick={() => setDeleting(true)}>Delete my account</Button> : <div className="space-y-2">
      <p className="text-xs">This deletes your account, your progress, your username and your friends, for good. It can't be undone.</p>
      {account.usesPassword ? <input aria-label="Password" className="auth-input" type="password" autoComplete="current-password" placeholder="Your password" value={delPw} onChange={(e) => setDelPw(e.target.value)} />
        : <p className="text-xs text-muted-foreground">Google will ask you to confirm it's you.</p>}
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={() => { setDeleting(false); setDelMsg(null); }}>No</Button>
        <Button type="button" variant="destructive" className="flex-1" disabled={busy || (account.usesPassword && !delPw)} onClick={() => void remove()}>{busy ? "…" : "Yes, delete it"}</Button>
      </div>
      {delMsg && <p className="text-center text-xs text-accent">{delMsg}</p>}
    </div>}
    {picking && <AvatarPicker current={account.photo} google={account.google} onPick={(url) => { void chooseAvatar(account, url).then((a) => { onAccount(a); setPicking(false); }).catch(() => {}); }} onClose={() => setPicking(false)} />}
  </Sheet>;
}

const QLABEL: Record<Quality, string> = { low: "Low", medium: "Medium", high: "High" };
function Settings({ onClose }: { onClose: () => void }) {
  const lang = currentLang();
  const [quality, setQuality] = useState<Quality>(readQuality);
  const [perm, setPerm] = useState(pushPermission());
  return <Sheet title="Settings" onClose={onClose}>
    <p className="sheet-label">Language</p>
    <ul className="lang-list">
      {LANGS.map((l) => <li key={l.code}>
        <button type="button" className={lang === l.code ? "on" : ""} aria-pressed={lang === l.code} onClick={() => { if (l.code !== lang) setLang(l.code); }}>
          <span data-no-translate>{l.name}</span>
          <img src={`/flags/${l.flag}.svg`} alt="" />
        </button>
      </li>)}
    </ul>
    <p className="sheet-label">Graphics</p>
    <div className="flex overflow-hidden rounded-md border border-input">
      {QUALITIES.map((q, i) => <button key={q} type="button" aria-pressed={quality === q} onClick={() => { saveQuality(q); setQuality(q); }}
        className={`flex-1 px-2.5 py-1.5 text-sm font-semibold ${i > 0 ? "border-l border-input" : ""} ${quality === q ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-white/5"}`}>{QLABEL[q]}</button>)}
    </div>
    {perm !== "unsupported" && <><p className="sheet-label">Notifications</p>
    {perm === "granted" ? <p className="text-sm">On: friend requests and room invitations reach you, even with the game closed.</p>
      : perm === "denied" ? <p className="text-sm text-muted-foreground">Blocked. Turn them on in your browser's or phone's settings for this site.</p>
      : <Button type="button" className="w-full" onClick={() => void enablePush().then((p) => { setPerm(p); if (p === "granted") void registerDevice(); })}>Turn on notifications</Button>}</>}
  </Sheet>;
}
