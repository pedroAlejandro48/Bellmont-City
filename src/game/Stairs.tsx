// The apartment buildings' stairs while playing (see stairs.ts): the stairwell drawn for the building you're in, and
// walking it — what's underfoot (the steps are walked like a slope by the body; the feet step tread to tread), the
// floor you're on changing as you go up or down, and the lobby's opening shut while you're up in the stairwell.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { stairsTexture } from "./Signs";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { APT_FLOORS, aptKey, floorKey, floorY } from "./apartments";
import { FLOOR_CLEAR, aptFloorOf } from "./aptRoom";
import type { Building, City } from "./config";
import { toLocal, type Box } from "./restaurantRoom";
import { LAND_W, SW, TREAD, flightUnder, floorAtHeight, footNow, footReach, legsToFeet, legsToFeetAt, stairGround, stairPlan, stepFeet, treadMiddle, type Feet, type StairPlan } from "./stairs";
import type { GameState } from "./state";
import { venueLayout, type VenueLayout } from "./venueRoom";

/** The top of the stairwell (the top floor's ceiling), world height. */
const topOf = () => floorY(APT_FLOORS) + FLOOR_CLEAR;

/** A floor's number for the plate over its landing (drawn once per number). */
const plates = new Map<number, THREE.CanvasTexture>();
function plateTexture(n: number) {
  let t = plates.get(n);
  if (t) return t;
  const c = document.createElement("canvas"); c.width = 128; c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fbf8f1"; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "#b9b2a4"; g.lineWidth = 6; g.strokeRect(3, 3, 122, 122);
  g.fillStyle = "#2b2d33"; g.font = "800 76px Manrope, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(n === 1 ? "L" : String(n), 64, 70);
  t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; plates.set(n, t);
  return t;
}

/** The stairwell's parts as geometries (steps and landings; walls; handrails and step edges; lights), in the
 * building's frame. Every wall is solid and reaches past the floors' slab edges, so no slab edge or face shares a
 * plane with anything (no lines, no flicker). */
