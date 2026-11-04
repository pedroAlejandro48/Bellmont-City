import { useCharacterColor } from "./characterColor";
import { foodValue } from "./shops";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { timeInfo } from "./config";
import { CharacterBody, useBodyRig } from "./CharacterBody";
import { isDrinkName } from "./food";
import { HOMES } from "./life";
import { lifeEvent } from "./lifeRuntime";
import { canConsume, consume } from "./needs";
import { quality } from "./quality";
import { toast, type GameState } from "./state";

/** The apartment: a room of ROOM.w × ROOM.d metres; the character keeps RADIUS from walls and furniture. */
const ROOM = { w: 7, d: 5.4, h: 2.8 };
const RADIUS = 0.3;
/** Furniture footprints (x, z centre, half sizes) the character walks around, and the spots E works at. */
const SOLIDS = [
  { x: -2.3, z: -1.7, hx: 1.05, hz: 1.0 }, // bed (head to the back wall)
  { x: 3.05, z: -2.2, hx: 0.42, hz: 0.38 }, // fridge
  { x: 1.6, z: 1.9, hx: 1.1, hz: 0.45 }, // sofa
  { x: 1.6, z: -2.35, hx: 0.8, hz: 0.25 }, // TV stand
];
const SPOTS = {
  bed: { x: -2.3, z: -0.35, label: "Sleep" },
  fridge: { x: 3.05, z: -1.45, label: "Fridge" },
  door: { x: -0.2, z: 2.25, label: "Leave" },
};
type Spot = keyof typeof SPOTS;


/**
 * Home: the player's apartment, shown over the city (which keeps running, undrawn). Walk with the same keys or
 * joystick; E at the bed sleeps (health back, and alone the night is skipped), at the fridge opens it (store the
 * food you carry, or eat from it), at the door goes back out. Fades in and out.
 */
export function HomeView({ state }: { state: GameState }) {
  const [inside, setInside] = useState(false), [shown, setShown] = useState(false);
  const [fridge, setFridge] = useState(false), [near, setNear] = useState<Spot | null>(null), [sleeping, setSleeping] = useState(false);
  const pos = useRef({ x: SPOTS.door.x, z: SPOTS.door.z - 0.6, yaw: Math.PI, speed: 0 });
  const keys = useRef(new Set<string>());
  const interact = useRef(false);
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = !!state.home;
      if (now !== inside) {
        setInside(now);
        if (now) { pos.current = { x: SPOTS.door.x, z: SPOTS.door.z - 0.6, yaw: Math.PI, speed: 0 }; window.setTimeout(() => setShown(true), 30); }
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [state, inside]);
  useEffect(() => {
    if (!inside) return;
    const down = (e: KeyboardEvent) => {
      if (state.phone.open) return;
      if (e.code === "KeyE" && !e.repeat) { interact.current = true; e.preventDefault(); return; }
      if (e.code === "Escape") { setFridge(false); return; }
      keys.current.add(e.code);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); keys.current.clear(); };
  }, [inside, state]);

  const leave = () => {
    setShown(false); setFridge(false);
    window.setTimeout(() => {
      const h = state.home;
      if (h) { state.pos.set(h.returnTo[0], state.pos.y, h.returnTo[1]); state.rotY = h.returnYaw; state.camYaw = h.returnYaw + Math.PI; state.camOrbit = 0; }
      state.home = null;
    }, 450);
  };
  const sleep = () => {
    setSleeping(true);
    window.setTimeout(() => {
      state.health = 100;
      // Alone, the night is skipped to 6:30 in the morning; in a shared room the clock is everyone's.
      const shared = !!state.npcLink;
      if (!shared) {
        const t = timeInfo(state.elapsed), cycle = 2400, into = ((state.elapsed % cycle) + cycle) % cycle;
        if (!t.isDay || t.hours > 18) state.elapsed += cycle - into + 50;
      }
      toast(state, "Good morning!", "info", shared ? "Rested: health is full." : "You slept through the night. Health is full.");
      setSleeping(false);
    }, 2200);
  };
  const use = (spot: Spot) => {
    if (spot === "door") leave();
    else if (spot === "bed") sleep();
    else setFridge(true);
  };
  useEffect(() => { if (inside) state.keys.clear(); }, [inside, state]);

  if (!inside) return null;
  const home = state.life.home;
  return <div className={`home-view ${shown ? "in" : ""}`}>
    <Canvas shadows={false} dpr={quality().dpr} camera={{ fov: 50, near: 0.1, far: 40, position: [0, 5.2, 6.4] }}>
      <Apartment state={state} pos={pos} keys={keys} interact={interact} onNear={setNear} onUse={use} busy={fridge || sleeping} />
    </Canvas>
    <div className="home-title">{home ? HOMES[home.kind].name : "Home"}</div>
    {near && !fridge && !sleeping && <button type="button" className="home-hint" onClick={() => use(near)}><kbd>E</kbd> {SPOTS[near].label}</button>}
    {fridge && <FridgePanel state={state} onClose={() => setFridge(false)} />}
    <div className={`home-sleep ${sleeping ? "on" : ""}`}><span>Zzz…</span></div>
  </div>;
}

