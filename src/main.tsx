import { InstallApp, listenForInstall } from "@/components/InstallApp";
import { guardBackButton } from "@/lib/backGuard";
import { loadLang } from "@/i18n";
import { watchNotifications } from "@/platform/push";
import { lazy, StrictMode, Suspense, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { AuthForm } from "@/components/AuthForm";
import { UsernameForm } from "@/components/UsernameForm";
import { MainMenu } from "@/components/MainMenu";
import type { RoomRequest } from "@/multiplayer/RoomGame";
import { setInGame, watchForUpdates } from "@/lib/updates";
import { appKind, backgroundPage } from "@/lib/appKind";
import { syncServerTime } from "@/lib/serverTime";
import { isSignedIn, signOutAccount, watchAccount, type Account } from "@/platform/account";
import { normalizeRoomCode } from "@/platform/rooms";
import "./styles.css";
import { startCityBackdrop } from "@/lib/cityBackdrop";

// The game itself (the 3D city, physics, multiplayer) is its own download: the start page comes up without waiting for
// it, and it loads in the background meanwhile (gameCode), so it's usually there by the time Play is pressed.
const loadCloud = () => import("@/game/CloudGame"), loadGuest = () => import("@/game/GuestGame"), loadRoom = () => import("@/multiplayer/RoomGame");
const CloudGame = lazy(() => loadCloud().then((m) => ({ default: m.CloudGame })));
const GuestGame = lazy(() => loadGuest().then((m) => ({ default: m.GuestGame })));
const RoomEntry = lazy(() => loadRoom().then((m) => ({ default: m.RoomEntry })));
function gameCode() {
  void loadCloud().catch(() => {}); void loadRoom().catch(() => {}); void loadGuest().catch(() => {});
  // The physics engine (WebAssembly) made ready too: the game waits for it before anyone can move.
  void import("@dimforge/rapier3d-compat").then((r) => r.init()).catch(() => {});
}
const GameLoading = () => <div className="auth-bg fit-screen flex items-center justify-center font-display text-2xl text-foreground">Loading…</div>;

type View = { name: "menu" | "city" | "guest" } | { name: "room"; request: RoomRequest };

/** A shared room link (`?room=CODE`): the room to open once the player is signed in. */
function linkedRoom() {
  return normalizeRoomCode(new URLSearchParams(window.location.search).get("room") ?? "");
}

function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  // The password just typed, kept in memory only until the new account has chosen its username.
  const [password, setPassword] = useState<string | null>(null);
  const [view, setView] = useState<View>({ name: "menu" });
  // (A newer version waits until you're out of the game, then loads.)
  useEffect(() => { setInGame(view.name !== "menu"); }, [view.name]);
  const [menuMessage, setMenuMessage] = useState<string>();
  const [pendingRoom, setPendingRoom] = useState(linkedRoom);
  // Friend requests, accepted requests and room invitations pop up as notifications while the game is open.
  // (In the Windows app's game window they're cards in its corner; its hidden listener shows Windows notifications.)
  useEffect(() => (account?.username ? watchNotifications(account) : undefined), [account]);
  const toMenu = useCallback((message?: string) => { setMenuMessage(message); setView({ name: "menu" }); }, []);

  useEffect(() => watchAccount(
    (next) => { setAccount(next); setLoading(false); setLoadFailed(false); },
    () => { setLoading(false); setLoadFailed(true); },
  ), []);

  // Once signed in with a username and gender, a shared link takes the player straight into its room.
  const ready = !!account?.username && !!account.gender;
  useEffect(() => {
    if (!ready || !pendingRoom) return;
    setView({ name: "room", request: { mode: "join", code: pendingRoom } });
    setPendingRoom(null);
    window.history.replaceState(null, "", window.location.pathname);
  }, [ready, pendingRoom]);

  const signOut = useCallback(async () => {
    await signOutAccount();
    setPassword(null);
    setView({ name: "menu" });
  }, []);

  if (view.name === "guest") return <Suspense fallback={<GameLoading />}><GuestGame onExit={() => setView({ name: "menu" })} /></Suspense>;
  if (loading) return <div className="auth-bg fit-screen flex items-center justify-center font-display text-2xl text-foreground">Loading…</div>;
  if (loadFailed) return <div className="auth-bg fit-screen flex flex-col items-center justify-center gap-4 text-foreground">
    <p>Could not reach the Bellmont server.</p>
    <Button onClick={() => window.location.reload()}>Try again</Button>
  </div>;

  if (!account) return (<>
    <AuthForm room={pendingRoom} onSignedIn={(signedIn, typed) => {
      if (!isSignedIn(signedIn.id)) return;
      setAccount(signedIn); setPassword(signedIn.username && signedIn.gender ? null : typed); toMenu();
    }}>
      <Button type="button" variant="ghost" className="w-full text-muted-foreground" onClick={() => setView({ name: "guest" })}>Play as guest</Button>
      <p className="text-center text-xs text-muted-foreground"><b>WASD</b> move · <b>Shift</b> run · <b>Space</b> jump · <b>E</b> interact · hold mouse to look</p>
    </AuthForm>
    <InstallApp />
  </>);
  if (!account.username || !account.gender) return <UsernameForm account={account} password={password} onSignOut={() => void signOut()} onComplete={(named) => { setAccount(named); setPassword(null); toMenu(); }} />;

  if (view.name === "city") return <Suspense fallback={<GameLoading />}><CloudGame account={account} onExit={() => toMenu()} /></Suspense>;
  if (view.name === "room") return <Suspense fallback={<GameLoading />}><RoomEntry account={account} request={view.request} onExit={toMenu} /></Suspense>;
  return <><InstallApp /><MainMenu account={account} onAccount={setAccount} username={account.username} message={menuMessage} onSignOut={() => void signOut()} onCity={() => setView({ name: "city" })} onRoom={(request) => { setMenuMessage(undefined); setView({ name: "room", request }); }} /></>;
}

/** The Windows app's hidden page: no game, just the signed-in player's notifications (shown by Windows). */
function Background() {
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => watchAccount(setAccount, () => {}), []);
  useEffect(() => (account?.username ? watchNotifications(account) : undefined), [account]);
  return null;
}

syncServerTime();
// (The backdrop's drawing waits till the page is up: the picture that stands in for it shows meanwhile.)
const idle = (f: () => void, timeout: number) => { if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(f, { timeout }); else setTimeout(f, 200); };
if (!backgroundPage()) idle(() => startCityBackdrop(), 600);
listenForInstall();
guardBackButton();
watchForUpdates();
// The Windows app: Ctrl + R refreshes the game (as its refresh button's tip says).
if (appKind() === "windows") window.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "R")) { e.preventDefault(); location.reload(); } });
// Installable as an app (Android browsers need a service worker); only in real builds, so dev never caches.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}
// (The chosen language's words first, so the page is drawn in it from the start.)
void loadLang().catch(() => {}).finally(() => {
  createRoot(document.getElementById("root")!).render(<StrictMode>{backgroundPage() ? <Background /> : <App />}</StrictMode>);
  // Then the game's code, quietly, once the page is drawn.
  if (!backgroundPage()) idle(gameCode, 1500);
});