function stairGeometry(p: StairPlan) {
  const steps: THREE.BufferGeometry[] = [], walls: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [], lights: THREE.BufferGeometry[] = [];
  const box = (into: THREE.BufferGeometry[], x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); into.push(g);
  };
  const bottom = floorY(1), top = topOf(), topFloor = floorY(APT_FLOORS);
  const zA: [number, number] = [p.zm + SW / 2, p.z1], zB: [number, number] = [p.z0, p.zm - SW / 2];
  // The flights: each tread a block down to under the one before (a stepped underside, no gaps).
  for (const f of p.flights) {
    const riser = f.rise / f.n, [z0, z1] = f.dir === 1 ? zA : zB;
    for (let i = 0; i < f.n - 1; i++) {
      const xa = f.dir === 1 ? p.xa + i * TREAD : p.xa + f.run - (i + 1) * TREAD, y = f.y + (i + 1) * riser;
      box(steps, xa, xa + TREAD, y - riser - 0.2, y, z0, z1);
      // The step's front edge (a darker strip, just proud of it).
      const nose = f.dir === 1 ? xa : xa + TREAD - 0.03;
      box(rails, nose, nose + 0.03, y + 0.001, y + 0.006, z0 + 0.02, z1 - 0.02);
    }
    // A handrail along each side of the flight (on the walls), 0.9 above the steps' front edges, with brackets.
    const len = Math.hypot(f.run + TREAD, f.rise), ang = Math.atan2(f.rise, f.run + TREAD) * f.dir;
    for (const [z, w0, w1] of [[z0 + 0.06, z0, z0 + 0.05], [z1 - 0.06, z1 - 0.05, z1]] as const) {
      const g = new THREE.BoxGeometry(len, 0.045, 0.045);
      g.rotateZ(ang); g.translate(p.xa + f.run / 2, f.y + f.rise / 2 + 0.9, z); rails.push(g);
      for (const k of [0.15, 0.5, 0.85]) { const x = p.xa + f.run * k, y = f.y + f.rise * (f.dir === 1 ? k : 1 - k) + 0.9; box(rails, x - 0.015, x + 0.015, y - 0.06, y - 0.02, w0, w1); }
    }
  }
  // The landings: the floors' by the shaft (up to the hallway's slab under the doorway), and the half-way ones.
  // (A floor's landing reaches 2 cm under the hallway's carpet: its edge is the only seam, and nothing overlaps.)
  for (const y of p.west) if (y > bottom + 1e-3) box(steps, p.x0, p.xa, y - 0.2, y, p.z0, p.z1 + SW + 0.02);
  for (const e of p.east) box(steps, e.x, p.xe, e.y - 0.2, e.y, p.z0, p.z1);
  // The walls: the back and the shaft's side, the far end, the wall between the flights, the hallway's wall with
  // each floor's doorway; on the top floor, a wall where the next flight up would be.
  box(walls, p.x0, p.xe, bottom, top, p.z0 - 0.1, p.z0 + 0.01);
  box(walls, p.x0 - 0.1, p.x0 + 0.01, bottom, top, p.z0 + 0.01, p.z1);
  box(walls, p.xe, p.xe + 0.15, bottom, top, p.z0 + 0.01, p.z1 + SW);
  box(walls, p.xa, p.xb, bottom, top, p.zm - SW / 2, p.zm + SW / 2);
  box(walls, p.xa, p.xa + SW, topFloor, top, p.zm + SW / 2, p.z1);
  const o0 = p.x0 + 0.05, o1 = p.x0 + LAND_W - 0.05;
  // (From the elevator's own wall to the hallway on: no gap at the corner.)
  box(walls, p.x0, o0, bottom, top, p.z1, p.z1 + SW);
  box(walls, o1, p.xe, bottom, top, p.z1, p.z1 + SW);
  for (let f = 1; f <= APT_FLOORS; f++) {
    const y = floorY(f), next = f < APT_FLOORS ? floorY(f + 1) : top;
    box(walls, o0, o1, y + 2.3, next, p.z1, p.z1 + SW);
  }
  // Lights over the half-way landings (the floors' have their number plates).
  for (const e of p.east) box(lights, p.xe - 0.016, p.xe, e.y + 2.05, e.y + 2.25, (p.z0 + p.z1) / 2 - 0.25, (p.z0 + p.z1) / 2 + 0.25);
  const merge = (gs: THREE.BufferGeometry[]) => { const g = mergeGeometries(gs.map((x) => x.toNonIndexed()))!; gs.forEach((x) => x.dispose()); return g; };
  return { steps: merge(steps), walls: merge(walls), rails: merge(rails), lights: merge(lights) };
}

