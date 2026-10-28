import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { resetProgress, type SaveData } from "@/game/config";
import { createState, toSave, type GameState } from "@/game/state";
import { mergeSave, newerBackup, readSave, saveRecord } from "@/game/saves";
import type { Json } from "@/integrations/supabase/types";
import { GameCanvas } from "@/game/GameCanvas";
import { UsernameForm } from "@/components/UsernameForm";
import { Button } from "@/components/ui/button";

// Signed-in game session: loads the account save (with local backup recovery) and keeps it synced.
function useCloudGame() {
  const [state, setState] = useState<GameState | null>(null);
  const [saving, setSaving] = useState(false);
  const [round, setRound] = useState(0);
  const userId = useRef<string | null>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const retained = useRef<Record<string, unknown>>({});
  const activeState = useRef<GameState | null>(null);
  const [needsUsername, setNeedsUsername] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    (async () => {
      try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      userId.current = u.user.id;
      const profile = await supabase.from("profiles").select("username").eq("id", u.user.id).maybeSingle();
      if (profile.error) throw profile.error;
      if (!profile.data?.username) { if (!cancelled) setNeedsUsername(u.user.id); return; }
      const { data, error } = await supabase.from("game_saves").select("data, updated_at").eq("user_id", u.user.id).maybeSingle();
      if (error) throw error; // Never overwrite an unread save with defaults.
      if (cancelled) return;
      let backup = null;
      try { backup = newerBackup(JSON.parse(localStorage.getItem(`linewalker-save:${u.user.id}`) ?? "null"), data?.updated_at); } catch { /* Cloud remains authoritative without a valid backup. */ }
      retained.current = { ...saveRecord(data?.data), ...saveRecord(backup?.data) };
      const parsed = readSave(retained.current);
      if (!data && !backup) parsed.worldSeed = resetProgress().worldSeed ?? 1337;
      const loaded = createState(parsed);
      activeState.current = loaded;
      setNeedsUsername(null);
      setState(loaded);
      } catch { if (!cancelled) setLoadError(true); }
    })();
    return () => { cancelled = true; };
  }, [loadAttempt]);

  const persist = useCallback((snapshot: SaveData) => {
    const id = userId.current;
    if (!id) return Promise.resolve();
    const data = mergeSave(retained.current, snapshot);
    const updated_at = new Date().toISOString();
    retained.current = data;
    try { localStorage.setItem(`linewalker-save:${id}`, JSON.stringify({ data, updated_at })); } catch { /* Cloud saving still works if local storage is unavailable. */ }
    writes.current = writes.current.catch(() => {}).then(async () => {
      setSaving(true);
      try {
        const { error } = await supabase.from("game_saves").upsert({
          user_id: id, data: data as unknown as Json, updated_at,
        });
        if (error) throw error;
        setSaveError(false);
      } catch (error) {
        setSaveError(true);
        throw error;
      } finally { setSaving(false); }
    });
    return writes.current;
  }, []);

  const save = useCallback(async () => {
    const current = activeState.current;
    if (current) await persist(toSave(current));
  }, [persist]);

  const reset = useCallback(() => {
    const fresh = resetProgress(activeState.current?.worldSeed);
    retained.current = {};
    const newState = createState(fresh);
    activeState.current = newState;
    setState(newState);
    setRound((value) => value + 1);
    void persist(fresh).catch(() => {});
  }, [persist]);

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
    state, saving, round, needsUsername, loadError, saveError, setSaveError, save, reset,
    retryLoad: () => setLoadAttempt((n) => n + 1),
  };
}

/** The signed-in game screen; `onSignOut` must end the Supabase session and leave the game. */
export function CloudGame({ onSignOut: signOut }: { onSignOut: () => Promise<void> }) {
  const { state, saving, round, needsUsername, loadError, saveError, setSaveError, save, reset, retryLoad } = useCloudGame();
  if (needsUsername) return <UsernameForm userId={needsUsername} onComplete={() => retryLoad()} onSignOut={signOut} />;
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
      onDeath={() => { void save().catch(() => {}); }}
      onReset={reset}
      onSignOut={async () => {
        try { await save(); await signOut(); } catch { setSaveError(true); }
      }}
    />{saveError && <div role="alert" className="hud-panel fixed left-4 top-20 z-30 max-w-[calc(100%-2rem)] space-y-2 p-3 text-sm text-foreground">
      <p>Cloud save failed. Retrying; keep this tab open.</p>
      <Button onClick={() => { void save().catch(() => {}); }} variant="outline" size="sm">Retry save</Button>
    </div>}</>
  );
}
