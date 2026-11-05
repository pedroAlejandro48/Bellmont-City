import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { APT_FLOORS, STOREY, aptKey, floorKey, floorY } from "./apartments";
import { aptFloor, FLOOR_CLEAR, INNER_WALL, type AptFloor, type AptFurniture } from "./aptRoom";
import { CharacterBody, useBodyRig } from "./CharacterBody";
import { BUILDING_ENTRANCE, SIDEWALK_H, timeInfo, type Building, type City } from "./config";
import { plan as makePlan, planAt, walkSeg, type GPose, type Plan } from "./groceryRun";
import { InteractionPrompt } from "./InteractionPrompt";
import { heldKind } from "./invRuntime";
import { ENTER, LEAVE, enterLead, enterPose, leaveLead, leavePose, toLocal, toWorld, worldYaw, type Reach } from "./restaurantRoom";
import { toast, type GameState, type Script } from "./state";
import { canvas, tex } from "./textures";
import { SHAFT, venueLayout, type VenueLayout } from "./venueRoom";
import { bodyColor } from "@/platform/account";

const FH = BUILDING_ENTRANCE.floorHeight;
const UPPER = APT_FLOORS - 1;
const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

// ---------- the outside: windows exactly where the apartments' are ----------
/** One face of the upper floors (14 storeys): wall, slab lines, the windows given (u from-to across, sill height),
 * lit at random at night. */
function faceTexture(widthM: number, windows: { u0: number; u1: number; y0: number; y1: number }[], seed: number) {
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
      if (rnd() < 0.45) { ge.fillStyle = rnd() < 0.5 ? "#ffd9a0" : "#fff1d0"; ge.fillRect(x0, y0, x1 - x0, y1 - y0); }
    }
  }
  void widthM;
  const map = tex(c), emissive = tex(ce);
  return { map, emissive };
}

