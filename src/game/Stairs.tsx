// The apartment buildings' stairs while playing (see stairs.ts): the stairwell drawn for the building you're in, and
// walking it — what's underfoot (the steps are walked like a slope by the body; the feet step tread to tread), the
// floor you're on changing as you go up or down, and the lobby's opening shut while you're up in the stairwell.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { APT_FLOORS, aptKey, floorKey, floorY } from "./apartments";
import { FLOOR_CLEAR, aptFloorOf } from "./aptRoom";
import type { Building, City } from "./config";
import { toLocal, type Box } from "./restaurantRoom";
import { LAND_W, RISERS, RUN, SW, TREAD, floorAtHeight, footNow, legsToFeet, stairGround, stairPlan, stepFeet, type Feet, type StairPlan } from "./stairs";
import type { GameState } from "./state";
import { venueLayout, type VenueLayout } from "./venueRoom";

/** The top of the stairwell (the top floor's ceiling), world height. */
const topOf = () => floorY(APT_FLOORS) + FLOOR_CLEAR;

/** The stairwell's parts as three geometries (steps and landings; walls; handrails), in the building's frame. */
function stairGeometry(p: StairPlan) {
  const steps: THREE.BufferGeometry[] = [], walls: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [], lights: THREE.BufferGeometry[] = [];
  const box = (into: THREE.BufferGeometry[], x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); into.push(g);
  };
  const bottom = floorY(1), top = topOf();
  const zA: [number, number] = [p.zm + SW / 2, p.z1], zB: [number, number] = [p.z0, p.zm - SW / 2];
  // The flights: each tread a block down to under the one before (a stepped underside, no gaps).
  for (const f of p.flights) {
    const riser = f.rise / RISERS, [z0, z1] = f.dir === 1 ? zA : zB;
    for (let i = 0; i < RISERS - 1; i++) {
      const xa = f.dir === 1 ? p.xa + i * TREAD : p.xb - (i + 1) * TREAD, y = f.y + (i + 1) * riser;
      box(steps, xa, xa + TREAD, y - riser - 0.2, y, z0, z1);
      // The step's front edge (a nosing strip), a shade darker.
      const nose = f.dir === 1 ? xa : xa + TREAD - 0.03;
      box(rails, nose, nose + 0.03, y - 0.004, y + 0.003, z0 + 0.02, z1 - 0.02);
    }
    // A handrail along each side of the flight (on the walls), 0.9 above the steps' front edges.
    const len = Math.hypot(RUN + TREAD, f.rise), ang = Math.atan2(f.rise, RUN + TREAD) * f.dir;
    for (const [z, w0, w1] of [[z0 + 0.06, z0, z0 + 0.05], [z1 - 0.06, z1 - 0.05, z1]] as const) {
      const g = new THREE.BoxGeometry(len, 0.045, 0.045);
      g.rotateZ(ang); g.translate((p.xa + p.xb) / 2, f.y + f.rise / 2 + 0.9, z); rails.push(g);
      // Small brackets from the rail back to the wall.
      for (const k of [0.15, 0.5, 0.85]) { const x = p.xa + (p.xb - p.xa) * k, y = f.y + f.rise * (f.dir === 1 ? k : 1 - k) + 0.9; box(rails, x - 0.015, x + 0.015, y - 0.06, y - 0.02, w0, w1); }
    }
  }
  // The landings: by the shaft (the floors' run through to the hallway under the doorway), and at the far end.
  const floorsY = new Set(Array.from({ length: APT_FLOORS }, (_, i) => floorY(i + 1).toFixed(3)));
  for (const y of p.west) {
    if (Math.abs(y - bottom) < 1e-3) continue;
    const isFloor = floorsY.has(y.toFixed(3));
    box(steps, p.x0, p.xa, y - 0.2, y, p.z0, isFloor ? p.z1 + SW : p.z1);
  }
  for (const y of p.east) box(steps, p.xb, p.xe, y - 0.2, y, p.z0, p.z1);
  // The walls: the back and the shaft's side (inside faces, all the way up), the far end, the wall between the
  // flights, and the hallway's wall with each floor's doorway.
  box(walls, p.x0, p.xe, bottom, top, p.z0 - 0.02, p.z0 + 0.004);
  box(walls, p.x0 - 0.02, p.x0 + 0.004, bottom, top, p.z0, p.z1);
  box(walls, p.xe, p.xe + 0.15, bottom, top, p.z0, p.z1 + SW);
  box(walls, p.xa, p.xb, bottom, top, p.zm - SW / 2, p.zm + SW / 2);
  const o0 = p.x0 + 0.05, o1 = p.x0 + LAND_W - 0.05;
  box(walls, p.x0, o0, bottom, top, p.z1, p.z1 + SW);
  box(walls, o1, p.xe + 0.15, bottom, top, p.z1, p.z1 + SW);
  for (let f = 1; f <= APT_FLOORS; f++) {
    const y = floorY(f), next = f < APT_FLOORS ? floorY(f + 1) : top;
    box(walls, o0, o1, y + 2.3, next, p.z1, p.z1 + SW);
  }
  // Lights on the walls over each landing.
  for (const y of p.west) box(lights, p.x0 + 0.004, p.x0 + 0.02, y + 2.05, y + 2.25, (p.z0 + p.z1) / 2 - 0.25, (p.z0 + p.z1) / 2 + 0.25);
  for (const y of p.east) box(lights, p.xe - 0.016, p.xe, y + 2.05, y + 2.25, (p.z0 + p.z1) / 2 - 0.25, (p.z0 + p.z1) / 2 + 0.25);
  const merge = (gs: THREE.BufferGeometry[]) => { const g = mergeGeometries(gs.map((x) => x.toNonIndexed()))!; gs.forEach((x) => x.dispose()); return g; };
  return { steps: merge(steps), walls: merge(walls), rails: merge(rails), lights: merge(lights) };
}

