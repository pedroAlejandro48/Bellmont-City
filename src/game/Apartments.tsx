import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { APT_FLOORS, STOREY, aptKey, floorKey, floorY, freeFloors } from "./apartments";
import { aptFloor, FLOOR_CLEAR, INNER_WALL, type AptFloor, type AptFurniture } from "./aptRoom";
import { CharacterBody, useBodyRig } from "./CharacterBody";
import { BUILDING_ENTRANCE, SIDEWALK_H, timeInfo, type Building, type City } from "./config";
import { plan as makePlan, planAt, walkSeg, type GPose, type Plan } from "./groceryRun";
import { InteractionPrompt } from "./InteractionPrompt";
import { heldKind } from "./invRuntime";
import { FRIDGE_DRINKS, FRIDGE_FOOD, fridgeSplit } from "@/components/FridgePanel";
import { CEILING, CHAIR, ENTER, LEAVE, TABLE, enterLead, enterPose, leaveLead, leavePose, planSit, toLocal, toWorld, worldYaw, type Reach } from "./restaurantRoom";
import { toast, type GameState, type Script } from "./state";
import { handWorld } from "./arms";
import { BedSheet, MATTRESS_TOP, PILLOW_TOP, SHEET_NX, SHEET_NZ, sheetGrips, sheetPoint, type SheetLead, type SheetLink, type SheetShape } from "./BedSheet";
import { canSleepAt, hoursTo6, sleepEnergy, wakeElapsed } from "./needs";
import { ItemModel, useLooks } from "./InventoryWorld";
import { ITEMS, type ItemKind } from "./inventory";
import { isDrinkName } from "./food";
import { canvas, tex } from "./textures";
import { LIFT_DOOR, SHAFT, venueLayout, type VenueLayout } from "./venueRoom";
import { bodyColor } from "@/platform/account";

const FH = BUILDING_ENTRANCE.floorHeight;
const UPPER = APT_FLOORS - 1;
const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

// ---------- the outside: windows exactly where the apartments' are ----------
/** One face of the upper floors (14 storeys): wall, slab lines, the windows given (u from-to across, sill height);
 * at night the rented floors' windows are lit (most of them), the free ones dark. */
function faceTexture(widthM: number, windows: { u0: number; u1: number; y0: number; y1: number }[], seed: number, lit: Set<number>) {
  const W = 512, R = 64, H = R * UPPER;
  const [c, g] = canvas(W, H);
  const [ce, ge] = canvas(W, H);
  ge.fillStyle = "#000"; ge.fillRect(0, 0, W, H);
  g.fillStyle = "#b8a593"; g.fillRect(0, 0, W, H);
  let r = seed;
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  for (let f = 0; f < UPPER; f++) {
    const top = H - (f + 1) * R;
    g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(0, top, W, 3);
    for (const w of windows) {
      const x0 = Math.round(w.u0 * W), x1 = Math.round(w.u1 * W), y0 = top + Math.round((1 - w.y1 / STOREY) * R), y1 = top + Math.round((1 - w.y0 / STOREY) * R);
      g.fillStyle = "#4a3c34"; g.fillRect(x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 6);
      g.fillStyle = "#6f8796"; g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.fillStyle = "rgba(255,255,255,0.18)"; g.fillRect(x0, y0, (x1 - x0) * 0.35, y1 - y0);
      g.fillStyle = "#4a3c34"; g.fillRect(Math.round((x0 + x1) / 2) - 1, y0, 2, y1 - y0);
      const on = true, warm = rnd() < 0.5;
      if (lit.has(f + 2) && on) { ge.fillStyle = warm ? "#ffd9a0" : "#fff1d0"; ge.fillRect(x0, y0, x1 - x0, y1 - y0); }
    }
  }
  void widthM;
  const map = tex(c), emissive = tex(ce);
  return { map, emissive };
}

function useFaces(b: Building, layout: VenueLayout, litKey: string) {
  return useMemo(() => {
    const lit = new Set(litKey ? litKey.split(",").map(Number) : []);
    const floor = aptFloor(b, 2), { width, depth, windowSide: ws } = layout;
    const front = faceTexture(width, floor.front.map((w) => ({ u0: (w.a0 + width / 2) / width, u1: (w.a1 + width / 2) / width, y0: w.y0, y1: 2.35 })), Math.round(Math.abs(b.x * 7 + b.z * 3)) + 1, lit);
    const sideU = (z: number) => (ws === 1 ? -z / depth : (z + depth) / depth);
    const side = faceTexture(depth, floor.side.map((w) => { const [p, q] = [sideU(w.a0), sideU(w.a1)].sort((m, n) => m - n) as [number, number]; return { u0: p, u1: q, y0: w.y0, y1: 2.35 }; }), Math.round(Math.abs(b.x * 3 + b.z * 11)) + 7, lit);
    const blank = faceTexture(width, [], 3, lit);
    const mat = (t: { map: THREE.Texture; emissive: THREE.Texture }) => new THREE.MeshStandardMaterial({ map: t.map, emissiveMap: t.emissive, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0, roughness: 0.85 });
    return { front: mat(front), side: mat(side), blank: mat(blank), roof: new THREE.MeshStandardMaterial({ color: "#6d6660", roughness: 0.9 }) };
  }, [b, layout, litKey]);
}

/** A face's material showing only floors a..b (2..15) of its texture. */
function band(m: THREE.MeshStandardMaterial, a: number, bTop: number) {
  const k = m.clone();
  for (const t of [m.map, m.emissiveMap]) if (t) {
    const c = t.clone(); c.needsUpdate = true; c.repeat.set(1, (bTop - a + 1) / UPPER); c.offset.set(0, (a - 2) / UPPER);
    if (t === m.map) k.map = c; else k.emissiveMap = c;
  }
  return k;
}

/**
 * An apartment building's upper floors from outside: its four faces (the front and the window side show the
 * apartments' windows, lit at random at night), and the roof. While the player is up on one of its floors, that
 * floor's band is left open so the inside (and the view out) shows.
 */
function AptExterior({ b, state }: { b: Building; state: GameState }) {
  const layout = useMemo(() => venueLayout(b), [b]);
  const key = aptKey(b);
  // The rented floors (not free to rent today, or yours): their lights are on at night.
  const litOf = () => { const free = freeFloors(state.worldSeed, key, timeInfo(state.elapsed).day), home = state.life.home; return Array.from({ length: APT_FLOORS - 1 }, (_, i) => i + 2).filter((f) => !free.includes(f) || (home?.building === key && home.floor === f)).join(","); };
  const [litKey, setLitKey] = useState(litOf);
  const faces = useFaces(b, layout, litKey);
  useEffect(() => () => [faces.front, faces.side, faces.blank].forEach((mm) => { mm.map?.dispose(); mm.emissiveMap?.dispose(); mm.dispose(); }), [faces]);
  const [cuts, setCuts] = useState<number[]>([]);
  useFrame(() => {
    const want = new Set<number>();
    if (state.level?.building === key) want.add(state.level.floor);
    const e = state.elevator;
    if (e?.building === key) { want.add(e.floor); if (e.target !== null) want.add(e.target); }
    const list = [...want].filter((f) => f > 1).sort((a, c) => a - c);
    if (list.join() !== cuts.join()) setCuts(list);
    if (Math.floor(state.simulationTime * 2) % 6 === 0) { const k = litOf(); if (k !== litKey) setLitKey(k); }
    const lit = state.darkness * 0.9;
    faces.front.emissiveIntensity = lit; faces.side.emissiveIntensity = lit; faces.blank.emissiveIntensity = lit;
  });
  const parts = useMemo(() => {
    // Floor bands to draw: everything but the open floors.
    const ranges: [number, number][] = [];
    let from = 2;
    for (const c of cuts) { if (c - 1 >= from) ranges.push([from, c - 1]); from = c + 1; }
    if (from <= APT_FLOORS) ranges.push([from, APT_FLOORS]);
    return ranges.map(([a, c]) => ({ a, c, front: band(faces.front, a, c), side: band(faces.side, a, c), blank: band(faces.blank, a, c) }));
  }, [cuts, faces]);
  useEffect(() => () => parts.forEach((p) => [p.front, p.side, p.blank].forEach((m) => { m.map?.dispose(); m.emissiveMap?.dispose(); m.dispose(); })), [parts]);
  // The bands are copies of the faces: their lights come on at night too.
  useFrame(() => { const lit = state.darkness * 0.9; for (const q of parts) { q.front.emissiveIntensity = lit; q.side.emissiveIntensity = lit; q.blank.emissiveIntensity = lit; } });
  const { frame, width, depth, windowSide: ws } = layout, H = (n: number) => n * STOREY;
  return <group position={[frame.ox, SIDEWALK_H + FH, frame.oz]} rotation-y={frame.rot}>
    {parts.map((p) => {
      const y = H(p.a - 2) + H(p.c - p.a + 1) / 2, h = H(p.c - p.a + 1);
      return <group key={`${p.a}`}>
        <mesh position={[0, y, 0.03]} material={p.front} castShadow receiveShadow><planeGeometry args={[width + 0.06, h]} /></mesh>
        <mesh position={[ws * (width / 2 + 0.03), y, -depth / 2]} rotation-y={ws * Math.PI / 2} material={p.side} castShadow receiveShadow><planeGeometry args={[depth + 0.06, h]} /></mesh>
        <mesh position={[0, y, -depth - 0.03]} rotation-y={Math.PI} material={p.blank} castShadow receiveShadow><planeGeometry args={[width + 0.06, h]} /></mesh>
        <mesh position={[-ws * (width / 2 + 0.03), y, -depth / 2]} rotation-y={-ws * Math.PI / 2} material={p.blank} castShadow receiveShadow><planeGeometry args={[depth + 0.06, h]} /></mesh>
      </group>;
    })}
    <mesh position={[0, H(UPPER) + 0.15, -depth / 2]} material={faces.roof} castShadow><boxGeometry args={[width + 0.3, 0.3, depth + 0.3]} /></mesh>
    {/* The slab between the lobby and the first floor (seen from the open band, and from the lobby's windows). */}
    <mesh position={[0, -0.06, -depth / 2]} material={faces.roof}><boxGeometry args={[width - 0.02, 0.12, depth - 0.02]} /></mesh>
  </group>;
}

// ---------- inside a floor ----------
type Hole = { a0: number; a1: number; y0: number; y1: number };
/** A wall's pieces between its openings, up to `h`. */
function wallPieces(a0: number, a1: number, h: number, holes: Hole[]) {
  const out: { a0: number; a1: number; y0: number; y1: number }[] = [];
  let at = a0;
  for (const o of [...holes].sort((p, q) => p.a0 - q.a0)) {
    if (o.a0 > at) out.push({ a0: at, a1: o.a0, y0: 0, y1: h });
    if (o.y0 > 0) out.push({ a0: o.a0, a1: o.a1, y0: 0, y1: o.y0 });
    if (o.y1 < h) out.push({ a0: o.a0, a1: o.a1, y0: o.y1, y1: h });
    at = Math.max(at, o.a1);
  }
  if (at < a1) out.push({ a0: at, a1, y0: 0, y1: h });
  return out.filter((r) => r.a1 - r.a0 > 1e-3 && r.y1 - r.y0 > 1e-3);
}

function useFloorMats() {
  const mats = useMemo(() => {
    const s = (color: string, roughness = 0.7, metalness = 0, side: THREE.Side = THREE.FrontSide) => new THREE.MeshStandardMaterial({ color, roughness, metalness, side });
    return {
      s, wall: s("#f1ece4", 0.9, 0, THREE.DoubleSide), hallWall: s("#e3dccf", 0.9, 0, THREE.DoubleSide), wood: s("#b58a5f", 0.6), carpet: s("#5a4a6e", 0.95), ceiling: s("#fbf9f5", 0.95, 0, THREE.DoubleSide),
      tile: s("#dcd6cc", 0.5), white: s("#f6f6f4", 0.45), steel: s("#c4c9cf", 0.3, 0.75), black: s("#1d1f24", 0.5), darkWood: s("#5b3a24", 0.6),
      door: s("#8b5e3c", 0.6), doorWhite: s("#f2efe8", 0.5), frame: s("#4a3c34", 0.6), fabric: s("#5d7a9a", 0.85), fabric2: s("#d8cdbd", 0.9), bed: s("#3b6ea8", 0.8),
      glass: new THREE.MeshStandardMaterial({ color: "#a9c7d3", transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }),
      screen: new THREE.MeshStandardMaterial({ color: "#10161f", emissive: new THREE.Color("#2d4f7a"), emissiveIntensity: 0.4 }),
      lamp: new THREE.MeshStandardMaterial({ color: "#fffaf0", emissive: new THREE.Color("#fff3d8"), emissiveIntensity: 1.2 }),
      plant: s("#3f7d3a", 0.9), pot: s("#d9cbb5", 0.7), brass: s("#c9a54a", 0.3, 0.8),
      shaft: s("#2b2d32", 0.9, 0.2, THREE.DoubleSide),
      slab: s("#8f8a83", 0.95),
      // Satin steel (not a mirror: without reflections to show, full metal reads as dark patches).
      liftDoor: s("#b7bdc4", 0.38, 0.3),
      fridgeLight: new THREE.MeshStandardMaterial({ color: "#f2f7fa", roughness: 0.4, emissive: new THREE.Color("#e8f4ff"), emissiveIntensity: 0.45 }),
      outside: s("#b8a593", 0.85),
    };
  }, []);
  // A slab's faces: its underside is the ceiling of the floor below.
  return useMemo(() => ({ ...mats, slabFaces: [mats.slab, mats.slab, mats.slab, mats.ceiling, mats.slab, mats.slab] }), [mats]);
}
type FMats = ReturnType<typeof useFloorMats>;
const B = (args: [number, number, number]) => <boxGeometry args={args} />;