function useFaces(b: Building, layout: VenueLayout) {
  return useMemo(() => {
    const floor = aptFloor(b, 2), { width, depth, windowSide: ws } = layout;
    const front = faceTexture(width, floor.front.map((w) => ({ u0: (w.a0 + width / 2) / width, u1: (w.a1 + width / 2) / width, y0: w.y0, y1: 2.35 })), Math.round(Math.abs(b.x * 7 + b.z * 3)) + 1);
    const sideU = (z: number) => (ws === 1 ? -z / depth : (z + depth) / depth);
    const side = faceTexture(depth, floor.side.map((w) => { const [p, q] = [sideU(w.a0), sideU(w.a1)].sort((m, n) => m - n) as [number, number]; return { u0: p, u1: q, y0: w.y0, y1: 2.35 }; }), Math.round(Math.abs(b.x * 3 + b.z * 11)) + 7);
    const blank = faceTexture(width, [], 3);
    const mat = (t: { map: THREE.Texture; emissive: THREE.Texture }) => new THREE.MeshStandardMaterial({ map: t.map, emissiveMap: t.emissive, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0, roughness: 0.85 });
    return { front: mat(front), side: mat(side), blank: mat(blank), roof: new THREE.MeshStandardMaterial({ color: "#6d6660", roughness: 0.9 }) };
  }, [b, layout]);
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
  const faces = useFaces(b, layout);
  const key = aptKey(b);
  const [cut, setCut] = useState<number | null>(null);
  useFrame(() => {
    const k = state.level?.building === key ? state.level.floor : null;
    if (k !== cut) setCut(k);
    const lit = state.darkness * 0.9;
    faces.front.emissiveIntensity = lit; faces.side.emissiveIntensity = lit; faces.blank.emissiveIntensity = lit;
  });
  const parts = useMemo(() => {
    // Floor bands to draw: all, or below and above the open one.
    const ranges: [number, number][] = cut === null ? [[2, APT_FLOORS]] : ([[2, cut - 1], [cut + 1, APT_FLOORS]] as [number, number][]).filter(([a, c]) => c >= a);
    return ranges.map(([a, c]) => ({ a, c, front: band(faces.front, a, c), side: band(faces.side, a, c), blank: band(faces.blank, a, c) }));
  }, [cut, faces]);
  useEffect(() => () => parts.forEach((p) => [p.front, p.side, p.blank].forEach((m) => { m.map?.dispose(); m.emissiveMap?.dispose(); m.dispose(); })), [parts]);
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
  return useMemo(() => {
    const s = (color: string, roughness = 0.7, metalness = 0, side: THREE.Side = THREE.FrontSide) => new THREE.MeshStandardMaterial({ color, roughness, metalness, side });
    return {
      s, wall: s("#f1ece4", 0.9, 0, THREE.DoubleSide), hallWall: s("#e3dccf", 0.9, 0, THREE.DoubleSide), wood: s("#b58a5f", 0.6), carpet: s("#5a4a6e", 0.95), ceiling: s("#fbf9f5", 0.95, 0, THREE.DoubleSide),
      tile: s("#dcd6cc", 0.5), white: s("#f6f6f4", 0.45), steel: s("#c4c9cf", 0.3, 0.75), black: s("#1d1f24", 0.5), darkWood: s("#5b3a24", 0.6),
      door: s("#8b5e3c", 0.6), doorWhite: s("#f2efe8", 0.5), frame: s("#4a3c34", 0.6), fabric: s("#5d7a9a", 0.85), fabric2: s("#d8cdbd", 0.9), bed: s("#3b6ea8", 0.8),
      glass: new THREE.MeshStandardMaterial({ color: "#a9c7d3", transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }),
      screen: new THREE.MeshStandardMaterial({ color: "#10161f", emissive: new THREE.Color("#2d4f7a"), emissiveIntensity: 0.4 }),
      lamp: new THREE.MeshStandardMaterial({ color: "#fffaf0", emissive: new THREE.Color("#fff3d8"), emissiveIntensity: 1.2 }),
      plant: s("#3f7d3a", 0.9), pot: s("#d9cbb5", 0.7), brass: s("#c9a54a", 0.3, 0.8),
    };
  }, []);
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
    case "fridge": return <group><mesh position={[0, 0.9, 0]} material={m.white} castShadow>{B([w, 1.8, d])}</mesh><mesh position={[0, 1.18, d / 2 + 0.005]} material={m.s("#e8e8e6", 0.4)}>{B([w - 0.02, 0.01, 0.01])}</mesh>{[0.7, 1.45].map((y) => <mesh key={y} position={[w / 2 - 0.08, y, d / 2 + 0.03]} material={m.steel}>{B([0.03, 0.3, 0.03])}</mesh>)}</group>;
    case "table": return <group><mesh position={[0, 0.75, 0]} material={m.wood} castShadow>{B([w, 0.04, d])}</mesh>{[-1, 1].flatMap((a) => [-1, 1].map((c) => <mesh key={`${a}${c}`} position={[a * (w / 2 - 0.05), 0.37, c * (d / 2 - 0.05)]} material={m.darkWood}>{B([0.04, 0.74, 0.04])}</mesh>))}</group>;
    case "chair": case "deskChair": return <group><mesh position={[0, 0.45, 0]} material={m.wood}>{B([0.42, 0.04, 0.42])}</mesh>{[-1, 1].flatMap((a) => [-1, 1].map((c) => <mesh key={`${a}${c}`} position={[a * 0.18, 0.22, c * 0.18]} material={m.darkWood}>{B([0.03, 0.44, 0.03])}</mesh>))}<mesh position={[0, 0.75, -0.19]} material={m.wood}>{B([0.42, 0.5, 0.03])}</mesh></group>;
    case "couch": return <group><mesh position={[0, 0.22, 0.05]} material={m.fabric} castShadow>{B([w, 0.28, d - 0.1])}</mesh><mesh position={[0, 0.42, 0.08]} material={m.fabric}>{B([w - 0.3, 0.13, d - 0.25])}</mesh><mesh position={[0, 0.62, -d / 2 + 0.12]} material={m.fabric} castShadow>{B([w, 0.6, 0.22])}</mesh>{[-1, 1].map((s) => <mesh key={s} position={[s * (w / 2 - 0.1), 0.45, 0.02]} material={m.fabric}>{B([0.2, 0.36, d - 0.1])}</mesh>)}<mesh position={[0.5, 0.62, -d / 2 + 0.3]} rotation-x={-0.3} material={m.fabric2}>{B([0.4, 0.36, 0.1])}</mesh></group>;
    case "tvTable": return <group><mesh position={[0, 0.25, 0]} material={m.darkWood} castShadow>{B([w, 0.5, d])}</mesh></group>;
    case "tv": return <group position={[0, 0.85, 0]}><mesh material={m.black}>{B([w, 0.6, 0.05])}</mesh><mesh position={[0, 0, 0.03]} material={m.screen}><planeGeometry args={[w - 0.06, 0.54]} /></mesh><mesh position={[0, -0.33, 0]} material={m.black}>{B([0.2, 0.06, 0.18])}</mesh></group>;
    case "rug": return <mesh position={[0, 0.012, 0]} rotation-x={-Math.PI / 2} material={m.s("#a0543f", 0.95)} receiveShadow><planeGeometry args={[w, d]} /></mesh>;
    case "bed": return <group><mesh position={[0, 0.2, 0]} material={m.darkWood} castShadow>{B([w, 0.3, d])}</mesh><mesh position={[0, 0.42, 0.02]} material={m.white}>{B([w - 0.06, 0.16, d - 0.08])}</mesh><mesh position={[0, 0.52, 0.25]} material={m.bed}>{B([w - 0.02, 0.06, d * 0.62])}</mesh><mesh position={[0, 0.55, -d / 2 + 0.28]} material={m.white}>{B([w - 0.25, 0.1, 0.32])}</mesh><mesh position={[0, 0.6, -d / 2 + 0.03]} material={m.darkWood}>{B([w, 0.9, 0.06])}</mesh></group>;
    case "desk": return <group><mesh position={[0, 0.74, 0]} material={m.wood} castShadow>{B([w, 0.04, d])}</mesh>{[-1, 1].map((a) => <mesh key={a} position={[a * (w / 2 - 0.03), 0.37, 0]} material={m.wood}>{B([0.04, 0.74, d])}</mesh>)}<mesh position={[-0.2, 0.78, -0.05]} material={m.black}>{B([0.34, 0.02, 0.24])}</mesh><mesh position={[0.3, 0.86, -0.12]} material={m.brass}><cylinderGeometry args={[0.07, 0.09, 0.2, 12]} /></mesh></group>;
    case "closet": return <group><mesh position={[0, 1.0, 0]} material={m.wood} castShadow>{B([w, 2.0, d])}</mesh><mesh position={[0, 1.0, d / 2 + 0.005]} material={m.darkWood}>{B([0.01, 1.9, 0.01])}</mesh>{[-0.08, 0.08].map((x) => <mesh key={x} position={[x, 1.0, d / 2 + 0.02]} material={m.brass}>{B([0.02, 0.2, 0.02])}</mesh>)}</group>;
    case "lamp": return <group><mesh position={[0, 0.7, 0]} material={m.brass}><cylinderGeometry args={[0.015, 0.015, 1.4, 6]} /></mesh><mesh position={[0, 1.45, 0]} material={m.fabric2}><cylinderGeometry args={[0.12, 0.18, 0.22, 14, 1, true]} /></mesh><mesh position={[0, 0.02, 0]} material={m.brass}><cylinderGeometry args={[0.12, 0.12, 0.03, 12]} /></mesh></group>;
  }
}

