import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { resetProgress, type SaveData } from "@/game/config";
import { createState, toSave, type GameState } from "@/game/state";
import { mergeSave, newerBackup, readSave, saveRecord } from "@/game/saves";
import { readCloudSave, writeCloudSave, type Account } from "@/platform/account";
import { GameCanvas } from "@/game/GameCanvas";
import { Button } from "@/components/ui/button";

/** A shared world (a multiplayer room) instead of the player's own city. */
export type WorldSlot = {
  /** Save slot for the player's progress in this world. */
  slot: string;
  /** The world every player in it shares; never changes, not even on death. */
  seed: number;
  /** The shared time of day, so everyone sees the same sky. */
  elapsed: () => number;
  /** Where a fresh (or respawning) player appears. */
  place: (save: SaveData) => SaveData;
};

/** Extra HUD and scene content, as stable component types so HUD ticks never rebuild the 3D scene. */
export type GameExtras = { Overlay?: ComponentType<{ state: GameState }>; Scene?: ComponentType<{ state: GameState }>; exitNote?: string };

function freshSave(world: WorldSlot | undefined, previousSeed?: number): SaveData {
  const fresh = resetProgress(previousSeed);
  return world ? world.place({ ...fresh, worldSeed: world.seed, elapsed: world.elapsed() }) : fresh;
}

// Signed-in game session: loads the account save (with local backup recovery) and keeps it synced.
function useCloudGame(account: Account, world?: WorldSlot) {
  const slot = world?.slot ?? "save";
  const backupKey = `bellmont-save:${account.id}${world ? `:${slot}` : ""}`;
  const [state, setState] = useState<GameState | null>(null);
  const [saving, setSaving] = useState(false);
  const [round, setRound] = useState(0);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const retained = useRef<Record<string, unknown>>({});
  const activeState = useRef<GameState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    (async () => {
      try {
      const data = await readCloudSave(account, slot); // Throws on read failure: never overwrite an unread save with defaults.
      if (cancelled) return;
      let backup = null;
      try { backup = newerBackup(JSON.parse(localStorage.getItem(backupKey) ?? "null"), data?.updated_at); } catch { /* Cloud remains authoritative without a valid backup. */ }
      retained.current = { ...saveRecord(data?.data), ...saveRecord(backup?.data) };
      let parsed = readSave(retained.current);
      if (!data && !backup) parsed = freshSave(world);
      else if (world) parsed = { ...parsed, worldSeed: world.seed, elapsed: world.elapsed() };
      const loaded = createState(parsed);
      activeState.current = loaded;
      setState(loaded);
      } catch { if (!cancelled) setLoadError(true); }
    })();
    return () => { cancelled = true; };
  }, [account, world, slot, backupKey, loadAttempt]);

  const persist = useCallback((snapshot: SaveData) => {
    const data = mergeSave(retained.current, snapshot);
    const updated_at = new Date().toISOString();
    retained.current = data;
    try { localStorage.setItem(backupKey, JSON.stringify({ data, updated_at })); } catch { /* Cloud saving still works if local storage is unavailable. */ }
    writes.current = writes.current.catch(() => {}).then(async () => {
      setSaving(true);
      try {
        await writeCloudSave(account, data, updated_at, slot);
        setSaveError(false);
      } catch (error) {
        setSaveError(true);
        throw error;
      } finally { setSaving(false); }
    });
    return writes.current;
  }, [account, slot, backupKey]);

  const save = useCallback(async () => {
    const current = activeState.current;
    if (current) await persist(toSave(current));
  }, [persist]);

  const reset = useCallback(() => {
    const fresh = freshSave(world, activeState.current?.worldSeed);
    retained.current = {};
    const newState = createState(fresh);
    activeState.current = newState;
    setState(newState);
    setRound((value) => value + 1);
    void persist(fresh).catch(() => {});
  }, [persist, world]);

  useEffect(() => {
    if (!state) return;
    const backgroundSave = () => { void save().catch(() => {}); };
    const id = window.setInterval(backgroundSave, 10000);
    const vis = () => { if (document.visibilityState === "hidden") backgroundSave(); };
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pagehide", backgroundSave);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("pagehide", backgroundSave);
    };
  }, [state, save]);

  return {
    state, saving, round, loadError, saveError, setSaveError, save, reset,
    retryLoad: () => setLoadAttempt((n) => n + 1),
  };
}

/** The signed-in game screen; `onExit` leaves the game after its final save. */
export function CloudGame({ account, onExit, world, extras }: { account: Account; onExit: () => void; world?: WorldSlot; extras?: GameExtras }) {
  const { state, saving, round, loadError, saveError, setSaveError, save, reset, retryLoad } = useCloudGame(account, world);
  if (loadError) return <div className="auth-bg flex min-h-screen flex-col items-center justify-center gap-4 text-foreground">
    <p>Could not load your progress. Your saved game has not been changed.</p>
    <Button onClick={() => retryLoad()}>Retry loading</Button>
  </div>;

  if (!state)
    return (
      <div className="flex min-h-screen items-center justify-center bg-background font-display text-2xl text-foreground">
        Loading your city…
      </div>
    );

  return (
    <><GameCanvas
      key={round}
      state={state}
      saving={saving}
      exitLabel="Save & exit"
      extras={extras}
      onDeath={() => { void save().catch(() => {}); }}
      onReset={reset}
      onSignOut={async () => {
        try { await save(); onExit(); } catch { setSaveError(true); }
      }}
    />{saveError && <div role="alert" className="hud-panel fixed left-4 top-20 z-30 max-w-[calc(100%-2rem)] space-y-2 p-3 text-sm text-foreground">
      <p>Cloud save failed. Retrying; keep this tab open.</p>
      <Button onClick={() => { void save().catch(() => {}); }} variant="outline" size="sm">Retry save</Button>
    </div>}</>
  );
}
