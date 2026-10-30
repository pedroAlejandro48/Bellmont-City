import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { BUILDING_ENTRANCE, RESTAURANTS, SIDEWALK_H, buildingLayout, restaurantOpen, timeInfo, type Building, type City, type RestaurantKind } from "./config";
import { canvas, glassPane, groundY, tex } from "./textures";
import type { GameState } from "./state";

/** Each brand's own fonts (loaded in index.html); signs are painted once they are ready. */
const FONTS = ["400 80px Pacifico", "400 80px Lobster", "700 80px Cinzel", "400 80px Bungee", "700 30px Manrope"];

function useFontsReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => { if (live) setReady(true); };
    const timeout = window.setTimeout(done, 4000);
    void Promise.all(FONTS.map((font) => document.fonts.load(font))).then(done, done);
    return () => { live = false; window.clearTimeout(timeout); };
  }, []);
  return ready;
}

/** Each brand's look: walls, window frames, how its windows glow, and its opening-hours plaque. */
const BRAND: Record<RestaurantKind, { glow: string; frame: string; hours: string }> = {
  cafe: { glow: "#ffd48a", frame: "#f3ead8", hours: "OPEN 6 AM – 5 PM" },
  pizza: { glow: "#ffa552", frame: "#1f5d3a", hours: "OPEN 11 AM – 8 PM" },
  fine: { glow: "#ffc98a", frame: "#b8923a", hours: "OPEN 12 PM – 10 PM" },
  burger: { glow: "#fff4e0", frame: "#ffcc00", hours: "OPEN 24 HOURS" },
};

function fitText(g: CanvasRenderingContext2D, text: string, font: (size: number) => string, size: number, maxWidth: number) {
  let s = size;
  g.font = font(s);
  while (g.measureText(text).width > maxWidth && s > 10) g.font = font((s -= 2));
  return s;
}

function paintWallFor(kind: RestaurantKind, g: CanvasRenderingContext2D, W: number, H: number) {
  if (kind === "cafe") {
    // Sage-green painted wooden boards.
    g.fillStyle = "#7fa38a"; g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(0,0,0,0.09)";
    for (let x = 0; x < W; x += 24) g.fillRect(x, 0, 2, H);
  } else if (kind === "pizza") {
    // Red brick.
    g.fillStyle = "#d8cbb6"; g.fillRect(0, 0, W, H);
    for (let row = 0, y = 0; y < H; row++, y += 18) for (let x = row % 2 ? -22 : 0; x < W; x += 46) {
      g.fillStyle = ["#a2412c", "#8f3726", "#b04a33"][(row * 7 + Math.floor(x / 46)) % 3] ?? "#a2412c";
      g.fillRect(x + 2, y + 2, 42, 14);
    }
  } else if (kind === "fine") {
    // Dark charred-wood slats.
    g.fillStyle = "#2a2420"; g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(255,255,255,0.05)";
    for (let x = 0; x < W; x += 16) g.fillRect(x, 0, 3, H);
  } else {
    // Glossy red tiles with a yellow stripe.
    g.fillStyle = "#c62828"; g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(255,255,255,0.08)";
    for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 1, H);
    for (let y = 0; y < H; y += 32) g.fillRect(0, y, W, 1);
    g.fillStyle = "#ffcc00"; g.fillRect(0, groundY(0.45), W, 14);
  }
}

