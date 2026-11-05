import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CharacterBody, useBodyRig } from "./CharacterBody";
import { BUILDING_ENTRANCE, SIDEWALK_H, type Building, type VenueKind } from "./config";
import { quality } from "./quality";
import { CEILING, DOOR_H, LEAF, WALL, WINDOW } from "./restaurantRoom";
import { ARM_Y, CLOSER_ARM, INTERIOR_REACH, Leaf, Panel, Plant, SKIN, Wall, WindowOpening, closerArms, makeTiles, type Hole, type Materials } from "./Restaurants";
import { ScooterModel, type ScooterLook } from "./Scooter";
import type { GameState } from "./state";
import { canvas, groundY, makeBlankWall, tex } from "./textures";
import { venueLayout, type Fixture, type VenueLayout } from "./venueRoom";

const FH = BUILDING_ENTRANCE.floorHeight;

/** Each venue's colours, inside and out. */
const LOOK: Record<VenueKind, { front: string; frame: string; wall: string; trim: string; floor: [string, string]; ceiling: string; accent: string; staff: string }> = {
  grocery: { front: "#e9e1cf", frame: "#2e7d4f", wall: "#f3efe4", trim: "#2e9d5b", floor: ["#e7e2d6", "#cfc8b8"], ceiling: "#fbfaf6", accent: "#2e9d5b", staff: "#2e9d5b" },
  clothing: { front: "#2b2d33", frame: "#d6455d", wall: "#f6efe9", trim: "#cdb9ad", floor: ["#c9a27e", "#b38b66"], ceiling: "#ffffff", accent: "#d6455d", staff: "#1f1f24" },
  bikes: { front: "#4b4f57", frame: "#e07a1f", wall: "#e6e4df", trim: "#5a5f6b", floor: ["#8d9196", "#767a80"], ceiling: "#f2f2f2", accent: "#e07a1f", staff: "#e07a1f" },
  gym: { front: "#1f2128", frame: "#ffb547", wall: "#d9dbe0", trim: "#33363f", floor: ["#3a3d44", "#2f3238"], ceiling: "#e9eaee", accent: "#ffb547", staff: "#2b2d33" },
  hospital: { front: "#f4f6f8", frame: "#3a8fb7", wall: "#f4f8fa", trim: "#9fd3e0", floor: ["#e8eef1", "#d4dde2"], ceiling: "#ffffff", accent: "#d62f3a", staff: "#4fb3a9" },
  police: { front: "#d9d6cf", frame: "#1d3b8a", wall: "#e3e6ea", trim: "#1d3b8a", floor: ["#b9bec6", "#a3a9b2"], ceiling: "#f5f6f8", accent: "#1d3b8a", staff: "#1d3b8a" },
};

/** The outside wall of a venue: its colour, frames round the windows and the door, the openings cut through. */
function makeFront(kind: VenueKind, windows: [number, number][], door: [number, number] | null) {
  const look = LOOK[kind];
  const [c, g] = canvas(1024, 384);
  g.fillStyle = look.front; g.fillRect(0, 0, 1024, 384);
  // A plinth along the bottom, and a band above the windows.
  g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(0, 352, 1024, 32);
  const top = groundY(WINDOW.y1), bottom = groundY(WINDOW.y0), doorTop = groundY(DOOR_H);
  g.fillStyle = look.frame; g.fillRect(0, top - 34, 1024, 10);
  const px = (u: number) => Math.round(u * 1024);
  for (const [u0, u1] of windows) { g.fillStyle = look.frame; g.fillRect(px(u0) - 10, top - 10, px(u1) - px(u0) + 20, bottom - top + 20); }
  if (door) { const [x0, x1] = [px(door[0]), px(door[1])]; g.fillStyle = look.frame; g.fillRect(x0 - 12, doorTop - 12, x1 - x0 + 24, 384 - doorTop + 12); g.clearRect(x0, doorTop, x1 - x0, 384 - doorTop); }
  for (const [u0, u1] of windows) g.clearRect(px(u0), top, px(u1) - px(u0), bottom - top);
  const map = tex(c); map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  return map;
}

/** A small picture on a canvas, as a material (flags, notice boards, the red cross…). */
function picture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, emissive = 0) {
  const [c, g] = canvas(w, h);
  draw(g);
  const map = tex(c);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.7, ...(emissive ? { emissiveMap: map, emissive: new THREE.Color("#ffffff"), emissiveIntensity: emissive } : {}) });
}

