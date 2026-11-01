import { Canvas, useThree } from "@react-three/fiber";
import { memo, startTransition, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Physics } from "@react-three/rapier";
import { Ragdoll } from "./Ragdoll";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DEATH_SCREEN_SECONDS, farCity, formatClock, generateCity, timeInfo, wholeCity } from "./config";
import { City, LampLights } from "./City";
import { ParkLights } from "./ParkLights";
import { TrafficSignals } from "./TrafficSignals";
import { Pedestrians } from "./Pedestrians";
import { Player } from "./Player";
import { SkyAndLights } from "./Sky";
import { Traffic } from "./Traffic";
import type { GameState } from "./state";
import { CameraRig } from "./CameraRig";
import { WorldRoads } from "./WorldRoads";
import { PITCH, MPH_TO_MPS } from "./config";
import { Scooter } from "./Scooter";
import { BenchInteraction } from "./BenchInteraction";
import { RestaurantInteraction } from "./RestaurantInteraction";
import { Food } from "./Food";
import { OrderMenu } from "@/components/OrderMenu";
import { PhysicsGround, RestaurantWalls } from "./PhysicsGround";
import type { GameExtras } from "./CloudGame";

const BLOCKED = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/** Test builds only: exposes the scene so browser checks can inspect it. */
function SceneHook() {
  const scene = useThree((t) => t.scene), camera = useThree((t) => t.camera), gl = useThree((t) => t.gl);
  useEffect(() => {
    if (import.meta.env["VITE_TRAFFIC_AUDIT"] !== "1") return;
    Object.assign(window, { __scene: scene, __camera: camera });
    // ?norender: run the game without drawing it, so logic checks see a realistic frame rate.
    if (new URLSearchParams(location.search).has("norender")) gl.render = () => {};
  }, [scene, camera, gl]);
  return null;
}

// HUD ticks never reconcile the physics/scene tree. Only a streamed cell does.
const GameScene = memo(function GameScene({ state, x, z, Extra }: { state: GameState; x: number; z: number; Extra?: GameExtras["Scene"] }) {
  const city = useMemo(() => generateCity(state.worldSeed, x, z), [state.worldSeed, x, z]);
  // Everything else in the city, drawn (lit at night) out to the horizon.
  const whole = useMemo(() => wholeCity(state.worldSeed), [state.worldSeed]);
  const far = useMemo(() => farCity(whole, x, z), [whole, x, z]);
  return <Canvas shadows dpr={[1, 1.25]} camera={{ fov: 60, near: 0.1, far: 1200 }}>
    <SkyAndLights state={state} />
    <SceneHook />
    <WorldRoads x={x} z={z} seed={state.worldSeed} />
    <City city={city} far={far} state={state} />
    <LampLights city={city} state={state} />
    <ParkLights state={state} />
    <Suspense fallback={null}>
      <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60} interpolate>
        <PhysicsGround city={city} x={x} z={z} /><RestaurantWalls city={city} /><TrafficSignals state={state} /><Pedestrians state={state} city={city} />
        <RestaurantInteraction state={state} city={city} />
        <BenchInteraction state={state} /><Traffic state={state} /><Scooter state={state} /><Player state={state} city={city} />
        <Ragdoll state={state} /><CameraRig state={state} />
        {Extra && <Extra state={state} />}
        <Food state={state} />
      </Physics>
    </Suspense>
  </Canvas>;
});

