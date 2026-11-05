import * as THREE from "three";
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
import { uiCaptured, type GameState } from "./state";
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
import { lookSupport } from "./mouseLook";
import { TouchControls } from "./TouchControls";
import { LifeWorld } from "./LifeWorld";
import { Billboards } from "./Billboards";
import { ShopPanel } from "@/components/ShopPanel";
import { InventoryButton } from "@/components/Inventory";
import { InventoryWorld } from "./InventoryWorld";
import { pressInventorySlot } from "./invRuntime";
import { LevelBadge, Phone, RouteHint, Toasts } from "@/components/Phone";
import { HomeView } from "./HomeView";
import { guideDone } from "./lifeRuntime";
import { autoLowerQuality, qualityChosen, quality, readQuality, softwareRendering, startQuality } from "./quality";
import { useFrame } from "@react-three/fiber";

const BLOCKED = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/** Test builds only: exposes the scene so browser checks can inspect it. */
function SceneHook() {
  const scene = useThree((t) => t.scene), camera = useThree((t) => t.camera), gl = useThree((t) => t.gl);
  useEffect(() => {
    if (import.meta.env["VITE_TRAFFIC_AUDIT"] !== "1") return;
    Object.assign(window, { __scene: scene, __camera: camera, __gl: gl });
    // ?norender: run the game without drawing it, so logic checks see a realistic frame rate.
    if (new URLSearchParams(location.search).has("norender")) gl.render = () => {};
  }, [scene, camera, gl]);
  return null;
}

/**
 * Draws the city each frame, except while the player is inside their home (a full-screen view of its own): the
 * city keeps living (traffic, people, the clock) but costs nothing to draw. Taking over drawing (priority 1) also
 * means three draws exactly once per frame, after every other update.
 */
function RenderGate({ state }: { state: GameState }) {
  useFrame((s) => { if (!state.home) s.gl.render(s.scene, s.camera); }, 1);
  return null;
}

/**
 * Keeps slow devices playable in any browser: after the first seconds (loading, first drawing), if the game runs
 * under 30 frames a second on Medium or High and nobody picked the device speed here, it switches to Low on the
 * spot (lower resolution, no shadows) and remembers Low for next time, when the rest of Low applies too.
 */
function PerformanceGuard() {
  const gl = useThree((t) => t.gl), scene = useThree((t) => t.scene), setDpr = useThree((t) => t.setDpr);
  const m = useRef({ start: performance.now(), frames: 0, from: 0, done: readQuality() === "low" || qualityChosen() });
  useFrame(() => {
    const r = m.current, now = performance.now();
    if (r.done) return;
    if (now - r.start < 8000 || document.hidden) { r.from = now; r.frames = 0; return; }
    r.frames++;
    if (now - r.from < 5000) return;
    const fps = (r.frames * 1000) / (now - r.from);
    r.frames = 0; r.from = now;
    if (fps >= 30) return;
    r.done = true;
    setDpr(0.65);
    gl.shadowMap.enabled = false;
    scene.traverse((o) => { if ((o as THREE.Light).isLight && o.castShadow) o.castShadow = false; });
    autoLowerQuality();
    window.dispatchEvent(new CustomEvent("bellmont-notice", { detail: "lowered" }));
  });
  return null;
}

/**
 * Prepares (compiles) everything the browser will need to draw, up front, so nothing stalls mid-game: once the
 * world has loaded, every object is briefly counted as shown and the drawing code is built for each lighting
 * the game uses — day, day by a restaurant, and night — without waiting on it. Without this, the first dusk, the
 * first restaurant visit or the first close-up of a car would each freeze the game while that code is built.
 */
function Precompile() {
  const gl = useThree((t) => t.gl), scene = useThree((t) => t.scene), camera = useThree((t) => t.camera);
  const done = useRef(false), since = useRef(performance.now());
  useFrame(() => {
    if (done.current || performance.now() - since.current < 4000) return;
    let traffic = false; scene.traverse((o) => { if (o.name === "perf:traffic") traffic = true; });
    if (!traffic) return;
    done.current = true;
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => { if (!o.visible && !(o as THREE.Light).isLight) { hidden.push(o); o.visible = true; } });
    const lights: THREE.Light[] = [];
    scene.traverse((o) => { const l = o as THREE.Light; if ((l as THREE.PointLight).isPointLight || (l as THREE.SpotLight).isSpotLight) lights.push(l); });
    const was = lights.map((l) => l.visible);
    const restaurant = lights.filter((l) => (l as THREE.PointLight).isPointLight && (l as THREE.PointLight).distance === 11);
    const variants: ((l: THREE.Light) => boolean)[] = [() => false, (l) => restaurant.includes(l), () => true];
    for (const on of variants) {
      lights.forEach((l) => { l.visible = on(l); });
      void gl.compileAsync(scene, camera).catch(() => {});
    }
    lights.forEach((l, i) => { l.visible = was[i] ?? l.visible; });
    hidden.forEach((o) => { o.visible = false; });
  });
  return null;
}