function Stairwell({ b }: { b: Building }) {
  const layout = useMemo(() => venueLayout(b), [b]);
  const plan = useMemo(() => stairPlan(layout.bounds), [layout]);
  const geo = useMemo(() => stairGeometry(plan), [plan]);
  const mats = useMemo(() => ({
    steps: new THREE.MeshStandardMaterial({ color: "#c9c3b8", roughness: 0.85 }),
    // (The same paint as the hallway's walls: one wall, one colour.)
    walls: new THREE.MeshStandardMaterial({ color: "#e3dccf", roughness: 0.9, side: THREE.DoubleSide }),
    rails: new THREE.MeshStandardMaterial({ color: "#5a5f66", roughness: 0.35, metalness: 0.6 }),
    lights: new THREE.MeshStandardMaterial({ color: "#fffaf0", emissive: new THREE.Color("#fff3d6"), emissiveIntensity: 1.2 }),
  }), []);
  useEffect(() => () => { Object.values(geo).forEach((g) => g.dispose()); Object.values(mats).forEach((m) => m.dispose()); }, [geo, mats]);
  const f = layout.frame;
  return <group position={[f.ox, 0, f.oz]} rotation-y={f.rot}>
    <mesh geometry={geo.steps} material={mats.steps} castShadow receiveShadow />
    <mesh geometry={geo.walls} material={mats.walls} receiveShadow />
    <mesh geometry={geo.rails} material={mats.rails} />
    <mesh geometry={geo.lights} material={mats.lights} />
    {/* Over the doorway onto the stairs, on the hallway's side of floors 2–15: the green stairs sign. */}
    {Array.from({ length: APT_FLOORS - 1 }, (_, i) => <mesh key={`s${i}`} position={[plan.x0 + LAND_W / 2, floorY(i + 2) + 2.56, plan.z1 + SW + 0.006]}>
      <planeGeometry args={[0.4, 0.4]} /><meshBasicMaterial map={stairsTexture()} toneMapped={false} />
    </mesh>)}
    {/* Each floor's number on a plate on the shaft's wall, by its landing (lit a little). */}
    {Array.from({ length: APT_FLOORS }, (_, i) => <mesh key={i} position={[plan.x0 + 0.012, floorY(i + 1) + 1.65, (plan.z0 + plan.z1) / 2]} rotation-y={Math.PI / 2}>
      <planeGeometry args={[0.3, 0.3]} /><meshStandardMaterial map={plateTexture(i + 1)} emissive="#ffffff" emissiveIntensity={0.25} emissiveMap={plateTexture(i + 1)} roughness={0.6} />
    </mesh>)}
  </group>;
}

/** The building the player's in (its lobby, a floor, the stairs), if it's an apartment building. */
function buildingIn(state: GameState, byKey: Map<string, Building>) {
  const key = state.interior?.phase === "inside" ? state.interior.key : null;
  if (!key) return null;
  return byKey.get(key.split("#")[0]!) ?? null;
}

/** How much lower than standing the hips are while climbing (the knees a little bent all the way up). */
const CLIMB_CROUCH = 0.07;
/** How far a planted foot's heel may come up as the body goes over it on the way up. */
const TOE_RISE = 0.05;