function Furniture({ f, m }: { f: AptFurniture; m: FMats }) {
  const { w, d } = f;
  switch (f.type) {
    case "counter": return <group><mesh position={[0, 0.44, 0]} material={m.white} castShadow>{B([w, 0.88, d])}</mesh><mesh position={[0, 0.9, 0]} material={m.darkWood}>{B([w + 0.02, 0.04, d + 0.02])}</mesh>{[-0.2, 0.2].map((x) => <mesh key={x} position={[x, 0.6, d / 2 + 0.005]} material={m.steel}>{B([0.12, 0.02, 0.01])}</mesh>)}</group>;
    case "sink": return <group><mesh position={[0, 0.44, 0]} material={m.white} castShadow>{B([w, 0.88, d])}</mesh><mesh position={[0, 0.9, 0]} material={m.darkWood}>{B([w + 0.02, 0.04, d + 0.02])}</mesh><mesh position={[0, 0.87, 0.02]} material={m.steel}>{B([0.5, 0.08, 0.38])}</mesh><mesh position={[0, 1.02, -d / 2 + 0.1]} rotation-x={-0.6} material={m.steel}><cylinderGeometry args={[0.015, 0.015, 0.28, 8]} /></mesh></group>;
    case "oven": return <group><mesh position={[0, 0.45, 0]} material={m.black} castShadow>{B([w, 0.9, d])}</mesh><mesh position={[0, 0.42, d / 2 + 0.005]} material={m.screen}>{B([w - 0.14, 0.42, 0.01])}</mesh><mesh position={[0, 0.74, d / 2 + 0.02]} material={m.steel}>{B([w - 0.2, 0.025, 0.03])}</mesh>{[-0.17, 0.17].flatMap((x) => [-0.13, 0.13].map((z) => <mesh key={`${x}${z}`} position={[x, 0.905, z]} rotation-x={-Math.PI / 2} material={m.steel}><ringGeometry args={[0.05, 0.08, 18]} /></mesh>))}</group>;
    case "microwave": return <group position={[0, 1.55, 0]}><mesh material={m.white} castShadow>{B([w, 0.3, d])}</mesh><mesh position={[-0.05, 0, d / 2 + 0.005]} material={m.screen}>{B([w * 0.6, 0.22, 0.01])}</mesh></group>;
    case "fridge": {
      // The cabinet: hollow, lit white inside, with four glass shelves (the door, hinged on the right, is drawn by
      // FloorInterior). Walls 4 cm thick; the opening is at the front, 6 cm behind the closed door's face.
      const t = 0.04, front = d / 2 - 0.06, back = -d / 2, inner = front - back - t;
      return <group>
        {/* (The pieces meet edge to edge, never overlapping: no two faces in one plane, so nothing flickers.) The back:
            white outside, lit inside. */}
        <mesh position={[0, 0.93, back + t / 2]} material={[m.white, m.white, m.white, m.white, m.fridgeLight, m.white]} castShadow>{B([w, 1.86, t])}</mesh>
        {[-1, 1].map((sd) => <mesh key={sd} position={[sd * (w / 2 - t / 2), 0.93, (front + back + t) / 2]} material={[m.white, m.white, m.white, m.white, m.white, m.white].map((x, i) => (i === (sd > 0 ? 1 : 0) ? m.fridgeLight : x))} castShadow>{B([t, 1.86, front - back - t])}</mesh>)}
        <mesh position={[0, 0.03, (front + back + t) / 2]} material={m.white}>{B([w - 2 * t, 0.06, front - back - t])}</mesh>
        <mesh position={[0, 1.86 - 0.03, (front + back + t) / 2]} material={m.white} castShadow>{B([w - 2 * t, 0.06, front - back - t])}</mesh>
        {FRIDGE_SHELVES.map((y) => <mesh key={y} position={[0, y, back + t + inner / 2]} material={m.glass}>{B([w - 2 * t, 0.012, inner])}</mesh>)}
        <mesh position={[0, 0.2, back + t + inner / 2]} material={m.s("#dfe7ea", 0.4)}>{B([w - 2 * t - 0.02, 0.26, inner - 0.04])}</mesh>
      </group>;
    }
    case "table": return <group><mesh position={[0, TABLE.top - 0.02, 0]} material={m.wood} castShadow>{B([w, 0.04, d])}</mesh>{[-1, 1].flatMap((a) => [-1, 1].map((c) => <mesh key={`${a}${c}`} position={[a * (w / 2 - 0.05), 0.37, c * (d / 2 - 0.05)]} material={m.darkWood}>{B([0.04, TABLE.top - 0.04, 0.04])}</mesh>))}</group>;
    case "chair": case "deskChair": return <group><mesh position={[0, 0.45, 0]} material={m.wood}>{B([0.42, 0.04, 0.42])}</mesh>{[-1, 1].flatMap((a) => [-1, 1].map((c) => <mesh key={`${a}${c}`} position={[a * 0.18, 0.22, c * 0.18]} material={m.darkWood}>{B([0.03, 0.44, 0.03])}</mesh>))}<mesh position={[0, 0.75, -0.19]} material={m.wood}>{B([0.42, 0.5, 0.03])}</mesh></group>;
    case "couch": return <group><mesh position={[0, 0.22, 0.05]} material={m.fabric} castShadow>{B([w, 0.28, d - 0.1])}</mesh><mesh position={[0, 0.42, 0.08]} material={m.fabric}>{B([w - 0.3, 0.13, d - 0.25])}</mesh><mesh position={[0, 0.62, -d / 2 + 0.12]} material={m.fabric} castShadow>{B([w, 0.6, 0.22])}</mesh>{[-1, 1].map((s) => <mesh key={s} position={[s * (w / 2 - 0.1), 0.45, 0.02]} material={m.fabric}>{B([0.2, 0.36, d - 0.1])}</mesh>)}<mesh position={[0.5, 0.62, -d / 2 + 0.3]} rotation-x={-0.3} material={m.fabric2}>{B([0.4, 0.36, 0.1])}</mesh></group>;
    case "tvTable": return <group><mesh position={[0, 0.25, 0]} material={m.darkWood} castShadow>{B([w, 0.5, d])}</mesh></group>;
    case "tv": return <group position={[0, 0.85, 0]}><mesh material={m.black}>{B([w, 0.6, 0.05])}</mesh><mesh position={[0, 0, 0.03]} material={m.screen}><planeGeometry args={[w - 0.06, 0.54]} /></mesh><mesh position={[0, -0.33, 0]} material={m.black}>{B([0.2, 0.06, 0.18])}</mesh></group>;
    case "rug": return <mesh position={[0, 0.012, 0]} rotation-x={-Math.PI / 2} material={m.s("#a0543f", 0.95)} receiveShadow><planeGeometry args={[w, d]} /></mesh>;
    case "bed": return <group><mesh position={[0, 0.18, 0]} material={m.darkWood} castShadow>{B([w, 0.3, d])}</mesh><mesh position={[0, (0.33 + MATTRESS_TOP) / 2, 0.01]} material={m.white} castShadow receiveShadow>{B([w - 0.02, MATTRESS_TOP - 0.33, d - 0.06])}</mesh><mesh position={[0, (MATTRESS_TOP + PILLOW_TOP) / 2, -d / 2 + 0.28]} material={m.white} castShadow>{B([w - 0.25, PILLOW_TOP - MATTRESS_TOP, 0.32])}</mesh><mesh position={[0, 0.43, -d / 2 + 0.03]} material={m.darkWood} castShadow>{B([w, 0.86, 0.06])}</mesh></group>;
    case "desk": return <group><mesh position={[0, TABLE.top - 0.02, 0]} material={m.wood} castShadow>{B([w, 0.04, d])}</mesh>{[-1, 1].map((a) => <mesh key={a} position={[a * (w / 2 - 0.03), (TABLE.top - 0.04) / 2, 0]} material={m.wood}>{B([0.04, TABLE.top - 0.04, d])}</mesh>)}<mesh position={[0.3, TABLE.top + 0.1, -0.12]} material={m.brass}><cylinderGeometry args={[0.07, 0.09, 0.2, 12]} /></mesh></group>;
    case "closet": {
      // Hollow, with a rail for clothes (the hangers, only with clothes on them, and the doors are drawn by FloorInterior).
      const t = 0.03, front = d / 2 - 0.03;
      return <group>
        <mesh position={[0, 1.0, -d / 2 + t / 2]} material={m.wood} castShadow>{B([w, 2.0, t])}</mesh>
        {[-1, 1].map((sd) => <mesh key={sd} position={[sd * (w / 2 - t / 2), 1.0, (front - d / 2) / 2]} material={m.wood} castShadow>{B([t, 2.0, front + d / 2])}</mesh>)}
        <mesh position={[0, 2.0 - t / 2, (front - d / 2) / 2]} material={m.wood}>{B([w, t, front + d / 2])}</mesh>
        <mesh position={[0, 0.06, (front - d / 2) / 2]} material={m.wood}>{B([w, 0.12, front + d / 2])}</mesh>
        <mesh position={[0, 1.78, -0.02]} rotation-z={Math.PI / 2} material={m.steel}><cylinderGeometry args={[0.012, 0.012, w - 0.08, 8]} /></mesh>
      </group>;
    }
    case "lamp": return <group><mesh position={[0, 0.7, 0]} material={m.brass}><cylinderGeometry args={[0.015, 0.015, 1.4, 6]} /></mesh><mesh position={[0, 1.45, 0]} material={m.fabric2}><cylinderGeometry args={[0.12, 0.18, 0.22, 14, 1, true]} /></mesh><mesh position={[0, 0.02, 0]} material={m.brass}><cylinderGeometry args={[0.12, 0.12, 0.03, 12]} /></mesh></group>;
  }
}

/**
 * The elevator's two doors, filling the LIFT_DOOR opening (they meet in the middle, a little overlapped, and tuck
 * into the steel frame at the sides). Opening, each folds away into its side of the frame, getting narrower until
 * it's gone; closing is the same, reversed. `open` (0..1) eases both ways.
 */
function ElevatorDoors({ open, m }: { open: () => number; m: FMats }) {
  const l = useRef<THREE.Group>(null), r = useRef<THREE.Group>(null);
  const half = LIFT_DOOR / 2 + 0.03;
  useFrame(() => {
    const k = open(), w = Math.max(0.0001, 1 - k);
    if (l.current) { l.current.scale.x = w; l.current.visible = k < 0.999; }
    if (r.current) { r.current.scale.x = w; r.current.visible = k < 0.999; }
  });
  return <group>
    {/* Each door hangs from its outer edge (in the frame), and narrows toward it. */}
    <group ref={l} position={[-half, 0, -0.06]}><mesh position={[half / 2 + 0.005, 1.15, 0]} material={m.liftDoor}>{B([half + 0.01, 2.3, 0.04])}</mesh><mesh position={[half - 0.01, 1.15, 0.021]} material={m.black}>{B([0.012, 2.3, 0.004])}</mesh></group>
    <group ref={r} position={[half, 0, -0.06]}><mesh position={[-half / 2 - 0.005, 1.15, 0]} material={m.liftDoor}>{B([half + 0.01, 2.3, 0.04])}</mesh></group>
  </group>;
}

/** The inside of an elevator shaft where the car isn't: dark walls, so an open door never shows past it. */
function ShaftInside({ m, h }: { m: FMats; h: number }) {
  // (A little inside the shaft's walls everywhere: no face shares a plane with a wall, so nothing flickers.)
  const s = SHAFT - 0.26;
  return <group>
    {[[0, -s / 2, 0], [-s / 2, 0, Math.PI / 2], [s / 2, 0, -Math.PI / 2]].map(([x, z, ry], i) => <mesh key={i} position={[x!, h / 2, z!]} rotation-y={ry!} material={m.shaft}><planeGeometry args={[s, h]} /></mesh>)}
    <mesh position={[0, 0.006, 0]} rotation-x={-Math.PI / 2} material={m.shaft}><planeGeometry args={[s, s]} /></mesh>
    <mesh position={[0, h - 0.03, 0]} rotation-x={Math.PI / 2} material={m.shaft}><planeGeometry args={[s, s]} /></mesh>
  </group>;
}

/** The little screen above an elevator's doors: the floor the car is at (L for the lobby), ▲/▼ while it moves. */
function LiftDisplay({ shown }: { shown: () => { floor: number; dir: number } }) {
  const scr = useMemo(() => { const [c, g] = canvas(128, 64); const t = tex(c); return { g, t, mat: new THREE.MeshBasicMaterial({ map: t, toneMapped: false }), label: "" }; }, []);
  useEffect(() => () => { scr.t.dispose(); scr.mat.dispose(); }, [scr]);
  useFrame(() => {
    const { floor, dir } = shown(), label = `${floor === 1 ? "L" : floor}${dir > 0 ? " ▲" : dir < 0 ? " ▼" : ""}`;
    if (label === scr.label) return;
    scr.label = label;
    const g = scr.g;
    g.fillStyle = "#0b0e12"; g.fillRect(0, 0, 128, 64);
    g.fillStyle = "#ff7a3d"; g.font = "800 40px Courier New, monospace"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(label, 64, 34);
    scr.t.needsUpdate = true;
  });
  return <mesh material={scr.mat}><planeGeometry args={[0.38, 0.16]} /></mesh>;
}

/** Which floor an elevator shows: where it is, counting a floor every 2 seconds while it moves. */
export function shownFloor(e: NonNullable<GameState["elevator"]>, now: number) {
  if (e.phase !== "moving" || e.target === null) return e.floor;
  const dir = Math.sign(e.target - e.floor), passed = Math.floor((now - e.t0) / 2);
  return e.floor + dir * Math.min(Math.abs(e.target - e.floor), passed);
}

/** The car (filling the shaft): steel walls, a lit ceiling, the buttons beside the door with the floor's number on a
 * little screen above them, a handrail. Its own floor reaches the doorway. */
function ElevatorCar({ m, state }: { m: FMats; state: GameState }) {
  // (Clear of the shaft's walls by a few centimetres: its walls never share a plane with them.)
  const s = SHAFT - 0.3;
  const screen = useMemo(() => { const [c, g] = canvas(128, 64); const t = tex(c); return { c, g, t, mat: new THREE.MeshBasicMaterial({ map: t, toneMapped: false }), shown: "" }; }, []);
  useEffect(() => () => { screen.t.dispose(); screen.mat.dispose(); }, [screen]);
  useFrame(() => {
    const e = state.elevator;
    if (!e) return;
    const f = shownFloor(e, state.simulationTime), dir = e.phase === "moving" && e.target !== null ? Math.sign(e.target - e.floor) : 0;
    const label = `${f === 1 ? "L" : f}${dir > 0 ? " ▲" : dir < 0 ? " ▼" : ""}`;
    if (label === screen.shown) return;
    screen.shown = label;
    const g = screen.g;
    g.fillStyle = "#0b0e12"; g.fillRect(0, 0, 128, 64);
    g.fillStyle = "#ff7a3d"; g.font = "800 40px Courier New, monospace"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(label, 64, 34);
    screen.t.needsUpdate = true;
  });
  return <group>
    <mesh position={[0, 0.01, 0.06]} rotation-x={-Math.PI / 2} material={m.s("#3a3d44", 0.8)}><planeGeometry args={[s, s + 0.12]} /></mesh>
    <mesh position={[0, 2.38, 0]} rotation-x={Math.PI / 2} material={m.lamp}><planeGeometry args={[s * 0.7, s * 0.7]} /></mesh>
    <mesh position={[0, 2.42, 0]} rotation-x={Math.PI / 2} material={m.steel}><planeGeometry args={[s, s]} /></mesh>
    {[[0, -s / 2, 0], [-s / 2, 0, Math.PI / 2], [s / 2, 0, -Math.PI / 2]].map(([x, z, ry], i) => <mesh key={i} position={[x!, 1.21, z!]} rotation-y={ry!} material={m.steel}><planeGeometry args={[s, 2.42]} /></mesh>)}
    {/* The panel of buttons on the wall beside the door, the floor screen above it. */}
    <group position={[-s / 2 + 0.012, 0, s / 2 - 0.35]} rotation-y={Math.PI / 2}>
      <mesh position={[0, 1.25, 0]} material={m.black}>{B([0.24, 0.62, 0.02])}</mesh>
      {Array.from({ length: 15 }, (_, k) => <mesh key={k} position={[-0.05 + (k % 2) * 0.1, 1.0 + Math.floor(k / 2) * 0.065, 0.012]} material={m.lamp}><circleGeometry args={[0.017, 10]} /></mesh>)}
      <mesh position={[0, 1.67, 0]} material={m.black}>{B([0.26, 0.15, 0.025])}</mesh>
      <mesh position={[0, 1.67, 0.0135]} material={screen.mat}><planeGeometry args={[0.22, 0.11]} /></mesh>
    </group>
    <mesh position={[0, 1.0, -s / 2 + 0.03]} material={m.steel}>{B([s - 0.1, 0.04, 0.05])}</mesh>
  </group>;
}

