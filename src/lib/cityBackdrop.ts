/**
 * The backdrop of every page before the game: the park at night, the same scene as the site icon (the obelisk,
 * the moon, the park's grass and path, and a bike up close in the corner), without the B.
 *
 * It is drawn here, at the exact size and pixel density of the screen, so nothing is cropped or blurred on any
 * shape of screen: the scene is laid out in a 512-unit square (the icon's), scaled to the screen's shorter side,
 * with the obelisk kept to the left, the moon and the bike to the right, and the extra width or height filled
 * with sky and ground. The result goes to `--city-bg` on the page root, which `.auth-bg` uses; a pre-rendered
 * picture stands in until it is ready.
 */

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

function draw(W: number, H: number, bike: HTMLImageElement) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const sc = Math.min(W, H) / S, WL = W / sc, OY = H / sc - S;
  g.scale(sc, sc); g.translate(0, OY);
  const px = 1 / sc;

  // The night sky and its stars.
  const sky = g.createLinearGradient(0, -OY, 0, S);
  sky.addColorStop(0, "#0b1230"); sky.addColorStop(0.6, "#1a2756"); sky.addColorStop(1, "#2a3a6e");
  g.fillStyle = sky; g.fillRect(0, -OY, WL, S + OY);
  let r = rng(5);
  for (let i = 0; i < 90 * WL / S * (300 + OY) / 300; i++) {
    g.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.5})`;
    g.beginPath(); g.arc(r() * WL, -OY + r() * (300 + OY), (0.8 + r() * 1.4) * 1.6 * px, 0, 7); g.fill();
  }

  // The moon, in its halo, at the top right.
  const MX = WL - 100, MY = 104, MR = 58;
  const h = g.createRadialGradient(MX, MY, 0, MX, MY, MR * 2.3);
  h.addColorStop(0, "rgba(220,230,255,0.75)"); h.addColorStop(0.3, "rgba(200,215,255,0.38)"); h.addColorStop(0.6, "rgba(180,200,255,0.1)"); h.addColorStop(1, "rgba(170,190,255,0)");
  g.fillStyle = h; g.fillRect(MX - MR * 2.3, MY - MR * 2.3, MR * 4.6, MR * 4.6);
  moon ??= moonTexture();
  g.save(); g.beginPath(); g.arc(MX, MY, MR, 0, 7); g.clip();
  g.drawImage(moon, 256, 256, 1536, 1536, MX - MR, MY - MR, MR * 2, MR * 2);
  const shade = g.createRadialGradient(MX - MR * 0.3, MY - MR * 0.3, MR * 0.2, MX, MY, MR);
  shade.addColorStop(0, "rgba(255,255,255,0.12)"); shade.addColorStop(1, "rgba(40,50,80,0.35)");
  g.fillStyle = shade; g.fillRect(MX - MR, MY - MR, MR * 2, MR * 2); g.restore();

  // The park's grass with the gravel path across it.
  const GY = 438;
  g.fillStyle = "#2b4a22"; g.fillRect(0, GY, WL, S - GY);
  r = rng(9);
  for (let i = 0; i < 500 * WL / S * sc * 1.2; i++) { g.fillStyle = r() < 0.5 ? "rgba(79,122,58,0.5)" : "rgba(20,36,16,0.5)"; g.fillRect(r() * WL, GY + r() * 80, 2.5 * px, 2.5 * px); }
  g.fillStyle = "#7d796f"; g.beginPath(); g.moveTo(0, GY + 22); g.lineTo(WL, GY + 18); g.lineTo(WL, GY + 44); g.lineTo(0, GY + 50); g.fill();
  r = rng(3);
  for (let i = 0; i < 400 * WL / S * sc * 1.5; i++) { g.fillStyle = r() < 0.5 ? "rgba(168,164,156,0.6)" : "rgba(90,86,80,0.6)"; g.fillRect(r() * WL, GY + 20 + r() * 28, 2 * px, 2 * px); }
  g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(0, GY, WL, 3);

  // The obelisk on the left, to scale, its tip level with the moon, lit from the ground.
  const OX = 74, base = GY + 20, PX = (base - MY) / 8.95;
  const y = (m: number) => base - m * PX;
  const glow = g.createRadialGradient(OX, base, 0, OX, base, 90);
  glow.addColorStop(0, "rgba(255,200,120,0.45)"); glow.addColorStop(1, "rgba(255,200,120,0)");
  g.fillStyle = glow; g.fillRect(OX - 90, base - 90, 180, 180);
  g.fillStyle = "#7e8279"; g.fillRect(OX - 1.25 * PX, y(0.55), 2.5 * PX, 0.4 * PX);
  g.fillStyle = "#6a6e66"; g.fillRect(OX - 1.25 * PX, y(0.55) + 0.3 * PX, 2.5 * PX, 0.1 * PX);
  const bw = 0.85, tw = 0.5, sb = y(0.55), st = y(9 - 0.95);
  const face = (side: number, col: CanvasGradient) => { g.fillStyle = col; g.beginPath(); g.moveTo(OX, sb); g.lineTo(OX + side * bw * PX, sb); g.lineTo(OX + side * tw * PX, st); g.lineTo(OX, st); g.fill(); };
  const lit = g.createLinearGradient(0, sb, 0, st); lit.addColorStop(0, "#d8cdb0"); lit.addColorStop(0.5, "#a9aa9f"); lit.addColorStop(1, "#7e837b"); face(-1, lit);
  const dark = g.createLinearGradient(0, sb, 0, st); dark.addColorStop(0, "#9c927c"); dark.addColorStop(0.5, "#6e726b"); dark.addColorStop(1, "#4f5550"); face(1, dark);
  g.fillStyle = "#9da096"; g.beginPath(); g.moveTo(OX - tw * PX, st); g.lineTo(OX, st - 0.9 * PX); g.lineTo(OX, st); g.fill();
  g.fillStyle = "#5c625c"; g.beginPath(); g.moveTo(OX + tw * PX, st); g.lineTo(OX, st - 0.9 * PX); g.lineTo(OX, st); g.fill();
  g.fillStyle = "#fff3c4"; for (const d of [-1.5, 1.5]) { g.beginPath(); g.ellipse(OX + d * PX, base + 3, 5, 2, 0, 0, 7); g.fill(); }

  // The game's bike, up close in the bottom-right corner (a 3D render of its model), its headlight glowing.
  const k = 0.24, bx = WL - 172, by = S - 840 * k;
  const head = g.createRadialGradient(bx + 247 * k, by + 395 * k, 0, bx + 247 * k, by + 395 * k, 70);
  head.addColorStop(0, "rgba(255,240,203,0.55)"); head.addColorStop(1, "rgba(255,240,203,0)");
  g.fillStyle = head; g.fillRect(bx + 270 * k - 70, by + 365 * k - 70, 140, 140);
  g.drawImage(bike, 0, 0, bike.naturalWidth, bike.naturalHeight, bx, by, 1024 * k, 840 * k);
  return c;
}

let url: string | null = null;
let drawn = "";

/** Draws the backdrop for the current window, and again whenever its size changes. */
export function startCityBackdrop() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const bike = new Image();
  bike.decoding = "async";
  bike.src = "/bike-hero.webp";
  let timer = 0;
  const render = () => {
    if (!bike.complete || !bike.naturalWidth) return;
    // Real pixels for a sharp picture, within what canvases handle well.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let W = Math.round(window.innerWidth * dpr), H = Math.round(window.innerHeight * dpr);
    const fit = Math.min(1, 4096 / Math.max(W, H));
    W = Math.max(1, Math.round(W * fit)); H = Math.max(1, Math.round(H * fit));
    const key = `${W}x${H}`;
    if (key === drawn) return;
    drawn = key;
    try {
      draw(W, H, bike).toBlob((blob) => {
        if (!blob) return;
        const next = URL.createObjectURL(blob);
        document.documentElement.style.setProperty("--city-bg", `url("${next}")`);
        if (url) URL.revokeObjectURL(url);
        url = next;
      }, "image/png");
    } catch { /* keep the pre-rendered picture */ }
  };
  bike.onload = render;
  window.addEventListener("resize", () => { window.clearTimeout(timer); timer = window.setTimeout(render, 200); });
}
