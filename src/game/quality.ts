/**
 * Device speed (graphics quality), chosen on the pages before the game and kept in this browser.
 *
 * - low: for slow devices — a lower drawing resolution, no shadows, no distant skyline (less memory), a shorter
 *   view, fewer people about and fewer real lights.
 * - medium: the game as it has always looked.
 * - high: the screen's full sharpness and finer shadows, for fast devices.
 *
 * It is read when a game starts, so changing it takes effect the next time a city loads.
 */
export type Quality = "low" | "medium" | "high";
export const QUALITIES: readonly Quality[] = ["low", "medium", "high"];
const KEY = "bellmont-quality";

export type QualitySettings = {
  /** Drawing resolution, as a range of device pixel ratios. */
  dpr: [number, number];
  antialias: boolean;
  shadows: boolean;
  shadowMap: number;
  /** How far the camera sees (m), and the fog's furthest reach. */
  far: number;
  fogFar: number;
  /** The rest of the city beyond the streamed neighbourhood (the skyline, lit at night). */
  farCity: boolean;
  /** Share of the usual number of people out walking. */
  npcShare: number;
  /** Real lights following the nearest street lamps, and the nearest vehicles' headlight spotlights. */
  lampLights: number;
  beams: number;
  /** Image-based reflections on materials. */
  environment: boolean;
  /** How far things are drawn in full (people, vehicle detail, restaurant interiors, staff), as a share of Medium's. */
  detail: number;
};

export function qualitySettings(q: Quality): QualitySettings {
  const screen = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  if (q === "low") return { dpr: [0.55, 0.7], antialias: false, shadows: false, shadowMap: 512, far: 480, fogFar: 360, farCity: false, npcShare: 0.4, lampLights: 4, beams: 2, environment: false, detail: 0.6 };
  if (q === "high") return { dpr: [1, Math.max(1.25, Math.min(2, screen))], antialias: true, shadows: true, shadowMap: 4096, far: 1200, fogFar: Infinity, farCity: true, npcShare: 1, lampLights: 12, beams: 8, environment: true, detail: 1 };
  return { dpr: [1, 1.25], antialias: true, shadows: true, shadowMap: 2048, far: 1200, fogFar: Infinity, farCity: true, npcShare: 1, lampLights: 8, beams: 4, environment: true, detail: 1 };
}

/**
 * Whether the browser is drawing without the graphics card (software rendering: Chrome or Edge with graphics
 * acceleration turned off or blocked fall back to it, and everything 3D is many times slower).
 */
let software: boolean | null = null;
export function softwareRendering(): boolean {
  if (software !== null) return software;
  software = false;
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) { software = true; return software; }
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
    software = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(name);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch { /* unknown: assume the graphics card */ }
  return software;
}

/** A guess for a browser that hasn't chosen: low on very weak devices, otherwise medium (as the game always was). */
export function guessQuality(): Quality {
  if (typeof navigator === "undefined") return "medium";
  if (softwareRendering()) return "low";
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if ((memory !== undefined && memory <= 2) || (navigator.hardwareConcurrency ?? 8) <= 2) return "low";
  return "medium";
}

/** Set by the game itself when it found this device too slow (only when nobody chose). */
const AUTO_KEY = "bellmont-quality-auto";
const valid = (v: string | null): v is Quality => v === "low" || v === "medium" || v === "high";
let current: Quality | null = null;
export function readQuality(): Quality {
  if (current) return current;
  try {
    const v = localStorage.getItem(KEY); if (valid(v)) return (current = v);
    const auto = localStorage.getItem(AUTO_KEY); if (valid(auto)) return (current = auto);
  } catch { /* storage blocked */ }
  return (current = guessQuality());
}
/** Whether someone picked the device speed in this browser (the game then never changes it by itself). */
export function qualityChosen() {
  try { return valid(localStorage.getItem(KEY)); } catch { return false; }
}
export function saveQuality(q: Quality) {
  current = q;
  try { localStorage.setItem(KEY, q); } catch { /* storage blocked: kept for this visit */ }
}
/** The game found this device too slow and dropped to Low: remembered for next time (as its own guess). */
export function autoLowerQuality() {
  current = "low";
  try { localStorage.setItem(AUTO_KEY, "low"); } catch { /* kept for this visit */ }
}
/** The settings for the game being played (fixed when it starts). */
let active: QualitySettings | null = null;
export function startQuality() {
  active = qualitySettings(readQuality());
  // Test builds: individual settings can be overridden for checks.
  if (import.meta.env["VITE_TRAFFIC_AUDIT"] === "1") { try { Object.assign(active, JSON.parse(localStorage.getItem("bellmont-quality-test") ?? "{}")); } catch { /* none */ } }
  return active;
}
export function quality(): QualitySettings { return active ?? startQuality(); }
