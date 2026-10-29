import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { AuthForm } from "@/components/AuthForm";
import { CloudGame } from "@/game/CloudGame";
import { GuestGame } from "@/game/GuestGame";
import { MainMenu } from "@/components/MainMenu";
import { RoomEntry, type RoomRequest } from "@/multiplayer/RoomGame";
import { currentAccount, type Account } from "@/platform/account";
import "./styles.css";

function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  type View = { name: "auth" | "menu" | "city" | "guest" } | { name: "room"; request: RoomRequest };
  const [view, setView] = useState<View>({ name: "auth" });
  const [menuMessage, setMenuMessage] = useState<string>();
  const toMenu = useCallback((message?: string) => { setMenuMessage(message); setView({ name: "menu" }); }, []);
  useEffect(() => {
    currentAccount()
      .then(setAccount)
      .catch(() => setAccount(null))
      .finally(() => setLoading(false));
  }, []);

  if (view.name === "guest") return <GuestGame onExit={() => setView({ name: "auth" })} />;
  if (account?.username) {
    if (view.name === "menu") return <MainMenu username={account.username} message={menuMessage} onCity={() => setView({ name: "city" })} onRoom={(request) => { setMenuMessage(undefined); setView({ name: "room", request }); }} />;
    if (view.name === "city") return <CloudGame account={account} onExit={() => toMenu()} />;
    if (view.name === "room") return <RoomEntry account={account} request={view.request} onExit={toMenu} />;
  }
  return (
    <AuthForm key={loading ? "loading" : "ready"} account={account} loading={loading} onEnter={(signedIn) => { setAccount(signedIn); toMenu(); }}>
      <div className="text-center text-xs text-muted-foreground">or</div>
      <Button type="button" variant="outline" className="w-full" onClick={() => setView({ name: "guest" })}>Play as guest</Button>
      <p className="text-center text-xs text-muted-foreground"><b>WASD</b> move · <b>Shift</b> run · <b>Space</b> jump · <b>E</b> interact · hold mouse to look</p>
    </AuthForm>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