function useVenueMaterials() {
  return useMemo(() => {
    const solid = (color: string, roughness = 0.7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
    return {
      solid,
      wood: solid("#a47148", 0.6), darkWood: solid("#5b3a24", 0.6), white: solid("#f4f4f2", 0.5), grey: solid("#8e949c", 0.55, 0.2),
      bench: solid("#7c828a", 0.5, 0.35), steel: solid("#c4c9cf", 0.3, 0.75), black: solid("#1d1f24", 0.5, 0.2), rubber: solid("#25272c", 0.95),
      screen: new THREE.MeshStandardMaterial({ color: "#1c3a52", emissive: new THREE.Color("#4fc3f7"), emissiveIntensity: 0.7 }),
      // A light, faintly blue sheen (a fully metal mirror shows black without reflections to show).
      mirror: new THREE.MeshStandardMaterial({ color: "#dbe6ee", roughness: 0.12, metalness: 0.35, emissive: new THREE.Color("#9fb6c6"), emissiveIntensity: 0.25 }),
      cloth: ["#d6455d", "#3d7bff", "#2e9d5b", "#ffb547", "#8a5cd6", "#f2f3f7", "#2b2d33", "#3a8fb7"].map((c) => solid(c, 0.85)),
      curtain: new THREE.MeshStandardMaterial({ color: "#a7d3df", roughness: 0.9, side: THREE.DoubleSide }),
      crate: solid("#b98a55", 0.85), basket: solid("#d62f3a", 0.6),
      fruit: {
        apple: solid("#c8202a", 0.45), banana: solid("#f3d23b", 0.55), orange: solid("#f28a1a", 0.75), pear: solid("#b5c94a", 0.55),
        lemon: solid("#f5e04a", 0.6), lime: solid("#6cbf3c", 0.6), grape: solid("#6b2d6b", 0.4), peach: solid("#f6a57a", 0.7),
      } as Record<string, THREE.MeshStandardMaterial>,
      products: ["#d62f3a", "#ffb547", "#3d7bff", "#2e9d5b", "#f2f3f7", "#8a5cd6", "#e07a1f"].map((c) => solid(c, 0.5)),
      flagUs: picture(128, 80, (g) => {
        for (let k = 0; k < 13; k++) { g.fillStyle = k % 2 ? "#ffffff" : "#b22234"; g.fillRect(0, k * 80 / 13, 128, 80 / 13 + 1); }
        g.fillStyle = "#3c3b6e"; g.fillRect(0, 0, 54, 43);
        g.fillStyle = "#ffffff"; for (let a = 0; a < 5; a++) for (let b = 0; b < 4; b++) g.fillRect(5 + a * 10, 5 + b * 10, 3, 3);
      }),
      flagCity: picture(128, 80, (g) => { g.fillStyle = "#1d3b8a"; g.fillRect(0, 0, 128, 80); g.fillStyle = "#ffd166"; g.beginPath(); g.arc(64, 40, 20, 0, Math.PI * 2); g.fill(); g.fillStyle = "#1d3b8a"; g.font = "800 22px Manrope, Arial"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("B", 64, 41); }),
      board: picture(256, 160, (g) => {
        g.fillStyle = "#b8865b"; g.fillRect(0, 0, 256, 160); g.strokeStyle = "#6d4a2c"; g.lineWidth = 10; g.strokeRect(0, 0, 256, 160);
        [["#ffffff", 18, 18], ["#fff3b0", 96, 26], ["#ffffff", 172, 16], ["#d7ecff", 30, 88], ["#ffffff", 118, 84], ["#ffd7d7", 186, 92]].forEach(([c, x, y]) => {
          g.fillStyle = c as string; g.fillRect(x as number, y as number, 58, 52); g.fillStyle = "#555"; for (let l = 0; l < 4; l++) g.fillRect((x as number) + 6, (y as number) + 10 + l * 9, 44, 3);
          g.fillStyle = "#d62f3a"; g.beginPath(); g.arc((x as number) + 29, (y as number) + 4, 3, 0, Math.PI * 2); g.fill();
        });
      }),
      redCross: picture(128, 128, (g) => { g.fillStyle = "#ffffff"; g.fillRect(0, 0, 128, 128); g.fillStyle = "#d62f3a"; g.fillRect(44, 14, 40, 100); g.fillRect(14, 44, 100, 40); }, 0.25),
      toolWall: picture(256, 128, (g) => {
        g.fillStyle = "#cfc6b4"; g.fillRect(0, 0, 256, 128); g.fillStyle = "#a99f8c"; for (let a = 8; a < 256; a += 14) for (let b = 8; b < 128; b += 14) g.fillRect(a, b, 3, 3);
        g.strokeStyle = "#333"; g.lineWidth = 6;
        [[30, 30, 30, 95], [62, 28, 62, 80], [96, 30, 120, 98], [150, 30, 150, 100], [190, 40, 230, 40], [200, 70, 236, 100]].forEach(([a, b, c, d]) => { g.beginPath(); g.moveTo(a!, b!); g.lineTo(c!, d!); g.stroke(); });
        g.fillStyle = "#e07a1f"; g.fillRect(56, 76, 12, 20); g.fillStyle = "#d62f3a"; g.fillRect(144, 92, 12, 18);
      }),
      tire: solid("#18191c", 0.9),
      hat: solid("#16244f", 0.6), hatBand: solid("#0b1124", 0.5), badge: solid("#d9b44a", 0.3, 0.85),
      lamp: new THREE.MeshStandardMaterial({ color: "#fffaf0", emissive: new THREE.Color("#fff6e0"), emissiveIntensity: 1.3 }),
    };
  }, []);
}
type VMats = ReturnType<typeof useVenueMaterials>;

const box = (args: [number, number, number]) => <boxGeometry args={args} />;

/** One fixture, drawn by its type, in its own frame (front toward +z). */
function FixtureModel({ f, m, kind }: { f: Fixture; m: VMats; kind: VenueKind }) {
  const { w, d } = f, look = LOOK[kind];
  switch (f.type) {
    case "desk": {
      const front = kind === "police" ? m.solid("#2c3e66", 0.6) : kind === "hospital" ? m.white : kind === "gym" ? m.black : m.wood;
      return <group>
        <mesh position={[0, 0.52, 0]} material={front} castShadow receiveShadow>{box([w, 1.04, d])}</mesh>
        <mesh position={[0, 1.06, 0]} material={kind === "police" ? m.grey : m.darkWood} castShadow>{box([w + 0.06, 0.05, d + 0.06])}</mesh>
        <mesh position={[0, 0.6, d / 2 + 0.005]} material={m.solid(look.accent, 0.5)}>{box([w, 0.12, 0.01])}</mesh>
        {/* The computer, facing the staff side. */}
        <group position={[-w * 0.18, 1.085, -0.08]} rotation-y={Math.PI}>
          <mesh position={[0, 0.03, 0]} material={m.black}>{box([0.2, 0.02, 0.16])}</mesh>
          <mesh position={[0, 0.14, 0]} material={m.black}>{box([0.04, 0.22, 0.04])}</mesh>
          <mesh position={[0, 0.33, 0.02]} material={m.black}>{box([0.52, 0.32, 0.03])}</mesh>
          <mesh position={[0, 0.33, 0.036]} material={m.screen}><planeGeometry args={[0.48, 0.28]} /></mesh>
          <mesh position={[0, 0.012, 0.3]} material={m.grey}>{box([0.42, 0.02, 0.14])}</mesh>
        </group>
        {kind !== "police" && <mesh position={[w * 0.28, 1.12, 0]} material={m.black}>{box([0.36, 0.1, 0.3])}</mesh>}
      </group>;
    }
    case "chairOffice": return <group>
      <mesh position={[0, 0.47, 0]} material={m.black}>{box([0.48, 0.07, 0.46])}</mesh>
      <mesh position={[0, 0.82, -0.21]} material={m.black}>{box([0.46, 0.55, 0.06])}</mesh>
      <mesh position={[0, 0.24, 0]} material={m.steel}><cylinderGeometry args={[0.03, 0.03, 0.42, 8]} /></mesh>
      {[0, 1, 2, 3, 4].map((k) => <mesh key={k} position={[Math.sin(k * 1.256) * 0.2, 0.04, Math.cos(k * 1.256) * 0.2]} rotation-y={k * 1.256} material={m.black}>{box([0.04, 0.04, 0.4])}</mesh>)}
    </group>;
    case "bench": return <group>
      {/* A long grey waiting bench: slatted seat and back on steel legs. */}
      {[-0.12, 0, 0.12].map((z) => <mesh key={z} position={[0, 0.45, z + 0.02]} material={m.bench} castShadow receiveShadow>{box([w, 0.04, 0.1])}</mesh>)}
      {[0.62, 0.78].map((y) => <mesh key={y} position={[0, y, -0.2]} material={m.bench} castShadow>{box([w, 0.1, 0.035])}</mesh>)}
      {[-w / 2 + 0.15, 0, w / 2 - 0.15].map((x) => <group key={x} position={[x, 0, 0]}>
        <mesh position={[0, 0.22, 0.12]} material={m.steel}>{box([0.05, 0.44, 0.05])}</mesh>
        <mesh position={[0, 0.45, -0.2]} material={m.steel}>{box([0.05, 0.9, 0.05])}</mesh>
        <mesh position={[0, 0.43, -0.04]} material={m.steel}>{box([0.05, 0.04, 0.34])}</mesh>
      </group>)}
    </group>;
    case "waitChair": return <group>
      <mesh position={[0, 0.45, 0]} material={m.solid("#3a8fb7", 0.5)} castShadow>{box([0.46, 0.05, 0.44])}</mesh>
      <mesh position={[0, 0.75, -0.2]} material={m.solid("#3a8fb7", 0.5)} castShadow>{box([0.46, 0.5, 0.05])}</mesh>
      {[-1, 1].flatMap((a) => [-1, 1].map((b) => <mesh key={`${a}${b}`} position={[a * 0.19, 0.22, b * 0.18]} material={m.steel}>{box([0.03, 0.44, 0.03])}</mesh>))}
    </group>;
    case "flag": return <group>
      <mesh position={[0, 1.15, 0]} material={m.badge}><cylinderGeometry args={[0.02, 0.02, 2.3, 8]} /></mesh>
      <mesh position={[0, 2.33, 0]} material={m.badge}><sphereGeometry args={[0.04, 8, 6]} /></mesh>
      <mesh position={[0, 0.03, 0]} material={m.black}><cylinderGeometry args={[0.16, 0.18, 0.06, 12]} /></mesh>
      <mesh position={[0.36, 1.95, 0]} material={f.tag === "us" ? m.flagUs : m.flagCity}>{box([0.7, 0.44, 0.01])}</mesh>
    </group>;
    case "board": return <mesh position={[0, 1.7, 0.03]} material={m.board}>{box([w, w * 0.62, 0.04])}</mesh>;
    case "redCross": return <mesh position={[0, 2.9, 0.03]} material={m.redCross}>{box([w, w, 0.04])}</mesh>;
    case "bed": return <group>
      <mesh position={[0, 0.35, 0]} material={m.steel}>{box([w, 0.1, d])}</mesh>
      <mesh position={[0, 0.5, 0]} material={m.white} castShadow>{box([w - 0.08, 0.2, d - 0.08])}</mesh>
      <mesh position={[0, 0.65, -d / 2 + 0.3]} material={m.white}>{box([w - 0.3, 0.12, 0.35])}</mesh>
      <mesh position={[0, 0.62, 0.25]} material={m.curtain}>{box([w - 0.06, 0.04, d * 0.6])}</mesh>
      {[-1, 1].flatMap((a) => [-1, 1].map((b) => <mesh key={`${a}${b}`} position={[a * (w / 2 - 0.05), 0.15, b * (d / 2 - 0.05)]} material={m.steel}>{box([0.04, 0.3, 0.04])}</mesh>))}
      <mesh position={[0, 0.8, -d / 2 + 0.03]} material={m.steel}>{box([w, 0.6, 0.04])}</mesh>
    </group>;
    case "curtain": return <group>
      <mesh position={[0, 2.5, 0]} material={m.steel}>{box([w, 0.03, 0.03])}</mesh>
      {Array.from({ length: 8 }, (_, k) => <mesh key={k} position={[-w / 2 + (k + 0.5) * w / 8, 1.45, Math.sin(k * 1.7) * 0.05]} rotation-y={k % 2 ? 0.25 : -0.25} material={m.curtain}><planeGeometry args={[w / 7.2, 2.0]} /></mesh>)}
    </group>;
    case "treadmill": return <group>
      <mesh position={[0, 0.1, 0.1]} material={m.black} castShadow>{box([w, 0.18, d - 0.2])}</mesh>
      <mesh position={[0, 0.2, 0.1]} material={m.rubber}>{box([w - 0.16, 0.02, d - 0.3])}</mesh>
      {[-1, 1].map((s) => <mesh key={s} position={[s * (w / 2 - 0.05), 0.65, -d / 2 + 0.15]} rotation-x={0.15} material={m.grey}>{box([0.05, 1.1, 0.05])}</mesh>)}
      <mesh position={[0, 1.2, -d / 2 + 0.22]} rotation-x={-0.5} material={m.black}>{box([w, 0.1, 0.3])}</mesh>
      <mesh position={[0, 1.25, -d / 2 + 0.26]} rotation-x={-0.5} material={m.screen}><planeGeometry args={[0.32, 0.16]} /></mesh>
    </group>;
    case "weightBench": return <group>
      <mesh position={[0, 0.45, 0]} material={m.black} castShadow>{box([0.32, 0.1, d])}</mesh>
      {[-d / 2 + 0.1, d / 2 - 0.1].map((z) => <mesh key={z} position={[0, 0.22, z]} material={m.steel}>{box([0.28, 0.44, 0.05])}</mesh>)}
      {[-1, 1].map((s) => <mesh key={s} position={[s * 0.3, 0.65, -d / 2 + 0.2]} material={m.steel}>{box([0.05, 1.3, 0.05])}</mesh>)}
      <group position={[0, 1.15, -d / 2 + 0.25]} rotation-z={Math.PI / 2}>
        <mesh material={m.steel}><cylinderGeometry args={[0.015, 0.015, 1.8, 8]} /></mesh>
        {[-0.7, 0.7].map((y) => <mesh key={y} position={[0, y, 0]} material={m.black}><cylinderGeometry args={[0.2, 0.2, 0.06, 18]} /></mesh>)}
      </group>
    </group>;
    case "dumbbells": return <group>
      {[0.3, 0.65].map((y) => <mesh key={y} position={[0, y, 0]} rotation-x={-0.25} material={m.black}>{box([w, 0.04, d - 0.1])}</mesh>)}
      {[-1, 1].map((s) => <mesh key={s} position={[s * (w / 2 - 0.04), 0.4, 0]} material={m.steel}>{box([0.04, 0.8, d - 0.1])}</mesh>)}
      {[0.32, 0.67].flatMap((y) => Array.from({ length: 5 }, (_, k) => <group key={`${y}${k}`} position={[-w / 2 + 0.25 + k * (w - 0.5) / 4, y + 0.06, 0]} rotation-z={Math.PI / 2}>
        <mesh material={m.steel}><cylinderGeometry args={[0.014, 0.014, 0.3, 6]} /></mesh>
        {[-0.12, 0.12].map((p) => <mesh key={p} position={[0, p, 0]} material={m.black}><cylinderGeometry args={[0.05 + (k % 3) * 0.008, 0.05 + (k % 3) * 0.008, 0.06, 10]} /></mesh>)}
      </group>))}
    </group>;
    case "mirror": return <group>
      <mesh position={[0, 1.4, 0.02]} material={m.steel}>{box([w + 0.08, 2.08, 0.03])}</mesh>
      <mesh position={[0, 1.4, 0.04]} material={m.mirror}><planeGeometry args={[w, 2]} /></mesh>
    </group>;
    case "mats": return <mesh position={[0, 0.008, 0]} rotation-x={-Math.PI / 2} material={m.rubber} receiveShadow><planeGeometry args={[w, d]} /></mesh>;
    case "rack": return <group>
      {[-1, 1].map((s) => <mesh key={s} position={[s * w / 2, 0.75, 0]} material={m.steel}>{box([0.04, 1.5, 0.04])}</mesh>)}
      {[-1, 1].map((s) => <mesh key={s} position={[s * w / 2, 0.02, 0]} material={m.steel}>{box([0.06, 0.04, d])}</mesh>)}
      <mesh position={[0, 1.48, 0]} rotation-z={Math.PI / 2} material={m.steel}><cylinderGeometry args={[0.015, 0.015, w, 8]} /></mesh>
      {Array.from({ length: 7 }, (_, k) => <group key={k} position={[-w / 2 + 0.2 + k * (w - 0.4) / 6, 1.48, 0]}>
        <mesh position={[0, -0.04, 0]} material={m.steel}>{box([0.02, 0.08, 0.02])}</mesh>
        <mesh position={[0, -0.38, 0]} rotation-y={Math.PI / 2} material={m.cloth[(((k + Math.round(f.x * 3)) % m.cloth.length) + m.cloth.length) % m.cloth.length]!} castShadow>{box([0.42, 0.6, 0.06])}</mesh>
      </group>)}
    </group>;
    case "shelfClothes": return <group>
      <mesh position={[0, 1.0, -d / 2 + 0.02]} material={m.wood}>{box([w, 2.0, 0.04])}</mesh>
      {[0.25, 0.75, 1.25, 1.75].map((y) => <mesh key={y} position={[0, y, 0]} material={m.wood}>{box([w, 0.04, d])}</mesh>)}
      {[0.25, 0.75, 1.25].flatMap((y, r) => Array.from({ length: 6 }, (_, k) => <mesh key={`${y}${k}`} position={[-w / 2 + 0.25 + k * (w - 0.5) / 5, y + 0.1, 0.02]} material={m.cloth[(k + r * 2) % m.cloth.length]!}>{box([0.36, 0.16, 0.32])}</mesh>))}
    </group>;
    case "fittingRoom": return <group>
      <mesh position={[0, 1.05, -d / 2]} material={m.white}>{box([w, 2.1, 0.04])}</mesh>
      {[-1, 1].map((s) => <mesh key={s} position={[s * w / 2, 1.05, 0]} material={m.white}>{box([0.04, 2.1, d])}</mesh>)}
      <mesh position={[0, 2.12, d / 2]} material={m.steel}>{box([w, 0.03, 0.03])}</mesh>
      {Array.from({ length: 5 }, (_, k) => <mesh key={k} position={[-w / 2 + (k + 0.5) * w / 5, 1.1, d / 2 + Math.sin(k * 2.1) * 0.04]} rotation-y={k % 2 ? 0.3 : -0.3} material={m.cloth[0]!}><planeGeometry args={[w / 4.6, 1.95]} /></mesh>)}
    </group>;
    case "bikeDisplay": return <BikeDisplay paint={f.tag ?? "#27877b"} m={m} />;
    case "toolWall": return <mesh position={[0, 1.6, 0.03]} material={m.toolWall}>{box([w, w * 0.5, 0.03])}</mesh>;
    case "tireRack": return <group>
      {[-1, 1].map((s) => <mesh key={s} position={[s * w / 2, 0.55, 0]} material={m.steel}>{box([0.04, 1.1, d])}</mesh>)}
      <mesh position={[0, 0.9, 0]} rotation-z={Math.PI / 2} material={m.steel}><cylinderGeometry args={[0.015, 0.015, w, 8]} /></mesh>
      {[-0.55, -0.18, 0.18, 0.55].map((x) => <mesh key={x} position={[x, 0.66, 0]} rotation-y={Math.PI / 2} material={m.tire}><torusGeometry args={[0.24, 0.06, 10, 22]} /></mesh>)}
    </group>;
    case "workbench": return <group>
      <mesh position={[0, 0.9, 0]} material={m.darkWood} castShadow>{box([w, 0.06, d])}</mesh>
      {[-1, 1].flatMap((a) => [-1, 1].map((b) => <mesh key={`${a}${b}`} position={[a * (w / 2 - 0.06), 0.44, b * (d / 2 - 0.06)]} material={m.steel}>{box([0.05, 0.88, 0.05])}</mesh>))}
      <mesh position={[-w / 2 + 0.3, 1.0, 0.1]} material={m.solid("#3a5a8a", 0.4, 0.5)}>{box([0.2, 0.14, 0.16])}</mesh>
      <mesh position={[w / 2 - 0.45, 1.05, 0]} material={m.solid("#d62f3a", 0.5, 0.3)}>{box([0.5, 0.24, 0.26])}</mesh>
    </group>;
    case "shelf": return <group>
      <mesh position={[0, 0.9, 0]} material={m.white}>{box([w, 1.8, 0.04])}</mesh>
      {[-1, 1].map((s) => <mesh key={s} position={[s * w / 2, 0.9, 0]} material={m.white}>{box([0.04, 1.8, d])}</mesh>)}
      {[0.12, 0.55, 1.0, 1.45].map((y, r) => <group key={y}>
        <mesh position={[0, y, 0]} material={m.white}>{box([w, 0.03, d])}</mesh>
        {[-1, 1].map((side) => Array.from({ length: Math.floor(w / 0.22) }, (_, k) => {
          const mat = m.products[(k * 3 + r + (side > 0 ? 1 : 4)) % m.products.length]!, x = -w / 2 + 0.14 + k * 0.22, z = side * d / 4;
          return f.tag === "cans" ? <mesh key={`${side}${k}`} position={[x, y + 0.08, z]} material={mat}><cylinderGeometry args={[0.04, 0.04, 0.13, 10]} /></mesh>
            : f.tag === "bottles" ? <group key={`${side}${k}`} position={[x, y, z]}><mesh position-y={0.12} material={mat}><cylinderGeometry args={[0.045, 0.045, 0.22, 10]} /></mesh><mesh position-y={0.27} material={mat}><cylinderGeometry args={[0.015, 0.03, 0.08, 8]} /></mesh></group>
            : <mesh key={`${side}${k}`} position={[x, y + 0.13, z]} material={mat}>{box([0.17, 0.24, 0.08])}</mesh>;
        }))}
      </group>)}
    </group>;
    case "crate": return <Crate f={f} m={m} />;
    case "baskets": return <group>
      {[0, 1, 2, 3, 4, 5].map((k) => <group key={k} position={[0, k * 0.07, 0]}>
        <mesh position={[0, 0.06, 0]} material={m.basket}>{box([0.46, 0.04, 0.32])}</mesh>
        {[-1, 1].map((s) => <mesh key={s} position={[s * 0.22, 0.14, 0]} material={m.basket}>{box([0.02, 0.16, 0.32])}</mesh>)}
        {[-1, 1].map((s) => <mesh key={s} position={[0, 0.14, s * 0.15]} material={m.basket}>{box([0.46, 0.16, 0.02])}</mesh>)}
      </group>)}
    </group>;
    case "checkout": return <group>
      {/* The checkout counter: a belt toward the register at the end deeper in the store (the customer's left). */}
      <mesh position={[0, 0.45, 0]} material={m.solid(look.accent, 0.5)} castShadow receiveShadow>{box([w, 0.9, d])}</mesh>
      <mesh position={[0, 0.92, 0]} material={m.steel}>{box([w + 0.04, 0.04, d + 0.04])}</mesh>
      <mesh position={[0.25, 0.945, 0.05]} material={m.rubber}>{box([w * 0.6, 0.01, d * 0.6])}</mesh>
      <group position={[-w / 2 + 0.35, 0.94, -0.12]} rotation-y={Math.PI}>
        <mesh position-y={0.06} material={m.black}>{box([0.42, 0.12, 0.36])}</mesh>
        <mesh position={[0, 0.2, -0.08]} rotation-x={-0.35} material={m.black}>{box([0.34, 0.24, 0.04])}</mesh>
        <mesh position={[0, 0.2, -0.057]} rotation-x={-0.35} material={m.screen}><planeGeometry args={[0.3, 0.2]} /></mesh>
      </group>
      <mesh position={[-w / 2 + 0.35, 0.95, 0.22]} material={m.black}>{box([0.24, 0.02, 0.2])}</mesh>
    </group>;
  }
}

/** A wooden crate of one fruit, heaped. */
function Crate({ f, m }: { f: Fixture; m: VMats }) {
  const fruit = m.fruit[f.tag ?? "apple"]!, banana = f.tag === "banana", grape = f.tag === "grape";
  const heap = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let a = 0; a < 5; a++) for (let b = 0; b < 4; b++) out.push([-0.22 + a * 0.11 + (b % 2) * 0.04, 0.0, -0.16 + b * 0.105]);
    for (let a = 0; a < 4; a++) for (let b = 0; b < 3; b++) out.push([-0.17 + a * 0.11, 0.07, -0.11 + b * 0.105]);
    return out;
  }, []);
  return <group rotation-x={-0.12}>
    <mesh position={[0, 0.35, 0]} material={m.crate} castShadow>{box([f.w, 0.04, f.d])}</mesh>
    {[-1, 1].map((s) => <mesh key={s} position={[s * f.w / 2, 0.45, 0]} material={m.crate}>{box([0.03, 0.22, f.d])}</mesh>)}
    {[-1, 1].map((s) => <mesh key={s} position={[0, 0.45, s * f.d / 2]} material={m.crate}>{box([f.w, 0.22, 0.03])}</mesh>)}
    {[-1, 1].flatMap((a) => [-1, 1].map((b) => <mesh key={`${a}${b}`} position={[a * (f.w / 2 - 0.03), 0.17, b * (f.d / 2 - 0.03)]} material={m.crate}>{box([0.05, 0.34, 0.05])}</mesh>))}
    {heap.map(([x, y, z], i) => banana
      ? <mesh key={i} position={[x, 0.42 + y, z]} rotation={[Math.PI / 2, 0, i]} material={fruit}><torusGeometry args={[0.06, 0.016, 6, 10, Math.PI * 0.7]} /></mesh>
      : <mesh key={i} position={[x, 0.42 + y, z]} material={fruit} scale={grape ? 0.55 : f.tag === "lemon" || f.tag === "lime" ? [1, 0.8, 0.8] : 1}><sphereGeometry args={[0.05, 10, 8]} /></mesh>)}
  </group>;
}

