import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { BUILDING_ENTRANCE, RESTAURANTS, SIDEWALK_H, restaurantOpen, timeInfo, type Building, type City, type RestaurantKind } from "./config";
import { canvas, groundY, makeBlankWall, tex } from "./textures";
import { CEILING, COUNTER, DINING, DOOR_H, HANDLE, KITCHEN_DOOR, KITCHEN_DOOR_H, LEAF, WALL, WINDOW, furnish, onLeaf, roomLayout, toWorld, type Item, type RoomLayout } from "./restaurantRoom";
import { MENU_BOARDS } from "./food";
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
 * A restaurant's ground floor wall: its own colours, with see-through openings (cleared to transparent) where
 * the real windows and doors go. Openings are fractions [u0, u1] across the wall; windows run from
 * WINDOW.y0 to WINDOW.y1 high. On the entrance side, the opening hours hang above the door.
 */
function makeStorefront(kind: RestaurantKind, windows: [number, number][], door: [number, number] | null) {
  const brand = BRAND[kind];
  const [c, g] = canvas(1024, 384);
  paintWallFor(kind, g, 1024, 384);
  const top = groundY(WINDOW.y1), bottom = groundY(WINDOW.y0), doorTop = groundY(DOOR_H);
  const px = (u: number) => Math.round(u * 1024);
  for (const [u0, u1] of windows) {
    g.fillStyle = brand.frame; g.fillRect(px(u0) - 10, top - 10, px(u1) - px(u0) + 20, bottom - top + 20);
    if (kind === "pizza") { g.fillStyle = "#1f5d3a"; g.fillRect(px(u0) - 10, bottom + 10, px(u1) - px(u0) + 20, 12); }
  }
  if (door) {
    const [x0, x1] = [px(door[0]), px(door[1])];
    g.fillStyle = brand.frame; g.fillRect(x0 - 12, doorTop - 12, x1 - x0 + 24, 384 - doorTop + 12);
    // Opening hours above the door.
    const plaqueY = doorTop - 44, mid = (x0 + x1) / 2;
    g.fillStyle = "rgba(255,255,255,0.9)"; g.fillRect(mid - 110, plaqueY, 220, 26);
    g.fillStyle = "#1b1b1b"; g.textAlign = "center"; g.textBaseline = "middle";
    fitText(g, brand.hours, (s) => `700 ${s}px Manrope, Arial, sans-serif`, 17, 206); g.fillText(brand.hours, mid, plaqueY + 14);
    g.clearRect(x0, doorTop, x1 - x0, 384 - doorTop);
  }
  for (const [u0, u1] of windows) g.clearRect(px(u0), top, px(u1) - px(u0), bottom - top);
  g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(0, 0, 1024, 10);
  const map = tex(c); map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  return map;
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

/** A place's emblem (the coffee cup, the slice, the rising sun and blossom, the burger), centred at (x, y). */
export function drawBrandIcon(kind: RestaurantKind, g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  if (kind === "cafe") coffeeCup(g, x, y, s);
  else if (kind === "pizza") pizzaSlice(g, x, y, s);
  else if (kind === "burger") burgerIcon(g, x, y, s);
  else { g.fillStyle = "#b71c1c"; g.beginPath(); g.arc(x, y, s * 0.5, 0, Math.PI * 2); g.fill(); blossom(g, x + s * 0.38, y - s * 0.36, s * 0.3); }
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

/** A soft band of coloured light, brightest along one long edge (the wall it spills from). */
function makeGlowSpill(colour: string) {
  const [c, g] = canvas(256, 128);
  // Brightest at the top of the texture: laid on the ground, that edge is against the wall.
  const fade = g.createLinearGradient(0, 0, 0, 128);
  fade.addColorStop(0, colour); fade.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = fade; g.fillRect(0, 0, 256, 128);
  const sides = g.createLinearGradient(0, 0, 256, 0);
  sides.addColorStop(0, "rgba(0,0,0,1)"); sides.addColorStop(0.12, "rgba(0,0,0,0)"); sides.addColorStop(0.88, "rgba(0,0,0,0)"); sides.addColorStop(1, "rgba(0,0,0,1)");
  g.globalCompositeOperation = "destination-out"; g.fillStyle = sides; g.fillRect(0, 0, 256, 128);
  return tex(c);
}

/** Small square wall tiles, or a plain grey floor tile, for the kitchen. One repeat is a metre square. */
function makeTiles(base: string, grout: string, count: number) {
  const [c, g] = canvas(256, 256);
  g.fillStyle = grout; g.fillRect(0, 0, 256, 256);
  const cell = 256 / count;
  g.fillStyle = base;
  for (let i = 0; i < count; i++) for (let j = 0; j < count; j++) g.fillRect(i * cell + 2, j * cell + 2, cell - 4, cell - 4);
  return tex(c);
}

/** What each place sells, and for how much (shared with ordering). */
const MENUS = MENU_BOARDS;

/** The menu board's look: background, titles, item text, prices, and fonts, from the sign's palette. */
const MENU_LOOK: Record<RestaurantKind, { bg: string; frame: string; title: string; text: string; price: string; head: string; body: string; rule: string }> = {
  cafe: { bg: "#26302a", frame: "#5b3a24", title: "#f6ecd9", text: "#f6ecd9", price: "#e9c48a", head: "400 {s}px Pacifico, cursive", body: "600 {s}px Manrope, Arial, sans-serif", rule: "rgba(246,236,217,0.35)" },
  pizza: { bg: "#f6efe2", frame: "#1f5d3a", title: "#c0392b", text: "#2b2b2b", price: "#1f5d3a", head: "400 {s}px Lobster, cursive", body: "600 {s}px Manrope, Arial, sans-serif", rule: "rgba(192,57,43,0.35)" },
  fine: { bg: "#0d0d0d", frame: "#c9a54a", title: "#e3c46f", text: "#efe6d2", price: "#e3c46f", head: "700 {s}px Cinzel, Georgia, serif", body: "500 {s}px Cinzel, Georgia, serif", rule: "rgba(201,165,74,0.4)" },
  burger: { bg: "#e53935", frame: "#ffcc00", title: "#ffcc00", text: "#ffffff", price: "#ffcc00", head: "400 {s}px Bungee, Impact, sans-serif", body: "700 {s}px Manrope, Arial, sans-serif", rule: "rgba(255,204,0,0.55)" },
};

/** The menu board behind the counter (1024 × 512, for a 3.2 m × 1.6 m board). */
function makeMenu(kind: RestaurantKind) {
  const W = 1024, H = 512, look = MENU_LOOK[kind], menu = MENUS[kind];
  const font = (f: string) => (size: number) => f.replace("{s}", String(size));
  const [c, g] = canvas(W, H);
  g.fillStyle = look.frame; g.fillRect(0, 0, W, H);
  g.fillStyle = look.bg; g.fillRect(14, 14, W - 28, H - 28);
  if (kind === "fine") { g.strokeStyle = look.frame; g.lineWidth = 2; g.strokeRect(26, 26, W - 52, H - 52); }
  if (kind === "burger") { g.fillStyle = "#b71c1c"; for (let x = 14; x < W - 14; x += 40) g.fillRect(x, H - 40, 20, 26); }
  g.textBaseline = "middle";
  // Heading: the brand's name.
  g.fillStyle = look.title; g.textAlign = "center";
  fitText(g, RESTAURANTS[kind].name, font(look.head), 54, 700); g.fillText(RESTAURANTS[kind].name, W / 2, 62);
  g.fillStyle = look.rule; g.fillRect(60, 104, W - 120, 2);
  const columns = menu.sections.length, colW = (W - 80) / columns;
  // Rows closer together when a column is long, so the note at the bottom stays clear.
  const rows = Math.max(...menu.sections.map((sec) => sec.items.length)), step = Math.min(46, 232 / Math.max(1, rows - 1));
  menu.sections.forEach((section, i) => {
    const x0 = 40 + i * colW + 14, x1 = 40 + (i + 1) * colW - 14;
    g.textAlign = "center"; g.fillStyle = look.title;
    fitText(g, section.title, font(look.head), 34, x1 - x0); g.fillText(section.title, (x0 + x1) / 2, 140);
    section.items.forEach(([name, price], row) => {
      const y = 190 + row * step;
      g.fillStyle = look.text; g.textAlign = "left";
      fitText(g, name, font(look.body), 22, x1 - x0 - 80); g.fillText(name, x0, y);
      g.fillStyle = look.price; g.textAlign = "right";
      g.font = font(look.body)(22); g.fillText(`$${price}`, x1, y);
      // Dotted leader between the item and its price.
      g.fillStyle = look.rule;
      const from = x0 + g.measureText(name).width + 10, to = x1 - g.measureText(`$${price}`).width - 10;
      for (let d = from; d < to; d += 9) g.fillRect(d, y + 8, 3, 3);
    });
    if (i > 0) { g.fillStyle = look.rule; g.fillRect(40 + i * colW, 130, 2, 300); }
  });
  g.textAlign = "center"; g.fillStyle = look.price;
  fitText(g, menu.note, font(look.body), 22, W - 160); g.fillText(menu.note, W / 2, H - 58);
  const map = tex(c); map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  return map;
}

/** Framed pictures for each place's walls (256 × 320 each). */
function makePainting(kind: RestaurantKind, index: number) {
  const [c, g] = canvas(256, 320);
  const sky = (top: string, bottom: string) => { const s = g.createLinearGradient(0, 0, 0, 320); s.addColorStop(0, top); s.addColorStop(1, bottom); g.fillStyle = s; g.fillRect(0, 0, 256, 320); };
  const circle = (x: number, y: number, r: number, fill: string) => { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  g.textAlign = "center"; g.textBaseline = "middle";
  if (kind === "cafe") {
    if (index === 0) {
      // Latte art seen from above.
      g.fillStyle = "#f3e6cf"; g.fillRect(0, 0, 256, 320);
      circle(128, 160, 98, "#ffffff"); circle(128, 160, 80, "#8a5a33"); circle(128, 160, 70, "#b07a48");
      g.fillStyle = "#f6ecd9"; for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(128, 120 + k * 22, 44 - k * 8, 12, 0, 0, Math.PI * 2); g.fill(); }
      g.fillRect(124, 110, 8, 100);
    } else if (index === 1) {
      g.fillStyle = "#7fa38a"; g.fillRect(0, 0, 256, 320);
      for (let k = 0; k < 9; k++) { const x = 50 + (k % 3) * 78, y = 70 + Math.floor(k / 3) * 90; g.fillStyle = "#4a2c18"; g.beginPath(); g.ellipse(x, y, 26, 36, 0.5, 0, Math.PI * 2); g.fill(); g.strokeStyle = "#2a170b"; g.lineWidth = 4; g.beginPath(); g.moveTo(x - 10, y - 26); g.quadraticCurveTo(x + 8, y, x - 8, y + 28); g.stroke(); }
    } else {
      g.fillStyle = "#f6ecd9"; g.fillRect(0, 0, 256, 320);
      g.fillStyle = "#5b3a24"; g.font = "400 34px Pacifico, cursive"; g.fillText("But first,", 128, 120); g.font = "400 50px Pacifico, cursive"; g.fillText("coffee", 128, 190);
      g.fillStyle = "#7fa38a"; g.fillRect(70, 240, 116, 4);
    }
  } else if (kind === "pizza") {
    if (index === 0) {
      // The Leaning Tower of Pisa.
      sky("#8fc3e8", "#f1e4d0"); g.fillStyle = "#cfe0a8"; g.fillRect(0, 260, 256, 60);
      g.save(); g.translate(128, 262); g.rotate(0.08);
      for (let k = 0; k < 7; k++) { g.fillStyle = k % 2 ? "#efe8da" : "#e2d9c5"; g.fillRect(-34, -28 - k * 28, 68, 28); g.fillStyle = "#b9ad95"; for (let a = -26; a <= 26; a += 13) g.fillRect(a - 3, -24 - k * 28, 6, 18); }
      g.restore();
    } else if (index === 1) {
      // The Amalfi coast.
      sky("#ffcf8a", "#ffe9c7"); circle(190, 90, 34, "#ff9f43");
      g.fillStyle = "#1e6fa8"; g.fillRect(0, 190, 256, 130);
      const houses = ["#f4d35e", "#ee6c4d", "#f7f0e3", "#e09f3e", "#98c1d9"];
      for (let k = 0; k < 10; k++) { g.fillStyle = houses[k % 5]!; g.fillRect(k * 26, 160 - (k % 3) * 22, 24, 50 + (k % 3) * 22); g.fillStyle = "#3d5a80"; g.fillRect(k * 26 + 8, 170 - (k % 3) * 22, 8, 10); }
    } else {
      // Tomatoes and basil.
      g.fillStyle = "#f6efe2"; g.fillRect(0, 0, 256, 320);
      circle(95, 180, 52, "#d62828"); circle(165, 200, 44, "#c1121f"); circle(130, 245, 36, "#e63946");
      g.fillStyle = "#2d6a4f"; for (const [x, y, a] of [[95, 130, -0.4], [165, 158, 0.3], [128, 214, 0]] as const) { g.beginPath(); g.ellipse(x, y, 20, 8, a, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = "#1f5d3a"; g.font = "400 30px Lobster, cursive"; g.fillText("Pomodoro", 128, 50);
    }
  } else if (kind === "fine") {
    if (index === 0) {
      // Mount Fuji under a red sun.
      sky("#f4e6cf", "#e8d5b5"); circle(178, 82, 34, "#b71c1c");
      g.fillStyle = "#3a4a63"; g.beginPath(); g.moveTo(10, 270); g.lineTo(110, 120); g.lineTo(146, 120); g.lineTo(246, 270); g.fill();
      g.fillStyle = "#f8f4ec"; g.beginPath(); g.moveTo(110, 120); g.lineTo(146, 120); g.lineTo(166, 152); g.lineTo(144, 146); g.lineTo(128, 160); g.lineTo(112, 146); g.lineTo(90, 152); g.fill();
      g.fillStyle = "#2b3a4f"; g.fillRect(0, 270, 256, 50);
    } else if (index === 1) {
      // A great wave.
      g.fillStyle = "#efe4cc"; g.fillRect(0, 0, 256, 320);
      g.fillStyle = "#1d3557"; g.beginPath(); g.moveTo(0, 320); g.lineTo(0, 210); g.bezierCurveTo(40, 120, 150, 60, 200, 110); g.bezierCurveTo(160, 100, 140, 140, 170, 170); g.bezierCurveTo(120, 180, 120, 260, 256, 250); g.lineTo(256, 320); g.fill();
      g.fillStyle = "#f8f4ec"; for (let k = 0; k < 7; k++) circle(150 + k * 9, 100 + Math.sin(k) * 6, 6, "#f8f4ec");
      g.fillStyle = "#457b9d"; g.fillRect(0, 290, 256, 30);
    } else {
      // A cherry blossom branch.
      g.fillStyle = "#f4ead8"; g.fillRect(0, 0, 256, 320);
      g.strokeStyle = "#3b2a20"; g.lineWidth = 8; g.beginPath(); g.moveTo(0, 260); g.quadraticCurveTo(110, 220, 230, 70); g.stroke();
      g.lineWidth = 4; g.beginPath(); g.moveTo(120, 200); g.quadraticCurveTo(150, 230, 210, 220); g.stroke();
      for (const [x, y] of [[60, 236], [110, 205], [160, 150], [205, 100], [230, 72], [175, 222], [210, 214], [140, 180]] as const) blossom(g, x, y, 14);
      g.fillStyle = "#b71c1c"; g.fillRect(36, 40, 22, 22);
    }
  } else {
    if (index === 0) {
      // A retro milkshake poster.
      g.fillStyle = "#ffcc00"; g.fillRect(0, 0, 256, 320);
      g.fillStyle = "#e53935"; for (let k = 0; k < 8; k++) g.fillRect(k * 32, 0, 16, 320);
      g.fillStyle = "#ffffff"; g.beginPath(); g.moveTo(78, 120); g.lineTo(178, 120); g.lineTo(160, 270); g.lineTo(96, 270); g.fill();
      circle(128, 112, 54, "#f8bbd0"); circle(128, 62, 14, "#c62828");
      g.fillStyle = "#c62828"; g.fillRect(150, 30, 8, 80);
      g.fillStyle = "#111"; g.font = "400 30px Bungee, Impact, sans-serif"; g.fillText("SHAKES", 128, 296);
    } else if (index === 1) {
      g.fillStyle = "#111111"; g.fillRect(0, 0, 256, 320);
      burgerIcon(g, 128, 170, 200);
      g.fillStyle = "#ffcc00"; g.font = "400 34px Bungee, Impact, sans-serif"; g.fillText("EST. 1958", 128, 60);
    } else {
      // Black and white diner checks with a neon-pink star.
      for (let i = 0; i < 8; i++) for (let j = 0; j < 10; j++) { g.fillStyle = (i + j) % 2 ? "#111" : "#f5f5f5"; g.fillRect(i * 32, j * 32, 32, 32); }
      g.fillStyle = "#ff4fa3"; g.beginPath();
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 40 : 96; g.lineTo(128 + Math.cos(a) * r, 160 + Math.sin(a) * r); }
      g.fill();
    }
  }
  const map = tex(c); map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  return map;
}

function useRestaurantMaterials(ready: boolean) {
  const mats = useMemo(() => {
    const kinds = Object.keys(RESTAURANTS) as RestaurantKind[];
    const entry = (kind: RestaurantKind) => {
      const signMap = makeSign(kind);
      const sign = new THREE.MeshStandardMaterial({ map: signMap, emissiveMap: signMap, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0, roughness: 0.5 });
      const edge = new THREE.MeshStandardMaterial({ color: kind === "fine" ? "#c9a54a" : kind === "burger" ? "#e53935" : kind === "pizza" ? "#173f28" : "#5b3a24", roughness: 0.6 });
      // Window glass: clear by day; at night it glows warm while the place is open.
      const glass = new THREE.MeshStandardMaterial({ color: "#a9c7d3", transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false, emissive: new THREE.Color(BRAND[kind].glow), emissiveIntensity: 0 });
      const menuMap = makeMenu(kind);
      const menu = new THREE.MeshStandardMaterial({ map: menuMap, emissiveMap: menuMap, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.25, roughness: 0.6 });
      const paintings = [0, 1, 2].map((i) => new THREE.MeshStandardMaterial({ map: makePainting(kind, i), roughness: 0.7 }));
      // The light spilling out of the windows onto the pavement while it is open at night.
      const spill = new THREE.MeshBasicMaterial({ map: makeGlowSpill(BRAND[kind].glow), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false });
      return { sign: [edge, edge, edge, edge, sign, edge], edge, glass, menu, paintings, spill };
    };
    return {
      ...Object.fromEntries(kinds.map((kind) => [kind, entry(kind)])) as Record<RestaurantKind, ReturnType<typeof entry>>,
      cafeAwning: new THREE.MeshStandardMaterial({ map: makeAwning(["#5b3a24", "#f6ecd9"]), roughness: 0.9, side: THREE.DoubleSide }),
      pizzaAwning: new THREE.MeshStandardMaterial({ map: makeAwning(["#2e8b57", "#ffffff", "#c0392b"]), roughness: 0.9, side: THREE.DoubleSide }),
      lantern: new THREE.MeshStandardMaterial({ color: "#d32f2f", emissive: new THREE.Color("#ff7043"), emissiveIntensity: 0, roughness: 0.7 }),
      lanternCap: new THREE.MeshStandardMaterial({ color: "#111111", roughness: 0.6 }),
      blade: (() => { const map = makeBlade(); return new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0, roughness: 0.5 }); })(),
      doorGlass: new THREE.MeshStandardMaterial({ color: "#a9c7d3", transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }),
      closer: new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.4, metalness: 0.5 }),
      register: new THREE.MeshStandardMaterial({ color: "#222428", roughness: 0.5, metalness: 0.3 }),
      screen: new THREE.MeshStandardMaterial({ color: "#1c3a52", emissive: new THREE.Color("#4fc3f7"), emissiveIntensity: 0.6 }),
      kitchenWall: new THREE.MeshStandardMaterial({ map: (() => { const t = makeTiles("#f4f6f6", "#c9cfd1", 6); return t; })(), roughness: 0.4 }),
      kitchenFloor: new THREE.MeshStandardMaterial({ map: (() => { const t = makeTiles("#9aa1a6", "#6f767b", 3); return t; })(), roughness: 0.7 }),
      soil: new THREE.MeshStandardMaterial({ color: "#3b2a1c", roughness: 1 }),
      leaves: new THREE.MeshStandardMaterial({ color: "#3f7d3a", roughness: 0.9 }),
      neon: new THREE.MeshStandardMaterial({ color: "#ff4fa3", emissive: new THREE.Color("#ff4fa3"), emissiveIntensity: 1.6 }),
    };
    // Repaint once the brand fonts have loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  useEffect(() => () => disposeAll(Object.values(mats).flatMap((v) => (v instanceof THREE.Material ? [v] : [v.edge, v.glass, v.menu, v.spill, ...v.paintings, ...v.sign]))), [mats]);
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
/** Exterior wall panels sit this far out from the building's face, and overlap at the corners by as much. */
const SKIN = 0.03;
/** How near (m) a restaurant's whole interior is drawn; further, a plain box shows behind its windows. */
const INTERIOR_REACH = 40;

/** A flat panel `w` × `h` centred at (x, y, z), turned `ry` about the vertical. */
function Panel({ x, y, z, w, h, ry = 0, material }: { x: number; y: number; z: number; w: number; h: number; ry?: number; material: THREE.Material }) {
  return <mesh position={[x, y, z]} rotation-y={ry} material={material} receiveShadow><planeGeometry args={[w, h]} /></mesh>;
}

type Hole = { a0: number; a1: number; y0: number; y1: number };
/**
 * An inside wall from `a0` to `a1` along it, with openings cut out (windows, doorways), painted in `low` up to
 * a metre and `high` above.
 */
function Wall({ a0, a1, place, ry, low, high, holes = [] }: { a0: number; a1: number; place: (a: number) => [number, number]; ry: number; low: THREE.Material; high: THREE.Material; holes?: Hole[] }) {
  const rects: { a0: number; a1: number; y0: number; y1: number }[] = [];
  let at = a0;
  for (const h of [...holes].filter((h) => h.a1 > a0 && h.a0 < a1).sort((p, q) => p.a0 - q.a0)) {
    if (h.a0 > at) rects.push({ a0: at, a1: h.a0, y0: 0, y1: CEILING });
    if (h.y0 > 0) rects.push({ a0: Math.max(h.a0, a0), a1: Math.min(h.a1, a1), y0: 0, y1: h.y0 });
    rects.push({ a0: Math.max(h.a0, a0), a1: Math.min(h.a1, a1), y0: h.y1, y1: CEILING });
    at = Math.max(at, h.a1);
  }
  if (at < a1) rects.push({ a0: at, a1, y0: 0, y1: CEILING });
  // Each piece is split where the wall paint changes, a metre up.
  const pieces = rects.flatMap((r) => [
    ...(r.y0 < 1 ? [{ ...r, y1: Math.min(1, r.y1), m: low }] : []),
    ...(r.y1 > 1 ? [{ ...r, y0: Math.max(1, r.y0), m: high }] : []),
  ]).filter((r) => r.a1 - r.a0 > 1e-3 && r.y1 - r.y0 > 1e-3);
  return <>{pieces.map((r, i) => {
    const [x, z] = place((r.a0 + r.a1) / 2);
    return <Panel key={i} x={x} z={z} y={(r.y0 + r.y1) / 2} w={r.a1 - r.a0} h={r.y1 - r.y0} ry={ry} material={r.m} />;
  })}</>;
}

/**
 * A real window in the wall: frame lining the opening through the wall's thickness, glass in the middle, and
 * (café and Hanami) glazing bars. In the wall's own frame: x along it, +z outward.
 */
function WindowOpening({ a0, a1, kind, frame, glass }: { a0: number; a1: number; kind: RestaurantKind; frame: THREE.Material; glass: THREE.Material }) {
  const w = a1 - a0, mid = (a0 + a1) / 2, h = WINDOW.y1 - WINDOW.y0, ym = (WINDOW.y0 + WINDOW.y1) / 2;
  const depth = WALL + SKIN + 0.02, zc = (SKIN - WALL) / 2;
  const bars: [number, number, number, number][] = [];
  if (kind === "cafe") { for (const f of [1 / 3, 2 / 3]) bars.push([a0 + w * f, ym, 0.05, h]); bars.push([mid, ym, w, 0.05]); }
  if (kind === "fine") { for (let k = 1; k < 6; k++) bars.push([a0 + w * k / 6, ym, 0.035, h]); for (let k = 1; k < 4; k++) bars.push([mid, WINDOW.y0 + h * k / 4, w, 0.035]); }
  return <>
    <mesh position={[mid, WINDOW.y0 - 0.03, zc]} material={frame} receiveShadow><boxGeometry args={[w + 0.12, 0.06, depth]} /></mesh>
    <mesh position={[mid, WINDOW.y1 + 0.03, zc]} material={frame}><boxGeometry args={[w + 0.12, 0.06, depth]} /></mesh>
    {[a0 - 0.03, a1 + 0.03].map((x) => <mesh key={x} position={[x, ym, zc]} material={frame} castShadow><boxGeometry args={[0.06, h, depth]} /></mesh>)}
    <mesh position={[mid, ym, zc]} material={glass}><planeGeometry args={[w, h]} /></mesh>
    {bars.map(([x, y, bw, bh], i) => <mesh key={i} position={[x, y, zc]} material={frame}><boxGeometry args={[bw, bh, 0.04]} /></mesh>)}
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
    <mesh position={[mid, DOOR_H / 2 + 0.04, 0]} material={mats.doorGlass}><planeGeometry args={[LEAF - 0.12, DOOR_H - 0.24]} /></mesh>
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

/** A potted plant (each place its own: leafy, olive, bonsai, or a tall palm). */
function Plant({ x, z, kind, mats, pot }: { x: number; z: number; kind: RestaurantKind; mats: Materials; pot: THREE.Material }) {
  const bonsai = kind === "fine";
  return <group position={[x, 0, z]}>
    <mesh position-y={bonsai ? 0.2 : 0.3} material={pot} castShadow><cylinderGeometry args={[0.26, 0.2, bonsai ? 0.4 : 0.6, 16]} /></mesh>
    <mesh position-y={bonsai ? 0.41 : 0.61} rotation-x={-Math.PI / 2} material={mats.soil}><circleGeometry args={[0.24, 16]} /></mesh>
    <mesh position-y={bonsai ? 0.75 : 1.0} material={mats.soil}><cylinderGeometry args={[0.04, 0.05, bonsai ? 0.7 : 0.8, 8]} /></mesh>
    {(bonsai ? [[0, 1.1, 0, 0.32], [0.2, 0.95, 0.1, 0.2]] : [[0, 1.55, 0, 0.45], [0.18, 1.3, 0.1, 0.3], [-0.16, 1.35, -0.12, 0.3]]).map(([px, py, pz, r], i) => (
      <mesh key={i} position={[px!, py!, pz!]} material={mats.leaves} castShadow><icosahedronGeometry args={[r!, 1]} /></mesh>
    ))}
  </group>;
}

function Restaurant({ b, mats, state, ready }: { b: Building; mats: Materials; state: GameState; ready: boolean }) {
  const kind = b.restaurant ?? "cafe";
  const layout = useMemo<RoomLayout>(() => roomLayout(b), [b]);
  const { frame, width, depth, windowSide: ws, counter, bounds, divider, frontWindows, sideWindows, plants } = layout;
  const m = mats[kind], look = INSIDE[kind];
  // Where along each storefront the openings are, as fractions across its texture.
  const sideU = (z: number) => (ws === 1 ? -z / depth : (z + depth) / depth);
  const own = useMemo(() => {
    const frontMap = makeStorefront(kind, frontWindows.map(([a, c]) => [(a + width / 2) / width, (c + width / 2) / width]), [(-LEAF + width / 2) / width, (LEAF + width / 2) / width]);
    const sideMap = makeStorefront(kind, sideWindows.map(([z0, z1]) => [sideU(z0), sideU(z1)].sort((p, q) => p - q) as [number, number]), null);
    const floorMap = makeFloor(kind); floorMap.repeat.set(width, DINING);
    const solid = (color: string, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
    return {
      front: new THREE.MeshStandardMaterial({ map: frontMap, roughness: 0.6, alphaTest: 0.5 }),
      side: new THREE.MeshStandardMaterial({ map: sideMap, roughness: 0.6, alphaTest: 0.5 }),
      floor: new THREE.MeshStandardMaterial({ map: floorMap, roughness: 0.7 }),
      blank: new THREE.MeshStandardMaterial({ map: makeBlankWall(b.variant), roughness: 0.9 }),
      wall: solid(look.wall, 0.9), trim: solid(look.trim), ceiling: solid(look.ceiling, 0.95),
      counter: solid(look.counter, 0.6), counterTop: solid(look.counterTop, 0.35, kind === "burger" ? 0.6 : 0.1),
      table: solid(look.table, 0.45), leg: solid(look.leg, 0.5, 0.3), chair: solid(look.chair, 0.6), seat: solid(look.seat, 0.7),
      metal: solid(look.metal, 0.35, 0.6), pot: solid(kind === "fine" ? "#1c1c1c" : kind === "pizza" ? "#b5651d" : kind === "burger" ? "#e53935" : "#f6ecd9", 0.7),
      lamp: new THREE.MeshStandardMaterial({ color: look.light, emissive: new THREE.Color(look.light), emissiveIntensity: 0 }),
      // Seen from inside the box: the room's walls from afar (lit up a little when it's open at night).
      inside: new THREE.MeshStandardMaterial({ color: look.wall, roughness: 0.9, side: THREE.BackSide, emissive: new THREE.Color(look.light), emissiveIntensity: 0 }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, width, depth, b.variant, ready, look, layout]);
  useEffect(() => () => disposeAll(Object.values(own)), [own]);

  const initial = useMemo<Item[]>(() => furnish(layout), [layout]);
  const pieces = useRef<(THREE.Group | null)[]>([]);
  const leaves = useRef<{ left: THREE.Group | null; right: THREE.Group | null }>({ left: null, right: null });
  const arms = useRef<(THREE.Mesh | null)[]>([]);
  const inner = useRef<THREE.Group>(null), proxy = useRef<THREE.Mesh>(null);
  useFrame(() => {
    // The interior in full only near (or inside); a plain box behind the windows from further away.
    const near = state.interior?.key === layout.key || Math.hypot(state.pos.x - frame.ox, state.pos.z - frame.oz) < INTERIOR_REACH;
    if (inner.current) inner.current.visible = near;
    if (proxy.current) proxy.current.visible = !near;
    if (!near) own.inside.emissiveIntensity = state.darkness * 0.25;
  });
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
    own.lamp.emissiveIntensity = restaurantOpen(kind, timeInfo(state.elapsed).hours) ? 1.4 : 0;
  });

  const { minX, maxX, minZ, maxZ } = bounds;
  const divFace = divider.z, divBack = divider.z - WALL;
  const plain = -ws, plainX = plain * maxX;
  const doorway: Hole = { a0: divider.doorX - KITCHEN_DOOR / 2, a1: divider.doorX + KITCHEN_DOOR / 2, y0: 0, y1: KITCHEN_DOOR_H };
  // Openings on the window wall, in that wall's own frame (x along it = -ws * z; see WindowOpening).
  const sideHoles: Hole[] = sideWindows.map(([z0, z1]) => ({ a0: Math.min(z0, z1), a1: Math.max(z0, z1), y0: WINDOW.y0, y1: WINDOW.y1 }));
  const frontHoles: Hole[] = [...frontWindows.map(([a0, a1]) => ({ a0, a1, y0: WINDOW.y0, y1: WINDOW.y1 })), { a0: -LEAF - 0.08, a1: LEAF + 0.08, y0: 0, y1: DOOR_H + 0.08 }];
  const awning = Math.min(width - 1, 9);
  const diningMid = (maxZ + divFace) / 2, kitchenMid = (minZ + divBack) / 2;
  return <group position={[frame.ox, SIDEWALK_H, frame.oz]} rotation-y={frame.rot}>
    {/* Outside: storefronts on both streets and plain walls behind, each overlapping the next at the corners. */}
    <mesh position={[0, FH / 2, SKIN]} material={own.front} castShadow receiveShadow><planeGeometry args={[width + 2 * SKIN, FH]} /></mesh>
    <mesh position={[ws * (width / 2 + SKIN), FH / 2, -depth / 2]} rotation-y={ws * Math.PI / 2} material={own.side} castShadow receiveShadow><planeGeometry args={[depth + 2 * SKIN, FH]} /></mesh>
    <Panel x={0} y={FH / 2} z={-depth - SKIN} w={width + 2 * SKIN} h={FH} ry={Math.PI} material={own.blank} />
    <Panel x={-ws * (width / 2 + SKIN)} y={FH / 2} z={-depth / 2} w={depth + 2 * SKIN} h={FH} ry={-ws * Math.PI / 2} material={own.blank} />
    {frontWindows.map(([a0, a1]) => <WindowOpening key={a0} a0={a0} a1={a1} kind={kind} frame={own.metal} glass={m.glass} />)}
    <group position={[ws * width / 2, 0, 0]} rotation-y={ws * Math.PI / 2}>
      {sideWindows.map(([z0, z1]) => { const p = -ws * z0, q = -ws * z1; return <WindowOpening key={z0} a0={Math.min(p, q)} a1={Math.max(p, q)} kind={kind} frame={own.metal} glass={m.glass} />; })}
    </group>

    <mesh position={[0, SIGN.y, SIGN.depth / 2 + 0.05]} material={m.sign} castShadow><boxGeometry args={[SIGN.w, SIGN.h, SIGN.depth]} /></mesh>
    {(kind === "cafe" || kind === "pizza") && (
      // A striped awning sloping out over the windows and door.
      <mesh position={[0, 3.12, 0.65]} rotation-x={0.32} material={kind === "cafe" ? mats.cafeAwning : mats.pizzaAwning} castShadow>
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

    {/* Light from the windows on the pavement outside, on both streets. */}
    <mesh position={[0, 0.03, 2.2]} rotation-x={-Math.PI / 2} material={m.spill}><planeGeometry args={[width + 2, 4.4]} /></mesh>
    <mesh position={[ws * (width / 2 + 2.2), 0.03, -depth / 2]} rotation={[-Math.PI / 2, 0, ws * Math.PI / 2]} material={m.spill}><planeGeometry args={[depth + 2, 4.4]} /></mesh>
    {/* The doorway: frame, two glass leaves opening outward, and their closers. */}
    {[-1, 1].map((s) => <mesh key={s} position={[s * (LEAF + 0.04), DOOR_H / 2, (SKIN - WALL) / 2]} material={own.metal} castShadow><boxGeometry args={[0.08, DOOR_H + 0.04, WALL + SKIN + 0.02]} /></mesh>)}
    <mesh position={[0, DOOR_H + 0.04, (SKIN - WALL) / 2]} material={own.metal}><boxGeometry args={[2 * LEAF + 0.16, 0.08, WALL + SKIN + 0.02]} /></mesh>
    <Leaf side={1} frame={own.metal} mats={mats} at={(g) => { leaves.current.right = g; }} />
    <Leaf side={-1} frame={own.metal} mats={mats} at={(g) => { leaves.current.left = g; }} />
    {[1, -1].map((s) => <mesh key={s} position={[s * (LEAF - 0.48), DOOR_H - 0.01, 0.07]} material={mats.closer}><boxGeometry args={[0.06, 0.05, 0.06]} /></mesh>)}
    {[0, 1, 2, 3].map((i) => <mesh key={i} ref={(el) => { arms.current[i] = el; }} material={mats.closer}><boxGeometry args={[CLOSER_ARM, 0.022, 0.03]} /></mesh>)}

    {/* From further than INTERIOR_REACH, the room behind the windows is just its walls' colour (one box); the
        whole interior (walls, kitchen, counter, furniture, decorations) is only drawn nearer than that. */}
    <mesh ref={proxy} position={[0, CEILING / 2, -depth / 2]} material={own.inside} visible={false}><boxGeometry args={[width - 0.3, CEILING - 0.05, depth - 0.3]} /></mesh>
    <group ref={inner}>
    {/* Dining room. */}
    <mesh position={[0, 0.004, (divFace + 0) / 2]} rotation-x={-Math.PI / 2} material={own.floor} receiveShadow><planeGeometry args={[width, -divFace]} /></mesh>
    <mesh position={[0, CEILING, -depth / 2]} rotation-x={Math.PI / 2} material={own.ceiling}><planeGeometry args={[width, depth]} /></mesh>
    <Wall a0={minX} a1={maxX} place={(a) => [a, -WALL]} ry={Math.PI} low={own.trim} high={own.wall} holes={frontHoles} />
    <Wall a0={divFace} a1={maxZ} place={(a) => [ws * maxX, a]} ry={-ws * Math.PI / 2} low={own.trim} high={own.wall} holes={sideHoles} />
    <Wall a0={divFace} a1={maxZ} place={(a) => [plainX, a]} ry={-plain * Math.PI / 2} low={own.trim} high={own.wall} />
    <Wall a0={minX} a1={maxX} place={(a) => [a, divFace]} ry={0} low={own.trim} high={own.wall} holes={[doorway]} />

    {/* Kitchen, behind the divider (fitted out later). */}
    <mesh position={[0, 0.004, (divFace + minZ - WALL) / 2]} rotation-x={-Math.PI / 2} material={mats.kitchenFloor} receiveShadow><planeGeometry args={[width, divFace - minZ + WALL]} /></mesh>
    <Wall a0={minX} a1={maxX} place={(a) => [a, divBack]} ry={Math.PI} low={mats.kitchenWall} high={mats.kitchenWall} holes={[doorway]} />
    <Wall a0={minX} a1={maxX} place={(a) => [a, minZ]} ry={0} low={mats.kitchenWall} high={mats.kitchenWall} />
    <Wall a0={minZ} a1={divBack} place={(a) => [ws * maxX, a]} ry={-ws * Math.PI / 2} low={mats.kitchenWall} high={mats.kitchenWall} holes={sideHoles} />
    <Wall a0={minZ} a1={divBack} place={(a) => [plainX, a]} ry={-plain * Math.PI / 2} low={mats.kitchenWall} high={mats.kitchenWall} />
    {/* The kitchen doorway's frame through the divider. */}
    {[doorway.a0 - 0.03, doorway.a1 + 0.03].map((x) => <mesh key={x} position={[x, KITCHEN_DOOR_H / 2, divFace - WALL / 2]} material={own.metal}><boxGeometry args={[0.06, KITCHEN_DOOR_H, WALL + 0.02]} /></mesh>)}
    <mesh position={[divider.doorX, KITCHEN_DOOR_H + 0.03, divFace - WALL / 2]} material={own.metal}><boxGeometry args={[KITCHEN_DOOR + 0.12, 0.06, WALL + 0.02]} /></mesh>

    {/* The counter, its register (screen toward the staff side), and the menu above the kitchen doorway. */}
    <mesh position={[counter.x, 0.5, counter.z]} material={own.counter} castShadow receiveShadow><boxGeometry args={[counter.hx * 2, 1, counter.hz * 2]} /></mesh>
    <mesh position={[counter.x, COUNTER.height - 0.025, counter.z]} material={own.counterTop} castShadow receiveShadow><boxGeometry args={[counter.hx * 2 + 0.08, 0.05, counter.hz * 2 + 0.08]} /></mesh>
    <group position={[counter.x + ws * (counter.hx - 0.45), COUNTER.height, counter.z]} rotation-y={Math.PI}>
      <mesh position-y={0.06} material={mats.register} castShadow><boxGeometry args={[0.42, 0.12, 0.36]} /></mesh>
      <mesh position={[0, 0.2, -0.08]} rotation-x={-0.35} material={mats.register}><boxGeometry args={[0.34, 0.24, 0.04]} /></mesh>
      <mesh position={[0, 0.2, -0.057]} rotation-x={-0.35} material={mats.screen}><planeGeometry args={[0.3, 0.2]} /></mesh>
    </group>
    <mesh position={[divider.doorX, KITCHEN_DOOR_H + 0.95, divFace + 0.025]} material={m.edge}><boxGeometry args={[3.3, 1.7, 0.04]} /></mesh>
    <mesh position={[divider.doorX, KITCHEN_DOOR_H + 0.95, divFace + 0.046]} material={m.menu}><planeGeometry args={[3.2, 1.6]} /></mesh>

    {/* Decorations: pictures along the plain wall, plants in the front corners, and each place's own touch. */}
    {[-1.5, -3.0, -4.5].map((z, i) => (kind === "burger" && i === 2
      ? <mesh key={z} position={[plainX + ws * 0.04, 2.2, z]} rotation-y={-plain * Math.PI / 2} material={mats.neon}><torusGeometry args={[0.38, 0.03, 8, 40]} /></mesh>
      : <group key={z} position={[plainX + ws * 0.03, 2.2, z]} rotation-y={-plain * Math.PI / 2}>
          <mesh position-z={0.01} material={kind === "fine" || kind === "burger" ? mats.closer : m.edge}><boxGeometry args={[0.92, 1.12, 0.03]} /></mesh>
          <mesh position-z={0.03} material={m.paintings[i]!}><planeGeometry args={[0.8, 1.0]} /></mesh>
        </group>))}
    {plants.map(([x, z]) => <Plant key={`${x}`} x={x} z={z} kind={kind} mats={mats} pot={own.pot} />)}
    {kind === "fine" && initial.filter((it) => it.kind === "table").map((t, i) => (
      // Paper lanterns hanging over the tables.
      <group key={i} position={[t.x, CEILING - 1.0, t.z]}>
        <mesh material={mats.lanternCap} position-y={0.6}><cylinderGeometry args={[0.008, 0.008, 0.8, 4]} /></mesh>
        <mesh material={mats.lantern} scale={[0.22, 0.3, 0.22]}><sphereGeometry args={[1, 14, 10]} /></mesh>
      </group>
    ))}

    {[[-width / 4, diningMid], [width / 4, diningMid], [0, kitchenMid]].map(([x, z], i) => <mesh key={i} position={[x!, CEILING - 0.03, z!]} rotation-x={Math.PI / 2} material={own.lamp}><circleGeometry args={[0.35, 24]} /></mesh>)}
    {initial.map((it, i) => it.kind === "table"
      ? <Table key={i} material={own.table} legs={own.leg} at={(g) => { pieces.current[i] = g; }} />
      : <Chair key={i} frame={own.chair} seat={own.seat} at={(g) => { pieces.current[i] = g; }} />)}
    </group>
  </group>;
}

/** Where the lights hang inside a restaurant (world space): the dining room, then the kitchen. */
function lightSpots(layout: RoomLayout) {
  const { bounds, divider } = layout;
  return [toWorld(layout.frame, 0, (bounds.maxZ + divider.z) / 2), toWorld(layout.frame, 0, (bounds.minZ + divider.z - WALL) / 2)];
}

/**
 * The city's four restaurants. Their windows glow at dusk like everyone else's, but go dark when they close for
 * the night (the burger place never closes). Inside, the lights are on while they are open.
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
      m.glass.emissiveIntensity = lit * 0.55;
      m.spill.opacity = lit * 0.7;
      (m.sign[4] as THREE.MeshStandardMaterial).emissiveIntensity = lit * 0.85;
      if (kind === "fine") mats.lantern.emissiveIntensity = lit * 1.6 + (restaurantOpen(kind, hours) ? 0.4 : 0);
      if (kind === "burger") mats.blade.emissiveIntensity = lit * 0.85;
    }
    // Real lights follow the nearest restaurant, lit while it is open.
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
      light.intensity = spot ? (on ? (i === 0 ? 22 : 9) : 1.2) : 0;
      // Only near a restaurant (lighting its room); otherwise off altogether.
      light.visible = !!spot;
      if (best) light.color.set(i === 0 ? INSIDE[best.kind].light : "#ffffff");
    });
  });
  return <>
    {here.map((b) => <Restaurant key={`${b.x}:${b.z}`} b={b} mats={mats} state={state} ready={ready} />)}
    {[0, 1].map((i) => <pointLight key={i} ref={(el) => { lights.current[i] = el; }} distance={11} decay={1.3} intensity={0} />)}
  </>;
}
