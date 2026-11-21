/**
 * The backdrop of every page before the game: the park at night (the moon) or by day (the sun, 10 am), as the
 * theme setting says (lib/theme.ts) — the same scene as the site icon (the obelisk, the park's grass and path,
 * and a bike up close in the corner, all drawn flat), without the B.
 *
 * It is drawn here, at the exact size and pixel density of the screen, so nothing is cropped or blurred on any
 * shape of screen: the scene is laid out in a 512-unit square (the icon's), scaled to the screen's shorter side,
 * with the obelisk kept to the left, the moon and the bike to the right, and the extra width or height filled
 * with sky and ground. The result goes to `--city-bg` on the page root, which `.auth-bg` uses; a pre-rendered
 * picture stands in until it is ready.
 */

import { backdropTime, onThemeChange } from "@/lib/theme";

const S = 512;

function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The game's moon surface (as Sky.tsx draws it), at four times the detail. */
function moonTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 2048;
  const m = c.getContext("2d")!;
  m.scale(4, 4);
  m.fillStyle = "#d9dde3"; m.fillRect(0, 0, 512, 512);
  const r = rng(11);
  for (let i = 0; i < 9; i++) {
    const x = 80 + r() * 352, y = 120 + r() * 272, rad = 30 + r() * 70;
    const sea = m.createRadialGradient(x, y, 0, x, y, rad);
    sea.addColorStop(0, "rgba(120,126,138,0.55)"); sea.addColorStop(1, "rgba(120,126,138,0)");
    m.fillStyle = sea; m.beginPath(); m.ellipse(x, y, rad * 1.4, rad, r() * 3, 0, Math.PI * 2); m.fill();
  }
  for (let i = 0; i < 140; i++) {
    const x = r() * 512, y = 40 + r() * 432, rad = 2 + r() ** 3 * 22;
    m.fillStyle = "rgba(90,96,108,0.35)"; m.beginPath(); m.arc(x, y, rad, 0, Math.PI * 2); m.fill();
    m.strokeStyle = "rgba(255,255,255,0.35)"; m.lineWidth = Math.max(1, rad * 0.18);
    m.beginPath(); m.arc(x - rad * 0.15, y - rad * 0.15, rad, Math.PI * 0.9, Math.PI * 1.7); m.stroke();
  }
  for (let i = 0; i < 4000; i++) { m.fillStyle = `rgba(0,0,0,${r() * 0.06})`; m.fillRect(r() * 512, r() * 512, 0.5, 0.5); }
  return c;
}

let moon: HTMLCanvasElement | null = null;

/** Day (the park at 10 am, the sun up) or night (the moon, the park lit from the ground). */
export type BackdropTime = "day" | "night";

type Ctx = CanvasRenderingContext2D;

/**
 * The bike in the corner, drawn flat like the obelisk (cel-shaded: each part a base colour with a shadow
 * crescent on the left and a lit side on the right, light from the right), in its own 1024 × 840 frame: the same
 * scooter, size and angle as the game's model seen from the front left.
 */