/** A restaurant's ground floor: its own walls, windows and (on the entrance side) doors and opening hours. */
function makeStorefront(kind: RestaurantKind, withDoor: boolean) {
  const brand = BRAND[kind];
  const [c, g] = canvas(1024, 384);
  paintWallFor(kind, g, 1024, 384);
  const top = groundY(3), bottom = groundY(0.8), doorTop = groundY(2.7);
  const windows: [number, number][] = withDoor ? [[70, 270], [684, 270]] : [[70, 270], [377, 270], [684, 270]];
  const [e, ge] = canvas(1024, 384);
  ge.fillStyle = "#000"; ge.fillRect(0, 0, 1024, 384); ge.fillStyle = "#fff";
  for (const [x, w] of windows) {
    g.fillStyle = brand.frame; g.fillRect(x - 10, top - 10, w + 20, bottom - top + 20);
    glassPane(g, x, top, w, bottom - top);
    ge.fillRect(x, top, w, bottom - top);
    // Window bars, painted dark on the glow too so they stay visible at night.
    for (const [ctx, colour] of [[g, brand.frame], [ge, "#000"]] as const) {
      ctx.fillStyle = colour;
      if (kind === "cafe") for (const f of [1 / 3, 2 / 3]) { ctx.fillRect(x + w * f - 3, top, 6, bottom - top); ctx.fillRect(x, top + (bottom - top) / 2 - 3, w, 6); }
      if (kind === "fine") {
        // Shoji-style lattice.
        for (let gx = x + w / 6; gx < x + w - 1; gx += w / 6) ctx.fillRect(gx - 2, top, 4, bottom - top);
        for (let gy = top + (bottom - top) / 4; gy < bottom - 1; gy += (bottom - top) / 4) ctx.fillRect(x, gy - 2, w, 4);
      }
    }
    ge.fillStyle = "#fff";
    if (kind === "pizza") { g.fillStyle = "#1f5d3a"; g.fillRect(x - 10, bottom + 10, w + 20, 12); }
  }
  if (withDoor) {
    g.fillStyle = brand.frame; g.fillRect(392, doorTop - 10, 240, 384 - doorTop + 10);
    glassPane(g, 400, doorTop, 108, 384 - doorTop); glassPane(g, 516, doorTop, 108, 384 - doorTop);
    ge.fillRect(400, doorTop, 108, 384 - doorTop); ge.fillRect(516, doorTop, 108, 384 - doorTop);
    g.fillStyle = "#dce2dd"; g.fillRect(492, groundY(1.2), 5, 40); g.fillRect(527, groundY(1.2), 5, 40);
    if (kind === "fine") {
      // Indigo noren curtains hanging across the top of the doorway.
      for (let i = 0; i < 3; i++) { g.fillStyle = "#1d2c5a"; g.fillRect(402 + i * 74, doorTop, 70, 62); g.fillStyle = "#f1e9da"; g.beginPath(); g.arc(437 + i * 74, doorTop + 30, 12, 0, Math.PI * 2); g.fill(); }
    }
    // Opening hours on the door glass.
    const plaqueY = groundY(1.75);
    g.fillStyle = "rgba(255,255,255,0.88)"; g.fillRect(520, plaqueY, 98, 46);
    g.fillStyle = "#1b1b1b"; g.textAlign = "center"; g.textBaseline = "middle";
    const [first = "", ...rest] = brand.hours.split(" ");
    fitText(g, first, (s) => `700 ${s}px Manrope, Arial, sans-serif`, 15, 86); g.fillText(first, 569, plaqueY + 13);
    fitText(g, rest.join(" "), (s) => `700 ${s}px Manrope, Arial, sans-serif`, 15, 90); g.fillText(rest.join(" "), 569, plaqueY + 32);
  }
  g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(0, 0, 1024, 10);
  const map = tex(c); map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  const emissiveMap = tex(e); emissiveMap.wrapS = emissiveMap.wrapT = THREE.ClampToEdgeWrapping;
  return { map, emissiveMap };
}

function coffeeCup(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.fillStyle = "#5b3a24";
  g.beginPath(); g.moveTo(x - s * 0.5, y - s * 0.3); g.lineTo(x + s * 0.5, y - s * 0.3); g.lineTo(x + s * 0.38, y + s * 0.45); g.lineTo(x - s * 0.38, y + s * 0.45); g.closePath(); g.fill();
  g.lineWidth = s * 0.1; g.strokeStyle = "#5b3a24"; g.beginPath(); g.arc(x + s * 0.55, y, s * 0.18, -Math.PI / 2, Math.PI / 2); g.stroke();
  g.fillRect(x - s * 0.65, y + s * 0.5, s * 1.3, s * 0.08);
  g.lineWidth = s * 0.07;
  for (const dx of [-0.2, 0.05, 0.3]) { g.beginPath(); g.moveTo(x + dx * s, y - s * 0.4); g.bezierCurveTo(x + (dx - 0.15) * s, y - s * 0.6, x + (dx + 0.15) * s, y - s * 0.7, x + dx * s, y - s * 0.9); g.stroke(); }
}

