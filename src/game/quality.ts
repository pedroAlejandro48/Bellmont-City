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
};

export function qualitySettings(q: Quality): QualitySettings {
  const screen = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  if (q === "low") return { dpr: [0.55, 0.7], antialias: false, shadows: false, shadowMap: 512, far: 480, fogFar: 360, farCity: false, npcShare: 0.4, lampLights: 4, beams: 2 };
  if (q === "high") return { dpr: [1, Math.max(1.25, Math.min(2, screen))], antialias: true, shadows: true, shadowMap: 4096, far: 1200, fogFar: Infinity, farCity: true, npcShare: 1, lampLights: 12, beams: 8 };
  return { dpr: [1, 1.25], antialias: true, shadows: true, shadowMap: 2048, far: 1200, fogFar: Infinity, farCity: true, npcShare: 1, lampLights: 12, beams: 8 };
}

/** A guess for a browser that hasn't chosen: low on very weak devices, otherwise medium (as the game always was). */
export function guessQuality(): Quality {
  if (typeof navigator === "undefined") return "medium";
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if ((memory !== undefined && memory <= 2) || (navigator.hardwareConcurrency ?? 8) <= 2) return "low";
  return "medium";
}

let current: Quality | null = null;
export function readQuality(): Quality {
  if (current) return current;
  try { const v = localStorage.getItem(KEY); if (v === "low" || v === "medium" || v === "high") return (current = v); } catch { /* storage blocked */ }
  return (current = guessQuality());
}
export function saveQuality(q: Quality) {
  current = q;
  try { localStorage.setItem(KEY, q); } catch { /* storage blocked: kept for this visit */ }
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