function FridgePanel({ state, onClose }: { state: GameState; onClose: () => void }) {
  const [, tick] = useState(0), life = state.life;
  const held = (["left", "right"] as const).map((h) => state.hands[h]).filter((h): h is NonNullable<typeof h> => !!h && (h.items?.length ?? 0) > 0);
  const store = () => {
    for (const h of held) {
      life.fridge.push(...(h.items ?? []));
      // The pack itself is used up (its contents are in the fridge now).
      state.foodSend?.({ type: "trash", pack: h.id, x: state.pos.x, y: -5, z: state.pos.z });
    }
    life.fridge = life.fridge.slice(0, 12);
    tick((n) => n + 1);
  };
  const eat = (i: number) => {
    const name = life.fridge[i]!;
    if (!canConsume(state, name)) { toast(state, isDrinkName(name) ? "Not thirsty" : "You're full", "warn"); return; }
    const after = consume(state, name, foodValue(name));
    state.hunger = after.hunger; state.thirst = after.thirst;
    life.fridge.splice(i, 1);
    lifeEvent(state, "eat", 1);
    tick((n) => n + 1);
  };
  return <div className="home-panel" role="dialog" aria-label="Fridge">
    <div className="home-panel-head"><b>Fridge</b><button type="button" onClick={onClose} aria-label="Close">✕</button></div>
    {life.fridge.length === 0 ? <p className="phone-note">Empty. Bring food home and store it here.</p> :
      <ul className="phone-list">{life.fridge.map((f, i) => <li key={i}><span>{f}</span><button type="button" className="phone-btn" onClick={() => eat(i)}>{isDrinkName(f) ? "Drink" : "Eat"}</button></li>)}</ul>}
    <button type="button" className="phone-btn ghost" disabled={!held.length || life.fridge.length >= 12} onClick={store}>Store the food you're carrying</button>
    <small className="phone-note">Holds 12 things.</small>
  </div>;
}