function pizzaSlice(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.fillStyle = "#e0a845"; g.beginPath(); g.moveTo(x, y + s * 0.6); g.lineTo(x - s * 0.5, y - s * 0.5); g.quadraticCurveTo(x, y - s * 0.75, x + s * 0.5, y - s * 0.5); g.closePath(); g.fill();
  g.fillStyle = "#f7d36b"; g.beginPath(); g.moveTo(x, y + s * 0.5); g.lineTo(x - s * 0.4, y - s * 0.4); g.quadraticCurveTo(x, y - s * 0.6, x + s * 0.4, y - s * 0.4); g.closePath(); g.fill();
  g.fillStyle = "#c0392b";
  for (const [dx, dy] of [[-0.15, -0.3], [0.15, -0.25], [0, 0.05], [-0.05, -0.1]] as const) { g.beginPath(); g.arc(x + dx * s, y + dy * s, s * 0.08, 0, Math.PI * 2); g.fill(); }
}

function burgerIcon(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const bun = "#e9a440";
  g.fillStyle = bun; g.beginPath(); g.ellipse(x, y - s * 0.12, s * 0.5, s * 0.36, 0, Math.PI, 0); g.fill();
  g.fillStyle = "#fff6d5"; for (const dx of [-0.2, 0, 0.2]) { g.beginPath(); g.ellipse(x + dx * s, y - s * 0.3, s * 0.03, s * 0.015, 0.4, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "#5ab03a"; g.fillRect(x - s * 0.52, y - s * 0.12, s * 1.04, s * 0.08);
  g.fillStyle = "#ffcc00"; g.beginPath(); g.moveTo(x - s * 0.48, y - s * 0.04); g.lineTo(x + s * 0.48, y - s * 0.04); g.lineTo(x + s * 0.2, y + s * 0.1); g.closePath(); g.fill();
  g.fillStyle = "#5a2d16"; g.fillRect(x - s * 0.5, y + s * 0.0, s, s * 0.16);
  g.fillStyle = bun; g.beginPath(); g.roundRect(x - s * 0.48, y + s * 0.18, s * 0.96, s * 0.18, s * 0.08); g.fill();
}

function blossom(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.fillStyle = "#f4a7c0";
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 - Math.PI / 2; g.beginPath(); g.ellipse(x + Math.cos(a) * s * 0.5, y + Math.sin(a) * s * 0.5, s * 0.42, s * 0.3, a, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "#c2185b"; g.beginPath(); g.arc(x, y, s * 0.2, 0, Math.PI * 2); g.fill();
}

/** The brand's sign board over the entrance (1024 × 208, for a 6.6 m × 1.34 m board). */
function makeSign(kind: RestaurantKind) {
  const W = 1024, H = 208;
  const [c, g] = canvas(W, H);
  const { name, food } = RESTAURANTS[kind];
  g.textAlign = "center"; g.textBaseline = "middle";
  if (kind === "cafe") {
    g.fillStyle = "#5b3a24"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#f6ecd9"; g.beginPath(); g.roundRect(12, 12, W - 24, H - 24, 30); g.fill();
    coffeeCup(g, 110, 112, 100); coffeeCup(g, W - 110, 112, 100);
    g.fillStyle = "#5b3a24"; fitText(g, name, (s) => `400 ${s}px Pacifico, cursive`, 84, 700); g.fillText(name, W / 2, 86);
    g.fillStyle = "#8a6a4a"; fitText(g, food.toUpperCase(), (s) => `700 ${s}px Manrope, Arial, sans-serif`, 26, 640); g.fillText(food.toUpperCase(), W / 2, 164);
  } else if (kind === "pizza") {
    g.fillStyle = "#1f5d3a"; g.fillRect(0, 0, W, H);
    // Italian flag edges.
    for (const [i, colour] of ["#2e8b57", "#ffffff", "#c0392b"].entries()) { g.fillStyle = colour; g.fillRect(i * 14, 0, 14, H); g.fillRect(W - 42 + i * 14, 0, 14, H); }
    pizzaSlice(g, 130, 104, 120); pizzaSlice(g, W - 130, 104, 120);
    g.fillStyle = "#ffffff"; g.shadowColor = "rgba(0,0,0,0.45)"; g.shadowOffsetY = 4;
    fitText(g, name, (s) => `400 ${s}px Lobster, cursive`, 96, 620); g.fillText(name, W / 2, 78);
    g.shadowColor = "transparent";
    g.fillStyle = "#ffffff"; g.fillRect(W / 2 - 170, 138, 340, 50);
    g.fillStyle = "#c0392b"; fitText(g, food.toUpperCase(), (s) => `700 ${s}px Manrope, Arial, sans-serif`, 36, 320); g.fillText(food.toUpperCase().split("").join(" "), W / 2, 164);
  } else if (kind === "fine") {
    g.fillStyle = "#0d0d0d"; g.fillRect(0, 0, W, H);
    g.strokeStyle = "#c9a54a"; g.lineWidth = 6; g.strokeRect(14, 14, W - 28, H - 28); g.lineWidth = 2; g.strokeRect(26, 26, W - 52, H - 52);
    g.fillStyle = "#b71c1c"; g.beginPath(); g.arc(150, H / 2, 62, 0, Math.PI * 2); g.fill();
    blossom(g, 196, 62, 36); blossom(g, W - 150, 140, 30); blossom(g, W - 100, 70, 22);
    const gold = g.createLinearGradient(0, 40, 0, 130); gold.addColorStop(0, "#f3d98b"); gold.addColorStop(1, "#b8862f");
    g.fillStyle = gold; fitText(g, name.toUpperCase(), (s) => `700 ${s}px Cinzel, Georgia, serif`, 92, 520); g.fillText(name.toUpperCase().split("").join(" "), W / 2 + 40, 88);
    g.fillStyle = "#d9bf72"; fitText(g, food.toUpperCase(), (s) => `700 ${s}px Cinzel, Georgia, serif`, 28, 520); g.fillText(food.toUpperCase(), W / 2 + 40, 160);
  } else {
    g.fillStyle = "#ffcc00"; g.fillRect(0, 0, W, H);
    // Red and yellow chevrons along the edges.
    g.fillStyle = "#e53935"; for (let x = 0; x < W; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 20, 14); g.lineTo(x + 40, 0); g.fill(); g.beginPath(); g.moveTo(x, H); g.lineTo(x + 20, H - 14); g.lineTo(x + 40, H); g.fill(); }
    burgerIcon(g, 130, 104, 170); burgerIcon(g, W - 130, 104, 170);
    g.lineJoin = "round"; g.strokeStyle = "#111"; g.lineWidth = 12; g.fillStyle = "#e53935";
    fitText(g, name.toUpperCase(), (s) => `400 ${s}px Bungee, Impact, sans-serif`, 78, 600); g.strokeText(name.toUpperCase(), W / 2, 88); g.fillText(name.toUpperCase(), W / 2, 88);
    g.fillStyle = "#111"; g.beginPath(); g.roundRect(W / 2 - 180, 140, 360, 44, 22); g.fill();
    g.fillStyle = "#ffcc00"; fitText(g, food.toUpperCase(), (s) => `400 ${s}px Bungee, Impact, sans-serif`, 28, 330); g.fillText(food.toUpperCase(), W / 2, 163);
  }
  const map = tex(c); map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  return map;
}

/** Awning stripes, running out from the wall. */
function makeAwning(colours: string[]) {
  const [c, g] = canvas(256, 64);
  colours.forEach((colour, i) => { g.fillStyle = colour; for (let x = i * 16; x < 256; x += 16 * colours.length) g.fillRect(x, 0, 16, 64); });
  return tex(c);
}

/** A round sign with the burger on it, sticking out from the wall so it is seen from down the street. */
function makeBlade() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = "#e53935"; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#ffcc00"; g.beginPath(); g.arc(128, 128, 108, 0, Math.PI * 2); g.fill();
  burgerIcon(g, 128, 134, 170);
  return tex(c);
}

type Materials = ReturnType<typeof useRestaurantMaterials>;
function useRestaurantMaterials(ready: boolean) {
  const mats = useMemo(() => {
    const kinds = Object.keys(RESTAURANTS) as RestaurantKind[];
    const entry = (kind: RestaurantKind) => {
      const glow = new THREE.Color(BRAND[kind].glow);
      const front = (withDoor: boolean) => { const { map, emissiveMap } = makeStorefront(kind, withDoor); return new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: glow, emissiveIntensity: 0, roughness: 0.6, metalness: 0.05 }); };
      const signMap = makeSign(kind);
      const sign = new THREE.MeshStandardMaterial({ map: signMap, emissiveMap: signMap, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0, roughness: 0.5 });
      const edge = new THREE.MeshStandardMaterial({ color: kind === "fine" ? "#c9a54a" : kind === "burger" ? "#e53935" : kind === "pizza" ? "#173f28" : "#5b3a24", roughness: 0.6 });
      return { door: front(true), side: front(false), sign: [edge, edge, edge, edge, sign, edge], edge };
    };
    return {
      ...Object.fromEntries(kinds.map((kind) => [kind, entry(kind)])) as Record<RestaurantKind, ReturnType<typeof entry>>,
      cafeAwning: new THREE.MeshStandardMaterial({ map: makeAwning(["#5b3a24", "#f6ecd9"]), roughness: 0.9, side: THREE.DoubleSide }),
      pizzaAwning: new THREE.MeshStandardMaterial({ map: makeAwning(["#2e8b57", "#ffffff", "#c0392b"]), roughness: 0.9, side: THREE.DoubleSide }),
      lantern: new THREE.MeshStandardMaterial({ color: "#d32f2f", emissive: new THREE.Color("#ff7043"), emissiveIntensity: 0, roughness: 0.7 }),
      lanternCap: new THREE.MeshStandardMaterial({ color: "#111111", roughness: 0.6 }),
      blade: (() => { const map = makeBlade(); return new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0, roughness: 0.5 }); })(),
    };
    // Repaint once the brand fonts have loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  useEffect(() => () => {
    const all = new Set<THREE.Material>();
    for (const value of Object.values(mats)) {
      if (value instanceof THREE.Material) all.add(value);
      else for (const m of [value.door, value.side, value.edge, ...value.sign]) all.add(m);
    }
    for (const m of all) {
      const s = m as THREE.MeshStandardMaterial;
      s.map?.dispose(); s.emissiveMap?.dispose(); m.dispose();
    }
  }, [mats]);
  return mats;
}