function drawBike(g: Ctx, day: boolean) {
  const P = day
    ? { body: "#1f8a7d", bodyLit: "#38b3a2", bodyShade: "#13605a", hi: "#a6eadf",
        black: "#2a2d33", blackLit: "#454a52", blackShade: "#17191d",
        chrome: "#c9ced6", chromeLit: "#f2f4f7", chromeShade: "#8a909b",
        hub: "#9aa2ae", hubShade: "#6c7480", lens: "#f4f1e6", lensShade: "#d4d0c2",
        floor: "#18675f", floorShade: "#10463f", pipe: "#7d8796", pipeShade: "#59616d", tail: "#d8443a" }
    : { body: "#0f5a57", bodyLit: "#1c7d76", bodyShade: "#093b3b", hi: "#6fc9bd",
        black: "#14161b", blackLit: "#2a2e36", blackShade: "#08090c",
        chrome: "#8e95a2", chromeLit: "#cfd4dc", chromeShade: "#5a6170",
        hub: "#5c6578", hubShade: "#3d4556", lens: "#fffaf0", lensShade: "#fffaf0",
        floor: "#0b4447", floorShade: "#072e31", pipe: "#4b556b", pipeShade: "#333b4d", tail: "#c0392b" };

  /**
   * A part shaped `path`: its base colour; the shadow is the part not covered by itself moved right and up
   * (a crescent on the left and bottom), the lit rim the part not covered by itself moved left and down.
   */
  const part = (path: (g: Ctx) => void, base: string, shade: string, lit: string, sx: number, sy: number) => {
    g.fillStyle = base; g.beginPath(); path(g); g.fill();
    const cut = (col: string, dx: number, dy: number) => {
      g.save(); g.beginPath(); path(g); g.clip();
      g.beginPath(); g.rect(-2000, -2000, 5000, 5000);
      g.translate(dx, dy); path(g); g.fillStyle = col; g.fill("evenodd"); g.restore();
    };
    cut(shade, sx, -sy);
    if (lit !== base) cut(lit, -sx * 0.35, sy * 0.25);
  };
  const ell = (x: number, y: number, rx: number, ry: number, rot = 0) => (g: Ctx) => g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  const poly = (...pts: number[]) => (g: Ctx) => { g.moveTo(pts[0]!, pts[1]!); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!); g.closePath(); };
  const rod = (x1: number, y1: number, x2: number, y2: number, w: number) => {
    const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy), nx = -dy / l * w / 2, ny = dx / l * w / 2;
    return poly(x1 + nx, y1 + ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny);
  };
  const flat = (path: (g: Ctx) => void, col: string) => { g.fillStyle = col; g.beginPath(); path(g); g.fill(); };
  /** A chrome rod: dark left half, bright right edge. */
  const chromeRod = (x1: number, y1: number, x2: number, y2: number, w: number) => {
    flat(rod(x1, y1, x2, y2, w), P.chromeShade);
    flat(rod(x1 + w * 0.22, y1, x2 + w * 0.22, y2, w * 0.5), P.chrome);
    flat(rod(x1 + w * 0.3, y1, x2 + w * 0.3, y2, w * 0.18), P.chromeLit);
  };

  // Behind: the rear body, its tail light, the exhaust, the floorboard and the seat.
  part(poly(640, 800, 872, 803, 878, 840, 640, 840), P.pipe, P.pipeShade, P.chrome, 10, 8);
  flat(poly(800, 682, 822, 680, 824, 702, 806, 704), P.tail);
  part(ell(650, 722, 190, 92, -0.02), P.body, P.bodyShade, P.bodyLit, 34, 22);
  flat(ell(640, 690, 40, 13, -0.05), P.hi);
  part(poly(380, 764, 652, 772, 652, 826, 380, 822), P.floor, P.floorShade, P.floor, 30, 0);
  part(ell(612, 598, 170, 42, 0.03), P.black, P.blackShade, P.blackLit, 24, 12);

  // The front wheel: tyre and hub, mostly hidden below the frame.
  part(ell(222, 812, 118, 128), P.black, P.blackShade, P.blackLit, 22, 6);
  part(ell(250, 832, 66, 78), P.hub, P.hubShade, P.chrome, 14, 6);

  // The leg shield, tall and round.
  part(ell(352, 606, 100, 240, 0.07), P.body, P.bodyShade, P.bodyLit, 40, 18);
  flat(ell(386, 580, 14, 70, 0.12), P.hi);

  // The fork, in front of the wheel and shield.
  chromeRod(248, 500, 212, 692, 18);
  chromeRod(312, 488, 252, 840, 20);

  // Handlebars and grips, the mirrors on their stems.
  part(rod(195, 445, 240, 435, 36), P.black, P.blackShade, P.blackLit, 8, 6);
  chromeRod(378, 393, 418, 386, 16);
  part(rod(418, 380, 482, 371, 42), P.black, P.blackShade, P.blackLit, 10, 8);
  flat(ell(484, 371, 9, 20, 0.15), P.blackShade);
  chromeRod(218, 330, 228, 368, 8);
  chromeRod(452, 248, 420, 372, 9);
  part(ell(209, 304, 25, 36, 0.1), P.chrome, P.chromeShade, P.chromeLit, 8, 6);
  part(ell(466, 212, 34, 42, 0.32), P.chrome, P.chromeShade, P.chromeLit, 10, 8);

  // The headlamp housing and its lens.
  part(ell(330, 404, 70, 58, -0.12), P.body, P.bodyShade, P.bodyLit, 22, 12);
  flat(ell(352, 380, 14, 7, -0.3), P.hi);
  part(ell(248, 394, 35, 50, 0.05), P.lens, P.lensShade, P.lens, 8, 4);
}

