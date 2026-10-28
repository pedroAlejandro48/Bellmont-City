import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { AuthForm } from "@/components/AuthForm";
import { CloudGame } from "@/game/CloudGame";
import { GuestGame } from "@/game/GuestGame";
import { currentAccount, type Account } from "@/platform/account";
import "./styles.css";

function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"auth" | "account" | "guest">("auth");
  useEffect(() => {
    currentAccount()
      .then(setAccount)
      .catch(() => setAccount(null))
      .finally(() => setLoading(false));
  }, []);

  if (view === "guest") return <GuestGame onExit={() => setView("auth")} />;
  if (view === "account" && account) return <CloudGame account={account} onExit={() => setView("auth")} />;
  return (
    <AuthForm key={loading ? "loading" : "ready"} account={account} loading={loading} onEnter={(signedIn) => { setAccount(signedIn); setView("account"); }}>
      <div className="text-center text-xs text-muted-foreground">or</div>
      <Button type="button" variant="outline" className="w-full" onClick={() => setView("guest")}>Play as guest</Button>
      <p className="text-center text-xs text-muted-foreground"><b>WASD</b> move · <b>Shift</b> run · <b>Space</b> jump · <b>E</b> interact · hold mouse to look</p>
    </AuthForm>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
