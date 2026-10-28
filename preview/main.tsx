// Static build of the game: sign in to play with the account's cloud save, or play as a guest
// with progress kept in this browser only. Username sign-in needs the app server, so it is off here.
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { resetProgress, type SaveData } from "@/game/config";
import { createState, toSave, type GameState } from "@/game/state";
import { mergeSave, readSave, saveRecord } from "@/game/saves";
import { GameCanvas } from "@/game/GameCanvas";
import { Button } from "@/components/ui/button";
import { AuthForm } from "@/components/AuthForm";
import { CloudGame } from "@/game/CloudGame";
import { supabase } from "@/integrations/supabase/client";
import "./preview.css";

const KEY = "bellmont-preview-save";

function loadLocal(): Record<string, unknown> {
  try { return saveRecord(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch { return {}; }
}

function initialState(): GameState {
  const stored = loadLocal();
  const parsed = readSave(stored);
  if (Object.keys(stored).length === 0) parsed.worldSeed = resetProgress().worldSeed ?? 1337;
  return createState(parsed);
}

function GuestGame({ onExit }: { onExit: () => void }) {
  const [state, setState] = useState(initialState);
  const [round, setRound] = useState(0);
  const active = useRef(state);

  const persist = useCallback((snapshot: SaveData) => {
    try { localStorage.setItem(KEY, JSON.stringify(mergeSave(loadLocal(), snapshot))); } catch { /* Preview still plays without storage. */ }
  }, []);
  const save = useCallback(() => { if (active.current) persist(toSave(active.current)); }, [persist]);

  useEffect(() => {
    active.current = state;
    const id = window.setInterval(save, 10000);
    return () => window.clearInterval(id);
  }, [state, save]);
  const reset = useCallback(() => {
    const fresh = resetProgress(active.current?.worldSeed);
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    setState(createState(fresh));
    setRound((n) => n + 1);
    persist(fresh);
  }, [persist]);

  return (
    <GameCanvas
      key={round}
      state={state}
      saving={false}
      exitLabel="Save & exit"
      onDeath={save}
      onReset={reset}
      onSignOut={() => { save(); onExit(); }}
    />
  );
}

function App() {
  const [view, setView] = useState<"loading" | "auth" | "account" | "guest">("loading");
  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data }) => setView(data.session ? "account" : "auth"))
      .catch(() => setView("auth"));
  }, []);
  const signOut = async () => { await supabase.auth.signOut(); setView("auth"); };

  if (view === "guest") return <GuestGame onExit={() => setView("auth")} />;
  if (view === "account") return <CloudGame onSignOut={signOut} />;
  if (view === "loading") return null;
  return (
    <AuthForm passwordReset={false} google={false} onSignedIn={async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) setView("account");
    }}>
      <div className="text-center text-xs text-muted-foreground">or</div>
      <Button type="button" variant="outline" className="w-full" onClick={() => setView("guest")}>Play as guest</Button>
      <p className="text-center text-xs text-muted-foreground"><b>WASD</b> move · <b>Shift</b> run · <b>Space</b> jump · <b>E</b> interact · hold mouse to look</p>
    </AuthForm>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
