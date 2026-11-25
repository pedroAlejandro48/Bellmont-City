// The apartment buildings' stairs (pure), in the building's entrance frame (as aptRoom.ts). A stairwell right of the
// elevator's shaft, behind the hallway, the same on every floor: from the floor's landing (by the shaft, open to
// the hallway), a flight runs along the back of the building toward its far wall, up to a landing half a storey up;
// there it turns, and the other flight comes back up to the next floor's landing. The lobby is taller (5 m): from
// it the stairs go round twice before the first floor's landing. A wall between the two flights, walls all round;
// handrails on every wall. Only players use them.
import { BUILDING_ENTRANCE } from "./config";
import { APT_FLOORS, floorY } from "./apartments";
import { SHAFT } from "./venueRoom";

/** A tread's depth; the floor's landing (by the shaft) and the half-way landing's length; the flight's length. */
export const TREAD = 0.28, RISERS = 9, LAND_W = 1.2, LAND_E = 1.1, RUN = (RISERS - 1) * TREAD;
/** Wall thickness (the hallway's wall, the end wall, the wall between the flights). */
export const SW = 0.12;
export type StairPlan = {
  /** x: the stairwell's inside from the shaft (x0) to its end wall (xe); the flights from xa to xb. */
  x0: number; xa: number; xb: number; xe: number;
  /** z: the back wall's inside (z0), the wall between the flights (zm, its middle), the hallway wall's inside (z1). */
  z0: number; zm: number; z1: number;
  /** Every flight, bottom to top: its foot's height (world), how much it rises, and which way it climbs (+1: along +x
   * on the hallway side; −1: along −x on the back side). */
  flights: { y: number; rise: number; dir: 1 | -1 }[];
  /** The floors' landings (by the shaft) and the in-between ones, their heights (world). */
  west: number[]; east: number[];
};

/** The stairs of a building whose (lobby) room bounds are these. */
export function stairPlan(bounds: { minX: number; minZ: number }): StairPlan {
  const x0 = bounds.minX + SHAFT, xa = x0 + LAND_W, xb = xa + RUN, xe = xb + LAND_E;
  const z0 = bounds.minZ, z1 = bounds.minZ + SHAFT - SW, zm = (z0 + z1) / 2;
  const flights: StairPlan["flights"] = [], west: number[] = [floorY(1)], east: number[] = [];
  for (let f = 1; f < APT_FLOORS; f++) {
    const y0 = floorY(f), rise = floorY(f + 1) - y0;
    // (The lobby's 5 m: round twice — four flights; a storey's 3 m: two.)
    const n = f === 1 && BUILDING_ENTRANCE.floorHeight > 4 ? 4 : 2;
    for (let k = 0; k < n; k++) {
      const y = y0 + (rise * k) / n, dir = (k % 2 === 0 ? 1 : -1) as 1 | -1;
      flights.push({ y, rise: rise / n, dir });
      (dir === 1 ? east : west).push(y + rise / n);
    }
  }
  return { x0, xa, xb, xe, z0, zm, z1, flights, west, east };
}

/** Inside the stairwell (its open space, not its walls). */
export const inStairwell = (p: StairPlan, x: number, z: number) => x > p.x0 && x < p.xe && z > p.z0 && z < p.z1 + SW;
/** Which side of the middle wall: +1 the hallway side (flights going +x), −1 the back. */
const sideOf = (p: StairPlan, z: number) => (z > p.zm ? 1 : -1);

/** A flight's height at x: stepped (`tread`, what feet stand on) or as a ramp (`ramp`, where the body is carried). */
function flightAt(p: StairPlan, f: StairPlan["flights"][number], x: number, tread: boolean) {
  const u = f.dir === 1 ? (x - p.xa) / RUN : (p.xb - x) / RUN;
  const riser = f.rise / RISERS;
  // (The slope runs through the middle of every tread, from half a tread before the flight to half a tread onto the
  // landing at its top.)
  if (!tread) return f.y + Math.max(0, Math.min(RISERS, (u * RUN + TREAD / 2) / TREAD)) * riser;
  // The first riser is at the flight's start, the last onto the landing at its end.
  const i = Math.floor(u * (RISERS - 1)) + 1;
  return f.y + Math.max(0, Math.min(RISERS, i)) * riser;
}

/**
 * What's underfoot at (x, z) in the stairwell for someone whose feet are at `y`: of everything there (the landings
 * and flights stacked up the stairwell), the highest no more than a step above them. `tread`: the steps' own
 * heights (for feet) rather than the slope through them (for the body). Null outside the stairwell.
 */
