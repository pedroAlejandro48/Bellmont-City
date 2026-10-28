import * as THREE from "three";
import { rng } from "./config";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const context = c.getContext("2d");
  if (!context) throw new Error("Canvas textures are unavailable");
  return [c, context] as const;
}

function tex(c: HTMLCanvasElement, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

const FACADES = [
  { wall: "#c9c0b1", glass: "#2c3c4d" },
  { wall: "#8a5442", glass: "#1e2830" },
  { wall: "#dde0e2", glass: "#3f5f7a" },
  { wall: "#59636d", glass: "#8fb0c8" },
];

const WINDOW_STYLES = [
  { cols: 4, w: 26, h: 30 },
  { cols: 3, w: 22, h: 38 },
  { cols: 4, w: 34, h: 22 },
];
export function wallColor(variant: number) { return (FACADES[variant % 4] ?? { wall: "#c9c0b1" }).wall; }
function paintWall(g: CanvasRenderingContext2D, wall: string, W: number, H: number, seed: number) {
  const r = rng(seed);
  g.fillStyle = wall; g.fillRect(0, 0, W, H);
  for (let i = 0; i < (W * H) / 44; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.06})`; g.fillRect(r() * W, r() * H, 2, 2); }
}
export function makeFacade(variant: number, style = 0) {
  const { wall, glass } = FACADES[variant % 4] ?? FACADES[0] ?? { wall: "#c9c0b1", glass: "#2c3c4d" };
  const ws = WINDOW_STYLES[style % WINDOW_STYLES.length] ?? { cols: 4, w: 26, h: 30 };
  const r = rng(variant * 97 + style * 13 + 3);
  const [c, g] = canvas(256, 256);
  const [e, ge] = canvas(256, 256);
  paintWall(g, wall, 256, 256, variant * 31 + 1);
  ge.fillStyle = "#000"; ge.fillRect(0, 0, 256, 256);
  const cell = 256 / ws.cols;
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < ws.cols; col++) {
      const x = Math.round(col * cell + (cell - ws.w) / 2);
      const y = Math.round(row * 64 + (64 - ws.h) / 2 - 2);
      g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(x - 3, y - 3, ws.w + 6, ws.h + 6);
      g.fillStyle = glass; g.fillRect(x, y, ws.w, ws.h);
      g.fillStyle = "rgba(255,255,255,0.18)"; g.fillRect(x, y, ws.w, 4);
      g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x - 3, y + ws.h, ws.w + 6, 4);
      if (r() < 0.6) { ge.fillStyle = r() < 0.5 ? "#ffcf73" : "#fff0c2"; ge.fillRect(x, y, ws.w, ws.h); }
    }
  return { map: tex(c), emissiveMap: tex(e) };
}
/** Windowless wall for interior (non-street) sides. */
export function makeBlankWall(variant: number) {
  const [c, g] = canvas(256, 256);
  paintWall(g, wallColor(variant), 256, 256, variant * 31 + 1);
  return tex(c);
}
function glassPane(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const grad = g.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, "#8caebd"); grad.addColorStop(0.5, "#456374"); grad.addColorStop(1, "#253e49");
  g.fillStyle = "#293738"; g.fillRect(x - 5, y - 5, w + 10, h + 10);
  g.fillStyle = grad; g.fillRect(x, y, w, h);
  g.fillStyle = "rgba(222,242,244,0.22)";
  g.beginPath(); g.moveTo(x + 8, y); g.lineTo(x + w * 0.5, y); g.lineTo(x + w * 0.25, y + h - 8); g.lineTo(x + 6, y + h - 8); g.fill();
}
/** Ground floor in the building's own wall colour: optional central double door plus moderate shop windows. */
export function makeGroundFloor(variant = 0, withDoor = true) {
  const [c, g] = canvas(1024, 256);
  paintWall(g, wallColor(variant), 1024, 256, variant * 17 + 5);
  const windows: [number, number][] = withDoor ? [[90, 230], [704, 230]] : [[80, 240], [392, 240], [704, 240]];
  for (const [x, w] of windows) glassPane(g, x, 60, w, 140);
  if (withDoor) {
    glassPane(g, 400, 40, 108, 210); glassPane(g, 516, 40, 108, 210);
    g.fillStyle = "#dce2dd"; g.fillRect(492, 130, 5, 40); g.fillRect(527, 130, 5, 40);
    g.fillStyle = "#293738"; g.fillRect(395, 30, 234, 8);
  }
  const [e, ge] = canvas(1024, 256);
  ge.fillStyle = "#000"; ge.fillRect(0, 0, 1024, 256); ge.fillStyle = "#fff";
  for (const [x, w] of windows) ge.fillRect(x, 60, w, 140);
  if (withDoor) { ge.fillRect(400, 40, 108, 210); ge.fillRect(516, 40, 108, 210); }
  const map = tex(c); map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  const emissiveMap = tex(e); emissiveMap.wrapS = emissiveMap.wrapT = THREE.ClampToEdgeWrapping;
  return { map, emissiveMap };
}
/** Small single wooden service door. */
export function makeBackDoor() {
  const [c, g] = canvas(128, 256);
  g.fillStyle = "#3d2a1a"; g.fillRect(0, 0, 128, 256);
  g.fillStyle = "#7a5233"; g.fillRect(8, 8, 112, 248);
  g.fillStyle = "rgba(0,0,0,0.18)";
  for (let y = 0; y < 256; y += 9) g.fillRect(8, y, 112, 1);
  g.strokeStyle = "#5a3b22"; g.lineWidth = 5; g.strokeRect(22, 24, 84, 90); g.strokeRect(22, 134, 84, 100);
  g.fillStyle = "#c9b27a"; g.beginPath(); g.arc(100, 138, 6, 0, Math.PI * 2); g.fill();
  const map = tex(c); map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  return map;
}

export function makeNoise(base: string, speck: string, repeat: number, grid?: string) {
  const r = rng(base.length * 31 + repeat);
  const [c, g] = canvas(256, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4000; i++) {
    g.globalAlpha = r() * 0.25;
    g.fillStyle = speck;
    g.fillRect(r() * 256, r() * 256, 2, 2);
  }
  g.globalAlpha = 1;
  if (grid) {
    g.strokeStyle = grid;
    g.lineWidth = 2;
    for (let i = 0; i <= 256; i += 64) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 256);
      g.moveTo(0, i);
      g.lineTo(256, i);
      g.stroke();
    }
  }
  return tex(c, repeat);
}

/** A tiled, individually shaded pebble surface; the ring uses world-space UVs. */
export function makePebbles() {
  const [c, g] = canvas(512, 512);
  const r = rng(2026);
  g.fillStyle = "#737976"; g.fillRect(0, 0, 512, 512);
  for (let row = -1; row < 33; row++) for (let col = -1; col < 33; col++) {
    const x = col * 16 + (row % 2) * 8 + r() * 4, y = row * 16 + r() * 4;
    const shade = Math.floor(150 + r() * 65);
    g.beginPath(); g.ellipse(x, y, 5 + r() * 3, 4 + r() * 3, r() * Math.PI, 0, Math.PI * 2);
    g.fillStyle = `rgb(${shade},${shade + 2},${shade - 5})`; g.fill();
    g.strokeStyle = "#626965"; g.lineWidth = 1; g.stroke();
  }
  return tex(c, 1);
}

/** Closed paired entrance leaves flanked by full-height storefront glazing. */

export function makeText(text: string, bg: string, fg: string, w = 512, h = 96) {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = `900 ${Math.floor(h * 0.68)}px Arial Black, Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeGlow() {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,210,140,0.9)");
  grad.addColorStop(0.5, "rgba(255,180,100,0.3)");
  grad.addColorStop(1, "rgba(255,160,80,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Box whose side UVs tile one facade texture per 8m x 12m (4 floors). */
export function buildingGeo(w: number, h: number, d: number) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes["uv"] as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++)
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      let u = uv.getX(idx);
      let v = uv.getY(idx);
      if (f === 2 || f === 3) {
        u = 0.02;
        v = 0.98;
      } else {
        u *= (f < 2 ? d : w) / 8;
        v *= h / 12;
      }
      uv.setXY(idx, u, v);
    }
  return geo;
}
