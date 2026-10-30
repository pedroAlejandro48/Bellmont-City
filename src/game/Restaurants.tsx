import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { BUILDING_ENTRANCE, RESTAURANTS, SIDEWALK_H, restaurantOpen, timeInfo, type Building, type City, type RestaurantKind } from "./config";
import { canvas, glassPane, groundY, makeBlankWall, tex } from "./textures";
import { CEILING, COUNTER, DOOR_H, HANDLE, LEAF, WALL, furnish, onLeaf, roomLayout, toWorld, type Item, type RoomLayout } from "./restaurantRoom";
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

/**
 * A restaurant's ground floor (`width` metres wide): its own walls and windows and, on the entrance side, an
 * open doorway (transparent, for the real doors) with the opening hours above it.
 */
function makeStorefront(kind: RestaurantKind, withDoor: boolean, width: number) {
  const brand = BRAND[kind];
  const [c, g] = canvas(1024, 384);
  paintWallFor(kind, g, 1024, 384);
  const top = groundY(3), bottom = groundY(0.8), doorTop = groundY(DOOR_H);
  const px = 1024 / width, x0 = Math.round(512 - LEAF * px), x1 = Math.round(512 + LEAF * px);
  const windows: [number, number][] = withDoor ? [[70, x0 - 60 - 70], [x1 + 60, 954 - x1 - 60]] : [[70, 270], [377, 270], [684, 270]];
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
    g.fillStyle = brand.frame; g.fillRect(x0 - 12, doorTop - 12, x1 - x0 + 24, 384 - doorTop + 12);
    // Opening hours above the door.
    const plaqueY = doorTop - 44;
    g.fillStyle = "rgba(255,255,255,0.9)"; g.fillRect(512 - 110, plaqueY, 220, 26);
    g.fillStyle = "#1b1b1b"; g.textAlign = "center"; g.textBaseline = "middle";
    fitText(g, brand.hours, (s) => `700 ${s}px Manrope, Arial, sans-serif`, 17, 206); g.fillText(brand.hours, 512, plaqueY + 14);
    // The doorway itself is open: the real doors stand in it.
    g.clearRect(x0, doorTop, x1 - x0, 384 - doorTop);
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

/** Inside each restaurant, in the colours of its sign. */
const INSIDE: Record<RestaurantKind, { wall: string; trim: string; floor: [string, string]; tiles: boolean; counter: string; counterTop: string; table: string; leg: string; chair: string; seat: string; ceiling: string; light: string; metal: string }> = {
  cafe: { wall: "#f6ecd9", trim: "#7fa38a", floor: ["#a0764f", "#8a633f"], tiles: false, counter: "#7fa38a", counterTop: "#5b3a24", table: "#8b5e3c", leg: "#5b3a24", chair: "#5b3a24", seat: "#7fa38a", ceiling: "#fbf6ec", light: "#ffd9a0", metal: "#5b3a24" },
  pizza: { wall: "#f1e4d0", trim: "#c0392b", floor: ["#c0392b", "#f4efe6"], tiles: true, counter: "#1f5d3a", counterTop: "#d8cbb6", table: "#f4efe6", leg: "#2b2b2b", chair: "#1f5d3a", seat: "#c0392b", ceiling: "#fff8ee", light: "#ffc27a", metal: "#1f5d3a" },
  fine: { wall: "#1c1814", trim: "#c9a54a", floor: ["#3b2a20", "#2f2119"], tiles: false, counter: "#0d0d0d", counterTop: "#c9a54a", table: "#111111", leg: "#c9a54a", chair: "#111111", seat: "#b71c1c", ceiling: "#15110e", light: "#ffcf8a", metal: "#c9a54a" },
  burger: { wall: "#ffcc00", trim: "#e53935", floor: ["#111111", "#f5f5f5"], tiles: true, counter: "#e53935", counterTop: "#c0c4c8", table: "#f5f5f5", leg: "#c0c4c8", chair: "#e53935", seat: "#e53935", ceiling: "#ffffff", light: "#ffffff", metal: "#c0c4c8" },
};

/** Checkered tiles, or wooden planks. One repeat is a metre square. */
function makeFloor(kind: RestaurantKind) {
  const { floor: [a, b], tiles } = INSIDE[kind];
  const [c, g] = canvas(256, 256);
  if (tiles) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? b : a; g.fillRect(i * 128, j * 128, 128, 128); }
  else {
    for (let row = 0; row < 8; row++) {
      g.fillStyle = row % 2 ? a : b; g.fillRect(0, row * 32, 256, 32);
      g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(0, row * 32, 256, 2); g.fillRect(((row * 97) % 200) + 20, row * 32, 2, 32);
    }
  }
  return tex(c);
}