/** The elevator's two sliding doors (on a shaft's front, at x = the shaft's middle), opened `k` (0..1). */
function ElevatorDoors({ open, m }: { open: () => number; m: FMats }) {
  const l = useRef<THREE.Mesh>(null), r = useRef<THREE.Mesh>(null);
  useFrame(() => { const k = open(); if (l.current) l.current.position.x = -0.26 - 0.5 * k; if (r.current) r.current.position.x = 0.26 + 0.5 * k; });
  return <group>
    <mesh ref={l} position={[-0.26, 1.08, 0.02]} material={m.steel}>{B([0.52, 2.16, 0.04])}</mesh>
    <mesh ref={r} position={[0.26, 1.08, 0.02]} material={m.steel}>{B([0.52, 2.16, 0.04])}</mesh>
  </group>;
}

/** The car: steel walls, a lit ceiling, the button panel beside the door; at the floor it's on. */
function ElevatorCar({ m }: { m: FMats }) {
  const s = SHAFT - 0.26;
  return <group>
    <mesh position={[0, 0.005, 0]} rotation-x={-Math.PI / 2} material={m.s("#3a3d44", 0.8)}><planeGeometry args={[s, s]} /></mesh>
    <mesh position={[0, 2.38, 0]} rotation-x={Math.PI / 2} material={m.lamp}><planeGeometry args={[s * 0.7, s * 0.7]} /></mesh>
    {[[0, -s / 2, 0], [-s / 2, 0, Math.PI / 2], [s / 2, 0, -Math.PI / 2]].map(([x, z, ry], i) => <mesh key={i} position={[x!, 1.2, z!]} rotation-y={ry!} material={m.steel}><planeGeometry args={[s, 2.4]} /></mesh>)}
    {/* The panel of buttons on the right of the door (as you face it from inside). */}
    <mesh position={[-s / 2 + 0.02, 1.25, s / 2 - 0.25]} rotation-y={Math.PI / 2} material={m.black}>{B([0.22, 0.6, 0.02])}</mesh>
    {Array.from({ length: 15 }, (_, k) => <mesh key={k} position={[-s / 2 + 0.035, 1.02 + Math.floor(k / 2) * 0.065, s / 2 - 0.29 + (k % 2) * 0.08]} rotation-y={Math.PI / 2} material={m.lamp}><circleGeometry args={[0.016, 10]} /></mesh>)}
    <mesh position={[0, 1.0, -s / 2 + 0.03]} material={m.steel}>{B([s - 0.1, 0.04, 0.05])}</mesh>
  </group>;
}