export function GameCanvas({ state, onSignOut, onDeath, onReset, saving, exitLabel = "Save & sign out", extras }: { state: GameState; onSignOut: () => void; onDeath: () => void; onReset: () => void; saving: boolean; exitLabel?: string; extras?: GameExtras | undefined }) {
  const Overlay = extras?.Overlay, Actions = extras?.Actions;
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
  const [cash, setCash] = useState(state.cash);
  // Whole dollars as they are; cents once there are any.
  const cashText = Number.isInteger(cash) ? String(cash) : cash.toFixed(2);
  // Test builds only: lets browser tests drive the character.
  useEffect(() => { if (import.meta.env["VITE_TRAFFIC_AUDIT"] === "1") (window as unknown as { __game?: GameState }).__game = state; }, [state]);
  const fade = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The black fade between outside and inside a restaurant, every frame.
    let id = 0;
    const tick = () => { if (fade.current) fade.current.style.opacity = String(state.fade); id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [state]);

  useEffect(() => {
    let resetTimer: number | undefined;
    let deathSeen = false;
    const id = window.setInterval(() => {
      setHealth(state.health);
      setCash(state.cash);
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
      // Seated at a restaurant table, Space stands up; during a scripted movement nothing else applies.
      if (state.seat || state.script) { if (e.code === "Space" && !e.repeat) state.standQueued = true; return; }
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
      <GameScene state={state} x={focus[0] ?? 0} z={focus[1] ?? 0} Extra={extras?.Scene} />

      <div className="pointer-events-none fixed inset-0 z-10">
        <div className="flex justify-center pt-5">
          <div className="hud-panel flex items-baseline gap-4 px-6 py-2.5">
            <span className="font-display text-3xl tracking-wide">Day {hud.day}</span>
            <span className="text-sm text-muted-foreground">
              {hud.isDay ? "☀" : "☾"} {formatClock(hud.hours)}
            </span>
          </div>
        </div>
        <div className="absolute right-4 top-20 flex flex-col items-end gap-1.5 sm:top-4">
          <div className="flex items-center gap-3">
            {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
            {Actions && <Actions />}
            <Button disabled={dead} onClick={onSignOut} className="pointer-events-auto">
              {exitLabel}
            </Button>
          </div>
          {extras?.exitNote && <span className="text-sm font-bold tracking-wide text-white">{extras.exitNote}</span>}
        </div>
        {Overlay && <Overlay state={state} />}
        {riding && <div className="hud-panel absolute bottom-24 left-1/2 flex h-16 w-40 -translate-x-1/2 items-baseline justify-center gap-2 px-4 py-3" aria-label="Scooter speed"><span className="font-display text-3xl tabular-nums">{speed}</span><span className="text-xs text-muted-foreground">MPH</span></div>}
        <div className="absolute bottom-6 left-1/2 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-stretch gap-2">
          <div className="hud-panel w-64 min-w-0 px-4 py-3">
            <div className="mb-2 flex justify-between text-xs font-bold">
              <span>HEALTH</span><span>{health}%</span>
            </div>
            <Progress aria-label="Health" value={health} className={`health-meter h-3 ${health <= 20 ? "health-critical" : ""}`} />
          </div>
          <div className="hud-panel flex aspect-square shrink-0 flex-col items-center justify-center gap-1 px-1" aria-label={`Cash: $${cashText}`}>
            <span className="text-[10px] font-bold leading-none tracking-wide">CASH</span>
            <span className="flex items-center gap-1 text-xs font-bold leading-none tabular-nums">
              <svg viewBox="0 0 24 14" className="h-3 w-5 shrink-0" aria-hidden><rect x="0.5" y="0.5" width="23" height="13" rx="1.5" fill="#2e7d32" stroke="#1b5e20" /><rect x="2.5" y="2.5" width="19" height="9" rx="1" fill="none" stroke="#a5d6a7" strokeWidth="0.8" /><circle cx="12" cy="7" r="3.2" fill="#a5d6a7" /><text x="12" y="9.3" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#1b5e20">$</text></svg>
              ${cashText}
            </span>
          </div>
        </div>
      </div>
      <OrderMenu state={state} />
      <div ref={fade} className="pointer-events-none fixed inset-0 z-30 bg-black" style={{ opacity: 0 }} aria-hidden />
      {dead && (
        <div role="alert" className="death-screen pointer-events-auto fixed inset-0 z-20 flex items-center justify-center">
          <h1 className="font-display text-5xl text-destructive sm:text-7xl">YOU DIED</h1>
        </div>
      )}
    </div>
  );
}