/** A window seen from inside: frame, glazing bars, and sky-bright glass. */
function makeWindowPane() {
  const [c, g] = canvas(256, 256);
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, "#9cc6e4"); sky.addColorStop(1, "#dcebf5");
  g.fillStyle = sky; g.fillRect(0, 0, 256, 256);
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.beginPath(); g.moveTo(30, 0); g.lineTo(110, 0); g.lineTo(40, 256); g.lineTo(-40, 256); g.fill();
  g.fillStyle = "#2b2f33"; g.fillRect(0, 0, 256, 12); g.fillRect(0, 244, 256, 12); g.fillRect(0, 0, 12, 256); g.fillRect(244, 0, 12, 256);
  g.fillRect(125, 0, 6, 256);
  const map = tex(c); map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  return map;
}

function useRestaurantMaterials(ready: boolean) {
  const mats = useMemo(() => {
    const kinds = Object.keys(RESTAURANTS) as RestaurantKind[];
    const entry = (kind: RestaurantKind) => {
      const { map, emissiveMap } = makeStorefront(kind, false, 13);
      const side = new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: new THREE.Color(BRAND[kind].glow), emissiveIntensity: 0, roughness: 0.6, metalness: 0.05 });
      const signMap = makeSign(kind);
      const sign = new THREE.MeshStandardMaterial({ map: signMap, emissiveMap: signMap, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0, roughness: 0.5 });
      const edge = new THREE.MeshStandardMaterial({ color: kind === "fine" ? "#c9a54a" : kind === "burger" ? "#e53935" : kind === "pizza" ? "#173f28" : "#5b3a24", roughness: 0.6 });
      return { side, sign: [edge, edge, edge, edge, sign, edge], edge };
    };
    return {
      ...Object.fromEntries(kinds.map((kind) => [kind, entry(kind)])) as Record<RestaurantKind, ReturnType<typeof entry>>,
      cafeAwning: new THREE.MeshStandardMaterial({ map: makeAwning(["#5b3a24", "#f6ecd9"]), roughness: 0.9, side: THREE.DoubleSide }),
      pizzaAwning: new THREE.MeshStandardMaterial({ map: makeAwning(["#2e8b57", "#ffffff", "#c0392b"]), roughness: 0.9, side: THREE.DoubleSide }),
      lantern: new THREE.MeshStandardMaterial({ color: "#d32f2f", emissive: new THREE.Color("#ff7043"), emissiveIntensity: 0, roughness: 0.7 }),
      lanternCap: new THREE.MeshStandardMaterial({ color: "#111111", roughness: 0.6 }),
      blade: (() => { const map = makeBlade(); return new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0, roughness: 0.5 }); })(),
      glass: new THREE.MeshStandardMaterial({ color: "#a9c7d3", transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }),
      closer: new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.4, metalness: 0.5 }),
      /** Interior window panes: daylight blue by day, dark at night. */
      pane: (() => { const map = makeWindowPane(); return new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.35, roughness: 0.2 }); })(),
      register: new THREE.MeshStandardMaterial({ color: "#222428", roughness: 0.5, metalness: 0.3 }),
      screen: new THREE.MeshStandardMaterial({ color: "#1c3a52", emissive: new THREE.Color("#4fc3f7"), emissiveIntensity: 0.6 }),
    };
    // Repaint once the brand fonts have loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  useEffect(() => () => disposeAll(Object.values(mats).flatMap((v) => (v instanceof THREE.Material ? [v] : [v.side, v.edge, ...v.sign]))), [mats]);
  return mats;
}
type Materials = ReturnType<typeof useRestaurantMaterials>;

