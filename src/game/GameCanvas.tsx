import { Canvas } from "@react-three/fiber";
import { memo, startTransition, Suspense, useEffect, useMemo, useState } from "react";
import { Physics } from "@react-three/rapier";
import { PhysicsGround } from "./PhysicsGround";
import { Ragdoll } from "./Ragdoll";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DEATH_SCREEN_SECONDS, formatClock, generateCity, timeInfo } from "./config";
import { City, LampLights } from "./City";
import { Player } from "./Player";
import { SkyAndLights } from "./Sky";
import { Traffic } from "./Traffic";
import type { GameState } from "./state";
import { CameraRig } from "./CameraRig";
import { WorldRoads } from "./WorldRoads";
import { PITCH, MPH_TO_MPS } from "./config";
import { Scooter } from "./Scooter";
import { BenchInteraction } from "./BenchInteraction";

const BLOCKED = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

// HUD ticks never reconcile the physics/scene tree. Only a streamed cell does.
const GameScene = memo(function GameScene({ state, x, z }: { state: GameState; x: number; z: number }) {
  const city = useMemo(() => generateCity(state.worldSeed, x, z), [state.worldSeed, x, z]);
  return <Canvas shadows dpr={[1, 1.25]} camera={{ fov: 60, near: 0.1, far: 1200 }}>
    <SkyAndLights state={state} />
    <WorldRoads x={x} z={z} seed={state.worldSeed} />
    <City city={city} state={state} />
    <LampLights city={city} state={state} />
    <Suspense fallback={null}>
      <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60} interpolate>
        <PhysicsGround city={city} x={x} z={z} />
        <BenchInteraction state={state} /><Traffic state={state} /><Scooter state={state} /><Player state={state} city={city} />
        <Ragdoll state={state} /><CameraRig state={state} />
      </Physics>
    </Suspense>
  </Canvas>;
});

export function GameCanvas({ state, onSignOut, onDeath, onReset, saving }: { state: GameState; onSignOut: () => void; onDeath: () => void; onReset: () => void; saving: boolean }) {
  const [focus, setFocus] = useState(() => [Math.round(state.pos.x / PITCH) * PITCH, Math.round(state.pos.z / PITCH) * PITCH]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const x = Math.round(state.pos.x / PITCH) * PITCH, z = Math.round(state.pos.z / PITCH) * PITCH;
      startTransition(() => setFocus((old) => old[0] === x && old[1] === z ? old : [x, z]));
    }, 250);
    return () => window.clearInterval(timer);
  }, [state]);
  const [hud, setHud] = useState(() => timeInfo(state.elapsed));
  const [health, setHealth] = useState(state.health);
  const [riding, setRiding] = useState(state.scooter.riding);
  const [speed, setSpeed] = useState(0);
  const [dead, setDead] = useState(state.health === 0);

  useEffect(() => {
    let resetTimer: number | undefined;
    let deathSeen = false;
    const id = window.setInterval(() => {
      setHealth(state.health);
      setRiding(state.scooter.riding);
      setSpeed(Math.round(Math.abs(state.scooter.speed) / MPH_TO_MPS));
      if (state.deathStartedAt !== null && !deathSeen) {
        deathSeen = true;
        setDead(true);
        onDeath();
        const remaining = Math.max(0, DEATH_SCREEN_SECONDS * 1000 - (performance.now() - state.deathStartedAt));
        resetTimer = window.setTimeout(onReset, remaining);
      }
    }, 50);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(resetTimer);
    };
  }, [state, onDeath, onReset]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (BLOCKED.has(e.code)) e.preventDefault();
      if (state.health === 0 || state.accident) return;
      if (e.code === "KeyE" && !e.repeat) { state.interactQueued = true; e.preventDefault(); }
      if (state.bench) return;
      if (e.code === "Space" && !e.repeat && !state.scooter.riding && !state.scooter.action) state.jumpQueued = true;
      state.keys.add(e.code);
    };
    const up = (e: KeyboardEvent) => state.keys.delete(e.code);
    const blur = () => state.keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    const id = window.setInterval(() => setHud(timeInfo(state.elapsed)), 500);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.clearInterval(id);
    };
  }, [state]);

  return (
    <div className="fixed inset-0 bg-background">
      <GameScene state={state} x={focus[0] ?? 0} z={focus[1] ?? 0} />

      <div className="pointer-events-none fixed inset-0 z-10">
        <div className="flex justify-center pt-5">
          <div className="hud-panel flex items-baseline gap-4 px-6 py-2.5">
            <span className="font-display text-3xl tracking-wide">Day {hud.day}</span>
            <span className="text-sm text-muted-foreground">
              {hud.isDay ? "☀" : "☾"} {formatClock(hud.hours)}
            </span>
          </div>
        </div>
        <div className="absolute right-4 top-20 flex items-center gap-3 sm:top-4">
          {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
          <Button disabled={dead} onClick={onSignOut} className="pointer-events-auto">
            Save & sign out
          </Button>
        </div>
        {riding && <div className="hud-panel absolute bottom-24 left-1/2 flex h-16 w-40 -translate-x-1/2 items-baseline justify-center gap-2 px-4 py-3" aria-label="Scooter speed"><span className="font-display text-3xl tabular-nums">{speed}</span><span className="text-xs text-muted-foreground">MPH</span></div>}
        <div className="absolute bottom-6 left-1/2 w-64 max-w-[calc(100%-2rem)] -translate-x-1/2 hud-panel px-4 py-3">
          <div className="mb-2 flex justify-between text-xs font-bold">
            <span>HEALTH</span><span>{health}%</span>
          </div>
          <Progress aria-label="Health" value={health} className={`health-meter h-3 ${health <= 20 ? "health-critical" : ""}`} />
        </div>
      </div>
      {dead && (
        <div role="alert" className="death-screen pointer-events-auto fixed inset-0 z-20 flex items-center justify-center">
          <h1 className="font-display text-5xl text-destructive sm:text-7xl">YOU DIED</h1>
        </div>
      )}
    </div>
  );
}