/** The floor the player is on: hallway, apartment (two rooms), the walls with real windows, the doors, the furniture. */
function FloorInterior({ fl, state, m, door, elevatorOpen }: { fl: AptFloor; state: GameState; m: FMats; door: () => number; elevatorOpen: () => number }) {
  const { frame, bounds, windowSide: ws, hallZ, wallZ, divX, bedroomDoor } = fl;
  const { minX, maxX, minZ, maxZ } = bounds;
  const leaf = useRef<THREE.Group>(null);
  useFrame(() => { if (leaf.current) leaf.current.rotation.y = -door(); });
  const H = FLOOR_CLEAR;
  const frontHoles = fl.front.map((w) => ({ a0: w.a0, a1: w.a1, y0: w.y0, y1: 2.35 }));
  const sideHoles = fl.side.map((w) => ({ a0: w.a0, a1: w.a1, y0: w.y0, y1: 2.35 }));
  const inside0 = wallZ + INNER_WALL;
  const panels = (pieces: { a0: number; a1: number; y0: number; y1: number }[], place: (a: number) => [number, number], ry: number, mat: THREE.Material) => pieces.map((r, i) => {
    const [x, z] = place((r.a0 + r.a1) / 2);
    return <mesh key={i} position={[x, (r.y0 + r.y1) / 2, z]} rotation-y={ry} material={mat} receiveShadow><planeGeometry args={[r.a1 - r.a0, r.y1 - r.y0]} /></mesh>;
  });
  const glass = (a0: number, a1: number, y0: number, place: (a: number) => [number, number], ry: number) => { const [x, z] = place((a0 + a1) / 2); return <mesh position={[x, (y0 + 2.35) / 2, z]} rotation-y={ry} material={m.glass}><planeGeometry args={[a1 - a0, 2.35 - y0]} /></mesh>; };
  const plainX = -ws * maxX, windowX = ws * maxX;
  return <group position={[frame.ox, fl.y, frame.oz]} rotation-y={frame.rot}>
    {/* Floors: carpet in the hallway, wood in the apartment; the ceiling over everything. */}
    <mesh position={[(minX + maxX) / 2, 0.004, (hallZ[0] + hallZ[1]) / 2]} rotation-x={-Math.PI / 2} material={m.carpet} receiveShadow><planeGeometry args={[maxX - minX, hallZ[1] - hallZ[0]]} /></mesh>
    <mesh position={[(minX + maxX) / 2, 0.004, (inside0 + maxZ) / 2]} rotation-x={-Math.PI / 2} material={m.wood} receiveShadow><planeGeometry args={[maxX - minX, maxZ - inside0]} /></mesh>
    <mesh position={[(minX + maxX) / 2, H, (minZ + maxZ) / 2]} rotation-x={Math.PI / 2} material={m.ceiling}><planeGeometry args={[maxX - minX, maxZ - minZ]} /></mesh>
    {/* The outside walls (front, both sides, back), the front and the window side with their windows. */}
    {panels(wallPieces(minX, maxX, H, frontHoles), (a) => [a, maxZ], Math.PI, m.wall)}
    {fl.front.map((w, i) => <group key={i}>{glass(w.a0, w.a1, w.y0, (a) => [a, maxZ + 0.1], Math.PI)}<mesh position={[(w.a0 + w.a1) / 2, w.y0 - 0.02, maxZ - 0.06]} material={m.white}>{B([w.a1 - w.a0 + 0.1, 0.04, 0.16])}</mesh></group>)}
    {panels(wallPieces(minZ, maxZ, H, sideHoles), (a) => [windowX, a], -ws * Math.PI / 2, m.wall)}
    {fl.side.map((w, i) => <group key={i}>{glass(w.a0, w.a1, w.y0, (a) => [windowX + ws * 0.1, a], -ws * Math.PI / 2)}</group>)}
    {panels(wallPieces(minZ, maxZ, H, []), (a) => [plainX, a], ws * Math.PI / 2, m.wall)}
    {panels(wallPieces(minX, maxX, H, []), (a) => [a, minZ], 0, m.hallWall)}
    {/* The shaft and the storage behind the hallway: their walls to the hallway. */}
    <mesh position={[(minX + SHAFT + maxX) / 2, H / 2, hallZ[0]]} material={m.hallWall}><planeGeometry args={[maxX - minX - SHAFT, H]} /></mesh>
    {[-1, 1].map((s) => <mesh key={s} position={[minX + SHAFT / 2 + s * (SHAFT / 2 - (SHAFT / 2 - 0.55) / 2), H / 2, hallZ[0]]} material={m.hallWall}><planeGeometry args={[SHAFT / 2 - 0.55, H]} /></mesh>)}
    <mesh position={[minX + SHAFT / 2, (H + 2.2) / 2, hallZ[0]]} material={m.hallWall}><planeGeometry args={[1.1, H - 2.2]} /></mesh>
    <group position={[minX + SHAFT / 2, 0, hallZ[0]]}>
      {[-0.58, 0.58].map((x) => <mesh key={x} position={[x, 1.1, 0.02]} material={m.steel}>{B([0.08, 2.2, 0.05])}</mesh>)}
      <mesh position={[0, 2.24, 0.02]} material={m.steel}>{B([1.24, 0.08, 0.05])}</mesh>
      <ElevatorDoors open={elevatorOpen} m={m} />
      <mesh position={[0.8, 1.15, 0.01]} material={m.steel}>{B([0.12, 0.2, 0.03])}</mesh>
    </group>
    {/* The wall between the hallway and the apartment, with the apartment's door (opens into the apartment). */}
    {[[minX, fl.door.x - 1.05], [fl.door.x + 0.02, maxX]].map(([a, c], i) => <mesh key={i} position={[(a! + c!) / 2, H / 2, wallZ + INNER_WALL / 2]} material={m.hallWall} castShadow>{B([c! - a!, H, INNER_WALL])}</mesh>)}
    <mesh position={[fl.door.x - 0.515, (H + 2.1) / 2, wallZ + INNER_WALL / 2]} material={m.hallWall}>{B([1.07, H - 2.1, INNER_WALL])}</mesh>
    <group position={[fl.door.x - 1, 0, wallZ + INNER_WALL]}>
      <group ref={leaf}>
        <mesh position={[0.5, 1.05, -0.02]} material={m.door} castShadow>{B([0.98, 2.08, 0.045])}</mesh>
        {[-1, 1].map((s) => <mesh key={s} position={[0.88, 1.02, -0.02 + s * 0.04]} material={m.brass}>{B([0.12, 0.025, 0.025])}</mesh>)}
        <mesh position={[0.88, 1.12, -0.065]} material={m.brass}><cylinderGeometry args={[0.018, 0.018, 0.01, 10]} /></mesh>
      </group>
    </group>
    {/* The door's number plate on the hallway side. */}
    <mesh position={[fl.door.x + 0.15, 1.6, wallZ - 0.005]} rotation-y={Math.PI} material={m.brass}>{B([0.16, 0.1, 0.01])}</mesh>
    {/* The bedroom wall and its doorway; the white bedroom door stands open against it. */}
    <mesh position={[divX, H / 2, (bedroomDoor[1] + maxZ) / 2]} material={m.wall} castShadow>{B([INNER_WALL, H, maxZ - bedroomDoor[1]])}</mesh>
    <mesh position={[divX, H / 2, (inside0 + bedroomDoor[0]) / 2]} material={m.wall}>{B([INNER_WALL, H, bedroomDoor[0] - inside0])}</mesh>
    <mesh position={[divX, (H + 2.05) / 2, (bedroomDoor[0] + bedroomDoor[1]) / 2]} material={m.wall}>{B([INNER_WALL, H - 2.05, bedroomDoor[1] - bedroomDoor[0]])}</mesh>
    <group position={[divX - INNER_WALL / 2, 0, bedroomDoor[1]]} rotation-y={Math.PI / 2 + 0.15}>
      <mesh position={[-0.44, 1.02, 0.02]} material={m.doorWhite} castShadow>{B([0.86, 2.02, 0.04])}</mesh>
      {[0.55, 1.45].map((y) => <mesh key={y} position={[-0.44, y, 0.045]} material={m.s("#e6e1d7", 0.5)}>{B([0.6, 0.6, 0.01])}</mesh>)}
      <mesh position={[-0.8, 1.02, 0.06]} material={m.steel}><sphereGeometry args={[0.025, 8, 6]} /></mesh>
    </group>
    {/* Hallway: lights, a plant at the far end, a runner of carpet. */}
    {[minX + 2.5, (minX + maxX) / 2 + 1, maxX - 1.2].map((x) => <mesh key={x} position={[x, H - 0.02, (hallZ[0] + hallZ[1]) / 2]} rotation-x={Math.PI / 2} material={m.lamp}><circleGeometry args={[0.18, 18]} /></mesh>)}
    <group position={[maxX - 0.35, 0, hallZ[0] + 0.35]}><mesh position-y={0.25} material={m.pot}><cylinderGeometry args={[0.2, 0.16, 0.5, 14]} /></mesh><mesh position-y={0.85} material={m.plant}><icosahedronGeometry args={[0.38, 1]} /></mesh></group>
    {/* The apartment's ceiling lights. */}
    {[[(divX + maxX) / 2, (inside0 + maxZ) / 2], [(minX + divX) / 2, (inside0 + maxZ) / 2]].map(([x, z], i) => <mesh key={i} position={[x!, H - 0.02, z!]} rotation-x={Math.PI / 2} material={m.lamp}><circleGeometry args={[0.25, 20]} /></mesh>)}
    {fl.furniture.map((f, i) => <group key={i} position={[f.x, 0, f.z]} rotation-y={f.rot}><Furniture f={f} m={m} /></group>)}
    {/* The elevator car at this floor. */}
    {state.elevator && <group position={[minX + SHAFT / 2, 0, minZ + SHAFT / 2]}><ElevatorCar m={m} /></group>}
  </group>;
}

