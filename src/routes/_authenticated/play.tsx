import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { resetProgress, type SaveData } from "@/game/config";
import { createState, toSave, type GameState } from "@/game/state";
import { GameCanvas } from "@/game/GameCanvas";
import type { Json } from "@/integrations/supabase/types";
import { UsernameForm } from "@/components/UsernameForm";
import { Button } from "@/components/ui/button";
import { mergeSave, newerBackup, readSave, saveRecord } from "@/game/saves";

export const Route = createFileRoute("/_authenticated/play")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Play — Bellmont City" },
      { name: "description", content: "Walk, run and jump through a living downtown with a full day and night cycle." },
      { property: "og:title", content: "Play — Bellmont City" },
      { property: "og:description", content: "Walk, run and jump through a living downtown with a full day and night cycle." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Play,
});

function Play() {
  const navigate = useNavigate();
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
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

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    await navigate({ to: "/", replace: true });
    void router.invalidate();
  };
  if (needsUsername) return <UsernameForm userId={needsUsername} onComplete={() => setLoadAttempt((n) => n + 1)} onSignOut={signOut} />;
  if (loadError) return <div className="auth-bg flex min-h-screen flex-col items-center justify-center gap-4 text-foreground">
    <p>Could not load your progress. Your saved game has not been changed.</p>
    <Button onClick={() => setLoadAttempt((n) => n + 1)}>Retry loading</Button>
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