export function stairGround(p: StairPlan, x: number, z: number, y: number, tread = false): number | null {
  if (!inStairwell(p, x, z)) return null;
  const cand: number[] = [];
  // (For the body the flights reach half a tread onto each landing: the slope meets the landing smoothly.)
  const ext = tread ? 0 : TREAD / 2;
  if (x <= p.xa - ext) cand.push(...p.west);
  else if (x >= p.xb + ext) cand.push(...p.east);
  else { const s = sideOf(p, z); for (const f of p.flights) if (f.dir === s) cand.push(flightAt(p, f, x, tread)); }
  let best = -Infinity, low = Infinity;
  for (const h of cand) { if (h <= y + 0.55 && h > best) best = h; if (h < low) low = h; }
  return best > -Infinity ? best : low;
}

/** The middle of the tread under x on a flight (for planting a foot squarely); landings: x itself. */
export function treadMiddle(p: StairPlan, x: number) {
  if (x <= p.xa || x >= p.xb) return x;
  const i = Math.floor((x - p.xa) / TREAD);
  return p.xa + (i + 0.5) * TREAD;
}

/** The floor whose level is nearest `y` (staying on `current` unless another is clearly nearer). */
export function floorAtHeight(y: number, current: number) {
  let best = current, d = Math.abs(y - floorY(current));
  for (let f = 1; f <= APT_FLOORS; f++) { const e = Math.abs(y - floorY(f)); if (e < d - 0.15) { best = f; d = e; } }
  return best;
}

/**
 * The solid walls of the stairwell as boxes (the room's frame): the end wall, the wall between the flights, and the
 * hallway's wall either side of the landing's opening (`open`: whether it has the opening — every floor's does).
 */
export function stairWalls(p: StairPlan, open = true) {
  const box = (x0: number, x1: number, z0: number, z1: number) => ({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2 });
  const out = [box(p.xe, p.xe + 0.15, p.z0, p.z1 + SW), box(p.xa, p.xb, p.zm - SW / 2, p.zm + SW / 2)];
  if (open) out.push(box(p.x0 + LAND_W - 0.05, p.xe + 0.15, p.z1, p.z1 + SW));
  else out.push(box(p.x0, p.xe + 0.15, p.z1, p.z1 + SW));
  return out;
}
/** The doorway from the hallway (or the lobby) onto the floor's landing: x from–to. */
export const landingOpening = (p: StairPlan): [number, number] => [p.x0 + 0.05, p.x0 + LAND_W - 0.05];

// ---------- the feet on the steps ----------
/** One foot: where it's planted (world x, y, z) and, while stepping, from where and how far through (0..1). */
export type FootPlant = { x: number; y: number; z: number; from: [number, number, number] | null; k: number; dur: number };
export type Feet = { L: FootPlant; R: FootPlant; next: "L" | "R" };
const HIP_W = 0.1;

/**
 * The feet on the stairs, a frame on: each stays planted on its step until the body has moved far enough past it,
 * then (one foot at a time) lifts — up first, clear of the step's edge, then over — and comes down on the tread
 * nearest where it should be (the middle of a tread, never on a riser). Standing still, the feet come together on
 * one step. Walking backward or sideways, the same: each foot finds the step it's over.
 */