const FH = BUILDING_ENTRANCE.floorHeight;
const SIGN = { w: 6.6, h: 1.34, y: 3.98, depth: 0.18 };

/** Where a face of a building sits: its centre on the pavement, its facing, and its width. */
function face(b: Building, axis: "x" | "z") {
  const L = buildingLayout(b);
  return axis === "x"
    ? { x: b.x + L.sx * (b.w / 2 + 0.03), z: b.z, rot: L.sx * Math.PI / 2, width: b.d }
    : { x: b.x, z: b.z + L.sz * (b.d / 2 + 0.03), rot: L.sz === 1 ? 0 : Math.PI, width: b.w };
}

function Restaurant({ b, mats }: { b: Building; mats: Materials }) {
  const kind = b.restaurant ?? "cafe";
  const L = buildingLayout(b);
  const entrance = face(b, L.door), other = face(b, L.door === "x" ? "z" : "x");
  const m = mats[kind];
  const awning = Math.min(entrance.width - 1, 9);
  return <>
    <group position={[other.x, SIDEWALK_H, other.z]} rotation-y={other.rot}>
      <mesh position-y={FH / 2} material={m.side} receiveShadow><planeGeometry args={[other.width, FH]} /></mesh>
    </group>
    <group position={[entrance.x, SIDEWALK_H, entrance.z]} rotation-y={entrance.rot}>
      <mesh position-y={FH / 2} material={m.door} receiveShadow><planeGeometry args={[entrance.width, FH]} /></mesh>
      <mesh position={[0, SIGN.y, SIGN.depth / 2 + 0.02]} material={m.sign} castShadow><boxGeometry args={[SIGN.w, SIGN.h, SIGN.depth]} /></mesh>
      {(kind === "cafe" || kind === "pizza") && (
        // A striped awning sloping out over the windows and door.
        <mesh position={[0, 3.02, 0.62]} rotation-x={0.32} material={kind === "cafe" ? mats.cafeAwning : mats.pizzaAwning} castShadow>
          <boxGeometry args={[awning, 0.04, 1.3]} />
        </mesh>
      )}
      {kind === "fine" && [-1.75, 1.75].map((x) => (
        // Red paper lanterns either side of the door.
        <group key={x} position={[x, 2.45, 0.42]}>
          <mesh material={mats.lantern} scale={[0.26, 0.36, 0.26]}><sphereGeometry args={[1, 16, 12]} /></mesh>
          <mesh material={mats.lanternCap} position-y={0.36}><cylinderGeometry args={[0.12, 0.12, 0.06, 12]} /></mesh>
          <mesh material={mats.lanternCap} position-y={-0.36}><cylinderGeometry args={[0.12, 0.12, 0.06, 12]} /></mesh>
          <mesh material={mats.lanternCap} position={[0, 0.5, -0.2]}><boxGeometry args={[0.04, 0.04, 0.44]} /></mesh>
        </group>
      ))}
      {kind === "burger" && (
        <group position={[entrance.width / 2 - 0.9, 3.95, 0.95]}>
          <mesh material={m.edge} position={[0, 0.76, -0.5]}><boxGeometry args={[0.08, 0.08, 1]} /></mesh>
          <mesh material={m.edge} rotation-z={Math.PI / 2} castShadow><cylinderGeometry args={[0.72, 0.72, 0.1, 32]} /></mesh>
          {[-1, 1].map((side) => (
            <mesh key={side} material={mats.blade} position-x={side * 0.052} rotation-y={side * Math.PI / 2}><circleGeometry args={[0.7, 32]} /></mesh>
          ))}
        </group>
      )}
    </group>
  </>;
}

/**
 * The city's four restaurants. Their doors and windows light up at dusk like everyone else's, but switch off
 * when they close for the night (the burger place never closes).
 */
export function Restaurants({ city, state }: { city: City; state: GameState }) {
  const ready = useFontsReady();
  const mats = useRestaurantMaterials(ready);
  const here = city.buildings.filter((b) => b.restaurant);
  useFrame(() => {
    const { hours } = timeInfo(state.elapsed), d = state.darkness;
    for (const kind of Object.keys(RESTAURANTS) as RestaurantKind[]) {
      const lit = restaurantOpen(kind, hours) ? d : 0, m = mats[kind];
      m.door.emissiveIntensity = m.side.emissiveIntensity = lit * 1.2;
      (m.sign[4] as THREE.MeshStandardMaterial).emissiveIntensity = lit * 0.85;
      if (kind === "fine") mats.lantern.emissiveIntensity = lit * 1.6;
      if (kind === "burger") mats.blade.emissiveIntensity = lit * 0.85;
    }
  });
  return <>{here.map((b) => <Restaurant key={`${b.x}:${b.z}`} b={b} mats={mats} />)}</>;
}