function draw(W: number, H: number, time: BackdropTime) {
  const day = time === "day";
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const sc = Math.min(W, H) / S, WL = W / sc, OY = H / sc - S;
  g.scale(sc, sc); g.translate(0, OY);
  const px = 1 / sc;
  const GY = 438;

  // The sky: night blue with stars, or a clear 10 am sky, deep blue on top paling to near white at the horizon.
  const sky = g.createLinearGradient(0, -OY, 0, GY);
  if (day) { sky.addColorStop(0, "#2f78d0"); sky.addColorStop(0.45, "#69a6e6"); sky.addColorStop(0.8, "#b9d9f5"); sky.addColorStop(1, "#eaf4fc"); }
  else { sky.addColorStop(0, "#0b1230"); sky.addColorStop(0.6, "#1a2756"); sky.addColorStop(1, "#2a3a6e"); }
  g.fillStyle = sky; g.fillRect(0, -OY, WL, S + OY);
  let r = rng(5);
  if (!day) for (let i = 0; i < 90 * WL / S * (300 + OY) / 300; i++) {
    g.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.5})`;
    g.beginPath(); g.arc(r() * WL, -OY + r() * (300 + OY), (0.8 + r() * 1.4) * 1.6 * px, 0, 7); g.fill();
  }

  // The moon in its halo, or the sun in its glare, at the top right.
  const MX = WL - 100, MY = 104, MR = 58;
  if (day) {
    const glare = g.createRadialGradient(MX, MY, 0, MX, MY, MR * 4.5);
    glare.addColorStop(0, "rgba(255,255,240,0.9)"); glare.addColorStop(0.18, "rgba(255,252,225,0.6)");
    glare.addColorStop(0.45, "rgba(255,250,225,0.18)"); glare.addColorStop(1, "rgba(255,250,230,0)");
    g.fillStyle = glare; g.fillRect(MX - MR * 4.5, MY - MR * 4.5, MR * 9, MR * 9);
    const SR = MR * 0.72;
    const disc = g.createRadialGradient(MX, MY, 0, MX, MY, SR);
    disc.addColorStop(0, "#ffffff"); disc.addColorStop(0.75, "#fffbe6"); disc.addColorStop(1, "#fff2b8");
    g.fillStyle = disc; g.beginPath(); g.arc(MX, MY, SR, 0, 7); g.fill();
  } else {
    const h = g.createRadialGradient(MX, MY, 0, MX, MY, MR * 2.3);
    h.addColorStop(0, "rgba(220,230,255,0.75)"); h.addColorStop(0.3, "rgba(200,215,255,0.38)"); h.addColorStop(0.6, "rgba(180,200,255,0.1)"); h.addColorStop(1, "rgba(170,190,255,0)");
    g.fillStyle = h; g.fillRect(MX - MR * 2.3, MY - MR * 2.3, MR * 4.6, MR * 4.6);
    moon ??= moonTexture();
    g.save(); g.beginPath(); g.arc(MX, MY, MR, 0, 7); g.clip();
    g.drawImage(moon, 256, 256, 1536, 1536, MX - MR, MY - MR, MR * 2, MR * 2);
    const shade = g.createRadialGradient(MX - MR * 0.3, MY - MR * 0.3, MR * 0.2, MX, MY, MR);
    shade.addColorStop(0, "rgba(255,255,255,0.12)"); shade.addColorStop(1, "rgba(40,50,80,0.35)");
    g.fillStyle = shade; g.fillRect(MX - MR, MY - MR, MR * 2, MR * 2); g.restore();
  }

  // The park's grass with the gravel path across it.
  g.fillStyle = day ? "#5b9a3a" : "#2b4a22"; g.fillRect(0, GY, WL, S - GY);
  r = rng(9);
  const grass: [string, string] = day ? ["rgba(132,186,88,0.55)", "rgba(52,96,34,0.5)"] : ["rgba(79,122,58,0.5)", "rgba(20,36,16,0.5)"];
  for (let i = 0; i < 500 * WL / S * sc * 1.2; i++) { g.fillStyle = r() < 0.5 ? grass[0] : grass[1]; g.fillRect(r() * WL, GY + r() * 80, 2.5 * px, 2.5 * px); }
  g.fillStyle = day ? "#c4bdac" : "#7d796f"; g.beginPath(); g.moveTo(0, GY + 22); g.lineTo(WL, GY + 18); g.lineTo(WL, GY + 44); g.lineTo(0, GY + 50); g.fill();
  r = rng(3);
  const grit: [string, string] = day ? ["rgba(230,225,212,0.65)", "rgba(150,143,128,0.6)"] : ["rgba(168,164,156,0.6)", "rgba(90,86,80,0.6)"];
  for (let i = 0; i < 400 * WL / S * sc * 1.5; i++) { g.fillStyle = r() < 0.5 ? grit[0] : grit[1]; g.fillRect(r() * WL, GY + 20 + r() * 28, 2 * px, 2 * px); }
  g.fillStyle = day ? "rgba(30,60,20,0.25)" : "rgba(0,0,0,0.25)"; g.fillRect(0, GY, WL, 3);

  // The obelisk on the left, to scale, its tip level with the moon/sun: lit on its right face, shaded on its left.
  // At night floodlights at its foot light it; by day the sun does, from the upper right, so it casts a shadow left.
  const OX = 74, base = GY + 20, PX = (base - MY) / 8.95;
  const y = (m: number) => base - m * PX;
  if (day) {
    const foot = g.createRadialGradient(OX - 0.9 * PX, base - 2, 0, OX - 0.9 * PX, base - 2, 2.4 * PX);
    foot.addColorStop(0, "rgba(30,55,20,0.38)"); foot.addColorStop(0.6, "rgba(30,55,20,0.22)"); foot.addColorStop(1, "rgba(30,55,20,0)");
    g.save(); g.translate(0, base - 2); g.scale(1, 0.22); g.translate(0, -(base - 2));
    g.fillStyle = foot; g.fillRect(OX - 3.4 * PX, base - 2 - 2.4 * PX, 5 * PX, 4.8 * PX); g.restore();
  } else {
    const glow = g.createRadialGradient(OX, base, 0, OX, base, 90);
    glow.addColorStop(0, "rgba(255,200,120,0.45)"); glow.addColorStop(1, "rgba(255,200,120,0)");
    g.fillStyle = glow; g.fillRect(OX - 90, base - 90, 180, 180);
  }
  g.fillStyle = day ? "#b9bcb1" : "#7e8279"; g.fillRect(OX - 1.25 * PX, y(0.55), 2.5 * PX, 0.4 * PX);
  g.fillStyle = day ? "#93968b" : "#6a6e66"; g.fillRect(OX - 1.25 * PX, y(0.55) + 0.3 * PX, 2.5 * PX, 0.1 * PX);
  if (day) { g.fillStyle = "#d8dacf"; g.fillRect(OX, y(0.55), 1.25 * PX, 0.3 * PX); }
  const bw = 0.85, tw = 0.5, sb = y(0.55), st = y(9 - 0.95);
  const face = (side: number, col: CanvasGradient) => { g.fillStyle = col; g.beginPath(); g.moveTo(OX, sb); g.lineTo(OX + side * bw * PX, sb); g.lineTo(OX + side * tw * PX, st); g.lineTo(OX, st); g.fill(); };
  const lit = g.createLinearGradient(0, sb, 0, st), dark = g.createLinearGradient(0, sb, 0, st);
  if (day) {
    lit.addColorStop(0, "#ece6d6"); lit.addColorStop(0.5, "#f2eee2"); lit.addColorStop(1, "#faf7ee");
    dark.addColorStop(0, "#a7a495"); dark.addColorStop(0.5, "#b2b0a4"); dark.addColorStop(1, "#bcbbb2");
  } else {
    lit.addColorStop(0, "#d8cdb0"); lit.addColorStop(0.5, "#a9aa9f"); lit.addColorStop(1, "#7e837b");
    dark.addColorStop(0, "#9c927c"); dark.addColorStop(0.5, "#6e726b"); dark.addColorStop(1, "#4f5550");
  }
  face(1, lit); face(-1, dark);
  g.fillStyle = day ? "#fbf9f2" : "#9da096"; g.beginPath(); g.moveTo(OX + tw * PX, st); g.lineTo(OX, st - 0.9 * PX); g.lineTo(OX, st); g.fill();
  g.fillStyle = day ? "#b4b2a7" : "#5c625c"; g.beginPath(); g.moveTo(OX - tw * PX, st); g.lineTo(OX, st - 0.9 * PX); g.lineTo(OX, st); g.fill();
  g.fillStyle = day ? "#8d8f86" : "#fff3c4"; for (const d of [-1.5, 1.5]) { g.beginPath(); g.ellipse(OX + d * PX, base + 3, 5, 2, 0, 0, 7); g.fill(); }

  // The bike up close in the bottom-right corner; at night its headlight glows, by day it casts a shadow left.
  const k = 0.24, bx = WL - 172, by = S - 840 * k;
  if (day) {
    g.fillStyle = "rgba(30,55,20,0.3)";
    g.beginPath(); g.ellipse(bx + 470 * k, S - 4, 300 * k, 26 * k, 0, 0, 7); g.fill();
  } else {
    const head = g.createRadialGradient(bx + 247 * k, by + 395 * k, 0, bx + 247 * k, by + 395 * k, 70);
    head.addColorStop(0, "rgba(255,240,203,0.55)"); head.addColorStop(1, "rgba(255,240,203,0)");
    g.fillStyle = head; g.fillRect(bx + 270 * k - 70, by + 365 * k - 70, 140, 140);
  }
  g.save(); g.translate(bx, by); g.scale(k, k); drawBike(g, day); g.restore();
  return c;
}

let url: string | null = null;
let drawn = "";

/** Draws the backdrop for the current window, and again whenever its size changes. */
/**
 * Where the obelisk's base ends on a screen of this size (CSS px from the left): the scene's 512-unit square is
 * scaled to the shorter side, and the obelisk's pedestal reaches 123 units across (OX 74 + 1.25 m at its scale).
 */
export function obeliskRight(width: number, height: number) {
  return 123 * (Math.min(width, height) / S);
}

/** The backdrop drawn for a screen of W × H real pixels (also used to make the pre-rendered pictures). */
export const drawBackdrop = draw;

export function startCityBackdrop() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  let timer = 0;
  const render = () => {
    // Real pixels for a sharp picture, within what canvases handle well.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let W = Math.round(window.innerWidth * dpr), H = Math.round(window.innerHeight * dpr);
    const fit = Math.min(1, 4096 / Math.max(W, H));
    W = Math.max(1, Math.round(W * fit)); H = Math.max(1, Math.round(H * fit));
    const time = backdropTime();
    const key = `${W}x${H}:${time}`;
    if (key === drawn) return;
    drawn = key;
    try {
      draw(W, H, time).toBlob((blob) => {
        if (!blob || drawn !== key) return;
        const next = URL.createObjectURL(blob);
        document.documentElement.style.setProperty("--city-bg", `url("${next}")`);
        if (url) URL.revokeObjectURL(url);
        url = next;
      }, "image/png");
    } catch { /* keep the pre-rendered picture */ }
  };
  render();
  onThemeChange(() => { document.documentElement.style.removeProperty("--city-bg"); render(); });
  window.addEventListener("resize", () => { window.clearTimeout(timer); timer = window.setTimeout(render, 200); });
}