function disposeAll(materials: THREE.Material[]) {
  for (const m of new Set(materials)) {
    const s = m as THREE.MeshStandardMaterial;
    s.map?.dispose(); s.emissiveMap?.dispose(); m.dispose();
  }
}

const FH = BUILDING_ENTRANCE.floorHeight;
const SIGN = { w: 6.6, h: 1.34, y: 3.98, depth: 0.18 };
const DAY_PANE = new THREE.Color("#ffffff"), NIGHT_PANE = new THREE.Color("#1a2333");

/** A flat panel `w` × `h` centred at (x, y, z), turned `ry` about the vertical. */
function Panel({ x, y, z, w, h, ry = 0, material }: { x: number; y: number; z: number; w: number; h: number; ry?: number; material: THREE.Material }) {
  return <mesh position={[x, y, z]} rotation-y={ry} material={material} receiveShadow><planeGeometry args={[w, h]} /></mesh>;
}

/** A wall from `a0` to `a1` along it, painted in the trim colour up to a metre and the wall colour above. */
function Wall({ a0, a1, y0 = 0, place, ry, low, high }: { a0: number; a1: number; y0?: number; place: (a: number) => [number, number]; ry: number; low: THREE.Material; high: THREE.Material }) {
  const [x, z] = place((a0 + a1) / 2), w = a1 - a0;
  return <>
    {y0 < 1 && <Panel x={x} z={z} y={(y0 + 1) / 2} w={w} h={1 - y0} ry={ry} material={low} />}
    <Panel x={x} z={z} y={(Math.max(1, y0) + CEILING) / 2} w={w} h={CEILING - Math.max(1, y0)} ry={ry} material={high} />
  </>;
}

function Table({ material, legs, at }: { material: THREE.Material; legs: THREE.Material; at: (g: THREE.Group | null) => void }) {
  return <group ref={at}>
    <mesh position-y={0.76} material={material} castShadow receiveShadow><boxGeometry args={[0.9, 0.04, 0.9]} /></mesh>
    {[-1, 1].flatMap((a) => [-1, 1].map((b) => <mesh key={`${a}${b}`} position={[a * 0.39, 0.37, b * 0.39]} material={legs} castShadow><boxGeometry args={[0.05, 0.74, 0.05]} /></mesh>))}
  </group>;
}

function Chair({ frame, seat, at }: { frame: THREE.Material; seat: THREE.Material; at: (g: THREE.Group | null) => void }) {
  return <group ref={at}>
    <mesh position-y={0.435} material={seat} castShadow receiveShadow><boxGeometry args={[0.44, 0.05, 0.44]} /></mesh>
    {[-1, 1].flatMap((a) => [-1, 1].map((b) => <mesh key={`${a}${b}`} position={[a * 0.19, 0.205, b * 0.19]} material={frame} castShadow><boxGeometry args={[0.035, 0.41, 0.035]} /></mesh>))}
    {[-1, 1].map((a) => <mesh key={a} position={[a * 0.19, 0.69, -0.2]} material={frame} castShadow><boxGeometry args={[0.035, 0.5, 0.035]} /></mesh>)}
    <mesh position={[0, 0.83, -0.2]} material={frame} castShadow><boxGeometry args={[0.44, 0.22, 0.035]} /></mesh>
  </group>;
}

