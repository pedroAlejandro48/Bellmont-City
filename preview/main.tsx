// Guest preview: runs the game without Supabase sign-in, keeping progress in this browser only.
import { StrictMode, useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { resetProgress, type SaveData } from "@/game/config";
import { createState, toSave, type GameState } from "@/game/state";
import { mergeSave, readSave, saveRecord } from "@/game/saves";
import { GameCanvas } from "@/game/GameCanvas";
import { Button } from "@/components/ui/button";
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

function Preview() {
  const [started, setStarted] = useState(false);
  const [state, setState] = useState<GameState | null>(null);
  const [round, setRound] = useState(0);
  const active = useRef<GameState | null>(null);

  const persist = useCallback((snapshot: SaveData) => {
    try { localStorage.setItem(KEY, JSON.stringify(mergeSave(loadLocal(), snapshot))); } catch { /* Preview still plays without storage. */ }
  }, []);
  const save = useCallback(() => { if (active.current) persist(toSave(active.current)); }, [persist]);

  const start = () => {
    const s = initialState();
    active.current = s;
    setState(s);
    setStarted(true);
    window.setInterval(save, 10000);
  };
  const reset = useCallback(() => {
    const fresh = resetProgress(active.current?.worldSeed);
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    const s = createState(fresh);
    active.current = s;
    setState(s);
    setRound((n) => n + 1);
    persist(fresh);
  }, [persist]);

  if (!started || !state)
    return (
      <div className="auth-bg flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center text-foreground">
        <h1 className="font-display text-5xl sm:text-7xl">Bellmont City</h1>
        <p className="max-w-md text-muted-foreground">Guest preview — progress is kept in this browser only.</p>
        <Button size="lg" onClick={start}>Play</Button>
        <div className="hud-panel max-w-md px-5 py-4 text-left text-sm">
          <p><b>WASD / arrows</b> move · <b>Shift</b> run · <b>Space</b> jump</p>
          <p><b>E</b> interact (scooter, benches) · <b>hold mouse</b> to look around</p>
        </div>
      </div>
    );

  return (
    <GameCanvas
      key={round}
      state={state}
      saving={false}
      exitLabel="Restart city"
      onDeath={save}
      onReset={reset}
      onSignOut={reset}
    />
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Preview /></StrictMode>);
