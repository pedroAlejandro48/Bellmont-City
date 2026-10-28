// Guest play: no account, progress kept in this browser only.
import { useCallback, useEffect, useRef, useState } from "react";
import { resetProgress, type SaveData } from "@/game/config";
import { createState, toSave, type GameState } from "@/game/state";
import { mergeSave, readSave, saveRecord } from "@/game/saves";
import { GameCanvas } from "@/game/GameCanvas";

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

export function GuestGame({ onExit }: { onExit: () => void }) {
  const [state, setState] = useState(initialState);
  const [round, setRound] = useState(0);
  const active = useRef(state);

  const persist = useCallback((snapshot: SaveData) => {
    try { localStorage.setItem(KEY, JSON.stringify(mergeSave(loadLocal(), snapshot))); } catch { /* Guests still play without storage. */ }
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