/** A bike on show on a low platform (the shop's own scooters, in their paints). */
function BikeDisplay({ paint, m }: { paint: string; m: VMats }) {
  const look = useMemo<ScooterLook>(() => ({ darkness: 0, scooter: { riding: false, steering: 0, braking: false }, life: { bikePaint: paint } }), [paint]);
  return <group>
    <mesh position={[0, 0.05, 0]} material={m.grey} receiveShadow>{box([0.9, 0.1, 1.9])}</mesh>
    <group position={[0, 0.1, 0]}><ScooterModel state={look} headlight={false} /></group>
  </group>;
}

/** Someone working there: standing, or seated at the desk; the officer wears a cap and a badge. */
function Staff({ layout, kind, m }: { layout: VenueLayout; kind: VenueKind; m: VMats }) {
  const rig = useBodyRig();
  const hat = useRef<THREE.Group>(null), badge = useRef<THREE.Mesh>(null);
  const s = layout.staff;
  useEffect(() => {
    // The cap goes on the head and the badge on the chest, so they move with the body.
    if (hat.current && rig.head.current) rig.head.current.add(hat.current);
    if (badge.current && rig.torso.current) rig.torso.current.add(badge.current);
  }, [rig]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const root = rig.root.current, hips = rig.hips.current;
    if (!root || !hips) return;
    root.position.set(s.x, 0, s.z); root.rotation.y = s.yaw;
    if (s.sit) {
      // Seated at the computer: hips on the chair, thighs forward, shins down, hands on the keyboard (typing).
      hips.position.y = 0.52;
      rig.thighL.current?.rotation.set(-Math.PI / 2, 0, 0.08); rig.thighR.current?.rotation.set(-Math.PI / 2, 0, -0.08);
      rig.shinL.current?.rotation.set(Math.PI / 2, 0, 0); rig.shinR.current?.rotation.set(Math.PI / 2, 0, 0);
      rig.torso.current?.rotation.set(0.12, 0, 0);
      const tap = Math.sin(t * 9) * 0.05;
      rig.armL.current?.rotation.set(-0.55 + tap, 0, 0.12); rig.armR.current?.rotation.set(-0.55 - tap, 0, -0.12);
      rig.foreL.current?.rotation.set(-0.95, 0, 0); rig.foreR.current?.rotation.set(-0.95, 0, 0);
      rig.head.current?.rotation.set(0.12 + Math.sin(t * 0.4) * 0.04, Math.sin(t * 0.25) * 0.15, 0);
    } else {
      // Standing behind the counter, breathing, glancing about now and then.
      hips.position.y = 0.95 + Math.sin(t * 1.6) * 0.006;
      rig.armL.current?.rotation.set(-0.35, 0, 0.12); rig.armR.current?.rotation.set(-0.35, 0, -0.12);
      rig.foreL.current?.rotation.set(-1.1, 0, 0); rig.foreR.current?.rotation.set(-1.1, 0, 0);
      rig.head.current?.rotation.set(0, Math.sin(t * 0.3) * 0.35, 0);
    }
  });
  return <group>
    <CharacterBody rig={rig} color={LOOK[kind].staff} />
    {kind === "police" && <>
      <group ref={hat} position={[0, 0.1, 0]}>
        <mesh material={m.hat} position={[0, 0.03, 0]}><cylinderGeometry args={[0.15, 0.13, 0.11, 18]} /></mesh>
        <mesh material={m.hatBand} position={[0, -0.01, 0]}><cylinderGeometry args={[0.135, 0.135, 0.03, 18]} /></mesh>
        <mesh material={m.hatBand} position={[0, -0.025, 0.12]} rotation-x={0.3} scale={[1, 0.15, 0.7]}><sphereGeometry args={[0.1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
        <mesh material={m.badge} position={[0, 0.04, 0.146]}><circleGeometry args={[0.025, 6]} /></mesh>
      </group>
      {/* The sheriff's star on the chest. */}
      <mesh ref={badge} material={m.badge} position={[0.07, 0.42, 0.155]}>
        <cylinderGeometry args={[0.035, 0.035, 0.01, 5]} />
      </mesh>
    </>}
  </group>;
}

/**
 * A venue: its storefront (windows and a double glass door that open like a restaurant's), and inside, its own
 * themed room from the layout's fixtures, with someone working at the counter or desk. The whole interior is only
 * drawn when near, like a restaurant's.
 */
export function Venue({ b, mats, state }: { b: Building; mats: Materials; state: GameState }) {
  const kind = b.venue!;
  const layout = useMemo(() => venueLayout(b), [b]);
  const m = useVenueMaterials();
  const look = LOOK[kind];
  const { frame, width, depth, windowSide: ws, bounds, frontWindows, sideWindows, plants, fixtures } = layout;
  const own = useMemo(() => {
    const sideU = (z: number) => (ws === 1 ? -z / depth : (z + depth) / depth);
    const floorMap = makeTiles(look.floor[0], look.floor[1], kind === "clothing" ? 2 : 4); floorMap.repeat.set(width / 2, depth / 2);
    const solid = (color: string, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness });
    return {
      front: new THREE.MeshStandardMaterial({ map: makeFront(kind, frontWindows.map(([a, c]) => [(a + width / 2) / width, (c + width / 2) / width]), [(-LEAF + width / 2) / width, (LEAF + width / 2) / width]), roughness: 0.7, alphaTest: 0.5 }),
      side: new THREE.MeshStandardMaterial({ map: makeFront(kind, sideWindows.map(([z0, z1]) => [sideU(z0), sideU(z1)].sort((p, q) => p - q) as [number, number]), null), roughness: 0.7, alphaTest: 0.5 }),
      blank: new THREE.MeshStandardMaterial({ map: makeBlankWall(b.variant), roughness: 0.9 }),
      floor: new THREE.MeshStandardMaterial({ map: floorMap, roughness: 0.6 }),
      wall: solid(look.wall, 0.9), trim: solid(look.trim, 0.7), ceiling: solid(look.ceiling, 0.95), metal: new THREE.MeshStandardMaterial({ color: look.frame, roughness: 0.4, metalness: 0.5 }),
      glass: new THREE.MeshStandardMaterial({ color: "#a9c7d3", transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false, emissive: new THREE.Color("#fff3d6"), emissiveIntensity: 0 }),
      pot: solid(kind === "police" || kind === "gym" ? "#2b2d33" : "#f6ecd9", 0.7),
      inside: new THREE.MeshStandardMaterial({ color: look.wall, roughness: 0.9, side: THREE.BackSide, emissive: new THREE.Color("#fff3d6"), emissiveIntensity: 0 }),
    };
  }, [kind, width, depth, b.variant, look, ws, frontWindows, sideWindows]);
  useEffect(() => () => { for (const mm of Object.values(own)) { mm.map?.dispose(); mm.dispose(); } }, [own]);

  const leaves = useRef<{ left: THREE.Group | null; right: THREE.Group | null }>({ left: null, right: null });
  const arms = useRef<(THREE.Mesh | null)[]>([]);
  const inner = useRef<THREE.Group>(null), proxy = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const near = state.interior?.key === layout.key || Math.hypot(state.pos.x - frame.ox, state.pos.z - frame.oz) < INTERIOR_REACH * quality().detail;
    if (inner.current) inner.current.visible = near;
    if (proxy.current) proxy.current.visible = !near;
    own.glass.emissiveIntensity = state.darkness * 0.5;
    own.inside.emissiveIntensity = state.darkness * 0.3;
    const room = state.rooms.get(layout.key);
    const doors = room?.doors ?? { left: 0, right: 0 };
    leaves.current.right?.rotation.set(0, doors.right, 0);
    leaves.current.left?.rotation.set(0, -doors.left, 0);
    ([1, -1] as const).forEach((side, k) => closerArms(side, side === 1 ? doors.right : doors.left).forEach(([x0, z0, x1, z1], j) => {
      const arm = arms.current[k * 2 + j];
      if (!arm) return;
      arm.position.set((x0 + x1) / 2, ARM_Y, (z0 + z1) / 2);
      arm.rotation.set(0, Math.atan2(-(z1 - z0), x1 - x0), 0);
    }));
  });

  const { minX, maxX, minZ, maxZ } = bounds;
  const plain = -ws, plainX = plain * maxX;
  const sideHoles: Hole[] = sideWindows.map(([z0, z1]) => ({ a0: Math.min(z0, z1), a1: Math.max(z0, z1), y0: WINDOW.y0, y1: WINDOW.y1 }));
  const frontHoles: Hole[] = [...frontWindows.map(([a0, a1]) => ({ a0, a1, y0: WINDOW.y0, y1: WINDOW.y1 })), { a0: -LEAF - 0.08, a1: LEAF + 0.08, y0: 0, y1: DOOR_H + 0.08 }];
  const lamps: [number, number][] = [[-width / 4, -depth * 0.3], [width / 4, -depth * 0.3], [-width / 4, -depth * 0.7], [width / 4, -depth * 0.7]];
  return <group position={[frame.ox, SIDEWALK_H, frame.oz]} rotation-y={frame.rot}>
    {/* Outside: the venue's front and side (with its windows), plain walls behind. */}
    <mesh position={[0, FH / 2, SKIN]} material={own.front} castShadow receiveShadow><planeGeometry args={[width + 2 * SKIN, FH]} /></mesh>
    <mesh position={[ws * (width / 2 + SKIN), FH / 2, -depth / 2]} rotation-y={ws * Math.PI / 2} material={own.side} castShadow receiveShadow><planeGeometry args={[depth + 2 * SKIN, FH]} /></mesh>
    <Panel x={0} y={FH / 2} z={-depth - SKIN} w={width + 2 * SKIN} h={FH} ry={Math.PI} material={own.blank} />
    <Panel x={-ws * (width / 2 + SKIN)} y={FH / 2} z={-depth / 2} w={depth + 2 * SKIN} h={FH} ry={-ws * Math.PI / 2} material={own.blank} />
    {frontWindows.map(([a0, a1]) => <WindowOpening key={a0} a0={a0} a1={a1} kind="burger" frame={own.metal} glass={own.glass} />)}
    <group position={[ws * width / 2, 0, 0]} rotation-y={ws * Math.PI / 2}>
      {sideWindows.map(([z0, z1]) => { const p = -ws * z0, q = -ws * z1; return <WindowOpening key={z0} a0={Math.min(p, q)} a1={Math.max(p, q)} kind="burger" frame={own.metal} glass={own.glass} />; })}
    </group>
    {/* The double glass door, opening out like the restaurants'. */}
    {[-1, 1].map((s) => <mesh key={s} position={[s * (LEAF + 0.04), DOOR_H / 2, (SKIN - WALL) / 2]} material={own.metal} castShadow><boxGeometry args={[0.08, DOOR_H + 0.04, WALL + SKIN + 0.02]} /></mesh>)}
    <mesh position={[0, DOOR_H + 0.04, (SKIN - WALL) / 2]} material={own.metal}><boxGeometry args={[2 * LEAF + 0.16, 0.08, WALL + SKIN + 0.02]} /></mesh>
    <Leaf side={1} frame={own.metal} mats={mats} at={(g) => { leaves.current.right = g; }} />
    <Leaf side={-1} frame={own.metal} mats={mats} at={(g) => { leaves.current.left = g; }} />
    {[1, -1].map((s) => <mesh key={s} position={[s * (LEAF - 0.48), DOOR_H - 0.01, 0.07]} material={mats.closer}><boxGeometry args={[0.06, 0.05, 0.06]} /></mesh>)}
    {[0, 1, 2, 3].map((i) => <mesh key={i} ref={(el) => { arms.current[i] = el; }} material={mats.closer}><boxGeometry args={[CLOSER_ARM, 0.022, 0.03]} /></mesh>)}

    <mesh ref={proxy} position={[0, CEILING / 2, -depth / 2]} material={own.inside} visible={false}><boxGeometry args={[width - 0.3, CEILING - 0.05, depth - 0.3]} /></mesh>
    <group ref={inner}>
      <mesh position={[0, 0.004, -depth / 2]} rotation-x={-Math.PI / 2} material={own.floor} receiveShadow><planeGeometry args={[width, depth]} /></mesh>
      <mesh position={[0, CEILING, -depth / 2]} rotation-x={Math.PI / 2} material={own.ceiling}><planeGeometry args={[width, depth]} /></mesh>
      <Wall a0={minX} a1={maxX} place={(a) => [a, -WALL]} ry={Math.PI} low={own.trim} high={own.wall} holes={frontHoles} />
      <Wall a0={minZ} a1={maxZ} place={(a) => [ws * maxX, a]} ry={-ws * Math.PI / 2} low={own.trim} high={own.wall} holes={sideHoles} />
      <Wall a0={minZ} a1={maxZ} place={(a) => [plainX, a]} ry={-plain * Math.PI / 2} low={own.trim} high={own.wall} />
      <Wall a0={minX} a1={maxX} place={(a) => [a, minZ]} ry={0} low={own.trim} high={own.wall} />
      {lamps.map(([x, z], i) => <mesh key={i} position={[x, CEILING - 0.03, z]} rotation-x={Math.PI / 2} material={m.lamp}><planeGeometry args={[1.2, 0.3]} /></mesh>)}
      {plants.map(([x, z]) => <Plant key={`${x}`} x={x} z={z} kind="cafe" mats={mats} pot={own.pot} />)}
      {/* (The grocery's basket pile and its cashier are drawn by Grocery, which moves them.) */}
      {fixtures.filter((f) => !(kind === "grocery" && f.type === "baskets")).map((f, i) => <group key={i} position={[f.x, 0, f.z]} rotation-y={f.rot}><FixtureModel f={f} m={m} kind={kind} /></group>)}
      {kind !== "grocery" && <Staff layout={layout} kind={kind} m={m} />}
    </group>
  </group>;
}