// ---------- moving about: the elevator, the apartment door, bed and fridge ----------
type Move = { kind: "board" | "alight" | "keyIn" | "out"; plan: Plan | null; t0: number; door?: "in" | "out"; from?: [number, number]; fromYaw?: number; keyT?: number };
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
  const doorAngle = useRef(0);
  const [floor, setFloor] = useState<AptFloor | null>(null);
  const prompt = useRef<{ visible: boolean; x: number; y: number; z: number; label?: string | undefined }>({ visible: false, x: 0, y: 0, z: 0 });
  const ownScript = useRef(false);
  const sleeping = useRef(0);

  const byKey = useMemo(() => new Map(buildings.map((b) => [aptKey(b), b])), [buildings]);
  const lobbyOf = (key: string) => { const b = byKey.get(key); return b ? venueLayout(b) : null; };
  // Every apartment building's lobby has its elevator's doors (they open while the car is there).
  const elevatorOpen = (bkey: string, fl: number) => () => {
    const e = state.elevator;
    if (!e || e.building !== bkey || e.floor !== fl) return 0;
    const t = state.simulationTime - e.t0;
    if (e.phase === "boarding") return smooth(t / 0.8);
    if (e.phase === "choose") return 1;
    if (e.phase === "closing") return 1 - smooth(t / 0.8);
    if (e.phase === "moving") return 0;
    if (e.phase === "opening") return smooth(t / 0.8);
    return 1 - smooth((t - 0.6) / 0.8);
  };

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1), now = state.simulationTime, p = state.pos;
    const inter = state.interior;
    const lobby = inter?.phase === "inside" && !state.level ? (() => { const b = byKey.get(inter.key); return b ? { b, layout: venueLayout(b) } : null; })() : null;
    const lvl = state.level, fb = lvl ? byKey.get(lvl.building) : undefined;
    // The floor's room (made once per floor, kept with the others).
    if (lvl && fb && (!floor || floor.key !== floorKey(fb, lvl.floor))) {
      const f = aptFloor(fb, lvl.floor);
      state.rooms.set(f.key, f);
      setFloor(f);
    }
    if (!lvl && floor) setFloor(null);

    const frameNow = lobby ? lobby.layout.frame : floor?.frame;
    const yNow = lvl ? lvl.y : SIDEWALK_H;
    const toW = (x: number, z: number) => (frameNow ? toWorld(frameNow, x, z) : [x, z] as [number, number]);
    const reachW = (r: Reach | null) => { if (!r || !frameNow) return null; const [x, z] = toWorld(frameNow, r.at[0], r.at[2]); return { at: new THREE.Vector3(x, yNow + r.at[1], z), blend: r.blend, pole: r.pole }; };
    const scriptFrom = (pose: GPose | { x: number; z: number; yaw: number; lean: number; left: Reach | null; right: Reach | null; crouch?: number }): Script => {
      const [x, z] = toW(pose.x, pose.z), prev = state.foodScript;
      return { x, z, yaw: frameNow ? worldYaw(frameNow, pose.yaw) : pose.yaw, walk: prev ? Math.hypot(x - prev.x, z - prev.z) / Math.max(dt, 1e-3) : 0, sit: 0, shuffle: 0, lean: pose.lean, left: reachW(pose.left), right: reachW(pose.right), crouch: pose.crouch ?? 0 };
    };

    // ---------- the elevator ----------
    const e = state.elevator;
    let script: Script | null = null;
    if (e && frameNow) {
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
            const f = aptFloor(b, e.target); state.rooms.set(f.key, f);
            state.level = { building: e.building, floor: e.target, y: floorY(e.target) };
            if (state.interior) state.interior.key = f.key;
          }
          state.pos.y = floorY(e.target);
          e.floor = e.target; e.phase = "opening"; e.t0 = now;
        } else if (e.phase === "opening" && t >= 0.8) { e.phase = "leaving"; e.t0 = now; move.current = { kind: "alight", t0: now, plan: makePlan([walkSeg(car, 0, out, 0, { basket: false, bag: !!state.groceryBag })]) }; }
      } else if (e.phase === "leaving") {
        if (!move.current) move.current = { kind: "alight", t0: now - 10, plan: makePlan([walkSeg(out, 0, out, 0, { basket: false, bag: false })]) };
        const r = planAt(move.current.plan!, now - move.current.t0);
        script = scriptFrom(r.pose);
        if (r.done) { const [x, z] = toW(r.pose.x, r.pose.z); state.pos.x = x; state.pos.z = z; state.rotY = worldYaw(frameNow, r.pose.yaw); move.current = null; script = null; }
        // Out of the car: the doors close behind (then the elevator is free again).
        if (r.done && t > 1.5) state.elevator = null;
      }
    }
    function here(): { x: number; z: number; yaw: number } { const [x, z] = frameNow ? toLocal(frameNow, p.x, p.z) : [p.x, p.z]; return { x, z, yaw: hereYaw() }; }
    function here2(): [number, number] { const h = here(); return [h.x, h.z]; }
    function hereYaw() { return frameNow ? state.rotY - frameNow.rot : state.rotY; }

    // ---------- the apartment door ----------
    const mv = move.current;
    if (!e && mv && floor && (mv.kind === "keyIn" || mv.kind === "out")) {
      const t = now - mv.t0, fr = floor, dx = fr.door.x, dz = fr.door.z + INNER_WALL;
      // The door's frame: origin at the doorway's right edge, +z into the apartment (the opening is local x −1..0).
      const toRoom = (pose: { x: number; z: number; yaw: number; lean: number; left: Reach | null; right: Reach | null }, mirror: boolean) => {
        const sx = mirror ? -1 : 1;
        const r = (h: Reach | null): Reach | null => (h ? { at: [dx + sx * h.at[0], h.at[1], dz + h.at[2]], blend: h.blend, pole: h.pole } : null);
        return { x: dx + sx * pose.x, z: dz + pose.z, yaw: mirror ? -pose.yaw : pose.yaw, lean: pose.lean, left: mirror ? r(pose.right) : r(pose.left), right: mirror ? r(pose.left) : r(pose.right), crouch: 0 };
      };
      if (mv.kind === "keyIn") {
        const kt = mv.keyT!, stand: [number, number] = [-0.45, -0.72];
        if (t < kt) {
          // Walk up, the key goes into the lock, turns, comes back out (into the pocket).
          const walkEnd = KEY.walk, lock: [number, number, number] = [dx - 0.13, 1.05, dz - INNER_WALL - 0.05];
          const sp = mv.plan ? planAt(mv.plan, Math.min(t, walkEnd)).pose : { x: dx + stand[0], z: dz + stand[1], yaw: 0, crouch: 0, lean: 0, left: null, right: null };
          let right: Reach | null = null;
          const a = t - walkEnd;
          if (a > 0) {
            const reach = smooth(a / KEY.reach), turn = smooth((a - KEY.reach) / KEY.turn), back = smooth((a - KEY.reach - KEY.turn) / KEY.back);
            right = { at: [lock[0] + 0.03 * Math.sin(turn * Math.PI), lock[1] + 0.02 * turn, lock[2]], blend: reach * (1 - back), pole: "out" };
            if (back > 0.5 && state.heldSlot !== null && heldKind(state) === "key") state.heldSlot = null;
          }
          script = scriptFrom({ ...sp, right, left: null, lean: 0.05 });
          doorAngle.current = 0;
        } else {
          // Then the door is pushed open into the apartment and they walk in (the restaurants' way out, here in).
          const from: [number, number] = [stand[0], stand[1]], total = LEAVE.done + leaveLead(from);
          const pose = leavePose(Math.min(t - kt, total), from, 0);
          script = scriptFrom(toRoom(pose, false));
          doorAngle.current = pose.door.left;
          if (t - kt >= total) { const [x, z] = toW(script.x, script.z); void x; void z; state.pos.x = script.x; state.pos.z = script.z; state.rotY = script.yaw; move.current = null; script = null; doorAngle.current = 0; }
        }
      } else {
        // Coming out: the door pulled open into the apartment (the restaurants' way in, mirrored) and out.
        const from = mv.from!, total = ENTER.done + enterLead(from);
        const pose = enterPose(Math.min(t, total), from, mv.fromYaw!);
        script = scriptFrom(toRoom(pose, true));
        doorAngle.current = pose.door.right;
        if (t >= total) { state.pos.x = script.x; state.pos.z = script.z; state.rotY = script.yaw; move.current = null; script = null; doorAngle.current = 0; }
      }
    }
    // This building's moves drive the body; when they end it's the player's again.
    if (script) { state.foodScript = script; ownScript.current = true; }
    else if (ownScript.current) { state.foodScript = null; ownScript.current = false; }

    // ---------- E: what can be done here ----------
    const pr = prompt.current; pr.visible = false; pr.label = undefined;
    if (state.elevator || move.current || state.accident || state.health <= 0 || sleeping.current) { if (state.elevator || move.current) state.interactQueued = false; return; }
    const show = (x: number, z: number, y: number, label: string) => { const [wx, wz] = toW(x, z); Object.assign(pr, { visible: true, x: wx, y: yNow + y, z: wz, label }); };
    let act: (() => void) | null = null;
    if (lobby) {
      const L = lobby.layout, [lx, lz] = toLocal(L.frame, p.x, p.z), ex = L.bounds.minX + SHAFT / 2, ez = L.bounds.minZ + SHAFT;
      if (Math.abs(lx - ex) < 1.1 && lz - ez > 0 && lz - ez < 1.6) {
        show(ex, ez + 0.3, 2.2, "E  ELEVATOR");
        act = () => { state.elevator = { building: aptKey(lobby.b), floor: 1, target: null, phase: "boarding", t0: now }; move.current = null; };
      }
    } else if (floor && lvl) {
      const [lx, lz] = toLocal(floor.frame, p.x, p.z), ex = floor.bounds.minX + SHAFT / 2, hz0 = floor.hallZ[0];
      const mine = state.life.home?.building === lvl.building && state.life.home.floor === lvl.floor;
      const dx = floor.door.x, wz = floor.wallZ;
      if (Math.abs(lx - ex) < 1.1 && lz - hz0 > 0 && lz - hz0 < 1.5) {
        show(ex, hz0 + 0.3, 2.2, "E  ELEVATOR");
        act = () => { state.elevator = { building: lvl.building, floor: lvl.floor, target: null, phase: "boarding", t0: now }; move.current = null; };
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
          move.current = { kind: "out", t0: now, plan: null, from: [fx, fz], fromYaw: fyaw };
          state.keys.clear();
        };
      } else if (mine && Math.hypot(lx - floor.spots.bed[0], lz - floor.spots.bed[1]) < 1.2) {
        show(floor.spots.bed[0] - 0.6, floor.spots.bed[1], 1.3, "E  SLEEP");
        act = () => sleep();
      } else if (mine && Math.hypot(lx - floor.spots.fridge[0], lz - floor.spots.fridge[1]) < 1.0) {
        show(floor.spots.fridge[0] + 0.5, floor.spots.fridge[1], 2.0, "E  FRIDGE");
        act = () => { state.uiLock = "fridge"; state.keys.clear(); };
      }
    }
    if (act && state.interactQueued) { state.interactQueued = false; act(); }
    if (floor && state.interactQueued) state.interactQueued = false;
  }, -0.66);

  const sleep = () => {
    sleeping.current = 1; state.uiLock = "sleep"; state.keys.clear();
    window.setTimeout(() => {
      state.health = 100;
      const shared = !!state.npcLink;
      if (!shared) { const t = timeInfo(state.elapsed), cycle = 2400, into = ((state.elapsed % cycle) + cycle) % cycle; if (!t.isDay) state.elapsed += cycle - into + 50; }
      toast(state, "Good morning!", "info", shared ? "Rested: health is full." : "You slept through the night. Health is full.");
      sleeping.current = 0; state.uiLock = null;
    }, 2400);
  };

  const lobbies = useMemo(() => buildings.map((b) => ({ b, layout: venueLayout(b) })), [buildings]);
  return <group>
    {buildings.map((b) => <AptExterior key={aptKey(b)} b={b} state={state} />)}
    {/* The lobby elevators' doors (and the car, while someone's in it at the lobby). */}
    {lobbies.map(({ b, layout }) => <group key={aptKey(b)} position={[layout.frame.ox, SIDEWALK_H, layout.frame.oz]} rotation-y={layout.frame.rot}>
      <group position={[layout.bounds.minX + SHAFT / 2, 0, layout.bounds.minZ + SHAFT + 0.005]}><ElevatorDoors open={elevatorOpen(aptKey(b), 1)} m={m} /></group>
      <LobbyCar state={state} bkey={aptKey(b)} at={[layout.bounds.minX + SHAFT / 2, layout.bounds.minZ + SHAFT / 2]} m={m} />
      <LobbyVisitor state={state} layout={layout} />
    </group>)}
    {floor && <FloorInterior fl={floor} state={state} m={m} door={() => doorAngle.current} elevatorOpen={elevatorOpen(state.level?.building ?? "", state.level?.floor ?? 0)} />}
    <InteractionPrompt sample={() => ({ ...prompt.current, time: state.simulationTime })} />
  </group>;
}

function LobbyCar({ state, bkey, at, m }: { state: GameState; bkey: string; at: [number, number]; m: FMats }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => { if (g.current) g.current.visible = state.elevator?.building === bkey && state.elevator.floor === 1; });
  return <group ref={g} position={[at[0], 0, at[1]]} visible={false}><ElevatorCar m={m} /></group>;
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