/** One glass door leaf, hinged at its outer edge (`side` 1 = right, seen from the street). */
function Leaf({ side, frame, mats, at }: { side: 1 | -1; frame: THREE.Material; mats: Materials; at: (g: THREE.Group | null) => void }) {
  const mid = -side * LEAF / 2;
  return <group ref={at} position={[side * LEAF, 0, 0]}>
    {[0.03, LEAF - 0.03].map((x) => <mesh key={x} position={[-side * x, DOOR_H / 2, 0]} material={frame} castShadow><boxGeometry args={[0.06, DOOR_H, 0.05]} /></mesh>)}
    <mesh position={[mid, DOOR_H - 0.04, 0]} material={frame}><boxGeometry args={[LEAF, 0.08, 0.05]} /></mesh>
    <mesh position={[mid, 0.08, 0]} material={frame}><boxGeometry args={[LEAF, 0.16, 0.05]} /></mesh>
    <mesh position={[mid, DOOR_H / 2 + 0.04, 0]} material={mats.glass}><planeGeometry args={[LEAF - 0.12, DOOR_H - 0.24]} /></mesh>
    {/* Pull handle outside, push bar inside. */}
    <mesh position={[-side * HANDLE.r, HANDLE.y, HANDLE.out]} material={mats.closer}><boxGeometry args={[0.03, 0.4, 0.03]} /></mesh>
    {[-0.15, 0.15].map((y) => <mesh key={y} position={[-side * HANDLE.r, HANDLE.y + y, 0.045]} material={mats.closer}><boxGeometry args={[0.02, 0.02, 0.05]} /></mesh>)}
    <mesh position={[mid, 1.05, -0.06]} material={mats.closer}><boxGeometry args={[LEAF * 0.7, 0.035, 0.035]} /></mesh>
    {/* The door closer's body, near the hinge on top of the leaf. */}
    <mesh position={[-side * 0.27, DOOR_H - 0.08, 0.065]} material={mats.closer} castShadow><boxGeometry args={[0.32, 0.07, 0.07]} /></mesh>
  </group>;
}

const CLOSER_ARM = 0.3, ARM_Y = DOOR_H - 0.02;
/** The closer's two arms: from its body on the door to a bracket on the frame, folded into a V when shut. */
function closerArms(side: 1 | -1, angle: number) {
  const [ax, az] = onLeaf(side === 1 ? "right" : "left", angle, 0.22, 0.07);
  const bx = side * (LEAF - 0.48), bz = 0.07;
  const d = Math.hypot(bx - ax, bz - az), mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const h = Math.sqrt(Math.max(0, CLOSER_ARM * CLOSER_ARM - d * d / 4));
  let px = -(bz - az) / (d || 1), pz = (bx - ax) / (d || 1);
  if (pz < 0) { px = -px; pz = -pz; }
  const ex = mx + px * h, ez = mz + pz * h;
  return [[ax, az, ex, ez], [bx, bz, ex, ez]] as const;
}