function Apartment({ state, pos, keys, interact, onNear, onUse, busy }: {
  state: GameState; pos: React.RefObject<{ x: number; z: number; yaw: number; speed: number }>; keys: React.RefObject<Set<string>>; interact: React.RefObject<boolean>;
  onNear: (s: Spot | null) => void; onUse: (s: Spot) => void; busy: boolean;
}) {
  const color = useCharacterColor(state);
  const rig = useBodyRig();
  const { camera } = useThree();
  const nearRef = useRef<Spot | null>(null), phase = useRef(0);
  const windowMat = useRef<THREE.MeshBasicMaterial>(null), lamp = useRef<THREE.PointLight>(null), sun = useRef<THREE.DirectionalLight>(null);
  const m = useMemo(() => {
    const wood = woodFloor();
    return {
      floor: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.7 }),
      wall: new THREE.MeshStandardMaterial({ color: "#efe6da", roughness: 0.95 }),
      accent: new THREE.MeshStandardMaterial({ color: "#5b7f95", roughness: 0.9 }),
      ceiling: new THREE.MeshStandardMaterial({ color: "#f7f3ee", roughness: 1 }),
      bedFrame: new THREE.MeshStandardMaterial({ color: "#7a5236", roughness: 0.7 }),
      mattress: new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.9 }),
      blanket: new THREE.MeshStandardMaterial({ color: "#3f6fb0", roughness: 0.95 }),
      pillow: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9 }),
      fridge: new THREE.MeshStandardMaterial({ color: "#dfe3e6", roughness: 0.35, metalness: 0.4 }),
      handle: new THREE.MeshStandardMaterial({ color: "#8a9096", metalness: 0.8, roughness: 0.3 }),
      sofa: new THREE.MeshStandardMaterial({ color: "#c76b4a", roughness: 0.9 }),
      dark: new THREE.MeshStandardMaterial({ color: "#1d1f22", roughness: 0.5 }),
      screen: new THREE.MeshStandardMaterial({ color: "#0d1b2a", emissive: new THREE.Color("#2b6cb0"), emissiveIntensity: 0.6, roughness: 0.2 }),
      rug: new THREE.MeshStandardMaterial({ color: "#d9b26f", roughness: 1 }),
      door: new THREE.MeshStandardMaterial({ color: "#8b5e3c", roughness: 0.7 }),
      plant: new THREE.MeshStandardMaterial({ color: "#3e8e41", roughness: 0.9 }),
      pot: new THREE.MeshStandardMaterial({ color: "#c0703a", roughness: 0.8 }),
      lampShade: new THREE.MeshStandardMaterial({ color: "#fff3d6", emissive: new THREE.Color("#ffcf80"), emissiveIntensity: 0.8 }),
    };
  }, []);
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05), p = pos.current, k = keys.current;
    // Walking: keys or the joystick, relative to the fixed camera (up the screen = into the room).
    let mx = 0, mz = 0;
    if (!busy) {
      if (k.has("KeyW") || k.has("ArrowUp")) mz -= 1;
      if (k.has("KeyS") || k.has("ArrowDown")) mz += 1;
      if (k.has("KeyA") || k.has("ArrowLeft")) mx -= 1;
      if (k.has("KeyD") || k.has("ArrowRight")) mx += 1;
      if (state.stick) { mx += state.stick.x; mz -= state.stick.y; }
    }
    const len = Math.hypot(mx, mz), want = len > 0.1 ? 2.1 * Math.min(1, len) : 0;
    p.speed += (want - p.speed) * (1 - Math.exp(-10 * dt));
    if (len > 0.1) {
      const nx = p.x + (mx / len) * p.speed * dt, nz = p.z + (mz / len) * p.speed * dt;
      const free = (x: number, z: number) => Math.abs(x) < ROOM.w / 2 - RADIUS && Math.abs(z) < ROOM.d / 2 - RADIUS && SOLIDS.every((s) => Math.abs(x - s.x) > s.hx + RADIUS || Math.abs(z - s.z) > s.hz + RADIUS);
      if (free(nx, nz)) { p.x = nx; p.z = nz; } else if (free(nx, p.z)) p.x = nx; else if (free(p.x, nz)) p.z = nz;
      const target = Math.atan2(mx, mz);
      p.yaw += Math.atan2(Math.sin(target - p.yaw), Math.cos(target - p.yaw)) * (1 - Math.exp(-12 * dt));
    }
    // Nearest thing to use.
    let best: Spot | null = null, bestD = 1.1;
    for (const [id, s] of Object.entries(SPOTS) as [Spot, (typeof SPOTS)[Spot]][]) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < bestD) { bestD = d; best = id; } }
    if (best !== nearRef.current) { nearRef.current = best; onNear(best); }
    if (interact.current) { interact.current = false; if (best && !busy) onUse(best); }
    // Pose: a walk cycle while moving.
    const root = rig.root.current;
    if (root) {
      root.position.set(p.x, 0, p.z); root.rotation.set(0, p.yaw, 0);
      phase.current += dt * p.speed * 4.2;
      const mv = Math.min(1, p.speed / 2), s = Math.sin(phase.current), c = Math.cos(phase.current);
      rig.thighL.current?.rotation.set(-s * 0.5 * mv, 0, 0.13); rig.thighR.current?.rotation.set(s * 0.5 * mv, 0, -0.13);
      rig.shinL.current?.rotation.set(0.08 + 0.65 * mv * Math.max(0, c), 0, 0); rig.shinR.current?.rotation.set(0.08 + 0.65 * mv * Math.max(0, -c), 0, 0);
      rig.armL.current?.rotation.set(s * 0.4 * mv, 0, 0.12); rig.armR.current?.rotation.set(-s * 0.4 * mv, 0, -0.12);
      rig.foreL.current?.rotation.set(-0.15, 0, 0); rig.foreR.current?.rotation.set(-0.15, 0, 0);
      if (rig.hips.current) rig.hips.current.position.y = 0.95 - Math.abs(c) * 0.035 * mv;
    }
    // The camera follows a little, from above the doorway.
    camera.position.lerp(new THREE.Vector3(p.x * 0.35, 5.2, 6.4 + p.z * 0.15), 1 - Math.exp(-3 * dt));
    camera.lookAt(p.x * 0.5, 0.6, p.z * 0.4 - 0.4);
    // The window shows the sky outside; the lamp comes on at night.
    const { darkness } = timeInfo(state.elapsed);
    windowMat.current?.color.setRGB(0.55 - darkness * 0.5, 0.75 - darkness * 0.68, 0.95 - darkness * 0.75);
    if (lamp.current) lamp.current.intensity = 2 + darkness * 10;
    if (sun.current) sun.current.intensity = 1.6 * (1 - darkness) + 0.2;
  });
  const W = ROOM.w, D = ROOM.d, H = ROOM.h;
  return <>
    <hemisphereLight args={["#fff6e8", "#6b5a48", 0.9]} />
    <directionalLight ref={sun} position={[-3, 6, -2]} intensity={1.4} />
    <pointLight ref={lamp} position={[2.7, 2.2, 1.6]} distance={9} decay={1.4} color="#ffd9a0" />
    {/* Room shell (the near wall is left out so the camera sees in). */}
    <mesh material={m.floor} rotation-x={-Math.PI / 2}><planeGeometry args={[W, D]} /></mesh>
    <mesh material={m.ceiling} position-y={H} rotation-x={Math.PI / 2}><planeGeometry args={[W, D]} /></mesh>
    <mesh material={m.wall} position={[0, H / 2, -D / 2]}><planeGeometry args={[W, H]} /></mesh>
    <mesh material={m.accent} position={[-W / 2, H / 2, 0]} rotation-y={Math.PI / 2}><planeGeometry args={[D, H]} /></mesh>
    <mesh material={m.wall} position={[W / 2, H / 2, 0]} rotation-y={-Math.PI / 2}><planeGeometry args={[D, H]} /></mesh>
    {/* Window on the back wall, the sky's colour. */}
    <mesh position={[0, 1.65, -D / 2 + 0.01]}><planeGeometry args={[1.6, 1.1]} /><meshBasicMaterial ref={windowMat} color="#9cc7ef" /></mesh>
    <mesh material={m.dark} position={[0, 1.65, -D / 2 + 0.02]}><boxGeometry args={[1.7, 0.06, 0.04]} /></mesh>
    <mesh material={m.dark} position={[0, 1.65, -D / 2 + 0.02]}><boxGeometry args={[0.05, 1.15, 0.04]} /></mesh>
    {/* Bed. */}
    <group position={[-2.3, 0, -1.7]}>
      <mesh material={m.bedFrame} position-y={0.22}><boxGeometry args={[2.0, 0.3, 2.0]} /></mesh>
      <mesh material={m.bedFrame} position={[0, 0.6, -0.98]}><boxGeometry args={[2.0, 0.9, 0.08]} /></mesh>
      <mesh material={m.mattress} position-y={0.45}><boxGeometry args={[1.9, 0.18, 1.9]} /></mesh>
      <mesh material={m.blanket} position={[0, 0.56, 0.25]}><boxGeometry args={[1.92, 0.06, 1.35]} /></mesh>
      {[-0.45, 0.45].map((x) => <mesh key={x} material={m.pillow} position={[x, 0.6, -0.68]}><boxGeometry args={[0.7, 0.12, 0.38]} /></mesh>)}
    </group>
    {/* Fridge. */}
    <group position={[3.05, 0, -2.2]}>
      <mesh material={m.fridge} position-y={0.95}><boxGeometry args={[0.8, 1.9, 0.72]} /></mesh>
      <mesh material={m.handle} position={[-0.3, 1.25, 0.37]}><boxGeometry args={[0.04, 0.5, 0.04]} /></mesh>
      <mesh material={m.dark} position={[0, 1.33, 0.365]}><boxGeometry args={[0.8, 0.01, 0.01]} /></mesh>
    </group>
    {/* Sofa facing the TV. */}
    <group position={[1.6, 0, 1.9]}>
      <mesh material={m.sofa} position-y={0.28}><boxGeometry args={[2.2, 0.4, 0.9]} /></mesh>
      <mesh material={m.sofa} position={[0, 0.65, 0.35]}><boxGeometry args={[2.2, 0.6, 0.2]} /></mesh>
      {[-1.05, 1.05].map((x) => <mesh key={x} material={m.sofa} position={[x, 0.45, 0]}><boxGeometry args={[0.18, 0.5, 0.9]} /></mesh>)}
    </group>
    <group position={[1.6, 0, -2.35]}>
      <mesh material={m.dark} position-y={0.25}><boxGeometry args={[1.6, 0.5, 0.45]} /></mesh>
      <mesh material={m.dark} position={[0, 1.05, 0]}><boxGeometry args={[1.5, 0.85, 0.06]} /></mesh>
      <mesh material={m.screen} position={[0, 1.05, 0.035]}><planeGeometry args={[1.42, 0.78]} /></mesh>
    </group>
    <mesh material={m.rug} position={[1.6, 0.005, 0]} rotation-x={-Math.PI / 2}><planeGeometry args={[2.6, 1.8]} /></mesh>
    {/* Lamp and plant. */}
    <group position={[3.05, 0, 1.6]}>
      <mesh material={m.dark} position-y={0.75}><cylinderGeometry args={[0.03, 0.03, 1.5, 8]} /></mesh>
      <mesh material={m.lampShade} position-y={1.55}><cylinderGeometry args={[0.18, 0.26, 0.3, 16, 1, true]} /></mesh>
    </group>
    <group position={[-3.05, 0, 2.0]}>
      <mesh material={m.pot} position-y={0.2}><cylinderGeometry args={[0.2, 0.16, 0.4, 14]} /></mesh>
      <mesh material={m.plant} position-y={0.75} scale={[1, 1.3, 1]}><icosahedronGeometry args={[0.38, 1]} /></mesh>
    </group>
    {/* The way out, on the near side (its wall is cut away for the camera): a doormat and a low threshold, so
        nothing stands between the camera and you. */}
    <mesh material={m.door} position={[SPOTS.door.x, 0.012, D / 2 - 0.4]} rotation-x={-Math.PI / 2}><planeGeometry args={[1.2, 0.7]} /></mesh>
    <mesh material={m.door} position={[SPOTS.door.x, 0.03, D / 2 - 0.02]}><boxGeometry args={[1.1, 0.06, 0.1]} /></mesh>
    <CharacterBody rig={rig} color={color} />
  </>;
}

function woodFloor() {
  const c = document.createElement("canvas"); c.width = 256; c.height = 256;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 8; i++) {
    const shade = 150 + ((i * 37) % 40);
    g.fillStyle = `rgb(${shade}, ${Math.round(shade * 0.72)}, ${Math.round(shade * 0.48)})`; g.fillRect(0, i * 32, 256, 32);
    g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(0, i * 32, 256, 1.5);
    g.fillRect(((i * 97) % 200) + 20, i * 32, 1.5, 32);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 2); t.colorSpace = THREE.SRGBColorSpace; return t;
}
