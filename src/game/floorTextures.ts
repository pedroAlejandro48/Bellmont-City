import * as THREE from "three";
import { rng } from "./config";
import { canvas, tex } from "./textures";

/**
 * Surfaces drawn once on canvases, each covering `size` metres square (a plane's UVs are scaled by its size over
 * that, so the planks, the carpet's weave and the tiles keep their real size on any floor).
 */

/** Wooden planks: 2 m square, planks 0.16 m wide in staggered lengths, each its own shade with grain and a seam. */
export function makePlanks() {
  const S = 1024, [c, g] = canvas(S, S), r = rng(91), px = S / 2;
  const rows = Math.round(2 / 0.16), h = S / rows;
  for (let j = 0; j < rows; j++) {
    let x = -r() * px * 1.2;
    while (x < S) {
      const len = px * (0.8 + r() * 0.9), l = 66 + r() * 10, hue = 30 + r() * 6, sat = 28 + r() * 10;
      g.fillStyle = `hsl(${hue} ${sat}% ${l * 0.62}%)`;
      g.fillRect(x, j * h, len, h);
      // Grain: long thin streaks, a knot now and then.
      for (let k = 0; k < 14; k++) {
        g.globalAlpha = 0.08 + r() * 0.12;
        g.strokeStyle = r() < 0.5 ? "#3d2414" : "#e0b88a";
        g.lineWidth = 0.6 + r() * 1.4;
        const y0 = j * h + r() * h;
        g.beginPath(); g.moveTo(x, y0);
        g.bezierCurveTo(x + len * 0.3, y0 + (r() - 0.5) * 6, x + len * 0.7, y0 + (r() - 0.5) * 6, x + len, y0 + (r() - 0.5) * 4);
        g.stroke();
      }
      if (r() < 0.25) { g.globalAlpha = 0.35; g.fillStyle = "#4a2c18"; g.beginPath(); g.ellipse(x + r() * len, j * h + h / 2, 5 + r() * 6, 3, 0, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 0.85; g.fillStyle = "#2b1a10"; g.fillRect(x, j * h, 2, h);
      g.globalAlpha = 1;
      x += len;
    }
    g.globalAlpha = 0.9; g.fillStyle = "#2b1a10"; g.fillRect(0, j * h, S, 2); g.globalAlpha = 1;
  }
  const t = tex(c); t.anisotropy = 8; return { map: t, size: 2 };
}

/** Carpet: 1 m square of fine fibres (tufts of lighter and darker), soft. */
export function makeCarpet(base = "#7c7368") {
  const S = 512, [c, g] = canvas(S, S), r = rng(37);
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26000; i++) {
    g.globalAlpha = 0.08 + r() * 0.14;
    g.fillStyle = r() < 0.5 ? "#3f3a33" : "#b6ab9c";
    const x = r() * S, y = r() * S;
    g.fillRect(x, y, 1 + r() * 1.5, 1 + r() * 1.5);
  }
  g.globalAlpha = 1;
  return { map: tex(c), size: 1 };
}

/**
 * Ceramic tiles: `n` × `n` tiles over `size` metres, each a slightly different shade with a soft bevel, in grout
 * lines; with a bump map from the same (the grout sunk in).
 */
export function makeTiles(color: string, grout: string, n: number, size: number, seed = 5) {
  const S = 1024, [c, g] = canvas(S, S), [bc, bg] = canvas(S, S), r = rng(seed), t = S / n, gw = Math.max(3, t * 0.05);
  const base = new THREE.Color(color);
  g.fillStyle = grout; g.fillRect(0, 0, S, S);
  bg.fillStyle = "#000"; bg.fillRect(0, 0, S, S);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = (r() - 0.5) * 0.06, col = base.clone().offsetHSL(0, 0, k);
    const x = i * t + gw / 2, y = j * t + gw / 2, w = t - gw;
    const grd = g.createLinearGradient(x, y, x + w, y + w);
    grd.addColorStop(0, `#${col.clone().offsetHSL(0, 0, 0.04).getHexString()}`);
    grd.addColorStop(1, `#${col.clone().offsetHSL(0, 0, -0.03).getHexString()}`);
    g.fillStyle = grd; g.fillRect(x, y, w, w);
    // A faint sheen across each.
    g.globalAlpha = 0.12; g.fillStyle = "#ffffff"; g.fillRect(x + w * 0.1, y + w * 0.08, w * 0.5, w * 0.06); g.globalAlpha = 1;
    bg.fillStyle = "#fff"; bg.fillRect(x + 1, y + 1, w - 2, w - 2);
  }
  const map = tex(c), bump = new THREE.CanvasTexture(bc);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  return { map, bump, size };
}

/** A soft dark blot (contact shadow) for under things standing on the floor. */
export function makeBlot() {
  const S = 128, [c, g] = canvas(S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, "rgba(0,0,0,0.55)"); grd.addColorStop(0.55, "rgba(0,0,0,0.3)"); grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); return t;
}

/** A plane geometry `w` × `h` whose UVs repeat a texture every `size` metres. */
export function scaledPlane(w: number, h: number, size: number) {
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / size, uv.getY(i) * h / size);
  return geo;
}