function Restaurant({ b, mats, state, ready }: { b: Building; mats: Materials; state: GameState; ready: boolean }) {
  const kind = b.restaurant ?? "cafe";
  const layout = useMemo<RoomLayout>(() => roomLayout(b), [b]);
  const { frame, width, depth, windowSide: ws, counter, bounds } = layout;
  const m = mats[kind], look = INSIDE[kind];
  const own = useMemo(() => {
    const { map, emissiveMap } = makeStorefront(kind, true, width);
    const front = new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: new THREE.Color(BRAND[kind].glow), emissiveIntensity: 0, roughness: 0.6, alphaTest: 0.5 });
    const floorMap = makeFloor(kind); floorMap.repeat.set(width / 1, depth / 1);
    const solid = (color: string, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
    return {
      front, floor: new THREE.MeshStandardMaterial({ map: floorMap, roughness: 0.7 }),
      blank: new THREE.MeshStandardMaterial({ map: makeBlankWall(b.variant), roughness: 0.9 }),
      wall: solid(look.wall, 0.9), trim: solid(look.trim), ceiling: solid(look.ceiling, 0.95),
      counter: solid(look.counter, 0.6), counterTop: solid(look.counterTop, 0.35, kind === "burger" ? 0.6 : 0.1),
      table: solid(look.table, 0.45), leg: solid(look.leg, 0.5, 0.3), chair: solid(look.chair, 0.6), seat: solid(look.seat, 0.7),
      metal: solid(look.metal, 0.35, 0.6),
      lamp: new THREE.MeshStandardMaterial({ color: look.light, emissive: new THREE.Color(look.light), emissiveIntensity: 0 }),
    };
  }, [kind, width, depth, b.variant, ready, look]);
  useEffect(() => () => disposeAll(Object.values(own)), [own]);

  const initial = useMemo<Item[]>(() => furnish(layout), [layout]);
  const pieces = useRef<(THREE.Group | null)[]>([]);
  const leaves = useRef<{ left: THREE.Group | null; right: THREE.Group | null }>({ left: null, right: null });
  const arms = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(() => {
    const room = state.rooms.get(layout.key);
    const items = room?.items ?? initial;
    items.forEach((it, i) => {
      const g = pieces.current[i];
      if (!g) return;
      g.position.set(it.x, 0, it.z);
      g.rotation.y = Math.atan2(it.f[0], it.f[1]);
    });
    const doors = room?.doors ?? { left: 0, right: 0 };
    leaves.current.right?.rotation.set(0, doors.right, 0);
    leaves.current.left?.rotation.set(0, -doors.left, 0);
    ([1, -1] as const).forEach((side, k) => closerArms(side, side === 1 ? doors.right : doors.left).forEach(([x0, z0, x1, z1], j) => {
      const arm = arms.current[k * 2 + j];
      if (!arm) return;
      arm.position.set((x0 + x1) / 2, ARM_Y, (z0 + z1) / 2);
      arm.rotation.set(0, Math.atan2(-(z1 - z0), x1 - x0), 0);
    }));
    const open = restaurantOpen(kind, timeInfo(state.elapsed).hours);
    own.front.emissiveIntensity = m.side.emissiveIntensity;
    own.lamp.emissiveIntensity = open ? 1.4 : 0;
  });

  const inner = { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: bounds.maxZ };
  const px = (p: number) => (p / 1024 - 0.5) * width;
  const doorPx = [512 - LEAF * 1024 / width, 512 + LEAF * 1024 / width];
  const frontPanes: [number, number][] = [[px(70), px(doorPx[0]! - 60)], [px(doorPx[1]! + 60), px(954)]];
  const awning = Math.min(width - 1, 9);
  return <group position={[frame.ox, SIDEWALK_H, frame.oz]} rotation-y={frame.rot}>
    {/* Outside: the storefronts on both streets, plain walls on the other two sides. */}
    <mesh position={[0, FH / 2, 0.03]} material={own.front} castShadow receiveShadow><planeGeometry args={[width, FH]} /></mesh>
    <mesh position={[ws * (width / 2 + 0.03), FH / 2, -depth / 2]} rotation-y={ws * Math.PI / 2} material={m.side} castShadow receiveShadow><planeGeometry args={[depth, FH]} /></mesh>
    <Panel x={0} y={FH / 2} z={-depth - 0.03} w={width} h={FH} ry={Math.PI} material={own.blank} />
    <Panel x={-ws * (width / 2 + 0.03)} y={FH / 2} z={-depth / 2} w={depth} h={FH} ry={-ws * Math.PI / 2} material={own.blank} />

    <mesh position={[0, SIGN.y, SIGN.depth / 2 + 0.05]} material={m.sign} castShadow><boxGeometry args={[SIGN.w, SIGN.h, SIGN.depth]} /></mesh>
    {(kind === "cafe" || kind === "pizza") && (
      // A striped awning sloping out over the windows and door.
      <mesh position={[0, 3.02, 0.65]} rotation-x={0.32} material={kind === "cafe" ? mats.cafeAwning : mats.pizzaAwning} castShadow>
        <boxGeometry args={[awning, 0.04, 1.3]} />
      </mesh>
    )}
    {kind === "fine" && [-1.75, 1.75].map((x) => (
      // Red paper lanterns either side of the door.
      <group key={x} position={[x, 2.45, 0.45]}>
        <mesh material={mats.lantern} scale={[0.26, 0.36, 0.26]}><sphereGeometry args={[1, 16, 12]} /></mesh>
        <mesh material={mats.lanternCap} position-y={0.36}><cylinderGeometry args={[0.12, 0.12, 0.06, 12]} /></mesh>
        <mesh material={mats.lanternCap} position-y={-0.36}><cylinderGeometry args={[0.12, 0.12, 0.06, 12]} /></mesh>
        <mesh material={mats.lanternCap} position={[0, 0.5, -0.2]}><boxGeometry args={[0.04, 0.04, 0.44]} /></mesh>
      </group>
    ))}
    {kind === "burger" && (
      <group position={[width / 2 - 0.9, 3.95, 0.98]}>
        <mesh material={m.edge} position={[0, 0.76, -0.5]}><boxGeometry args={[0.08, 0.08, 1]} /></mesh>
        <mesh material={m.edge} rotation-z={Math.PI / 2} castShadow><cylinderGeometry args={[0.72, 0.72, 0.1, 32]} /></mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} material={mats.blade} position-x={side * 0.052} rotation-y={side * Math.PI / 2}><circleGeometry args={[0.7, 32]} /></mesh>
        ))}
      </group>
    )}

    {/* The doorway: frame, two glass leaves opening outward, and their closers. */}
    {[-1, 1].map((s) => <mesh key={s} position={[s * (LEAF + 0.04), DOOR_H / 2, -WALL / 2 + 0.015]} material={own.metal} castShadow><boxGeometry args={[0.08, DOOR_H + 0.04, WALL + 0.04]} /></mesh>)}
    <mesh position={[0, DOOR_H + 0.04, -WALL / 2 + 0.015]} material={own.metal}><boxGeometry args={[2 * LEAF + 0.16, 0.08, WALL + 0.04]} /></mesh>
    <Leaf side={1} frame={own.metal} mats={mats} at={(g) => { leaves.current.right = g; }} />
    <Leaf side={-1} frame={own.metal} mats={mats} at={(g) => { leaves.current.left = g; }} />
    {[1, -1].map((s) => <mesh key={s} position={[s * (LEAF - 0.48), DOOR_H - 0.01, 0.07]} material={mats.closer}><boxGeometry args={[0.06, 0.05, 0.06]} /></mesh>)}
    {[0, 1, 2, 3].map((i) => <mesh key={i} ref={(el) => { arms.current[i] = el; }} material={mats.closer}><boxGeometry args={[CLOSER_ARM, 0.022, 0.03]} /></mesh>)}

    {/* Inside. */}
    <mesh position={[0, 0.004, -depth / 2]} rotation-x={-Math.PI / 2} material={own.floor} receiveShadow><planeGeometry args={[width, depth]} /></mesh>
    <mesh position={[0, CEILING, -depth / 2]} rotation-x={Math.PI / 2} material={own.ceiling}><planeGeometry args={[width, depth]} /></mesh>
    <Wall a0={inner.minX} a1={-LEAF - 0.08} place={(a) => [a, -WALL]} ry={Math.PI} low={own.trim} high={own.wall} />
    <Wall a0={LEAF + 0.08} a1={inner.maxX} place={(a) => [a, -WALL]} ry={Math.PI} low={own.trim} high={own.wall} />
    <Wall a0={-LEAF - 0.08} a1={LEAF + 0.08} y0={DOOR_H + 0.08} place={(a) => [a, -WALL]} ry={Math.PI} low={own.trim} high={own.wall} />
    <Wall a0={inner.minX} a1={inner.maxX} place={(a) => [a, inner.minZ]} ry={0} low={own.trim} high={own.wall} />
    <Wall a0={inner.minZ} a1={inner.maxZ} place={(a) => [inner.minX, a]} ry={Math.PI / 2} low={own.trim} high={own.wall} />
    <Wall a0={inner.minZ} a1={inner.maxZ} place={(a) => [inner.maxX, a]} ry={-Math.PI / 2} low={own.trim} high={own.wall} />
    {frontPanes.map(([a, b2]) => <Panel key={a} x={(a + b2) / 2} y={1.9} z={-WALL - 0.006} w={Math.abs(b2 - a)} h={2.2} ry={Math.PI} material={mats.pane} />)}
    {[-0.3, 0, 0.3].map((k) => <Panel key={k} x={ws * (width / 2 - WALL - 0.006)} y={1.9} z={-depth / 2 + k * depth} w={depth * 270 / 1024} h={2.2} ry={-ws * Math.PI / 2} material={mats.pane} />)}

    {/* The counter with its register, and the menu board on the wall behind. */}
    <mesh position={[counter.x, 0.5, counter.z]} material={own.counter} castShadow receiveShadow><boxGeometry args={[counter.hx * 2, 1, counter.hz * 2]} /></mesh>
    <mesh position={[counter.x, COUNTER.height - 0.025, counter.z]} material={own.counterTop} castShadow receiveShadow><boxGeometry args={[counter.hx * 2 + 0.08, 0.05, counter.hz * 2 + 0.08]} /></mesh>
    <group position={[counter.x + ws * (counter.hx - 0.45), COUNTER.height, counter.z]}>
      <mesh position-y={0.06} material={mats.register} castShadow><boxGeometry args={[0.42, 0.12, 0.36]} /></mesh>
      <mesh position={[0, 0.2, -0.08]} rotation-x={-0.35} material={mats.register}><boxGeometry args={[0.34, 0.24, 0.04]} /></mesh>
      <mesh position={[0, 0.2, -0.057]} rotation-x={-0.35} material={mats.screen}><planeGeometry args={[0.3, 0.2]} /></mesh>
    </group>
    <mesh position={[counter.x, 2.7, inner.minZ + 0.02]} material={m.sign}><boxGeometry args={[3.2, 0.65, 0.03]} /></mesh>
    {[-1, 1].map((s) => <mesh key={s} position={[s * width / 4, CEILING - 0.03, -depth / 2]} rotation-x={Math.PI / 2} material={own.lamp}><circleGeometry args={[0.35, 24]} /></mesh>)}

    {initial.map((it, i) => it.kind === "table"
      ? <Table key={i} material={own.table} legs={own.leg} at={(g) => { pieces.current[i] = g; }} />
      : <Chair key={i} frame={own.chair} seat={own.seat} at={(g) => { pieces.current[i] = g; }} />)}
  </group>;
}

