import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { AuthForm } from "@/components/AuthForm";
import { UsernameForm } from "@/components/UsernameForm";
import { MainMenu } from "@/components/MainMenu";
import { CloudGame } from "@/game/CloudGame";
import { GuestGame } from "@/game/GuestGame";
import { RoomEntry, type RoomRequest } from "@/multiplayer/RoomGame";
import { isSignedIn, signOutAccount, watchAccount, type Account } from "@/platform/account";
import "./styles.css";

type View = { name: "menu" | "city" | "guest" } | { name: "room"; request: RoomRequest };

function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  // The password just typed, kept in memory only until the new account has chosen its username.
  const [password, setPassword] = useState<string | null>(null);
  const [view, setView] = useState<View>({ name: "menu" });
  const [menuMessage, setMenuMessage] = useState<string>();
  const toMenu = useCallback((message?: string) => { setMenuMessage(message); setView({ name: "menu" }); }, []);

  useEffect(() => watchAccount(
    (next) => { setAccount(next); setLoading(false); setLoadFailed(false); },
    () => { setLoading(false); setLoadFailed(true); },
  ), []);

  const signOut = useCallback(async () => {
    await signOutAccount();
    setPassword(null);
    setView({ name: "menu" });
  }, []);

  if (view.name === "guest") return <GuestGame onExit={() => setView({ name: "menu" })} />;
  if (loading) return <div className="auth-bg flex min-h-screen items-center justify-center font-display text-2xl text-foreground">Loading…</div>;
  if (loadFailed) return <div className="auth-bg flex min-h-screen flex-col items-center justify-center gap-4 text-foreground">
    <p>Could not reach the Bellmont server.</p>
    <Button onClick={() => window.location.reload()}>Try again</Button>
  </div>;

  if (!account) return (
    <AuthForm onSignedIn={(signedIn, typed) => {
      if (!isSignedIn(signedIn.id)) return;
      setAccount(signedIn); setPassword(signedIn.username ? null : typed); toMenu();
    }}>
      <Button type="button" variant="ghost" className="w-full text-muted-foreground" onClick={() => setView({ name: "guest" })}>Play as guest</Button>
      <p className="text-center text-xs text-muted-foreground"><b>WASD</b> move · <b>Shift</b> run · <b>Space</b> jump · <b>E</b> interact · hold mouse to look</p>
    </AuthForm>
  );
  if (!account.username) return <UsernameForm account={account} password={password} onSignOut={() => void signOut()} onComplete={(named) => { setAccount(named); setPassword(null); toMenu(); }} />;

  if (view.name === "city") return <CloudGame account={account} onExit={() => toMenu()} />;
  if (view.name === "room") return <RoomEntry account={account} request={view.request} onExit={toMenu} />;
  return <MainMenu username={account.username} message={menuMessage} onSignOut={() => void signOut()} onCity={() => setView({ name: "city" })} onRoom={(request) => { setMenuMessage(undefined); setView({ name: "room", request }); }} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