/** A floor's shaft inside (dark), hidden while the elevator's car is at that floor. */
function ShaftAt({ state, fl, m }: { state: GameState; fl: AptFloor; m: FMats }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => { const e = state.elevator; if (g.current) g.current.visible = !(e && e.building === fl.key.split("#")[0] && e.floor === fl.upper); });
  return <group ref={g} position={[fl.bounds.minX + SHAFT / 2, 0, fl.bounds.minZ + SHAFT / 2 - 0.06]}><ShaftInside m={m} h={FLOOR_CLEAR} /></group>;
}

/** The elevator's car, wherever it is: at its building's shaft, at the height of the floor it's at. */
function CarAt({ state, buildings, m }: { state: GameState; buildings: Map<string, Building>; m: FMats }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    const e = state.elevator, b = e ? buildings.get(e.building) : undefined, el = g.current;
    if (!el) return;
    el.visible = !!b;
    if (!b || !e) return;
    const L = venueLayout(b), [x, z] = toWorld(L.frame, L.bounds.minX + SHAFT / 2, L.bounds.minZ + SHAFT / 2);
    el.position.set(x, floorY(e.floor), z); el.rotation.y = L.frame.rot;
  });
  return <group ref={g} visible={false}><ElevatorCar m={m} state={state} /></group>;
}

/** The fridge's glass shelves (heights) and its door's bins. */
const FRIDGE_SHELVES = [0.42, 0.78, 1.14, 1.5];
const FRIDGE_BINS = [0.45, 0.95, 1.45];
const FOOD_COLORS = ["#c8202a", "#f3d23b", "#f28a1a", "#b5c94a", "#e7d8b0", "#6b2d6b", "#f6a57a", "#8b5e3c", "#d0c0a0", "#5a8f3a"];
const DRINK_COLORS = ["#6fb6ff", "#f28a1a", "#5a2d1a", "#ee3333", "#9fd17a"];
const hashOf = (t: string) => { let h = 0; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
/** What's in the fridge, on its shelves: up to 15 things to eat, five a shelf (a shape and colour for each). */
function FridgeContents({ state, fridge, m }: { state: GameState; fridge: AptFurniture; m: FMats }) {
  const [list, setList] = useState<string[]>([]);
  useFrame(() => { const food = fridgeSplit(state.life.fridge).food.slice(0, FRIDGE_FOOD); if (food.join("|") !== list.join("|")) setList(food); });
  const back = -fridge.d / 2 + 0.04;
  return <group>
    {list.map((name, i) => {
      const shelf = FRIDGE_SHELVES[Math.floor(i / 5)]!, k = i % 5, h = hashOf(name), mat = m.s(FOOD_COLORS[h % FOOD_COLORS.length]!, 0.6);
      const x = -fridge.w / 2 + 0.1 + k * (fridge.w - 0.2) / 4, z = back + 0.14 + (k % 2) * 0.12;
      return h % 3 === 0 ? <mesh key={i} position={[x, shelf + 0.06, z]} material={mat}><sphereGeometry args={[0.05, 10, 8]} /></mesh>
        : <mesh key={i} position={[x, shelf + 0.05, z]} material={mat}>{B([0.11, 0.09, 0.13])}</mesh>;
    })}
  </group>;
}
/** The drinks in the fridge's door bins: up to 9, three a bin. */
function DoorDrinks({ state, fridge }: { state: GameState; fridge: AptFurniture }) {
  const [list, setList] = useState<string[]>([]);
  useFrame(() => { const d = fridgeSplit(state.life.fridge).drinks.slice(0, FRIDGE_DRINKS); if (d.join("|") !== list.join("|")) setList(d); });
  const mats = useMemo(() => DRINK_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.25, transparent: true, opacity: 0.85 })), []);
  const looks = useLooks();
  return <group>
    {list.map((name, i) => {
      const bin = FRIDGE_BINS[Math.floor(i / 3)]!, k = i % 3;
      // The real thing when it's one of the shop's drinks (a bottle, a can); otherwise a plain bottle.
      const kind = (Object.keys(ITEMS) as ItemKind[]).find((k2) => ITEMS[k2].name === name && ITEMS[k2].use === "drink");
      return <group key={i} position={[-fridge.w / 2 - 0.2 + k * 0.2, bin + 0.02, -0.05]}>
        {kind ? <group scale={1.15}><ItemModel kind={kind} looks={looks} /></group> : <>
          <mesh position-y={0.1} material={mats[hashOf(name) % mats.length]!}><cylinderGeometry args={[0.032, 0.032, 0.2, 10]} /></mesh>
          <mesh position-y={0.22} material={mats[0]!}><cylinderGeometry args={[0.012, 0.028, 0.05, 8]} /></mesh></>}
      </group>;
    })}
  </group>;
}

/** The clothes in the closet, each on a hanger along the rail (a top, or a pair of trousers folded over the bar). */
function ClosetClothes({ state, closet, m }: { state: GameState; closet: AptFurniture; m: FMats }) {
  const [list, setList] = useState<string>("");
  useFrame(() => { const k = JSON.stringify(state.life.closet); if (k !== list) setList(k); });
  const clothes = (list ? JSON.parse(list) : []) as GameState["life"]["closet"];
  const span = closet.w - 0.3, step = clothes.length > 1 ? Math.min(0.13, span / (clothes.length - 1)) : 0, x0 = -step * (clothes.length - 1) / 2;
  return <group>
    {clothes.map((c, k) => {
      const mat = m.s(c.color, 0.85);
      return <group key={k} position={[x0 + k * step, 1.7, -0.02]} rotation-y={Math.PI / 2}>
        <mesh position-y={0.06} material={m.steel}><torusGeometry args={[0.02, 0.004, 4, 10, Math.PI]} /></mesh>
        <mesh rotation-z={Math.PI / 2} material={m.darkWood}><cylinderGeometry args={[0.006, 0.006, 0.36, 6]} /></mesh>
        {c.part === "upper"
          ? <group><mesh position-y={-0.28} material={mat}>{B([0.4, 0.56, 0.05])}</mesh>{[-1, 1].map((s) => <mesh key={s} position={[s * 0.23, -0.12, 0]} rotation-z={s * 0.5} material={mat}>{B([0.1, 0.3, 0.045])}</mesh>)}</group>
          : <group>{[-1, 1].map((s) => <mesh key={s} position={[s * 0.06, -0.3, 0]} material={mat}>{B([0.11, 0.6, 0.04])}</mesh>)}</group>}
      </group>;
    })}
  </group>;
}

/** A door's casing: jambs and a head right through the wall, overlapping it, so the doorway's edges are closed. */
function DoorCasing({ at, rot, m, white = false }: { at: [number, number]; rot: number; m: FMats; white?: boolean }) {
  const mat = white ? m.doorWhite : m.frame, depth = INNER_WALL + 0.04;
  return <group position={[at[0], 0, at[1]]} rotation-y={rot}>
    {[-1, 1].map((s) => <mesh key={s} position={[s * 0.53, 1.07, 0]} material={mat}>{B([0.07, 2.14, depth])}</mesh>)}
    <mesh position={[0, 2.135, 0]} material={mat}>{B([1.13, 0.07, depth])}</mesh>
  </group>;
}