/** Where the lights hang inside a restaurant (world space). */
function lightSpots(layout: RoomLayout) {
  return [-1, 1].map((s) => toWorld(layout.frame, s * layout.width / 4, -layout.depth / 2));
}

/**
 * The city's four restaurants. Their doors and windows light up at dusk like everyone else's, but switch off
 * when they close for the night (the burger place never closes). Inside, the lights are on while they are open.
 */
export function Restaurants({ city, state }: { city: City; state: GameState }) {
  const ready = useFontsReady();
  const mats = useRestaurantMaterials(ready);
  const here = useMemo(() => city.buildings.filter((b) => b.restaurant), [city]);
  const layouts = useMemo(() => here.map((b) => roomLayout(b)), [here]);
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  useFrame(() => {
    const { hours } = timeInfo(state.elapsed), d = state.darkness;
    for (const kind of Object.keys(RESTAURANTS) as RestaurantKind[]) {
      const lit = restaurantOpen(kind, hours) ? d : 0, m = mats[kind];
      m.side.emissiveIntensity = lit * 1.2;
      (m.sign[4] as THREE.MeshStandardMaterial).emissiveIntensity = lit * 0.85;
      if (kind === "fine") mats.lantern.emissiveIntensity = lit * 1.6;
      if (kind === "burger") mats.blade.emissiveIntensity = lit * 0.85;
    }
    mats.pane.color.copy(DAY_PANE).lerp(NIGHT_PANE, d); mats.pane.emissiveIntensity = 0.35 * (1 - d);
    // Two real lights follow the nearest restaurant, lit while it is open.
    let best: RoomLayout | null = null, bestDistance = 45;
    for (const layout of layouts) {
      const distance = Math.hypot(layout.frame.ox - state.pos.x, layout.frame.oz - state.pos.z);
      if (distance < bestDistance) { best = layout; bestDistance = distance; }
    }
    const spots = best ? lightSpots(best) : [];
    const on = best ? restaurantOpen(best.kind, hours) : false;
    lights.current.forEach((light, i) => {
      if (!light) return;
      const spot = spots[i];
      if (spot) light.position.set(spot[0], SIDEWALK_H + CEILING - 0.4, spot[1]);
      light.intensity = spot ? (on ? 16 : 1.2) : 0;
      if (best) light.color.set(INSIDE[best.kind].light);
    });
  });
  return <>
    {here.map((b) => <Restaurant key={`${b.x}:${b.z}`} b={b} mats={mats} state={state} ready={ready} />)}
    {[0, 1].map((i) => <pointLight key={i} ref={(el) => { lights.current[i] = el; }} distance={10} decay={1.3} intensity={0} />)}
  </>;
}
