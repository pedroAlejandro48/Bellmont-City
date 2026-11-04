// Traffic law (pure): the speed limit and red lights for anyone riding, and what each ticket costs.
import { MPH_TO_MPS, SIGNALLED, signalState, streetHalfWidth } from "./config";

export const SPEED_LIMIT_MPH = 30;
/** A ticket only past this (a little grace over the limit), held for SPEEDING_HOLD seconds. */
export const SPEEDING_MPH = 37;
export const SPEEDING_HOLD = 1.5;
/** At most one ticket of each kind this often (seconds). */
export const TICKET_COOLDOWN = 45;
export const FINE = { speeding: 35, redLight: 50 } as const;

/** The signalled intersection (its index in SIGNALLED) whose box (x, z) is inside, or -1. */
export function intersectionAt(x: number, z: number) {
  for (let i = 0; i < SIGNALLED.length; i++) {
    const [ix, iz] = SIGNALLED[i]!;
    if (Math.abs(x - ix) <= streetHalfWidth(ix) && Math.abs(z - iz) <= streetHalfWidth(iz)) return i;
  }
  return -1;
}

/**
 * Whether riding into intersection `i` moving (vx, vz) runs its red light. Moving along x is governed by the
 * light for x; a near-standstill (or turning slowly) never counts.
 */
export function runsRed(i: number, vx: number, vz: number, elapsed: number) {
  if (i < 0 || Math.hypot(vx, vz) < 3) return false;
  return signalState(Math.abs(vx) >= Math.abs(vz) ? "x" : "z", elapsed) === "red";
}

/** Tracks one rider over time; returns the ticket to write this step, if any. */
export type Watch = { over: number; lastSpeeding: number; lastRed: number; inside: number };
export const newWatch = (): Watch => ({ over: 0, lastSpeeding: -1e9, lastRed: -1e9, inside: -1 });
export function watchRider(w: Watch, now: number, dt: number, x: number, z: number, vx: number, vz: number, elapsed: number): { kind: "speeding" | "redLight"; mph: number } | null {
  const mph = Math.hypot(vx, vz) / MPH_TO_MPS;
  w.over = mph > SPEEDING_MPH ? w.over + dt : 0;
  const i = intersectionAt(x, z), entered = i >= 0 && i !== w.inside;
  w.inside = i;
  if (entered && runsRed(i, vx, vz, elapsed) && now - w.lastRed > TICKET_COOLDOWN) { w.lastRed = now; return { kind: "redLight", mph }; }
  if (w.over >= SPEEDING_HOLD && now - w.lastSpeeding > TICKET_COOLDOWN) { w.lastSpeeding = now; w.over = 0; return { kind: "speeding", mph }; }
  return null;
}