/** The floor the player is on: hallway, apartment (two rooms), the walls with real windows, the doors, the furniture. */
function FloorInterior({ fl, state, m, door, bedDoor, fridgeDoor, closetDoor, elevatorOpen, sheet, lift }: { lift: () => { floor: number; dir: number }; sheet: SheetLink; fl: AptFloor; state: GameState; m: FMats; door: () => number; bedDoor: () => number; fridgeDoor: () => number; closetDoor: () => number; elevatorOpen: () => number }) {
  const { frame, bounds, windowSide: ws, hallZ, wallZ, divX, bedroomDoor } = fl;
  const { minX, maxX, minZ, maxZ } = bounds;
  const leaf = useRef<THREE.Group>(null), bedLeaf = useRef<THREE.Group>(null), fridgeLeaf = useRef<THREE.Group>(null), closetL = useRef<THREE.Group>(null), closetR = useRef<THREE.Group>(null);
  const closet = fl.furniture.find((f) => f.type === "closet")!;
  // Only your own apartment's doors move (and only its fridge shows your food).
  const mineHere = () => { const h = state.life.home; return !!h && h.building === fl.key.split("#")[0] && h.floor === fl.upper && state.level?.floor === fl.upper; };
  useFrame(() => {
    if (leaf.current) leaf.current.rotation.y = -door();
    if (bedLeaf.current) bedLeaf.current.rotation.y = -bedDoor();
    const own = mineHere();
    if (fridgeLeaf.current) fridgeLeaf.current.rotation.y = own ? fridgeDoor() : 0;
    const c = own ? closetDoor() : 0;
    if (closetL.current) closetL.current.rotation.y = -c;
    if (closetR.current) closetR.current.rotation.y = c;
  });
  const fridge = fl.furniture.find((f) => f.type === "fridge")!;
  const H = FLOOR_CLEAR, HT = H + 0.1;
  const frontHoles = fl.front.map((w) => ({ a0: w.a0, a1: w.a1, y0: w.y0, y1: 2.35 }));
  const sideHoles = fl.side.map((w) => ({ a0: w.a0, a1: w.a1, y0: w.y0, y1: 2.35 }));
  const inside0 = wallZ + INNER_WALL;
  const panels = (pieces: { a0: number; a1: number; y0: number; y1: number }[], place: (a: number) => [number, number], ry: number, mat: THREE.Material) => pieces.map((r, i) => {
    const [x, z] = place((r.a0 + r.a1) / 2);
    return <mesh key={i} position={[x, (r.y0 + r.y1) / 2, z]} rotation-y={ry} material={mat} receiveShadow><planeGeometry args={[r.a1 - r.a0, r.y1 - r.y0]} /></mesh>;
  });
  // The outside walls are solid, as thick as the building's (WALL), from the floor up to the next floor (so no band
  // between floors shows outside): their inside faces painted, their outside faces the building's; a window's sides
  // are the wall's own thickness, and its glass sits in the middle of it.
  const T = 0.2, SH = STOREY;
  const facing = (outward: 0 | 1 | 4 | 5) => [0, 1, 2, 3, 4, 5].map((k) => (k === outward ? m.outside : m.wall));
  const frontMats = useMemo(() => facing(4), [m]);
  const backMats = useMemo(() => facing(5), [m]);
  const windowMats = useMemo(() => facing(ws === 1 ? 0 : 1), [m, ws]);
  const plainMats = useMemo(() => facing(ws === 1 ? 1 : 0), [m, ws]);
  const along = (pieces: { a0: number; a1: number; y0: number; y1: number }[], at: (mid: number) => [number, number], alongX: boolean, mats: THREE.Material[]) => pieces.map((r, i) => {
    const [x, z] = at((r.a0 + r.a1) / 2), len = r.a1 - r.a0, h = r.y1 - r.y0;
    return <mesh key={i} position={[x, (r.y0 + r.y1) / 2, z]} material={mats} receiveShadow castShadow><boxGeometry args={alongX ? [len, h, T] : [T, h, len]} /></mesh>;
  });
  const plainX = -ws * (maxX + T / 2), windowX = ws * (maxX + T / 2);
  return <group position={[frame.ox, fl.y, frame.oz]} rotation-y={frame.rot}>
    {/* The floor's slab (whole, under everything, walls included) and the next floor's above the ceiling: no gap
        anywhere, at doorways or round the shaft. */}
    {/* Both are the same box (a floor's slab is the ceiling of the one below: its underside is the ceiling), so when
        two floors are drawn they coincide exactly, same faces, same materials; and they stop just inside the outside
        walls, so their edges never share a plane with a wall's face. */}
    <mesh position={[(minX + maxX) / 2, (H - STOREY) / 2, (minZ + maxZ) / 2]} material={m.slabFaces} receiveShadow>{B([maxX - minX + 0.38, STOREY - H, maxZ - minZ + 0.38])}</mesh>
    <mesh position={[(minX + maxX) / 2, (H + STOREY) / 2, (minZ + maxZ) / 2]} material={m.slabFaces}>{B([maxX - minX + 0.38, STOREY - H, maxZ - minZ + 0.38])}</mesh>
    <mesh position={[(minX + maxX) / 2, 0.002, (hallZ[1] + wallZ + INNER_WALL) / 2]} rotation-x={-Math.PI / 2} material={m.carpet}><planeGeometry args={[maxX - minX, INNER_WALL + 0.02]} /></mesh>
    {/* Floors: carpet in the hallway, wood in the apartment (the ceiling is the slab's underside). */}
    <mesh position={[(minX + maxX) / 2, 0.004, (hallZ[0] + hallZ[1]) / 2]} rotation-x={-Math.PI / 2} material={m.carpet} receiveShadow><planeGeometry args={[maxX - minX, hallZ[1] - hallZ[0]]} /></mesh>
    <mesh position={[(minX + maxX) / 2, 0.004, (inside0 + maxZ) / 2]} rotation-x={-Math.PI / 2} material={m.wood} receiveShadow><planeGeometry args={[maxX - minX, maxZ - inside0]} /></mesh>
    {/* The outside walls (front, both sides, back), the front and the window side with their windows. */}
    {along(wallPieces(minX - T, maxX + T, SH, frontHoles), (a) => [a, maxZ + T / 2], true, frontMats)}
    {along(wallPieces(minX - T, maxX + T, SH, []), (a) => [a, minZ - T / 2], true, backMats)}
    {along(wallPieces(minZ, maxZ, SH, sideHoles), (a) => [windowX, a], false, windowMats)}
    {along(wallPieces(minZ, maxZ, SH, []), (a) => [plainX, a], false, plainMats)}
    {fl.front.map((w, i) => <group key={i}>
      <mesh position={[(w.a0 + w.a1) / 2, (w.y0 + 2.35) / 2, maxZ + T / 2]} material={m.glass}><planeGeometry args={[w.a1 - w.a0, 2.35 - w.y0]} /></mesh>
      {/* A frame round the glass, and the sill inside. */}
      <mesh position={[(w.a0 + w.a1) / 2, (w.y0 + 2.35) / 2, maxZ + T / 2]} material={m.frame}>{B([0.04, 2.35 - w.y0, 0.06])}</mesh>
      <mesh position={[(w.a0 + w.a1) / 2, w.y0 + 0.01, maxZ + 0.02]} material={m.white}>{B([w.a1 - w.a0 + 0.08, 0.03, 0.2])}</mesh>
    </group>)}
    {fl.side.map((w, i) => <group key={i}>
      <mesh position={[windowX, (w.y0 + 2.35) / 2, (w.a0 + w.a1) / 2]} rotation-y={Math.PI / 2} material={m.glass}><planeGeometry args={[w.a1 - w.a0, 2.35 - w.y0]} /></mesh>
      <mesh position={[windowX, (w.y0 + 2.35) / 2, (w.a0 + w.a1) / 2]} material={m.frame}>{B([0.06, 2.35 - w.y0, 0.04])}</mesh>
      <mesh position={[ws * (maxX + 0.02), w.y0 + 0.01, (w.a0 + w.a1) / 2]} material={m.white}>{B([0.2, 0.03, w.a1 - w.a0 + 0.08])}</mesh>
    </group>)}
    {/* The shaft and the storage behind the hallway: their walls to the hallway. */}
    {/* (Side by side with no overlap, and up into the slab above, so no two faces share a plane.) */}
    <mesh position={[(minX + SHAFT + maxX) / 2, HT / 2, hallZ[0] - 0.06]} material={m.hallWall}>{B([maxX - minX - SHAFT, HT, 0.12])}</mesh>
    {[-1, 1].map((s) => <mesh key={s} position={[minX + SHAFT / 2 + s * (LIFT_DOOR / 2 + (SHAFT / 2 - LIFT_DOOR / 2) / 2), HT / 2, hallZ[0] - 0.06]} material={m.hallWall}>{B([SHAFT / 2 - LIFT_DOOR / 2, HT, 0.12])}</mesh>)}
    <mesh position={[minX + SHAFT / 2, (HT + 2.3) / 2, hallZ[0] - 0.06]} material={m.hallWall}>{B([LIFT_DOOR, HT - 2.3, 0.12])}</mesh>
    <group position={[minX + SHAFT / 2, 0, hallZ[0]]}>
      {/* The steel frame lines the doorway right through the wall, overlapping it; a steel sill on the floor. */}
      {[-1, 1].map((sd) => <mesh key={sd} position={[sd * (LIFT_DOOR / 2 + 0.04), 1.16, -0.06]} material={m.steel}>{B([0.1, 2.32, 0.18])}</mesh>)}
      <mesh position={[0, 2.33, -0.06]} material={m.steel}>{B([LIFT_DOOR + 0.18, 0.1, 0.18])}</mesh>
      <mesh position={[0, 0.006, -0.06]} material={m.steel}>{B([LIFT_DOOR, 0.012, 0.16])}</mesh>
      <ElevatorDoors open={elevatorOpen} m={m} />
      <mesh position={[LIFT_DOOR / 2 + 0.3, 1.15, 0.01]} material={m.steel}>{B([0.12, 0.2, 0.03])}</mesh>
      {/* Where the car is: a little screen above the doors. */}
      <mesh position={[0, 2.58, 0.012]} material={m.black}>{B([0.44, 0.2, 0.025])}</mesh>
      <group position={[0, 2.58, 0.026]}><LiftDisplay shown={lift} /></group>
    </group>
    <ShaftAt state={state} fl={fl} m={m} />
    {/* The wall between the hallway and the apartment, with the apartment's door (opens into the apartment). */}
    {[[minX, fl.door.x - 1], [fl.door.x, maxX]].map(([a, c], i) => <mesh key={i} position={[(a! + c!) / 2, HT / 2, wallZ + INNER_WALL / 2]} material={m.hallWall} castShadow>{B([c! - a!, HT, INNER_WALL])}</mesh>)}
    <mesh position={[fl.door.x - 0.5, (HT + 2.1) / 2, wallZ + INNER_WALL / 2]} material={m.hallWall}>{B([1, HT - 2.1, INNER_WALL])}</mesh>
    <DoorCasing at={[fl.door.x - 0.5, wallZ + INNER_WALL / 2]} rot={0} m={m} />
    <group position={[fl.door.x - 1, 0, wallZ + INNER_WALL]}>
      <group ref={leaf}>
        <mesh position={[0.5, 1.05, -0.024]} material={m.door} castShadow>{B([0.996, 2.096, 0.045])}</mesh>
        {[-1, 1].map((s) => <mesh key={s} position={[0.88, 1.02, -0.024 + s * 0.04]} material={m.brass}>{B([0.12, 0.025, 0.025])}</mesh>)}
        <mesh position={[0.88, 1.12, -0.07]} material={m.brass}><cylinderGeometry args={[0.018, 0.018, 0.01, 10]} /></mesh>
      </group>
    </group>
    {/* The door's number plate on the hallway side. */}
    <mesh position={[fl.door.x + 0.15, 1.6, wallZ - 0.005]} rotation-y={Math.PI} material={m.brass}>{B([0.16, 0.1, 0.01])}</mesh>
    {/* The bedroom wall and its doorway; the white bedroom door stands open against it. */}
    <mesh position={[divX, HT / 2, (bedroomDoor[1] + maxZ) / 2]} material={m.wall} castShadow>{B([INNER_WALL, HT, maxZ - bedroomDoor[1]])}</mesh>
    <mesh position={[divX, HT / 2, (inside0 + bedroomDoor[0]) / 2]} material={m.wall}>{B([INNER_WALL, HT, bedroomDoor[0] - inside0])}</mesh>
    <mesh position={[divX, (HT + 2.1) / 2, (bedroomDoor[0] + bedroomDoor[1]) / 2]} material={m.wall}>{B([INNER_WALL, HT - 2.1, bedroomDoor[1] - bedroomDoor[0]])}</mesh>
    <DoorCasing at={[divX, (bedroomDoor[0] + bedroomDoor[1]) / 2]} rot={Math.PI / 2} m={m} white />
    {/* The bedroom door (white, panelled, a round knob): hinged at the doorway's back edge, opening into the bedroom. */}
    <group position={[fl.hinged.bedroom.ox, 0, bedroomDoor[0]]} rotation-y={fl.hinged.bedroom.theta}>
      <group ref={bedLeaf}>
        <mesh position={[0.5, 1.05, -0.024]} material={m.doorWhite} castShadow>{B([0.996, 2.096, 0.04])}</mesh>
        {[-1, 1].flatMap((s) => [0.6, 1.5].map((y) => <mesh key={`${s}${y}`} position={[0.5, y, -0.024 + s * 0.022]} material={m.s("#e6e1d7", 0.5)}>{B([0.66, 0.7, 0.006])}</mesh>))}
        {[-1, 1].map((s) => <mesh key={s} position={[0.88, 1.02, -0.024 + s * 0.045]} material={m.steel}><sphereGeometry args={[0.03, 10, 8]} /></mesh>)}
      </group>
    </group>
    {/* The closet's two doors, hinged at its sides, handles by the middle; inside, your clothes on their hangers. */}
    <group position={[closet.x, 0, closet.z]} rotation-y={closet.rot}>
      {state.life.home?.building === fl.key.split("#")[0] && state.life.home?.floor === fl.upper && <ClosetClothes state={state} closet={closet} m={m} />}
      {([-1, 1] as const).map((sd) => <group key={sd} position={[sd * closet.w / 2, 0, closet.d / 2 - 0.015]} ref={sd < 0 ? closetL : closetR}>
        <mesh position={[-sd * closet.w / 4, 1.0, 0]} material={m.wood} castShadow>{B([closet.w / 2 - 0.004, 1.96, 0.025])}</mesh>
        <mesh position={[-sd * closet.w / 4, 1.0, 0.014]} material={m.darkWood}>{B([closet.w / 2 - 0.12, 1.7, 0.004])}</mesh>
        <mesh position={[-sd * (closet.w / 2 - 0.07), 1.1, 0.03]} material={m.brass}>{B([0.02, 0.22, 0.02])}</mesh>
      </group>)}
    </group>
    {/* The fridge's door, hinged on its right: the right hand pulls it open by the handle and pushes it shut. */}
    <group position={[fridge.x, 0, fridge.z]} rotation-y={fridge.rot}>
      {state.life.home?.building === fl.key.split("#")[0] && state.life.home?.floor === fl.upper && <FridgeContents state={state} fridge={fridge} m={m} />}
      <group position={[fridge.w / 2, 0, fridge.d / 2 - 0.06]}>
        <group ref={fridgeLeaf}>
          {/* The door: white outside, its inside liner lit by the fridge's light; its handle by the left edge. */}
          <mesh position={[-fridge.w / 2, 0.93, 0.03]} material={[m.white, m.white, m.white, m.white, m.white, m.fridgeLight]} castShadow>{B([fridge.w, 1.86, 0.06])}</mesh>
          <mesh position={[-fridge.w / 2, 1.2, 0.061]} material={m.s("#e8e8e6", 0.4)}>{B([fridge.w - 0.02, 0.01, 0.01])}</mesh>
          {[0.7, 1.45].map((y) => <mesh key={y} position={[-(fridge.w - 0.08), y, 0.09]} material={m.steel}>{B([0.03, 0.3, 0.03])}</mesh>)}
          {FRIDGE_BINS.map((y) => <mesh key={y} position={[-fridge.w / 2, y, -0.05]} material={m.s("#eef3f5", 0.4)}>{B([fridge.w - 0.14, 0.04, 0.08])}</mesh>)}
          {FRIDGE_BINS.map((y) => <mesh key={`f${y}`} position={[-fridge.w / 2, y + 0.06, -0.088]} material={m.glass}>{B([fridge.w - 0.14, 0.1, 0.006])}</mesh>)}
          {state.life.home?.building === fl.key.split("#")[0] && state.life.home?.floor === fl.upper && <DoorDrinks state={state} fridge={fridge} />}
        </group>
      </group>
    </group>
    {/* Hallway: lights, a plant at the far end, a runner of carpet. */}
    {[minX + 2.5, (minX + maxX) / 2 + 1, maxX - 1.2].map((x) => <mesh key={x} position={[x, H - 0.02, (hallZ[0] + hallZ[1]) / 2]} rotation-x={Math.PI / 2} material={m.lamp}><circleGeometry args={[0.18, 18]} /></mesh>)}
    <group position={[maxX - 0.35, 0, hallZ[0] + 0.35]}><mesh position-y={0.25} material={m.pot}><cylinderGeometry args={[0.2, 0.16, 0.5, 14]} /></mesh><mesh position-y={0.85} material={m.plant}><icosahedronGeometry args={[0.38, 1]} /></mesh></group>
    {/* The apartment's ceiling lights. */}
    {[[(divX + maxX) / 2, (inside0 + maxZ) / 2], [(minX + divX) / 2, (inside0 + maxZ) / 2]].map(([x, z], i) => <mesh key={i} position={[x!, H - 0.02, z!]} rotation-x={Math.PI / 2} material={m.lamp}><circleGeometry args={[0.25, 20]} /></mesh>)}
    {fl.furniture.map((f, i) => <group key={i} position={[f.x, 0, f.z]} rotation-y={f.rot}><Furniture f={f} m={m} /></group>)}
    <RoomChairs fl={fl} m={m} />
    {/* The bed's sheet (a cloth: it moves only on your own floor, near the bed). */}
    <BedSheet fl={fl} state={state} mat={m.bed} link={sheet} live={() => state.level?.floor === fl.upper && state.level?.building === fl.key.split("#")[0]} />
  </group>;
}

const CHAIR_PIECE: AptFurniture = { type: "chair", x: 0, z: 0, rot: 0, w: 0.44, d: 0.44, solid: false };
/** The floor's chairs, where they are now (pulled out and pushed back in as people sit, like a restaurant's). */
function RoomChairs({ fl, m }: { fl: AptFloor; m: FMats }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => fl.items.forEach((it, i) => {
    const g = refs.current[i];
    if (g && it.kind === "chair") { g.position.set(it.x, 0, it.z); g.rotation.y = Math.atan2(it.f[0], it.f[1]); }
  }));
  return <group>
    {fl.items.map((it, i) => it.kind === "chair" ? <group key={i} ref={(g) => { refs.current[i] = g; }} position={[it.x, 0, it.z]} rotation-y={Math.atan2(it.f[0], it.f[1])}><Furniture f={CHAIR_PIECE} m={m} /></group> : null)}
  </group>;
}

// ---------- moving about: the elevator, the apartment door, bed and fridge ----------
type Seat = { x: number; z: number; yaw: number; approach: [number, number]; surface: { x: number; z: number; y: number; lx: number; lz: number } };
type Move = { kind: "board" | "alight" | "keyIn" | "push" | "pull" | "fridge" | "closet" | "sit" | "bed"; plan: Plan | null; t0: number; which?: "apartment" | "bedroom"; from?: [number, number]; fromYaw?: number; keyT?: number; phase?: "open" | "held" | "close" | "down" | "seated" | "up" | "in" | "asleep" | "out"; seat?: Seat; slept?: number; /** The sheet point a hand lifts it by. */ flap?: [number, number] | null };
/**
 * The bed, step by step (seconds). Getting in: beside it facing it, the left hand takes the sheet's top corner and
 * folds it back diagonally (baring the mattress there), let go; turn round and sit on the bare edge; the left hand
 * takes the folded sheet and, lying back with the legs swinging up, brings it over — down to the shoulders; let go.
 * Getting out is that backward (the right hand lifts the sheet off). Then the bed is made: by its side, bent over,
 * the left hand at the head and the right at the foot take the sheet's open edge and lay it out flat again.
 */
const BI = (() => { let a = 0; const at = (d: number) => (a += d); return { reach: at(0.5), fold: at(1.5), let: at(0.35), turn: at(0.9), sit: at(0.9), grab: at(0.5), lie: at(2.6), release: at(0.4) }; })();
const BO = (() => { let a = 0; const at = (d: number) => (a += d); return { reach: at(0.5), off: at(2.6), let: at(0.35), up: at(0.9), walk: at(0.9), bend: at(0.55), make: at(2.0), done: at(0.5) }; })();
const ASLEEP = 2.6;
type BedStep = { x: number; z: number; yaw: number; lean: number; crouch: number; bed: { sit: number; lie: number; legL: number; legR: number } | null;
  left: { grip: "corner" | "flap" | "head"; blend: number } | null; right: { grip: "flap" | "foot"; blend: number } | null;
  sheet: { from: SheetShape; to: SheetShape; k: number; lead: SheetLead; lift: number } };