function Stairwell({ b }: { b: Building }) {
  const layout = useMemo(() => venueLayout(b), [b]);
  const plan = useMemo(() => stairPlan(layout.bounds), [layout]);
  const geo = useMemo(() => stairGeometry(plan), [plan]);
  const mats = useMemo(() => ({
    steps: new THREE.MeshStandardMaterial({ color: "#c9c3b8", roughness: 0.85 }),
    walls: new THREE.MeshStandardMaterial({ color: "#e6e0d4", roughness: 0.9 }),
    rails: new THREE.MeshStandardMaterial({ color: "#8a8f96", roughness: 0.35, metalness: 0.6 }),
    lights: new THREE.MeshStandardMaterial({ color: "#fffaf0", emissive: new THREE.Color("#fff3d6"), emissiveIntensity: 1.2 }),
  }), []);
  useEffect(() => () => { Object.values(geo).forEach((g) => g.dispose()); Object.values(mats).forEach((m) => m.dispose()); }, [geo, mats]);
  const f = layout.frame;
  return <group position={[f.ox, 0, f.oz]} rotation-y={f.rot}>
    <mesh geometry={geo.steps} material={mats.steps} castShadow receiveShadow />
    <mesh geometry={geo.walls} material={mats.walls} receiveShadow />
    <mesh geometry={geo.rails} material={mats.rails} />
    <mesh geometry={geo.lights} material={mats.lights} />
  </group>;
}

/** The building the player's in (its lobby, a floor, the stairs), if it's an apartment building. */
function buildingIn(state: GameState, byKey: Map<string, Building>) {
  const key = state.interior?.phase === "inside" ? state.interior.key : null;
  if (!key) return null;
  return byKey.get(key.split("#")[0]!) ?? null;
}

export function Stairs({ state, city }: { state: GameState; city: City }) {
  const buildings = useMemo(() => city.buildings.filter((b) => b.venue === "apartments"), [city]);
  const byKey = useMemo(() => new Map(buildings.map((b) => [aptKey(b), b])), [buildings]);
  const [shown, setShown] = useState<Building | null>(null);
  const plans = useRef(new Map<string, { plan: StairPlan; layout: VenueLayout }>());
  const feet = useRef<Feet | null>(null);
  const of = (b: Building) => { const k = aptKey(b); let v = plans.current.get(k); if (!v) { const layout = venueLayout(b); v = { plan: stairPlan(layout.bounds), layout }; plans.current.set(k, v); } return v; };

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1), b = buildingIn(state, byKey);
    if (b !== shown) setShown(b);
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
    // The feet, tread to tread (only where there are steps near).
    const onFlight = lx > plan.xa - 0.5 && lx < plan.xb + 0.5;
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
      const put = (side: -1 | 1) => { const x = lx + rx * side * 0.1, z = lz + rz * side * 0.1; return { x, y: stairGround(plan, x, z, p.y + 0.3, true) ?? p.y, z, from: null, k: 1, dur: 0.3 }; };
      feet.current = { L: put(1), R: put(-1), next: "L" };
    }
    feet.current = stepFeet(plan, feet.current, body, dt);
    const legs = legsToFeet({ x: lx, z: lz, yaw: ly }, p.y + 0.95, footNow(feet.current.L), footNow(feet.current.R));
    state.stairFeet = legs;
  }, -0.85);

  return shown ? <Stairwell b={shown} /> : null;
}