export function stepFeet(p: StairPlan, feet: Feet, body: { x: number; y: number; z: number; yaw: number; vx: number; vz: number }, dt: number): Feet {
  const fx = Math.sin(body.yaw), fz = Math.cos(body.yaw), rx = Math.cos(body.yaw), rz = -Math.sin(body.yaw);
  const speed = Math.hypot(body.vx, body.vz), moving = speed > 0.15;
  // Where each foot would naturally be: under its hip, a little ahead in the way the body is going.
  const lead = moving ? Math.min(0.32, speed * 0.24) : 0;
  const home = (side: -1 | 1): [number, number] => [body.x + rx * side * HIP_W + (moving ? body.vx / speed : 0) * lead, body.z + rz * side * HIP_W + (moving ? body.vz / speed : 0) * lead];
  const ground = (x: number, z: number) => stairGround(p, x, z, body.y + 0.3, true) ?? body.y;
  const advance = (f: FootPlant) => {
    if (!f.from) return f;
    const k = Math.min(1, f.k + dt / f.dur);
    return { ...f, k, from: k >= 1 ? null : f.from };
  };
  let L = advance(feet.L), R = advance(feet.R), next = feet.next;
  const swinging = !!L.from || !!R.from;
  if (!swinging) {
    // The foot furthest from where it should be steps (moving: when it's more than about a tread off; still:
    // whenever the two aren't side by side on one step).
    const off = (f: FootPlant, side: -1 | 1) => { const [hx, hz] = home(side); return Math.hypot(f.x - hx, f.z - hz); };
    const dl = off(L, 1), dr = off(R, -1);
    const limit = moving ? TREAD * 0.95 : 0.06;
    const which = dl > limit || dr > limit ? (dl > dr + 0.02 ? "L" : dr > dl + 0.02 ? "R" : next) : null;
    if (which) {
      const side = which === "L" ? 1 : -1, [hx, hz] = home(side);
      // Moving: a stride ahead of the hip (half a tread past where it should be), onto a tread's middle.
      const ax = moving ? hx + (body.vx / speed) * TREAD * 0.5 : hx, az = moving ? hz + (body.vz / speed) * TREAD * 0.5 : hz;
      const tx = treadMiddle(p, ax), ty = ground(tx, az);
      const f = which === "L" ? L : R;
      const dur = moving ? Math.max(0.2, Math.min(0.42, (TREAD * 1.1) / Math.max(0.4, speed))) : 0.3;
      const stepped: FootPlant = { x: tx, y: ty, z: az, from: [f.x, f.y, f.z], k: 0, dur };
      if (which === "L") L = stepped; else R = stepped;
      next = which === "L" ? "R" : "L";
    }
  }
  return { L, R, next };
}

/** Where a foot is now: planted, or partway through its step (lifted first — clear of the step's edge — then over
 * and down). */
export function footNow(f: FootPlant): [number, number, number] {
  if (!f.from) return [f.x, f.y, f.z];
  const [x0, y0, z0] = f.from, k = f.k, sm = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
  const over = sm((k - 0.15) / 0.75), up = Math.max(y0, f.y) + 0.12;
  // Up to above the higher of the two steps first, across, then down onto the new one.
  const y = k < 0.5 ? y0 + (up - y0) * sm(k / 0.4) : up + (f.y - up) * sm((k - 0.55) / 0.45);
  return [x0 + (f.x - x0) * over, y, z0 + (f.z - z0) * over];
}

const THIGH = 0.46, SHIN = 0.46, ANKLE = 0.03;
/**
 * The legs reaching the feet (2-bone, in the body's frame): thigh forward angle and knee bend for each, the thighs'
 * spread to the side, and how much lower the hips sit so the lower foot can be reached. `hipY`: the hips' height
 * standing (world).
 */
export function legsToFeet(body: { x: number; z: number; yaw: number }, hipY: number, left: [number, number, number], right: [number, number, number]) {
  const fx = Math.sin(body.yaw), fz = Math.cos(body.yaw), rx = Math.cos(body.yaw), rz = -Math.sin(body.yaw);
  const reach = THIGH + SHIN - 0.02;
  const local = (foot: [number, number, number], side: -1 | 1) => {
    const hx = body.x + rx * side * HIP_W, hz = body.z + rz * side * HIP_W;
    const dx = foot[0] - hx, dz = foot[2] - hz;
    return { fwd: dx * fx + dz * fz, lat: dx * rx + dz * rz - 0 * side, up: foot[1] + ANKLE };
  };
  const a = local(left, 1), b = local(right, -1);
  // The hips drop as far as the lower foot needs to be reached.
  const need = (q: { fwd: number; lat: number; up: number }) => q.up + Math.sqrt(Math.max(0, reach * reach - q.fwd * q.fwd - q.lat * q.lat));
  const top = Math.min(hipY, need(a), need(b));
  const leg = (q: { fwd: number; lat: number; up: number }) => {
    const dy = q.up - top, d = Math.min(reach, Math.max(0.05, Math.hypot(q.fwd, dy, q.lat)));
    const knee = Math.acos(Math.max(-1, Math.min(1, (d * d - THIGH * THIGH - SHIN * SHIN) / (2 * THIGH * SHIN))));
    const sag = Math.hypot(q.fwd, dy);
    const toward = Math.atan2(q.fwd, -dy), lead = Math.acos(Math.max(-1, Math.min(1, (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d))));
    return { hip: -(toward + lead), knee, roll: Math.atan2(q.lat, Math.max(0.2, sag)) };
  };
  const l = leg(a), r = leg(b);
  return { hipL: l.hip, kneeL: l.knee, rollL: l.roll, hipR: r.hip, kneeR: r.knee, rollR: r.roll, drop: hipY - top };
}