export function Stairs({ state, city }: { state: GameState; city: City }) {
  const buildings = useMemo(() => city.buildings.filter((b) => b.venue === "apartments"), [city]);
  const byKey = useMemo(() => new Map(buildings.map((b) => [aptKey(b), b])), [buildings]);
  const [shown, setShown] = useState<Building | null>(null);
  const plans = useRef(new Map<string, { plan: StairPlan; layout: VenueLayout }>());
  const feet = useRef<Feet | null>(null);
  const of = (b: Building) => { const k = aptKey(b); let v = plans.current.get(k); if (!v) { const layout = venueLayout(b); v = { plan: stairPlan(layout.bounds), layout }; plans.current.set(k, v); } return v; };

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1), b = buildingIn(state, byKey);
    // Drawn for the building you're in — or, outside, the nearest one close by (seen through its door and windows).
    let draw = b;
    if (!draw) { let best = 45; for (const c of buildings) { const d = Math.hypot(c.x - state.pos.x, c.z - state.pos.z); if (d < best) { best = d; draw = c; } } }
    if (draw !== shown) setShown(draw);
    state.stairGround = null; state.stairFeet = null;
    if (!b) { feet.current = null; return; }
    const { plan, layout } = of(b), f = layout.frame, p = state.pos;
    const [lx, lz] = toLocal(f, p.x, p.z);
    const here = (x: number, z: number) => { const [a, c] = toLocal(f, x, z); return stairGround(plan, a, c, p.y); };
    const g = here(p.x, p.z);
    // The lobby's opening onto the stairs: shut while you're up in the stairwell (open from the lobby's floor).
    const lobby = state.rooms.get(aptKey(b)) as (VenueLayout & { stairGate?: Box & { home?: [number, number] } }) | undefined;
    const gate = lobby?.stairGate;
    if (gate?.home) { const up = g !== null && p.y > floorY(1) + 0.9; gate.x = up ? gate.home[0] : 1e6; gate.z = up ? gate.home[1] : 1e6; }
    if (g === null || state.inCar || state.ladder) { feet.current = null; return; }
    // Underfoot: the stairs (a slope for the body).
    state.stairGround = (x, z) => here(x, z) ?? (state.level ? state.level.y : g);
    // Which floor this is now: the one nearest your feet (the stairs' room is the same on every floor).
    const cur = state.level?.floor ?? 1, fl = floorAtHeight(p.y, cur);
    if (fl !== cur && state.interior) {
      if (fl <= 1) { state.level = null; state.interior.key = aptKey(b); }
      else { aptFloorOf(b, fl); state.level = { building: aptKey(b), floor: fl, y: floorY(fl) }; state.interior.key = floorKey(b, fl); }
    }
    // The feet, tread to tread — only on a flight (on the landings you stand and walk as on any floor).
    const onFlight = flightUnder(plan, lx, lz, p.y);
    if (!onFlight || state.foodScript || state.script || state.health <= 0) { feet.current = null; return; }
    const vel = state.bodyVel ?? { x: 0, z: 0 };
    const yaw = state.rotY;
    // (Feet in the room's frame: the stairs run along its x.)
    const c = Math.cos(f.rot), s = Math.sin(f.rot);
    const lv = { x: vel.x * c - vel.z * s, z: vel.x * s + vel.z * c };
    const ly = yaw - f.rot;
    const body = { x: lx, y: p.y, z: lz, yaw: ly, vx: lv.x, vz: lv.z };
    if (!feet.current) {
      const rx = Math.cos(ly), rz = -Math.sin(ly);
      const put = (side: -1 | 1) => { const x = treadMiddle(plan, lx + rx * side * 0.1), z = lz + rz * side * 0.1; return { x, y: stairGround(plan, x, z, p.y + 0.35, true) ?? p.y, z, from: null, k: 1, dur: 0.3 }; };
      feet.current = { L: put(1), R: put(-1), next: "L", hip: null };
    }
    // Going up: the hips ride up the slope with the body (a little lower than standing, the knees soft) — one
    // diagonal movement, never held back by the foot behind (it steps as soon as it can't reach them).
    const sp = Math.hypot(lv.x, lv.z), ahead = sp > 0.12 ? stairGround(plan, lx + (lv.x / sp) * 0.2, lz + (lv.z / sp) * 0.2, p.y + 0.35, true) : null;
    const up = ahead !== null && ahead > p.y + 0.02, slope = p.y + 0.95 - CLIMB_CROUCH;
    feet.current = stepFeet(plan, feet.current, body, dt, up ? slope : undefined);
    const legs = legsToFeet({ x: lx, z: lz, yaw: ly }, footNow(feet.current.L), footNow(feet.current.R));
    // The hips (eased). Going up: on the slope, as far as the planted feet still reach. Otherwise as high as the
    // lower-reaching foot allows — that leg straight, the other bent as its step needs (on one step both straight).
    const fc = feet.current, where = { x: lx, z: lz, yaw: ly };
    const planted = [...(fc.L.from ? [] : [footReach(where, fc.L, 1)]), ...(fc.R.from ? [] : [footReach(where, fc.R, -1)])];
    // (The foot that stays pushes up onto its toes at the end — its heel leaves the step a little.)
    const target = up ? Math.min(slope, ...planted.map((h) => h + TOE_RISE)) : legs.top;
    fc.hip = fc.hip === null ? target : fc.hip + (target - fc.hip) * (1 - Math.exp(-(up ? 12 : 16) * dt));
    const settled = legsToFeetAt({ x: lx, z: lz, yaw: ly }, footNow(fc.L), footNow(fc.R), fc.hip);
    state.stairFeet = { ...settled, drop: p.y + 0.95 - fc.hip };
  }, -0.85);

  return shown ? <Stairwell b={shown} /> : null;
}