// HUD ticks never reconcile the physics/scene tree. Only a streamed cell does.
const GameScene = memo(function GameScene({ state, x, z, Extra }: { state: GameState; x: number; z: number; Extra?: GameExtras["Scene"] }) {
  const q = useMemo(() => startQuality(), []);
  const city = useMemo(() => generateCity(state.worldSeed, x, z, q.streamBlocks), [state.worldSeed, x, z, q]);
  // Everything else in the city, drawn (lit at night) out to the horizon.
  // (On low, none: less to build, hold in memory and draw.)
  const whole = useMemo(() => (q.farCity ? wholeCity(state.worldSeed) : { buildings: [], lamps: [] }), [state.worldSeed, q]);
  const far = useMemo(() => farCity(whole, x, z), [whole, x, z]);
  return <Canvas shadows={q.shadows} dpr={q.dpr} gl={{ antialias: q.antialias, powerPreference: "high-performance", stencil: false }} camera={{ fov: 60, near: 0.1, far: q.far }}>
    <PerformanceGuard />
    <Precompile />
    <RenderGate state={state} />
    {/* Each part of the scene in its own named group (no effect on the picture), so performance checks can
        measure what each costs. */}
    <group name="perf:sky"><SkyAndLights state={state} /></group>
    <SceneHook />
    <group name="perf:roads"><WorldRoads x={x} z={z} seed={state.worldSeed} /></group>
    <group name="perf:city"><City city={city} far={far} state={state} /></group>
    <group name="perf:lamplights"><LampLights city={city} state={state} /></group>
    <group name="perf:park"><ParkLights state={state} /></group>
    <group name="perf:billboards"><Billboards state={state} /></group>
    <Suspense fallback={null}>
      <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60} interpolate>
        <PhysicsGround city={city} x={x} z={z} state={state} /><RestaurantWalls city={city} state={state} />
        <group name="perf:signals"><TrafficSignals state={state} /></group>
        <group name="perf:npcs"><Pedestrians state={state} city={city} /></group>
        <RestaurantInteraction state={state} city={city} />
        <BenchInteraction state={state} />
        <group name="perf:traffic"><Traffic state={state} /></group>
        <group name="perf:player"><Scooter state={state} /><Player state={state} city={city} /><Ragdoll state={state} /></group>
        <CameraRig state={state} />
        {Extra && <group name="perf:room"><Extra state={state} /></group>}
        <group name="perf:food"><Food state={state} /></group>
        <group name="perf:life"><LifeWorld state={state} /><InventoryWorld state={state} /></group>
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
  const [needs, setNeeds] = useState({ hunger: state.hunger, thirst: state.thirst });
  const [riding, setRiding] = useState(state.scooter.riding);
  const [speed, setSpeed] = useState(0);
  const [dead, setDead] = useState(state.health === 0);
  const [cash, setCash] = useState(state.cash);
  // First person with the pointer not yet locked: a hint to click (turning is then unlimited).
  const [fpHint, setFpHint] = useState(false);
  /** A notice about speed: drawing without the graphics card (at the start), or switched to Low while playing. */
  const [notice, setNotice] = useState<"software" | "lowered" | null>(() => (softwareRendering() ? "software" : null));
  useEffect(() => {
    const on = (e: Event) => setNotice((e as CustomEvent<"lowered">).detail);
    window.addEventListener("bellmont-notice", on);
    return () => window.removeEventListener("bellmont-notice", on);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), notice === "software" ? 20000 : 7000);
    return () => window.clearTimeout(id);
  }, [notice]);
  const dayBox = useRef<HTMLDivElement>(null), actionsRow = useRef<HTMLDivElement>(null);
  // Phones: keep the day box centred, unless the people count or the buttons would cover it; then it sits in the
  // middle of the space between them (shrunk a little if even that is too narrow).
  useEffect(() => {
    const fit = () => {
      const box = dayBox.current, row = actionsRow.current;
      if (!box || !row || !box.offsetWidth) return;
      box.style.transform = ""; box.style.left = "";
      const width = box.offsetWidth, screen = window.innerWidth;
      const leftEdge = (document.querySelector("[data-hud-left]")?.getBoundingClientRect().right ?? 8) + 8;
      const rightEdge = row.getBoundingClientRect().left - 8;
      const room = rightEdge - leftEdge;
      let x = screen / 2 - width / 2, scale = 1;
      if (x < leftEdge || x + width > rightEdge) {
        scale = Math.min(1, room / width);
        x = leftEdge + (room - width * scale) / 2;
      }
      box.style.left = `${x}px`;
      box.style.transform = scale < 1 ? `scale(${scale})` : "none";
      box.style.transformOrigin = "left center";
    };
    fit();
    const id = window.setInterval(fit, 300);
    window.addEventListener("resize", fit);
    return () => { window.clearInterval(id); window.removeEventListener("resize", fit); };
  }, []);
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
      setNeeds((old) => (Math.round(old.hunger * 2) === Math.round(state.hunger * 2) && Math.round(old.thirst * 2) === Math.round(state.thirst * 2) ? old : { hunger: state.hunger, thirst: state.thirst }));
      setCash(state.cash);
      setFpHint(state.firstPerson && !document.pointerLockElement && !lookSupport.lockRefused);
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
      // The phone: P opens and closes it, Escape closes it; while it's open the character stays put.
      // The phone is slot 1 of the inventory: P (or 1) takes it out and puts it away.
      if (e.code === "KeyP" && !e.repeat && !state.home) { pressInventorySlot(state, 0); e.preventDefault(); return; }
      // Number keys 1–9: the inventory's slots. I or Tab opens the grid.
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit && !e.repeat && !state.home && !state.shop && !state.foodUi.open && !state.uiLock) { pressInventorySlot(state, Number(digit[1]) - 1); e.preventDefault(); return; }
      if ((e.code === "KeyI" || e.code === "Tab") && !e.repeat && !state.home) { state.inventoryOpen = !state.inventoryOpen; if (state.inventoryOpen) state.keys.clear(); e.preventDefault(); return; }
      if (e.code === "Escape" && state.inventoryOpen) { state.inventoryOpen = false; return; }
      if (e.code === "Escape" && state.phone.open) { state.phone = { open: false, app: null, atm: false }; return; }
      if (e.code === "Escape" && state.shop) { state.shop = null; return; }
      if (uiCaptured(state) || state.home) return;
      if (BLOCKED.has(e.code)) e.preventDefault();
      if (state.health === 0 || state.accident) return;
      if (e.code === "KeyE" && !e.repeat) { state.interactQueued = true; e.preventDefault(); }
      // Q: put down whatever is in the hands.
      if (e.code === "KeyQ" && !e.repeat) { state.dropQueued = true; e.preventDefault(); }
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
        {/* Phones: a smaller day box, centred, the same height as the buttons beside it (placed by fitDayBox). */}
        <div ref={dayBox} className="hud-panel absolute left-1/2 top-4 flex h-8 items-center gap-2 whitespace-nowrap px-2.5 sm:hidden">
          <span className="font-display text-base leading-none tracking-wide">Day {hud.day}</span>
          <span className="text-[10px] leading-none text-muted-foreground">{hud.isDay ? "☀" : "☾"} {formatClock(hud.hours)}</span>
        </div>
        {/* Wide screens: the day and time centred at the top. */}
        <div className="hidden justify-center pt-5 sm:flex">
          <div className="hud-panel flex items-baseline gap-4 px-6 py-2.5">
            <span className="font-display text-3xl tracking-wide">Day {hud.day}</span>
            <span className="text-sm text-muted-foreground">
              {hud.isDay ? "☀" : "☾"} {formatClock(hud.hours)}
            </span>
          </div>
        </div>
        <div className="absolute right-4 top-4 flex flex-col items-end gap-1.5">
          <div ref={actionsRow} className="hud-actions relative flex items-center gap-2 sm:gap-3">
            {saving && <span className="absolute right-0 top-full mt-1 whitespace-nowrap text-xs text-muted-foreground sm:static sm:mt-0">Saving…</span>}
            {Actions && <Actions />}
            <Button disabled={dead} onClick={onSignOut} className="pointer-events-auto h-8 px-3 text-xs sm:h-9 sm:px-4 sm:text-sm">
              {exitLabel}
            </Button>
          </div>
          {extras?.exitNote && <span className="text-[11px] font-bold tracking-wide text-white sm:text-sm">{extras.exitNote}</span>}
        </div>
        {Overlay && <Overlay state={state} />}
        {riding && <div className="hud-panel absolute bottom-24 left-1/2 flex h-16 w-40 -translate-x-1/2 items-baseline justify-center gap-2 px-4 py-3" aria-label="Scooter speed"><span className="font-display text-3xl tabular-nums">{speed}</span><span className="text-xs text-muted-foreground">MPH</span></div>}
        <div className="absolute bottom-6 left-1/2 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-stretch gap-2">
          <div className="hud-panel w-64 min-w-0 space-y-1.5 px-4 py-2.5">
            {([["HEALTH", health, "health"], ["HUNGER", needs.hunger, "hunger"], ["THIRST", needs.thirst, "thirst"]] as const).map(([label, value, kind]) => (
              <div key={kind}>
                <div className="mb-0.5 flex justify-between text-[10px] font-bold leading-none tracking-wide">
                  <span>{label}</span><span className="tabular-nums">{Math.round(value)}%</span>
                </div>
                <Progress aria-label={label.charAt(0) + label.slice(1).toLowerCase()} value={value} className={`need-meter need-${kind} h-1.5 ${value <= 20 ? "need-low" : ""}`} />
              </div>
            ))}
          </div>
          <div className="hud-panel flex aspect-square shrink-0 flex-col items-center justify-center gap-1 px-1" aria-label={`Cash: $${cashText}`}>
            <span className="text-[10px] font-bold leading-none tracking-wide">CASH</span>
            <span className="flex items-center gap-1 text-xs font-bold leading-none tabular-nums">
              <svg viewBox="0 0 24 14" className="h-3 w-5 shrink-0" aria-hidden><rect x="0.5" y="0.5" width="23" height="13" rx="1.5" fill="#2e7d32" stroke="#1b5e20" /><rect x="2.5" y="2.5" width="19" height="9" rx="1" fill="none" stroke="#a5d6a7" strokeWidth="0.8" /><circle cx="12" cy="7" r="3.2" fill="#a5d6a7" /><text x="12" y="9.3" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#1b5e20">$</text></svg>
              ${cashText}
            </span>
          </div>
          <LevelBadge state={state} />
          <InventoryButton state={state} />
        </div>
      </div>
      {notice && <div role="status" className="hud-panel pointer-events-auto fixed left-1/2 top-16 z-30 flex max-w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 items-start gap-3 px-4 py-3 text-sm text-foreground sm:top-24">
        <p className="flex-1 leading-snug">{notice === "software"
          ? <>This browser is drawing the game <b>without your graphics card</b>, which makes it very slow, so it's on <b>Low</b>. To fix it in Chrome or Edge: <b>Settings → System</b>, turn on <b>“Use graphics acceleration when available”</b>, then restart the browser.</>
          : <>The game was running slowly here, so it switched to <b>Device speed: Low</b> for smoother play. You can change it on the home page.</>}</p>
        <button type="button" aria-label="Close" className="text-muted-foreground hover:text-foreground" onClick={() => setNotice(null)}>✕</button>
      </div>}
      {fpHint && <div className="pointer-events-none fixed left-1/2 top-1/2 z-20 -translate-x-1/2 translate-y-10 rounded-md bg-black/55 px-3 py-1.5 text-xs font-semibold text-white">Click to look around freely</div>}
      {!dead && <TouchControls state={state} />}
      <OrderMenu state={state} />
      <RouteHint state={state} />
      <Toasts state={state} />
      <Phone state={state} /><ShopPanel state={state} />
      {!dead && <HomeView state={state} />}
      <div ref={fade} className="pointer-events-none fixed inset-0 z-30 bg-black" style={{ opacity: 0 }} aria-hidden />
      {dead && (
        <div role="alert" className="death-screen pointer-events-auto fixed inset-0 z-20 flex items-center justify-center">
          <h1 className="font-display text-5xl text-destructive sm:text-7xl">YOU DIED</h1>
        </div>
      )}
    </div>
  );
}