const lerp2 = (a: [number, number], c: [number, number], k: number): [number, number] => [a[0] + (c[0] - a[0]) * k, a[1] + (c[1] - a[1]) * k];
/** Spots by the bed: facing it to fold the sheet (and a step along while folding), getting up to sit, making it. */
const bedSpots = (fl: AptFloor) => { const b = fl.bed; return { S: [b.edgeX + 0.42, b.sit[1]] as [number, number], S2: [b.edgeX + 0.34, b.sit[1] - 0.4] as [number, number], up: [b.edgeX + 0.45, b.sit[1]] as [number, number], M: [b.edgeX + 0.36, b.z + 0.1] as [number, number] }; };
/** Getting in, `u` seconds after arriving beside the bed. */
function bedIn(fl: AptFloor, u: number): BedStep {
  const b = fl.bed, P = bedSpots(fl), k = (from: number, d: number) => smooth((u - from) / d);
  const none = { sit: 0, lie: 0, legL: 0, legR: 0 };
  if (u < BI.fold) {
    const g = k(0, 0.5), f = k(BI.reach, BI.fold - BI.reach), at = lerp2(P.S, P.S2, f);
    return { x: at[0], z: at[1], yaw: -Math.PI / 2, lean: 0.42 * g, crouch: 0.12 * g, bed: null, left: { grip: "corner", blend: g }, right: null, sheet: { from: "made", to: "turned", k: f, lead: "corner", lift: 0.16 } };
  }
  if (u < BI.let) { const r = 1 - k(BI.fold, BI.let - BI.fold); return { x: P.S2[0], z: P.S2[1], yaw: -Math.PI / 2, lean: 0.42 * r, crouch: 0.12 * r, bed: null, left: { grip: "corner", blend: r }, right: null, sheet: { from: "turned", to: "turned", k: 1, lead: "corner", lift: 0 } }; }
  if (u < BI.turn) { const t = k(BI.let, BI.turn - BI.let), at = lerp2(P.S2, P.up, t); return { x: at[0], z: at[1], yaw: -Math.PI / 2 + Math.PI * t, lean: 0, crouch: 0, bed: none, left: null, right: null, sheet: { from: "turned", to: "turned", k: 1, lead: "corner", lift: 0 } }; }
  if (u < BI.grab) {
    const t = k(BI.turn, BI.sit - BI.turn), at = lerp2(P.up, b.sit, t), g = k(BI.sit, BI.grab - BI.sit);
    return { x: at[0], z: at[1], yaw: Math.PI / 2, lean: 0.25 * Math.sin(Math.PI * t) + 0.1 * g, crouch: 0, bed: { ...none, sit: t }, left: g > 0 ? { grip: "flap", blend: g } : null, right: null, sheet: { from: "turned", to: "turned", k: 1, lead: "corner", lift: 0 } };
  }
  // Lying back under it: the legs swing up, the back goes down, the sheet comes over (lifted high enough for the legs).
  const L = BI.lie - BI.grab, legL = k(BI.grab, 0.9), legR = k(BI.grab + 0.8, 1.0), lie = k(BI.grab + 1.0, L - 1.0), toLie = k(BI.grab + 1.0, L - 1.0);
  const at = lerp2(b.sit, b.lie, toLie), yaw = Math.PI / 2 + Math.PI / 2 * k(BI.grab, L), sheetK = k(BI.grab, L), rel = 1 - k(BI.lie, BI.release - BI.lie);
  return { x: at[0], z: at[1], yaw, lean: 0, crouch: 0, bed: { sit: 1, lie, legL, legR }, left: rel > 0 ? { grip: "flap", blend: rel } : null, right: null, sheet: { from: "turned", to: "covering", k: sheetK, lead: "corner", lift: 0.45 } };
}
/** Getting out and making the bed, `t` seconds after waking. */
function bedOut(fl: AptFloor, t: number): BedStep {
  const P = bedSpots(fl), k = (from: number, d: number) => smooth((t - from) / d);
  if (t < BO.let) {
    // The right hand lifts the sheet off while the legs swing out and he sits up (getting in, backward).
    const g = k(0, 0.5), v = BI.lie - Math.max(0, t - BO.reach) * ((BI.lie - BI.grab) / (BO.off - BO.reach)), st = bedIn(fl, Math.max(BI.grab, v)), rel = 1 - k(BO.off, BO.let - BO.off);
    return { ...st, left: null, right: { grip: "flap", blend: t < BO.reach ? g : rel }, sheet: { from: "covering", to: "turned", k: k(BO.reach, BO.off - BO.reach), lead: "corner", lift: 0.45 } };
  }
  if (t < BO.up) { const st = bedIn(fl, BI.sit - (t - BO.let)); return { ...st, left: null, right: null, sheet: { from: "turned", to: "turned", k: 1, lead: "corner", lift: 0 } }; }
  if (t < BO.walk) { const w = k(BO.up, BO.walk - BO.up), at = lerp2(P.up, P.M, w); return { x: at[0], z: at[1], yaw: Math.PI / 2 - Math.PI * w, lean: 0, crouch: 0, bed: null, left: null, right: null, sheet: { from: "turned", to: "turned", k: 1, lead: "open", lift: 0 } }; }
  // Bent over the bed, a hand at each end of its open edge: lay the sheet out flat again (it hangs as made).
  const bend = k(BO.walk, BO.bend - BO.walk), mk = k(BO.bend, BO.make - BO.bend), rel = 1 - k(BO.make, BO.done - BO.make), h = Math.min(bend, rel);
  return { x: P.M[0], z: P.M[1], yaw: -Math.PI / 2, lean: 0.75 * h, crouch: 0.3 * h, bed: null, left: { grip: "head", blend: h }, right: { grip: "foot", blend: h }, sheet: { from: "turned", to: "made", k: mk, lead: "open", lift: 0.28 } };
}
/** The closet: both hands take the handles in the middle and swing the two doors open (and shut again). */
const CLOSET = { reach: 0.45, pull: 0.9, release: 0.35, open: 1.45 };
/** The couch's two places to sit: each with the spot in front to sit down from, and where food goes while seated
 * (on the couch beside). (The chairs are the room's items, sat on like a restaurant's.) */
function seatsOf(fl: AptFloor): Seat[] {
  const out: Seat[] = [];
  for (const f of fl.furniture) {
    const fx = Math.sin(f.rot), fz = Math.cos(f.rot);
    if (f.type === "couch") for (const side of [-0.5, 0.5]) {
      const ax = Math.cos(f.rot), az = -Math.sin(f.rot);
      const x = f.x + ax * side + fx * 0.08, z = f.z + az * side + fz * 0.08;
      out.push({ x, z, yaw: f.rot, approach: [x + fx * 0.6, z + fz * 0.6], surface: { x: f.x - ax * side * 0.6 + fx * 0.1, z: f.z - az * side * 0.6 + fz * 0.1, y: 0.5, lx: ax * 0.15, lz: az * 0.15 } });
    }
  }
  return out;
}
/** The fridge: reach for the handle, pull the door open (it swings round with the hand), let go; the same back. */
const FRIDGE = { reach: 0.4, pull: 1.0, release: 0.3, step: 0.55, back: 0.45, open: 1.75 };
const KEY = { walk: 0.9, reach: 0.55, turn: 0.45, back: 0.4 };

/**
 * The apartment buildings: their outsides, the lobby's elevator doors, and the floor the player is on; and the
 * moves — calling the elevator (E at its doors), riding it (its buttons come up close: press a floor; the doors
 * close, 2 seconds a floor, and open on that floor), the apartment door (only yours, with your key in hand: the key
 * goes in and turns, back in the pocket, then the door is pushed open into the apartment; coming out it's pulled),
 * the bed (sleep) and the fridge.
 */
