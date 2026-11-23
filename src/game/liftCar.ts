// An apartment building's elevator car (pure): where it is (in floors, 1 = the lobby), which way it's going, the
// floors it has been asked to stop at (from its buttons inside and the call buttons outside), and its doors. It
// keeps going one way while anyone wants a floor that way, then turns round for the rest; at each stop the doors
// stay open 8 s, and then until nobody has stood in the doorway for a second. It runs the same with or without
// anyone in it. Up to three people ride at once (players and residents alike).
import { floorY } from "./apartments";

/** Top speed: 2 s a floor. It speeds up and slows down at LIFT_ACCEL (floors/s²), arriving gently, not with a jolt. */
export const LIFT_SPEED = 0.5, LIFT_ACCEL = 0.9, DOOR_T = 0.8, DWELL = 8, PRESSED_DWELL = 2.5, CLEAR = 1, CAPACITY = 4;
export type CarPhase = "idle" | "moving" | "opening" | "open" | "closing";
export type Car = { y: number; dir: -1 | 0 | 1; stops: number[]; phase: CarPhase; t: number; dwell: number; clear: number; v?: number };
export const newCar = (): Car => ({ y: 1, dir: 0, stops: [], phase: "idle", t: 0, dwell: 0, clear: 0, v: 0 });
/**
 * One step of travel toward `next`: speeding up from a stop, at most LIFT_SPEED, and slowing so it comes to rest
 * exactly at the floor (the speed it could still brake from over the distance left). True once it's there.
 */
function travel(c: Car, next: number, dt: number) {
  const left = Math.abs(next - c.y);
  const brake = Math.sqrt(2 * LIFT_ACCEL * left);
  const want = Math.max(0.04, Math.min(LIFT_SPEED, brake));
  const v = c.v ?? 0;
  c.v = v < want ? Math.min(want, v + LIFT_ACCEL * dt) : want;
  const step = c.v * dt;
  if (step >= left - 1e-4) { c.y = next; c.v = 0; return true; }
  c.y += c.dir * step;
  return false;
}

const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
/** How open its doors are (0..1). */
export function doorsOf(c: Car) {
  if (c.phase === "opening") return smooth(c.t / DOOR_T);
  if (c.phase === "open") return 1;
  if (c.phase === "closing") return 1 - smooth(c.t / DOOR_T);
  return 0;
}
/** The floor it's at, or passing. */
export const carFloor = (c: Car) => Math.round(c.y);
/** Stopped at a floor (not between floors). */
export const atFloor = (c: Car, f: number) => c.phase !== "moving" && Math.abs(c.y - f) < 1e-3;
/** Its height (world): between two floors, in proportion. */
export function carWorldY(y: number) {
  const a = Math.floor(y), k = y - a;
  return k < 1e-6 ? floorY(a) : floorY(a) + (floorY(a + 1) - floorY(a)) * k;
}
/** The way it shows (▲/▼) on the screens. */
export const carDir = (c: Car) => (c.phase === "moving" ? c.dir : 0);

/** Someone wants it at `floor` (called from outside, or a button inside). */
export function request(c: Car, floor: number) {
  floor = Math.round(floor);
  if (atFloor(c, floor)) {
    // Already there: the doors open (again), or stay open longer.
    if (c.phase === "idle") { c.phase = "opening"; c.t = 0; }
    else if (c.phase === "closing") { c.t = DOOR_T * (1 - c.t / DOOR_T); c.phase = "opening"; }
    else if (c.phase === "open") c.dwell = Math.max(c.dwell, DWELL);
    return;
  }
  if (!c.stops.includes(floor)) c.stops.push(floor);
  // (Stopped with its doors open and somewhere else to go now: they close soon, not after the full wait.)
  if (c.phase === "open") c.dwell = Math.min(c.dwell, PRESSED_DWELL);
}
// (A floor only just short of, by rounding, is still ahead.)
const ahead = (c: Car, dir: number) => c.stops.filter((s) => (s - c.y) * dir > -1e-4 && Math.abs(s - c.y) > 1e-9 || (s - c.y) * dir > 0);
function pickDir(c: Car) {
  if (c.dir !== 0 && ahead(c, c.dir).length) return;
  if (!c.stops.length) { c.dir = 0; return; }
  // The nearest wanted floor decides (ties: up).
  const near = [...c.stops].sort((a, b) => Math.abs(a - c.y) - Math.abs(b - c.y) || b - a)[0]!;
  c.dir = near > c.y ? 1 : -1;
}
/** On by `dt` seconds; `blocked`: someone is standing in its doorway (at the floor it's stopped at). */
/**
 * For players who don't run the elevators (rooms): the car as the runner last said, carried on between its updates —
 * moving the same way at the same speed (never past the floor it's stopping at), its doors' timers running — but
 * never deciding anything itself (no new stops, opening, closing or setting off): that's only ever the runner's, so
 * everyone sees the same car, doors and floors.
 */
export function followCar(c: Car, dt: number) {
  if (c.phase === "moving") {
    const next = ahead(c, c.dir).sort((a, b) => (a - b) * c.dir)[0];
    if (next === undefined) return;
    travel(c, next, dt);
    return;
  }
  if (c.phase === "opening" || c.phase === "closing") c.t = Math.min(DOOR_T, c.t + dt);
  else if (c.phase === "open") c.dwell = Math.max(0, c.dwell - dt);
}
export function stepCar(c: Car, dt: number, blocked: boolean) {
  // (A stop asked for at the floor it's already at, while there: the doors see to it.)
  if (c.phase !== "moving") c.stops = c.stops.filter((s) => !(Math.abs(s - c.y) < 1e-3 && (request(c, s), true)));
  if (c.phase === "idle") {
    if (c.stops.length) { pickDir(c); c.phase = "moving"; c.t = 0; }
    return;
  }
  if (c.phase === "moving") {
    if (!ahead(c, c.dir).length) { pickDir(c); if (c.dir === 0) { c.phase = "idle"; return; } }
    const next = ahead(c, c.dir).sort((a, b) => (a - b) * c.dir)[0]!;
    if (travel(c, next, dt)) {
      c.stops = c.stops.filter((s) => s !== next);
      c.phase = "opening"; c.t = 0;
    }
    return;
  }
  c.t += dt;
  if (c.phase === "opening") {
    if (c.t >= DOOR_T) { c.phase = "open"; c.t = 0; c.dwell = DWELL; c.clear = 0; }
  } else if (c.phase === "open") {
    c.dwell -= dt; c.clear = blocked ? 0 : c.clear + dt;
    if (c.dwell <= 0 && c.clear >= CLEAR) { c.phase = "closing"; c.t = 0; }
  } else if (c.phase === "closing") {
    // Someone steps into the doors: they open again.
    if (blocked) { c.t = DOOR_T * (1 - Math.min(1, c.t / DOOR_T)); c.phase = "opening"; return; }
    if (c.t >= DOOR_T) {
      c.t = 0;
      if (c.stops.length) { pickDir(c); c.phase = "moving"; } else { c.phase = "idle"; c.dir = 0; }
    }
  }
}