export function Apartments({ state, city }: { state: GameState; city: City }) {
  const buildings = useMemo(() => city.buildings.filter((b) => b.venue === "apartments"), [city]);
  const m = useFloorMats();
  const move = useRef<Move | null>(null);
  const doorAngle = useRef(0), bedAngle = useRef(0), fridgeAngle = useRef(0), closetAngle = useRef(0);
  const [shown, setShown] = useState<AptFloor[]>([]);
  const shownKeys = useRef("");
  const cache = useRef(new Map<string, AptFloor>());
  const prompt = useRef<{ visible: boolean; x: number; y: number; z: number; label?: string | undefined }>({ visible: false, x: 0, y: 0, z: 0 });
  const ownScript = useRef(false);
  const sleeping = useRef(0);
  const lastLift = useRef<string | null>(null);
  /** Doors closing behind someone who has walked on: which, how it was used (pushed open: leave; pulled: enter), when. */
  const closing = useRef<{ which: "apartment" | "bedroom"; kind: "leave" | "enter"; from: [number, number]; fromYaw: number; start: number }[]>([]);
  /** Each floor's bedsheet and the hand holding its corner. */
  const sheets = useRef(new Map<string, SheetLink>());
  const sheetLink = (key: string) => { let l = sheets.current.get(key); if (!l) { l = { from: "made", to: "made", k: 1, lead: "top", lift: 0, points: null }; sheets.current.set(key, l); } return l; };
  /** Putting things in the fridge: the one in hand now, and how far the character has stepped in (0..1). */
  const load = useRef<{ name: string; t0: number; slot: [number, number, number]; drink: boolean; placed: boolean } | null>(null);
  const loadStep = useRef(0);
  const carry = useRef<THREE.Group>(null);
  const carryMats = useMemo(() => ({ food: new THREE.MeshStandardMaterial({ color: "#c8202a", roughness: 0.6 }), drink: new THREE.MeshStandardMaterial({ color: "#6fb6ff", roughness: 0.25, transparent: true, opacity: 0.85 }) }), []);

  const byKey = useMemo(() => new Map(buildings.map((b) => [aptKey(b), b])), [buildings]);
  /** Each building's car: resting at `floor`, or going from `floor` to `to` since t0 (2 s a floor); `busy` someone else's. */
  const cars = useRef(new Map<string, { floor: number; to: number | null; t0: number; busy: boolean }>());
  const carOf = (bkey: string) => { let c = cars.current.get(bkey); if (!c) { c = { floor: 1, to: null, t0: 0, busy: false }; cars.current.set(bkey, c); } return c; };
  /** The floor the car shows (counting a floor every 2 s while it moves), and which way it's going. */
  const carShown = (bkey: string): { floor: number; dir: number } => {
    const c = carOf(bkey), now = state.simulationTime;
    if (c.to === null || c.to === c.floor) return { floor: c.floor, dir: 0 };
    const dir = Math.sign(c.to - c.floor), passed = Math.floor((now - c.t0) / 2);
    return { floor: c.floor + dir * Math.min(Math.abs(c.to - c.floor), passed), dir: now - c.t0 >= 2 * Math.abs(c.to - c.floor) ? 0 : dir };
  };
  const lobbyOf = (key: string) => { const b = byKey.get(key); return b ? venueLayout(b) : null; };
  // Every apartment building's lobby has its elevator's doors (they open while the car is there).
  const elevatorOpen = (bkey: string, fl: number) => () => {
    const e = state.elevator;
    if (!e || e.building !== bkey || e.floor !== fl) return 0;
    const t = state.simulationTime - e.t0;
    if (e.phase === "waiting" || e.phase === "calling") return 0;
    if (e.phase === "boarding") return smooth(t / 0.8);
    if (e.phase === "choose") return 1;
    if (e.phase === "closing") return 1 - smooth(t / 0.8);
    if (e.phase === "moving") return 0;
    if (e.phase === "opening") return smooth(t / 0.8);
    // Leaving: open until the rider is all the way out, then they close.
    return e.outAt === undefined ? 1 : 1 - smooth((state.simulationTime - e.outAt) / 0.8);
  };

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1), now = state.simulationTime, p = state.pos;
    const inter = state.interior;
    const lobby = inter?.phase === "inside" && !state.level ? (() => { const b = byKey.get(inter.key); return b ? { b, layout: venueLayout(b) } : null; })() : null;
    const lvl = state.level, fb = lvl ? byKey.get(lvl.building) : undefined;
    // Each floor's room is made once and kept (with the others in state.rooms).
    const floorOf = (b: Building, n: number) => {
      const k = floorKey(b, n);
      let f = cache.current.get(k);
      if (!f) { f = aptFloor(b, n); cache.current.set(k, f); }
      if (!state.rooms.has(k)) state.rooms.set(k, f);
      return f;
    };
    const floor = lvl && fb ? floorOf(fb, lvl.floor) : null;
    // The floors drawn: the player's, and while the elevator runs the floor it's at and the one it goes to — so the
    // floor it arrives at is already there (nothing pops in, nothing outside shows).
    const want: AptFloor[] = floor ? [floor] : [];
    const e0 = state.elevator, eb = e0 ? byKey.get(e0.building) : undefined;
    if (e0 && eb) for (const n of [e0.floor, e0.target]) if (n !== null && n > 1) { const f = floorOf(eb, n); if (!want.includes(f)) want.push(f); }
    const keys = want.map((f) => f.key).sort().join();
    if (keys !== shownKeys.current) { shownKeys.current = keys; setShown(want); }

    const frameNow = lobby ? lobby.layout.frame : floor?.frame;
    const yNow = lvl ? lvl.y : SIDEWALK_H;
    const toW = (x: number, z: number) => (frameNow ? toWorld(frameNow, x, z) : [x, z] as [number, number]);
    const reachW = (r: Reach | null) => { if (!r || !frameNow) return null; const [x, z] = toWorld(frameNow, r.at[0], r.at[2]); return { at: new THREE.Vector3(x, yNow + r.at[1], z), blend: r.blend, pole: r.pole }; };
    const scriptFrom = (pose: GPose | { x: number; z: number; yaw: number; lean: number; left: Reach | null; right: Reach | null; crouch?: number; sit?: number; bed?: NonNullable<BedStep["bed"]> }): Script => {
      const inBed = (pose as { bed?: NonNullable<BedStep["bed"]> }).bed;
      if (inBed) { const sc = scriptOf(pose); return { ...sc, walk: 0, bed: inBed }; }
      return scriptOf(pose);
    };
    const scriptOf = (pose: GPose | { x: number; z: number; yaw: number; lean: number; left: Reach | null; right: Reach | null; crouch?: number; sit?: number }): Script => {
      const [x, z] = toW(pose.x, pose.z), prev = state.foodScript, wy = frameNow ? worldYaw(frameNow, pose.yaw) : pose.yaw;
      // Steps play backward when stepping back.
      const dx = prev ? x - prev.x : 0, dz = prev ? z - prev.z : 0, d = Math.hypot(dx, dz), back = dx * Math.sin(wy) + dz * Math.cos(wy) < -0.3 * d;
      return { x, z, yaw: wy, walk: (back ? -1 : 1) * d / Math.max(dt, 1e-3), sit: (pose as { sit?: number }).sit ?? 0, shuffle: 0, lean: pose.lean, left: reachW(pose.left), right: reachW(pose.right), crouch: pose.crouch ?? 0 };
    };

    // ---------- the cars ----------
    const others = state.liftLink?.others(now) ?? [];
    for (const [bkey, c] of cars.current) c.busy = false;
    for (const u of others) {
      const c = carOf(u.b);
      if (u.active) { c.floor = u.from; c.to = u.to; c.t0 = u.t0 ?? now; c.busy = true; }
      else if (c.to === null || c.to === c.floor) c.floor = u.to;
    }
    {
      const me = state.elevator;
      if (me && me.phase !== "waiting") {
        const c = carOf(me.building);
        if (me.phase === "calling") { c.floor = me.from ?? me.floor; c.to = me.floor; c.t0 = me.t0; }
        else if (me.phase === "moving" && me.target !== null) { c.floor = me.floor; c.to = me.target; c.t0 = me.t0; }
        else { c.floor = me.floor; c.to = null; }
        state.liftLink?.publish({ b: me.building, from: c.floor, to: c.to ?? c.floor, at: now - c.t0, active: true });
      } else if (lastLift.current) {
        const c = carOf(lastLift.current);
        state.liftLink?.publish({ b: lastLift.current, from: c.floor, to: c.floor, at: 0, active: false });
      }
      lastLift.current = me ? me.building : lastLift.current;
      // Arrived somewhere with nobody aboard: it rests there.
      for (const c of cars.current.values()) if (!c.busy && c.to !== null && now - c.t0 >= 2 * Math.abs(c.to - c.floor) && !(me && carOf(me.building) === c)) { c.floor = c.to; c.to = null; }
    }

    // ---------- the elevator ----------
    const e = state.elevator;
    let script: Script | null = null;
    // Waiting for it (someone else has it), then it comes: 2 s a floor, doors shut; then in as usual (if still here).
    if (e && (e.phase === "waiting" || e.phase === "calling")) {
      const c = carOf(e.building);
      if (e.phase === "waiting" && !c.busy) {
        const at = carShown(e.building).floor;
        if (at === e.floor) { e.phase = "boarding"; e.t0 = now; } else { e.phase = "calling"; e.from = at; e.t0 = now; }
      } else if (e.phase === "calling" && now - e.t0 >= 2 * Math.abs((e.from ?? e.floor) - e.floor)) {
        // Here: in you go — if you're still at its doors (otherwise it just stays here).
        const L = lobby?.layout ?? floor, here = L ? toLocal(L.frame, p.x, p.z) : null;
        const atDoor = !!L && !!here && Math.abs(here[0] - (L.bounds.minX + SHAFT / 2)) < 1.4 && here[1] - (L.bounds.minZ + SHAFT) < 2.2 && (state.level?.floor ?? 1) === e.floor;
        c.floor = e.floor; c.to = null;
        if (atDoor) { e.phase = "boarding"; e.t0 = now; } else state.elevator = null;
      }
    }
    const eRide = state.elevator && state.elevator.phase !== "waiting" && state.elevator.phase !== "calling" ? state.elevator : null;
    if (eRide && frameNow) {
      const e = eRide;
      const L = lobby?.layout ?? floor!, minX = L.bounds.minX, minZ = L.bounds.minZ;
      const car: [number, number] = [minX + SHAFT / 2, minZ + SHAFT / 2], out: [number, number] = [minX + SHAFT / 2, minZ + SHAFT + 0.75];
      const t = now - e.t0, mv = move.current;
      if (e.phase === "boarding") {
        if (!mv?.plan) move.current = { kind: "board", t0: now, plan: makePlan([{ dur: 0.5, pose: () => ({ ...here(), crouch: 0, lean: 0, left: null, right: null }) }, walkSeg(here2(), hereYaw(), car, 0, { basket: false, bag: !!state.groceryBag })]) };
        const r = planAt(move.current!.plan!, now - move.current!.t0);
        script = scriptFrom(r.pose);
        if (r.done) { e.phase = "choose"; e.t0 = now; state.uiLock = "elevator"; state.keys.clear(); }
      } else if (e.phase === "choose" || e.phase === "closing" || e.phase === "moving" || e.phase === "opening") {
        script = scriptFrom({ x: car[0], z: car[1], yaw: 0, lean: 0, left: null, right: null });
        if (e.phase === "closing" && t >= 0.8) { e.phase = "moving"; e.t0 = now; }
        else if (e.phase === "moving" && e.target !== null && t >= 2 * Math.abs(e.target - e.floor)) {
          // There: the same spot in the shaft, at the new floor's height (nothing to see: the doors are shut).
          const b = byKey.get(e.building)!;
          if (e.target <= 1) { state.level = null; if (state.interior) state.interior.key = aptKey(b); }
          else {
            const f = floorOf(b, e.target);
            state.level = { building: e.building, floor: e.target, y: floorY(e.target) };
            if (state.interior) state.interior.key = f.key;
          }
          state.pos.y = floorY(e.target);
          e.floor = e.target; e.phase = "opening"; e.t0 = now;
        } else if (e.phase === "opening" && t >= 0.8) { e.phase = "leaving"; e.t0 = now; move.current = { kind: "alight", t0: now, plan: makePlan([walkSeg(car, 0, out, 0, { basket: false, bag: !!state.groceryBag })]) }; }
      } else if (e.phase === "leaving") {
        if (e.outAt === undefined) {
          if (!move.current) move.current = { kind: "alight", t0: now - 10, plan: makePlan([walkSeg(out, 0, out, 0, { basket: false, bag: false })]) };
          const r = planAt(move.current.plan!, now - move.current.t0);
          script = scriptFrom(r.pose);
          // All the way out of the car: free to go, and only now do the doors close behind.
          if (r.done) { const [x, z] = toW(r.pose.x, r.pose.z); state.pos.x = x; state.pos.z = z; state.rotY = worldYaw(frameNow, r.pose.yaw); move.current = null; script = null; e.outAt = now; }
        } else if (now - e.outAt >= 0.8) state.elevator = null;
      }
    }
    function here(): { x: number; z: number; yaw: number } { const [x, z] = frameNow ? toLocal(frameNow, p.x, p.z) : [p.x, p.z]; return { x, z, yaw: hereYaw() }; }
    function here2(): [number, number] { const h = here(); return [h.x, h.z]; }
    function hereYaw() { return frameNow ? state.rotY - frameNow.rot : state.rotY; }

    // ---------- doors swinging shut by themselves (whoever went through has walked on) ----------
    closing.current = closing.current.filter((c) => {
      const tt = now - c.start, done = c.kind === "leave" ? LEAVE.done + leaveLead(c.from) : ENTER.done + enterLead(c.from);
      const a = tt >= done ? 0 : c.kind === "leave" ? leavePose(tt, c.from, c.fromYaw).door.left : enterPose(tt, c.from, c.fromYaw).door.right;
      if (c.which === "apartment") doorAngle.current = a; else bedAngle.current = a;
      return tt < done;
    });
    // ---------- the hinged doors (the apartment's and the bedroom's) ----------
    const mv = move.current;
    if (!eRide && mv && floor && (mv.kind === "keyIn" || mv.kind === "push" || mv.kind === "pull")) {
      const t = now - mv.t0, which = mv.which ?? "apartment", F = floor.hinged[which], c = Math.cos(F.theta), sn = Math.sin(F.theta);
      const setAngle = (a: number) => { if (which === "apartment") doorAngle.current = a; else bedAngle.current = a; };
      // The door's frame: origin at the doorway's edge, +z into the room the door opens into (the opening is local
      // x −1..0, like the restaurants' left leaf); going in pushes it open, coming out (mirrored) pulls it.
      const fr = (u: number, v: number): [number, number] => [F.ox + u * c + v * sn, F.oz - u * sn + v * c];
      const toRoom = (pose: { x: number; z: number; yaw: number; lean: number; left: Reach | null; right: Reach | null }, mirror: boolean) => {
        const sx = mirror ? -1 : 1;
        const r = (h: Reach | null): Reach | null => { if (!h) return null; const [x, z] = fr(sx * h.at[0], h.at[2]); return { at: [x, h.at[1], z], blend: h.blend, pole: h.pole }; };
        // Rooms here are small: past the doorway the walk is shortened (about a metre in, not the restaurants' 2.6 m),
        // so nobody walks on into the couch or the closet. (The steps shorten with it: legs follow the distance.)
        const squeeze = (v: number) => (!mirror && v > 0.35 ? 0.35 + (v - 0.35) * 0.35 : mirror && v < -0.35 ? -0.35 + (v + 0.35) * 0.35 : v);
        const [x, z] = fr(sx * pose.x, squeeze(pose.z));
        return { x, z, yaw: (mirror ? -pose.yaw : pose.yaw) + F.theta, lean: pose.lean, left: mirror ? r(pose.right) : r(pose.left), right: mirror ? r(pose.left) : r(pose.right), crouch: 0 };
      };
      const finish = () => { state.pos.x = script!.x; state.pos.z = script!.z; state.rotY = script!.yaw; move.current = null; script = null; };
      // Through the doorway and clear of the door: free to walk on; the door swings shut behind on its own.
      const release = (kind: "leave" | "enter", from: [number, number], fromYaw: number, start: number) => { closing.current.push({ which, kind, from, fromYaw, start }); finish(); };
      if (mv.kind === "keyIn" && t < mv.keyT!) {
        // Walk up, the key goes into the lock, turns, comes back out (into the pocket).
        const [lx, lz] = fr(-0.13, -INNER_WALL - 0.05), lock: [number, number, number] = [lx, 1.05, lz];
        const sp = planAt(mv.plan!, Math.min(t, KEY.walk)).pose;
        let right: Reach | null = null;
        const a = t - KEY.walk;
        if (a > 0) {
          const reach = smooth(a / KEY.reach), turn = smooth((a - KEY.reach) / KEY.turn), back = smooth((a - KEY.reach - KEY.turn) / KEY.back);
          right = { at: [lock[0] + 0.03 * Math.sin(turn * Math.PI), lock[1] + 0.02 * turn, lock[2]], blend: reach * (1 - back), pole: "out" };
          if (back > 0.5 && state.heldSlot !== null && heldKind(state) === "key") state.heldSlot = null;
        }
        script = scriptFrom({ ...sp, right, left: null, lean: 0.05 });
        setAngle(0);
      } else if (mv.kind === "keyIn" || mv.kind === "push") {
        // The door pushed open into the room and walked through (the restaurants' way out).
        const tt = mv.kind === "keyIn" ? t - mv.keyT! : t;
        const from: [number, number] = mv.kind === "keyIn" ? [-0.45, -0.72] : mv.from!, fromYaw = mv.kind === "keyIn" ? 0 : mv.fromYaw!;
        const total = LEAVE.done + leaveLead(from), free = LEAVE.free + leaveLead(from), pose = leavePose(Math.min(tt, total), from, fromYaw);
        script = scriptFrom(toRoom(pose, false));
        setAngle(pose.door.left);
        if (tt >= free) release("leave", from, fromYaw, now - tt);
      } else {
        // Coming back out: the door pulled open (the restaurants' way in, mirrored) and through.
        const from = mv.from!, free = ENTER.free + enterLead(from);
        const pose = enterPose(Math.min(t, free), from, mv.fromYaw!);
        script = scriptFrom(toRoom(pose, true));
        setAngle(pose.door.right);
        if (t >= free) release("enter", from, mv.fromYaw!, mv.t0);
      }
    }
    // ---------- the fridge ----------
    if (!eRide && mv && floor && mv.kind === "fridge") {
      const fz = floor.furniture.find((f) => f.type === "fridge")!, yaw = fz.rot + Math.PI;
      const fc = Math.cos(fz.rot), fs = Math.sin(fz.rot);
      // Where the handle is with the door open `a` (radians), in the room (hinge on the right, handle on the left).
      const handle = (a: number): [number, number, number] => {
        const hx = -(fz.w - 0.08), hz = 0.09, ca = Math.cos(a), sa = Math.sin(a);
        const lx = fz.w / 2 + hx * ca + hz * sa, lz = fz.d / 2 - 0.06 - hx * sa + hz * ca;
        return [fz.x + lx * fc + lz * fs, 1.12, fz.z - lx * fs + lz * fc];
      };
      const stand = [floor.spots.fridge[0], floor.spots.fridge[1] - 0.05] as [number, number];
      const t = now - mv.t0;
      // One big step back (making room for the door) and, once it's open, one step in again.
      const backAt = (k: number): [number, number] => [stand[0] - Math.sin(yaw) * FRIDGE.back * k, stand[1] - Math.cos(yaw) * FRIDGE.back * k];
      if (mv.phase === "open") {
        const walk = mv.plan!.total, a = t - walk;
        const sp = planAt(mv.plan!, Math.min(t, walk)).pose;
        // Take the handle; pull the door open stepping back with it; let go; step in.
        const pull = smooth((a - FRIDGE.reach) / FRIDGE.pull), angle = FRIDGE.open * pull;
        const blend = a < 0 ? 0 : a < FRIDGE.reach ? smooth(a / FRIDGE.reach) : 1 - smooth((a - FRIDGE.reach - FRIDGE.pull) / FRIDGE.release);
        const stepIn = smooth((a - FRIDGE.reach - FRIDGE.pull - FRIDGE.release) / FRIDGE.step);
        fridgeAngle.current = a > FRIDGE.reach ? angle : 0;
        const [bx, bz] = a > 0 ? backAt(pull * (1 - stepIn)) : [sp.x, sp.z];
        script = scriptFrom({ ...sp, x: bx, z: bz, lean: 0.06 * blend, left: null, right: blend > 0 ? { at: handle(fridgeAngle.current), blend, pole: "out" } : null });
        if (a >= FRIDGE.reach + FRIDGE.pull + FRIDGE.release + FRIDGE.step) { mv.phase = "held"; state.pos.x = script.x; state.pos.z = script.z; state.rotY = script.yaw; script = null; state.uiLock = "fridge"; state.keys.clear(); }
      } else if (mv.phase === "held") {
        // The fridge's panel is up; closing it pushes the door shut (once everything being stored is in).
        fridgeAngle.current = FRIDGE.open;
        const busy = state.fridgeLoad.length > 0 || load.current !== null;
        loadStep.current = Math.max(0, Math.min(1, loadStep.current + (busy ? dt : -dt) / 0.4));
        // Each thing: the right hand takes it (out of the bag in the left hand, or up from the hands), puts it in its
        // place — food on the next free shelf spot, a drink in the door's next bin spot — and comes back.
        const fwd: [number, number] = [Math.sin(yaw), Math.cos(yaw)], lft: [number, number] = [Math.cos(yaw), -Math.sin(yaw)];
        const step = smooth(loadStep.current) * 0.28, at: [number, number] = [stand[0] + fwd[0] * step, stand[1] + fwd[1] * step];
        if (!load.current && state.fridgeLoad.length && loadStep.current >= 1) {
          const next = state.fridgeLoad.shift()!, drink = isDrinkName(next.name), split = fridgeSplit(state.life.fridge);
          if (next.bag && state.groceryBag) { const i = state.groceryBag.indexOf(next.bag); if (i >= 0) state.groceryBag.splice(i, 1); if (!state.groceryBag.length) state.groceryBag = null; }
          let slot: [number, number, number];
          if (drink) {
            const i = Math.min(split.drinks.length, FRIDGE_DRINKS - 1), bin = FRIDGE_BINS[Math.floor(i / 3)]!, k = i % 3;
            const dx = -fz.w / 2 - 0.2 + k * 0.2, dz = -0.05, a = FRIDGE.open, ca = Math.cos(a), sa = Math.sin(a);
            const lx = fz.w / 2 + dx * ca + dz * sa, lz = fz.d / 2 - 0.06 - dx * sa + dz * ca;
            slot = [fz.x + lx * fc + lz * fs, bin + 0.12, fz.z - lx * fs + lz * fc];
          } else {
            const i = Math.min(split.food.length, FRIDGE_FOOD - 1), shelf = FRIDGE_SHELVES[Math.floor(i / 5)]!, k = i % 5;
            const lx = -fz.w / 2 + 0.1 + k * (fz.w - 0.2) / 4, lz = -fz.d / 2 + 0.04 + 0.14 + (k % 2) * 0.12;
            slot = [fz.x + lx * fc + lz * fs, shelf + 0.06, fz.z - lx * fs + lz * fc];
          }
          load.current = { name: next.name, t0: now, slot, drink, placed: false };
        }
        const L = load.current;
        let right: Reach | null = null, crouch = 0, lean = 0.06 * loadStep.current;
        if (L) {
          const t = now - L.t0;
          // Where the thing is picked from: the bag (beside the left leg) or held up in front.
          const lh = state.avatar.body[9];
          let from: [number, number, number] = [at[0] + fwd[0] * 0.3 - lft[0] * 0.05, 1.0, at[1] + fwd[1] * 0.3 - lft[1] * 0.05];
          if (state.groceryBag && lh) { const v = handWorld(lh, new THREE.Vector3()); const [bx, bz] = toLocal(floor.frame, v.x, v.z); from = [bx + fwd[0] * 0.05, v.y - yNow - 0.18, bz + fwd[1] * 0.05]; }
          const k1 = smooth(t / 0.35), k2 = smooth((t - 0.35) / 0.55), k3 = smooth((t - 0.95) / 0.35);
          const p3 = [0, 1, 2].map((i) => from[i]! + (L.slot[i]! - from[i]!) * k2) as [number, number, number];
          right = { at: p3, blend: k1 * (1 - k3), pole: "out" };
          const low = L.drink ? 0 : L.slot[1] < 0.7 ? 0.6 : L.slot[1] < 1.0 ? 0.25 : 0;
          crouch = low * smooth((t - 0.2) / 0.5) * (1 - k3);
          lean += (L.drink ? 0.05 : 0.22) * k2 * (1 - k3);
          if (!L.placed && t >= 0.9) { L.placed = true; state.life.fridge.push(L.name); }
          if (t >= 1.3) load.current = null;
        }
        if (loadStep.current > 0) script = scriptFrom({ x: at[0], z: at[1], yaw, crouch, lean, left: null, right });
        if (state.uiLock !== "fridge" && !busy && loadStep.current <= 0) { mv.phase = "close"; mv.t0 = now; }
      } else {
        // The opening backward: step back, take the handle, push the door shut stepping in with it, let go.
        const out = smooth(t / FRIDGE.step), u = t - FRIDGE.step;
        const push = smooth((u - FRIDGE.reach) / FRIDGE.pull), angle = FRIDGE.open * (1 - push);
        const blend = u < 0 ? 0 : u < FRIDGE.reach ? smooth(u / FRIDGE.reach) : 1 - smooth((u - FRIDGE.reach - FRIDGE.pull) / FRIDGE.release);
        fridgeAngle.current = u > FRIDGE.reach ? angle : FRIDGE.open;
        const [bx, bz] = backAt(u > FRIDGE.reach ? 1 - push : out);
        script = scriptFrom({ x: bx, z: bz, yaw, crouch: 0, lean: 0.05 * blend, left: null, right: blend > 0 ? { at: handle(fridgeAngle.current), blend, pole: "out" } : null });
        if (u >= FRIDGE.reach + FRIDGE.pull + FRIDGE.release) { fridgeAngle.current = 0; move.current = null; script = null; }
      }
    }
    // ---------- the closet ----------
    if (!eRide && mv && floor && mv.kind === "closet") {
      const c = floor.furniture.find((f) => f.type === "closet")!, cc = Math.cos(c.rot), cs = Math.sin(c.rot);
      // The two handles (by the middle) with the doors open `a`: the left door is hinged at the left edge, the right at the right.
      const handle = (side: 1 | -1, a: number): [number, number, number] => {
        const hx = -side * (c.w / 2 - 0.06), hz = 0.04, r = side * a, ca = Math.cos(-r), sa = Math.sin(-r);
        const lx = side * c.w / 2 + hx * ca + hz * sa, lz = c.d / 2 - hx * sa + hz * ca;
        return [c.x + lx * cc + lz * cs, 1.1, c.z - lx * cs + lz * cc];
      };
      void handle;
      const hand = (a: number, blend: number) => ({ left: blend > 0 ? { at: handleAt(-1, a), blend, pole: "out" as const } : null, right: blend > 0 ? { at: handleAt(1, a), blend, pole: "out" as const } : null });
      function handleAt(side: 1 | -1, a: number): [number, number, number] {
        // side −1 the left door (hinge at −w/2, opens with −a), +1 the right (hinge at +w/2, opens with +a).
        const hx = -side * (c.w / 2 - 0.07), hz = 0.05, rot = side === -1 ? -a : a, ca = Math.cos(rot), sa = Math.sin(rot);
        const lx = side * c.w / 2 + hx * ca + hz * sa, lz = c.d / 2 - hx * sa + hz * ca;
        return [c.x + lx * cc + lz * cs, 1.1, c.z - lx * cs + lz * cc];
      }
      const t = now - mv.t0, yaw = c.rot + Math.PI;
      if (mv.phase === "open") {
        const walk = mv.plan!.total, a = t - walk, sp = planAt(mv.plan!, Math.min(t, walk)).pose;
        const pull = smooth((a - CLOSET.reach) / CLOSET.pull), blend = a < 0 ? 0 : a < CLOSET.reach ? smooth(a / CLOSET.reach) : 1 - smooth((a - CLOSET.reach - CLOSET.pull) / CLOSET.release);
        closetAngle.current = a > CLOSET.reach ? CLOSET.open * pull : 0;
        script = scriptFrom({ ...sp, lean: 0.05 * blend, ...hand(closetAngle.current, blend) });
        if (a >= CLOSET.reach + CLOSET.pull + CLOSET.release) { mv.phase = "held"; state.pos.x = script.x; state.pos.z = script.z; state.rotY = script.yaw; script = null; state.uiLock = "closet"; state.keys.clear(); }
      } else if (mv.phase === "held") {
        closetAngle.current = CLOSET.open;
        if (state.uiLock !== "closet") { mv.phase = "close"; mv.t0 = now; }
      } else {
        const stand = mv.plan!.segs[mv.plan!.segs.length - 1]!.pose(1);
        const push = smooth((t - CLOSET.reach) / (CLOSET.pull * 0.85)), blend = t < CLOSET.reach ? smooth(t / CLOSET.reach) : 1 - smooth((t - CLOSET.reach - CLOSET.pull * 0.85) / CLOSET.release);
        closetAngle.current = t > CLOSET.reach ? CLOSET.open * (1 - push) : CLOSET.open;
        script = scriptFrom({ x: stand.x, z: stand.z, yaw, crouch: 0, lean: 0.05 * blend, ...hand(closetAngle.current, blend) });
        if (t >= CLOSET.reach + CLOSET.pull * 0.85 + CLOSET.release) { closetAngle.current = 0; move.current = null; script = null; }
      }
    }
    // ---------- the bed: getting in, asleep, getting out, making it ----------
    const link = floor ? sheetLink(floor.key) : null;
    if (!eRide && mv && floor && mv.kind === "bed" && link) {
      const t = now - mv.t0, grips = sheetGrips(floor);
      // A hand on the sheet: at that point of it (where the sheet has it now).
      const hold = (h: { grip: string; blend: number } | null): Reach | null => {
        if (!h || h.blend <= 0) return null;
        const ij = h.grip === "flap" ? (mv.flap ?? grips.corner) : h.grip === "head" ? grips.head : h.grip === "foot" ? grips.foot : grips.corner;
        const pt = sheetPoint(link, ij[0], ij[1]);
        return pt ? { at: [pt[0], pt[1] + 0.03, pt[2]], blend: h.blend, pole: "out" } : null;
      };
      const play = (st: BedStep) => {
        link.from = st.sheet.from; link.to = st.sheet.to; link.k = st.sheet.k; link.lead = st.sheet.lead; link.lift = st.sheet.lift;
        script = scriptFrom({ x: st.x, z: st.z, yaw: st.yaw, lean: st.lean, crouch: st.crouch, left: hold(st.left), right: hold(st.right), ...(st.bed ? { bed: st.bed } : {}) });
      };
      // The point of the sheet a hand takes to lift it: the nearest to where that hand is.
      const nearest = (to: [number, number, number]): [number, number] => {
        let best: [number, number] = grips.corner, bd = Infinity;
        for (let j = 0; j < SHEET_NZ; j++) for (let i = 0; i < SHEET_NX; i++) { const q = sheetPoint(link, i, j); if (!q) continue; const d = Math.hypot(q[0] - to[0], (q[1] - to[1]) * 0.5, q[2] - to[2]); if (d < bd) { bd = d; best = [i, j]; } }
        return best;
      };
      if (mv.phase === "in") {
        const walk = mv.plan!.total;
        if (t < walk) script = scriptFrom(planAt(mv.plan!, t).pose);
        else {
          const u = t - walk;
          if (u >= BI.sit && !mv.flap) mv.flap = nearest([floor.bed.sit[0] - 0.05, MATTRESS_TOP + 0.03, floor.bed.sit[1] - 0.4]);
          play(bedIn(floor, Math.min(u, BI.release)));
          if (u >= BI.release) {
            // Asleep: the night passes (in a shared room the clock is everyone's, so only rest), energy comes back.
            mv.phase = "asleep"; mv.t0 = now; state.uiLock = "sleep"; state.keys.clear();
            // Energy by the hours slept (to 6 AM): an hour or less +20%, eight or more full.
            const slept = hoursTo6(timeInfo(state.elapsed).hours);
            if (!state.npcLink) state.elapsed = wakeElapsed(state.elapsed);
            state.energy = sleepEnergy(state.energy, slept); mv.slept = slept;
          }
        }
      } else if (mv.phase === "asleep") {
        play({ ...bedIn(floor, BI.release), left: null });
        if (t >= ASLEEP) {
          state.uiLock = null; mv.phase = "out"; mv.t0 = now; mv.flap = null;
          const h = Math.round((mv.slept ?? 8) * 10) / 10;
          toast(state, "Good morning!", "info", `${state.npcLink ? "Rested" : "It's 6 AM"}: you slept ${h} h, energy ${Math.round(state.energy)}%.`);
        }
      } else if (mv.phase === "out") {
        if (!mv.flap) mv.flap = nearest([floor.bed.edgeX - 0.2, MATTRESS_TOP + 0.2, floor.bed.lie[1] + 0.2]);
        play(bedOut(floor, Math.min(t, BO.done)));
        if (t >= BO.done) { const P = bedSpots(floor), [x, z] = toW(P.M[0], P.M[1]); state.pos.x = x; state.pos.z = z; state.rotY = worldYaw(floor.frame, -Math.PI / 2); link.from = link.to = "made"; link.k = 1; move.current = null; script = null; }
      }
    }
    // ---------- sitting on the couch (the chairs sit like a restaurant's: RestaurantInteraction runs them) ----------
    if (!eRide && mv && floor && mv.kind === "sit") {
      const st = mv.seat!, t = now - mv.t0, SIT = 0.9;
      // The hands come to rest on the knees as one sits (and leave them getting up).
      const knees = (k: number): { left: Reach | null; right: Reach | null } => {
        if (k <= 0.02) return { left: null, right: null };
        const fx = Math.sin(st.yaw), fz = Math.cos(st.yaw), lx = Math.cos(st.yaw), lz = -Math.sin(st.yaw), b = smooth(k);
        const knee = (side: 1 | -1): Reach => ({ at: [st.x + fx * 0.42 + lx * side * 0.12, CHAIR.seatTop + 0.16, st.z + fz * 0.42 + lz * side * 0.12], blend: b, pole: "out" });
        return { left: knee(1), right: knee(-1) };
      };
      const at = (k: number) => ({ x: st.approach[0] + (st.x - st.approach[0]) * k, z: st.approach[1] + (st.z - st.approach[1]) * k });
      if (mv.phase === "down") {
        const walk = mv.plan!.total;
        if (t < walk) script = scriptFrom(planAt(mv.plan!, t).pose);
        else {
          // Back to the seat, lowering down onto it (leaning forward a little on the way).
          const k = smooth((t - walk) / SIT), p2 = at(k);
          script = scriptFrom({ ...p2, yaw: st.yaw, lean: 0.25 * Math.sin(Math.PI * k), ...knees(k), sit: k });
          if (t - walk >= SIT) { mv.phase = "seated"; mv.t0 = now; }
        }
      } else if (mv.phase === "seated") {
        // (While eating, the eating arm takes over from the knee.)
        script = scriptFrom({ x: st.x, z: st.z, yaw: st.yaw, lean: 0.06, ...(state.eating || state.put || state.grab ? { left: null, right: null } : knees(1)), sit: 1 });
        const [sx, sz] = toW(st.surface.x, st.surface.z), [ax, az] = toW(st.surface.x + st.surface.lx, st.surface.z + st.surface.lz);
        state.seatSurface = { x: sx, z: sz, y: yNow + st.surface.y, yaw: worldYaw(floor.frame, st.yaw + Math.PI), lx: ax - sx, lz: az - sz };
        // E or Space: up again (once anything set down has been eaten and taken back up, or right away).
        if ((state.interactQueued || state.standQueued) && !state.eating && !state.put && !state.grab) { state.interactQueued = false; state.standQueued = false; mv.phase = "up"; mv.t0 = now; state.seatSurface = null; }
        state.interactQueued = false; state.standQueued = false;
      } else {
        const k = 1 - smooth(t / SIT), p2 = at(k);
        script = scriptFrom({ ...p2, yaw: st.yaw, lean: 0.25 * Math.sin(Math.PI * k), ...knees(k), sit: k });
        if (t >= SIT) { state.pos.x = script.x; state.pos.z = script.z; state.rotY = script.yaw; move.current = null; script = null; }
      }
    }
    if (!(mv?.kind === "sit" && mv.phase === "seated")) state.seatSurface = null;
    // This building's moves drive the body; when they end it's the player's again.
    if (script) { state.foodScript = script; ownScript.current = true; }
    else if (ownScript.current) { state.foodScript = null; ownScript.current = false; }

    // ---------- E: what can be done here ----------
    const pr = prompt.current; pr.visible = false; pr.label = undefined;
    if (eRide || move.current || state.accident || state.health <= 0 || sleeping.current) { if (eRide || move.current) state.interactQueued = false; return; }
    // Calling the car: where it is now (it comes 2 s a floor); busy with someone else: wait for it.
    const callLift = (bkey: string, here: number) => {
      const c = carOf(bkey), at = carShown(bkey).floor;
      if (c.busy) { state.elevator = { building: bkey, floor: here, target: null, phase: "waiting", t0: now }; return; }
      state.elevator = at === here && (c.to === null || now - c.t0 >= 2 * Math.abs(c.to - c.floor)) ? { building: bkey, floor: here, target: null, phase: "boarding", t0: now } : { building: bkey, floor: here, target: null, phase: "calling", t0: now, from: at };
      move.current = null;
    };
    const liftLabel = (bkey: string, here: number) => {
      const w = state.elevator;
      if (w && w.building === bkey && w.floor === here) return w.phase === "waiting" ? "ELEVATOR IN USE · WAITING" : `ELEVATOR COMING · ${carShown(bkey).floor === 1 ? "L" : carShown(bkey).floor}`;
      return carOf(bkey).busy ? "E  CALL (IN USE)" : "E  ELEVATOR";
    };
    // On a chair (sitting the restaurants' way): E gets up too, once anything set down is eaten and taken back.
    if (state.seat && floor) {
      if (state.interactQueued && state.seat.phase === "seated" && !state.eating && !state.put && !state.grab) state.standQueued = true;
      state.interactQueued = false;
      return;
    }
    const show = (x: number, z: number, y: number, label: string) => { const [wx, wz] = toW(x, z); Object.assign(pr, { visible: true, x: wx, y: yNow + y, z: wz, label }); };
    let act: (() => void) | null = null;
    if (lobby) {
      const L = lobby.layout, [lx, lz] = toLocal(L.frame, p.x, p.z), ex = L.bounds.minX + SHAFT / 2, ez = L.bounds.minZ + SHAFT;
      if (Math.abs(lx - ex) < 1.1 && lz - ez > 0 && lz - ez < 1.6) {
        show(ex, ez + 0.3, 2.2, liftLabel(aptKey(lobby.b), 1));
        if (!state.elevator) act = () => callLift(aptKey(lobby.b), 1);
      }
    } else if (floor && lvl) {
      const [lx, lz] = toLocal(floor.frame, p.x, p.z), ex = floor.bounds.minX + SHAFT / 2, hz0 = floor.hallZ[0];
      const mine = state.life.home?.building === lvl.building && state.life.home.floor === lvl.floor;
      const dx = floor.door.x, wz = floor.wallZ;
      if (Math.abs(lx - ex) < 1.1 && lz - hz0 > 0 && lz - hz0 < 1.5) {
        show(ex, hz0 + 0.3, 2.2, liftLabel(lvl.building, lvl.floor));
        if (!state.elevator) act = () => callLift(lvl.building, lvl.floor);
      } else if (lx > dx - 1.7 && lx < dx + 0.3 && lz < wz && lz > wz - 1.4) {
        // At the apartment's door, in the hallway.
        const holding = heldKind(state) === "key";
        show(dx - 0.5, wz - 0.1, 2.1, mine ? (holding ? "E  UNLOCK" : "HOLD YOUR KEY (ITS NUMBER)") : "LOCKED");
        act = () => {
          if (!mine) { toast(state, "That's not your apartment", "warn"); return; }
          if (!holding) { toast(state, "Take out your key first", "info", "Press the key's number (see the inventory)."); return; }
          const stand: [number, number] = [dx - 0.45, wz + INNER_WALL - 0.72];
          move.current = { kind: "keyIn", t0: now, keyT: KEY.walk + KEY.reach + KEY.turn + KEY.back, plan: makePlan([walkSeg([lx, lz], state.rotY - floor.frame.rot, stand, 0, { basket: false, bag: !!state.groceryBag })]) };
          state.keys.clear();
        };
      } else if (lx > dx - 1.6 && lx < dx + 0.3 && lz > wz + INNER_WALL && lz < wz + INNER_WALL + 1.5) {
        show(dx - 0.5, wz + 0.3, 2.1, "E  OUT");
        act = () => {
          // In the door's frame, mirrored (its pull-open move uses the other leaf).
          const fx = -(lx - dx), fz = lz - (wz + INNER_WALL), fyaw = -(state.rotY - floor.frame.rot);
          move.current = { kind: "pull", which: "apartment", t0: now, plan: null, from: [fx, fz], fromYaw: fyaw };
          state.keys.clear();
        };
      } else if (mine && bedroomSide(floor, lx, lz)) {
        // The bedroom door (kept shut): pushed open going in, pulled open coming out.
        const F = floor.hinged.bedroom, [u, v] = bedroomSide(floor, lx, lz)!, fyaw = state.rotY - floor.frame.rot - F.theta;
        const [px, pz] = [F.ox + -0.5 * Math.cos(F.theta) + (v < 0 ? -0.2 : 0.2) * Math.sin(F.theta), F.oz + 0.5 * Math.sin(F.theta) + (v < 0 ? -0.2 : 0.2) * Math.cos(F.theta)];
        show(px, pz, 2.1, v < 0 ? "E  BEDROOM" : "E  OUT");
        act = () => {
          move.current = v < 0 ? { kind: "push", which: "bedroom", t0: now, plan: null, from: [u, v], fromYaw: fyaw } : { kind: "pull", which: "bedroom", t0: now, plan: null, from: [-u, v], fromYaw: -fyaw };
          state.keys.clear();
        };
      } else if (mine && Math.hypot(lx - floor.spots.bed[0], lz - floor.spots.bed[1]) < 1.2) {
        show(floor.bed.x, floor.bed.z, 1.2, "E  SLEEP");
        act = () => {
          // Only at night: from 9 PM to 5 AM.
          if (!canSleepAt(timeInfo(state.elapsed).hours)) { toast(state, "Not tired enough yet", "info", "You can go to bed between 9 PM and 5 AM."); return; }
          move.current = { kind: "bed", phase: "in", t0: now, flap: null, plan: makePlan([walkSeg([lx, lz], state.rotY - floor.frame.rot, bedSpots(floor).S, -Math.PI / 2, { basket: false, bag: !!state.groceryBag })]) };
          state.keys.clear();
        };
      } else if (mine && Math.hypot(lx - floor.spots.fridge[0], lz - floor.spots.fridge[1]) < 1.0) {
        show(floor.spots.fridge[0] + 0.5, floor.spots.fridge[1], 2.0, "E  FRIDGE");
        act = () => {
          const fz = floor.furniture.find((f) => f.type === "fridge")!, stand: [number, number] = [floor.spots.fridge[0], floor.spots.fridge[1] - 0.05];
          move.current = { kind: "fridge", phase: "open", t0: now, plan: makePlan([walkSeg([lx, lz], state.rotY - floor.frame.rot, stand, fz.rot + Math.PI, { basket: false, bag: !!state.groceryBag })]) };
          state.keys.clear();
        };
      } else if (mine && closetNear(floor, lx, lz)) {
        const c = closetNear(floor, lx, lz)!, stand: [number, number] = [c.x + Math.sin(c.rot) * (c.d / 2 + 0.62), c.z + Math.cos(c.rot) * (c.d / 2 + 0.62)];
        show(c.x, c.z + 0.4, 2.2, "E  CLOSET");
        act = () => { move.current = { kind: "closet", phase: "open", t0: now, plan: makePlan([walkSeg([lx, lz], state.rotY - floor.frame.rot, stand, c.rot + Math.PI, { basket: false, bag: !!state.groceryBag })]) }; state.keys.clear(); };
      } else if (mine && chairNear(floor, lx, lz) !== null) {
        const idx = chairNear(floor, lx, lz)!, c = floor.items[idx]!;
        show(c.x - c.f[0] * CHAIR.back, c.z - c.f[1] * CHAIR.back, 1.5, "E  SIT");
        act = () => {
          const plan = planSit(floor, idx, lx, lz, state.rotY - floor.frame.rot);
          if (plan) { state.seat = { room: floor.key, plan, phase: "sit", startedAt: now }; state.keys.clear(); state.jumpQueued = false; }
        };
      } else if (mine && seatNear(floor, lx, lz)) {
        const st = seatNear(floor, lx, lz)!;
        show(st.x, st.z, 1.3, "E  SIT");
        act = () => { move.current = { kind: "sit", phase: "down", t0: now, seat: st, plan: makePlan([walkSeg([lx, lz], state.rotY - floor.frame.rot, st.approach, st.yaw, { basket: false, bag: !!state.groceryBag })]) }; state.keys.clear(); };
      }
    }
    if (act && state.interactQueued) { state.interactQueued = false; act(); }
    if (floor && state.interactQueued) state.interactQueued = false;
  }, -0.66);

  useFrame(() => {
    const g = carry.current, L = load.current, fore = state.avatar.body[11];
    if (!g) return;
    const t = L ? state.simulationTime - L.t0 : 0, show = !!L && !!fore && t > 0.3 && !L.placed;
    g.visible = show;
    if (!show || !L || !fore) return;
    fore.updateWorldMatrix(true, false); handWorld(fore, g.position);
    g.rotation.set(0, state.rotY, 0);
    g.children.forEach((c) => { c.visible = (c.name === "drink") === L.drink; });
    const mat = L.drink ? carryMats.drink : carryMats.food, col = L.drink ? DRINK_COLORS[hashOf(L.name) % DRINK_COLORS.length]! : FOOD_COLORS[hashOf(L.name) % FOOD_COLORS.length]!;
    if (`#${mat.color.getHexString()}` !== col.toLowerCase()) mat.color.set(col);
  }, 2);


  const lobbies = useMemo(() => buildings.map((b) => ({ b, layout: venueLayout(b) })), [buildings]);
  return <group>
    {buildings.map((b) => <AptExterior key={aptKey(b)} b={b} state={state} />)}
    {/* The lobby elevators' doors (and the car, while someone's in it at the lobby). */}
    {lobbies.map(({ b, layout }) => <group key={aptKey(b)} position={[layout.frame.ox, SIDEWALK_H, layout.frame.oz]} rotation-y={layout.frame.rot}>
      <group position={[layout.bounds.minX + SHAFT / 2, 0, layout.bounds.minZ + SHAFT]}><ElevatorDoors open={elevatorOpen(aptKey(b), 1)} m={m} /><group position={[0, 2.55, 0.035]}><LiftDisplay shown={() => carShown(aptKey(b))} /></group></group>
      <LobbyCar state={state} bkey={aptKey(b)} at={[layout.bounds.minX + SHAFT / 2, layout.bounds.minZ + SHAFT / 2]} m={m} />
      <LobbyVisitor state={state} layout={layout} />
    </group>)}
    {shown.map((fl) => <FloorInterior key={fl.key} lift={() => carShown(fl.key.split("#")[0]!)} sheet={sheetLink(fl.key)} fl={fl} state={state} m={m} door={() => doorAngle.current} bedDoor={() => bedAngle.current} fridgeDoor={() => fridgeAngle.current} closetDoor={() => closetAngle.current} elevatorOpen={elevatorOpen(fl.key.split("#")[0]!, fl.upper)} />)}
    <CarAt state={state} buildings={byKey} m={m} />
    {/* The thing being put in the fridge, in the right hand. */}
    <group ref={carry} visible={false}>
      <mesh name="food" material={carryMats.food}><sphereGeometry args={[0.05, 10, 8]} /></mesh>
      <mesh name="drink" position-y={0.04} material={carryMats.drink}><cylinderGeometry args={[0.032, 0.032, 0.2, 10]} /></mesh>
    </group>
    <InteractionPrompt sample={() => ({ ...prompt.current, time: state.simulationTime })} />
  </group>;
}

const seatCache = new WeakMap<AptFloor, Seat[]>();
/** The seat nearest (within 1.1 m), if any. */
function seatNear(fl: AptFloor, lx: number, lz: number): Seat | null {
  let list = seatCache.get(fl);
  if (!list) { list = seatsOf(fl); seatCache.set(fl, list); }
  let best: Seat | null = null, bd = 1.1;
  for (const st of list) { const d = Math.hypot(st.x - lx, st.z - lz); if (d < bd) { bd = d; best = st; } }
  return best;
}
/** A chair (index into the floor's items) one is standing behind or beside, ready to pull it out and sit. */
function chairNear(fl: AptFloor, lx: number, lz: number): number | null {
  let best: number | null = null, bd = 0.9;
  fl.items.forEach((c, i) => {
    if (c.kind !== "chair") return;
    const d = Math.hypot(lx - (c.x - c.f[0] * 0.64), lz - (c.z - c.f[1] * 0.64));
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
/** Standing in front of the closet. */
function closetNear(fl: AptFloor, lx: number, lz: number) {
  const c = fl.furniture.find((f) => f.type === "closet");
  if (!c) return null;
  const fx = c.x + Math.sin(c.rot) * (c.d / 2 + 0.6), fz = c.z + Math.cos(c.rot) * (c.d / 2 + 0.6);
  return Math.hypot(lx - fx, lz - fz) < 0.9 ? c : null;
}

/** Near the bedroom door, on either side: the spot in the door's frame (v < 0 the main room's side), or null. */
function bedroomSide(fl: AptFloor, lx: number, lz: number): [number, number] | null {
  const F = fl.hinged.bedroom, c = Math.cos(F.theta), s = Math.sin(F.theta), dx = lx - F.ox, dz = lz - F.oz;
  const u = dx * c - dz * s, v = dx * s + dz * c;
  if (u < -1.6 || u > 0.3) return null;
  if (v < -INNER_WALL - 0.05 && v > -1.5) return [u, v];
  if (v > 0.05 && v < 1.6) return [u, v];
  return null;
}

function LobbyCar({ state, bkey, at, m }: { state: GameState; bkey: string; at: [number, number]; m: FMats }) {
  const empty = useRef<THREE.Group>(null);
  useFrame(() => {
    const here = state.elevator?.building === bkey && state.elevator.floor === 1;
    // Without the car, the shaft's dark inside shows behind its doors (never the lobby's floor and ceiling).
    if (empty.current) empty.current.visible = !here;
  });
  return <group ref={empty} position={[at[0], 0, at[1] - 0.06]}><ShaftInside m={m} h={CEILING - 0.02} /></group>;
}

/** Now and then someone waits in the lobby's armchair (reading their phone). */
function LobbyVisitor({ state, layout }: { state: GameState; layout: VenueLayout }) {
  const rig = useBodyRig();
  const color = useMemo(() => bodyColor(Math.abs(Math.round(layout.frame.ox)) % 2 ? "female" : "male"), [layout]);
  const chair = useMemo(() => layout.fixtures.find((f) => f.type === "armchair"), [layout]);
  useFrame(() => {
    const root = rig.root.current, hips = rig.hips.current;
    if (!root || !hips || !chair) return;
    // Here for a while, then gone for a while (a different rhythm in each building).
    const here = Math.floor((state.elapsed + layout.frame.ox * 7) / 90) % 2 === 0;
    root.visible = here && Math.hypot(state.pos.x - layout.frame.ox, state.pos.z - layout.frame.oz) < 40;
    if (!root.visible) return;
    root.position.set(chair.x + Math.sin(chair.rot) * 0.05, 0, chair.z + Math.cos(chair.rot) * 0.05); root.rotation.y = chair.rot;
    hips.position.y = 0.55;
    rig.thighL.current?.rotation.set(-Math.PI / 2, 0, 0.1); rig.thighR.current?.rotation.set(-Math.PI / 2, 0, -0.1);
    rig.shinL.current?.rotation.set(Math.PI / 2, 0, 0); rig.shinR.current?.rotation.set(Math.PI / 2, 0, 0);
    rig.torso.current?.rotation.set(-0.12, 0, 0);
    rig.armL.current?.rotation.set(-0.7, 0, 0.25); rig.foreL.current?.rotation.set(-1.4, 0, 0);
    rig.armR.current?.rotation.set(-0.7, 0, -0.25); rig.foreR.current?.rotation.set(-1.4, 0, 0);
    rig.head.current?.rotation.set(0.45, 0, 0);
  });
  return <CharacterBody rig={rig} color={color} />;
}
