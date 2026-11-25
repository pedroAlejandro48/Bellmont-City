// The apartment buildings' stairs (pure), in the building's entrance frame (as aptRoom.ts). A stairwell right of the
// elevator's shaft, behind the hallway, the same on every floor: from the floor's landing (by the shaft, open to
// the hallway), a flight runs along the back of the building toward its far wall, up to a landing half a storey up;
// there it turns, and the other flight comes back up to the next floor's landing. The lobby is taller (5 m): from
// it the stairs go round twice before the first floor's landing. A wall between the two flights, walls all round;
// handrails on every wall. Only players use them.
import { BUILDING_ENTRANCE } from "./config";
import { APT_FLOORS, floorY } from "./apartments";
import { SHAFT } from "./venueRoom";

/** A tread's depth; the floor's landing (by the shaft) and the half-way landing's length; a storey's flights' risers
 * (and the lobby's, taller: its flights longer — every riser under 18 cm). */
export const TREAD = 0.28, RISERS = 9, LAND_W = 1.2, LAND_E = 1.1, RUN = (RISERS - 1) * TREAD;
export const LOBBY_RISERS = Math.max(RISERS, Math.ceil((BUILDING_ENTRANCE.floorHeight / 2) / 0.18));
const MAX_RUN = (LOBBY_RISERS - 1) * TREAD;
/** Wall thickness (the hallway's wall, the end wall, the wall between the flights). */
export const SW = 0.12;
export type Flight = { y: number; rise: number; dir: 1 | -1; n: number; run: number };
export type StairPlan = {
  /** x: the stairwell's inside from the shaft (x0) to its end wall (xe); the flights start at xa (the longest, the
   * lobby's, ends at xb). */
  x0: number; xa: number; xb: number; xe: number;
  /** z: the back wall's inside (z0), the wall between the flights (zm, its middle), the hallway wall's inside (z1). */
  z0: number; zm: number; z1: number;
  /** Every flight, bottom to top: its foot's height (world), how much it rises, which way it climbs (+1: along +x on
   * the hallway side; −1: along −x on the back side), its risers and length. */
  flights: Flight[];
  /** The floors' landings (by the shaft), their heights (world); the half-way ones at the far end (from x to xe). */
  west: number[]; east: { y: number; x: number }[];
};

/** The stairs of a building whose (lobby) room bounds are these. */
export function stairPlan(bounds: { minX: number; minZ: number }): StairPlan {
  const x0 = bounds.minX + SHAFT, xa = x0 + LAND_W, xb = xa + MAX_RUN, xe = xb + LAND_E;
  const z0 = bounds.minZ, z1 = bounds.minZ + SHAFT - SW, zm = (z0 + z1) / 2;
  const flights: Flight[] = [], west: number[] = [floorY(1)], east: StairPlan["east"] = [];
  for (let f = 1; f < APT_FLOORS; f++) {
    // Two flights a storey, half its height each (the lobby's taller: longer flights).
    const y0 = floorY(f), rise = (floorY(f + 1) - y0) / 2, n = f === 1 ? LOBBY_RISERS : RISERS, run = (n - 1) * TREAD;
    flights.push({ y: y0, rise, dir: 1, n, run }, { y: y0 + rise, rise, dir: -1, n, run });
    east.push({ y: y0 + rise, x: xa + run });
    west.push(y0 + 2 * rise);
  }
  return { x0, xa, xb, xe, z0, zm, z1, flights, west, east };
}

/** Inside the stairwell (its open space, not its walls). */
export const inStairwell = (p: StairPlan, x: number, z: number) => x > p.x0 && x < p.xe && z > p.z0 && z < p.z1 + SW;
/** Which side of the middle wall: +1 the hallway side (flights going +x), −1 the back. */
const sideOf = (p: StairPlan, z: number) => (z > p.zm ? 1 : -1);

/** A flight's height at x: stepped (`tread`, what feet stand on) or as a ramp (`ramp`, where the body is carried). */
export function flightAt(p: StairPlan, f: Flight, x: number, tread: boolean) {
  const along = f.dir === 1 ? x - p.xa : p.xa + f.run - x;
  const riser = f.rise / f.n;
  // (The slope runs through the middle of every tread, from half a tread before the flight to half a tread onto the
  // landing at its top.)
  if (!tread) return f.y + Math.max(0, Math.min(f.n, (along + TREAD / 2) / TREAD)) * riser;
  // The first riser is at the flight's start, the last onto the landing at its end.
  const i = Math.floor(along / TREAD) + 1;
  return f.y + Math.max(0, Math.min(f.n, i)) * riser;
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
  const s = sideOf(p, z);
  for (const f of p.flights) if (f.dir === s && x > p.xa - ext && x < p.xa + f.run + ext) cand.push(flightAt(p, f, x, tread));
  for (const e of p.east) if (x >= e.x + ext) cand.push(e.y);
  let best = -Infinity, low = Infinity;
  for (const h of cand) { if (h <= y + 0.55 && h > best) best = h; if (h < low) low = h; }
  return best > -Infinity ? best : low;
}
/** The flight someone at (x, z), feet at y, is on (null: a landing or the floor). */
export function flightUnder(p: StairPlan, x: number, z: number, y: number): Flight | null {
  if (!inStairwell(p, x, z)) return null;
  const s = sideOf(p, z);
  for (const f of p.flights) if (f.dir === s && x > p.xa - 0.05 && x < p.xa + f.run + 0.05 && Math.abs(flightAt(p, f, x, false) - y) < 0.35) return f;
  return null;
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
export function stairWalls(p: StairPlan, open = true, top = false) {
  const box = (x0: number, x1: number, z0: number, z1: number) => ({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2 });
  const out = [box(p.xe, p.xe + 0.15, p.z0, p.z1 + SW), box(p.xa, p.xb, p.zm - SW / 2, p.zm + SW / 2)];
  // (The top floor: a wall across where the next flight up would start — nothing past it but the drop.)
  if (top) out.push(box(p.xa, p.xa + SW, p.zm - SW / 2, p.z1));
  if (open) out.push(box(p.x0 + LAND_W - 0.05, p.xe + 0.15, p.z1, p.z1 + SW));
  else out.push(box(p.x0, p.xe + 0.15, p.z1, p.z1 + SW));
  return out;
}
/** The doorway from the hallway (or the lobby) onto the floor's landing: x from–to. */
export const landingOpening = (p: StairPlan): [number, number] => [p.x0 + 0.05, p.x0 + LAND_W - 0.05];

// ---------- the feet on the steps ----------
/** One foot: where it's planted (the room's frame, x/z; y world) and, while stepping, from where and how far
 * through (0..1). */
export type FootPlant = { x: number; y: number; z: number; from: [number, number, number] | null; k: number; dur: number };
export type Feet = { L: FootPlant; R: FootPlant; next: "L" | "R"; hip: number | null };
const HIP_W = 0.1;
const treadOf = (p: StairPlan, x: number) => Math.floor((x - p.xa) / TREAD);

/**
 * The feet on a flight, a frame on (the room's frame: the flights run along x). Each foot stays planted on its tread
 * until the body has gone about a tread past it; then (one foot at a time) it steps — onto the tread ahead going up
 * or down, or (walking sideways) beside the other foot, never across it. Standing still: facing along the stairs the
 * two feet come together on one step (once — then nothing moves); turned across them each foot stays on its own.
 */
export function stepFeet(p: StairPlan, feet: Feet, body: { x: number; y: number; z: number; yaw: number; vx: number; vz: number }, dt: number): Feet {
  const fx = Math.sin(body.yaw), fz = Math.cos(body.yaw), rx = Math.cos(body.yaw), rz = -Math.sin(body.yaw);
  const speed = Math.hypot(body.vx, body.vz), moving = speed > 0.12;
  const ground = (x: number, z: number) => stairGround(p, x, z, body.y + 0.35, true) ?? body.y;
  const advance = (f: FootPlant): FootPlant => {
    if (!f.from) return f;
    const k = Math.min(1, f.k + dt / f.dur);
    return { ...f, k, from: k >= 1 ? null : f.from };
  };
  let L = advance(feet.L), R = advance(feet.R), next = feet.next;
  if (L.from || R.from) return { L, R, next, hip: feet.hip };
  const hipAt = (side: 1 | -1): [number, number] => [body.x + rx * side * HIP_W, body.z + rz * side * HIP_W];
  const plant = (which: "L" | "R", x: number, z: number, dur: number) => {
    const f = which === "L" ? L : R, tx = treadMiddle(p, x), stepped: FootPlant = { x: tx, y: ground(tx, z), z, from: [f.x, f.y, f.z], k: 0, dur };
    if (which === "L") L = stepped; else R = stepped;
    next = which === "L" ? "R" : "L";
  };
  if (moving) {
    const ux = body.vx / speed, uz = body.vz / speed, sideways = Math.abs(ux * rx + uz * rz) > Math.abs(ux * fx + uz * fz);
    if (sideways) {
      // Sideways: the trailing foot steps in toward the other (no further than under the middle of the body), then
      // the leading one steps out — as on a flat floor.
      const dir = ux * rx + uz * rz > 0 ? 1 : -1;
      const off = (f: FootPlant, side: 1 | -1) => { const [hx, hz] = hipAt(side); return Math.hypot(f.x - hx - ux * 0.08, f.z - hz - uz * 0.08); };
      const dl = off(L, 1), dr = off(R, -1);
      if (Math.max(dl, dr) > 0.16) {
        const which = dl > dr ? "L" : "R", side = which === "L" ? 1 : -1;
        const lead = side === dir ? 0.12 : 0.02;
        const [hx, hz] = hipAt(side);
        // (Toward the middle at most: lateral offset from the body's middle never past 0 to the wrong side.)
        const tx = hx + ux * lead - rx * side * (side === dir ? 0 : HIP_W * 0.6), tz = hz + uz * lead - rz * side * (side === dir ? 0 : HIP_W * 0.6);
        plant(which, tx, tz, 0.32);
      }
    } else {
      // Up or down (forward or backward): the foot that's furthest behind goes onto the next tread ahead of the body.
      const behind = (f: FootPlant) => -((f.x - body.x) * ux + (f.z - body.z) * uz);
      const bl = behind(L), br = behind(R);
      if (Math.max(bl, br) > TREAD * 0.45) {
        const which = bl > br ? "L" : "R", side = which === "L" ? 1 : -1, [hx, hz] = hipAt(side);
        plant(which, hx + ux * TREAD * 0.75, hz + uz * TREAD * 0.75, Math.max(0.3, Math.min(0.55, (TREAD * 1.4) / Math.max(0.25, speed))));
      }
    }
  } else if (Math.abs(fx) > 0.7 && treadOf(p, L.x) !== treadOf(p, R.x)) {
    // Stopped facing along the stairs: the foot further from the body comes to the other's step (just the once).
    const far = Math.abs(L.x - body.x) > Math.abs(R.x - body.x) ? "L" : "R", other = far === "L" ? R : L, side = far === "L" ? 1 : -1, [, hz] = hipAt(side);
    plant(far, other.x, hz, 0.38);
  }
  return { L, R, next, hip: feet.hip };
}

/** Where a foot is now: planted, or partway through its step. Going up: lifted first (just clear of the step's
 * edge), then over onto the higher tread; going down: out over the edge first, the leg straight, then down. */
export function footNow(f: FootPlant): [number, number, number] {
  if (!f.from) return [f.x, f.y, f.z];
  const [x0, y0, z0] = f.from, k = f.k, sm = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
  if (f.y >= y0) {
    const over = sm((k - 0.2) / 0.8), y = y0 + (f.y + 0.045 - y0) * sm(k / 0.55) - 0.045 * sm((k - 0.7) / 0.3);
    return [x0 + (f.x - x0) * over, y, z0 + (f.z - z0) * over];
  }
  const over = sm(k / 0.65), y = y0 + 0.02 * Math.sin(Math.PI * Math.min(1, k / 0.5)) + (f.y - y0) * sm((k - 0.4) / 0.6);
  return [x0 + (f.x - x0) * over, y, z0 + (f.z - z0) * over];
}

const THIGH = 0.46, SHIN = 0.46, ANKLE = 0.03, REACH = THIGH + SHIN - 0.0006;
/**
 * The legs reaching the feet (2-bone, in the body's frame: thigh forward angle and knee bend for each, the thighs'
 * roll to the side) and where the hips are: as high as the lower-reaching foot allows — that leg straight, the other
 * bending as much as its step needs.
 */
export function legsToFeet(body: { x: number; z: number; yaw: number }, left: [number, number, number], right: [number, number, number]) {
  const fx = Math.sin(body.yaw), fz = Math.cos(body.yaw), rx = Math.cos(body.yaw), rz = -Math.sin(body.yaw);
  const local = (foot: [number, number, number], side: -1 | 1) => {
    const hx = body.x + rx * side * HIP_W, hz = body.z + rz * side * HIP_W;
    const dx = foot[0] - hx, dz = foot[2] - hz;
    return { fwd: dx * fx + dz * fz, lat: dx * rx + dz * rz, up: foot[1] + ANKLE };
  };
  const a = local(left, 1), b = local(right, -1);
  const need = (q: { fwd: number; lat: number; up: number }) => q.up + Math.sqrt(Math.max(0, REACH * REACH - q.fwd * q.fwd - q.lat * q.lat));
  return { ...legsAt(a, b, Math.min(need(a), need(b))), top: Math.min(need(a), need(b)) };
}
/** The same, with the hips at `top` (world height). */
export function legsToFeetAt(body: { x: number; z: number; yaw: number }, left: [number, number, number], right: [number, number, number], top: number) {
  const fx = Math.sin(body.yaw), fz = Math.cos(body.yaw), rx = Math.cos(body.yaw), rz = -Math.sin(body.yaw);
  const local = (foot: [number, number, number], side: -1 | 1) => {
    const hx = body.x + rx * side * HIP_W, hz = body.z + rz * side * HIP_W;
    const dx = foot[0] - hx, dz = foot[2] - hz;
    return { fwd: dx * fx + dz * fz, lat: dx * rx + dz * rz, up: foot[1] + ANKLE };
  };
  return legsAt(local(left, 1), local(right, -1), top);
}
function legsAt(a: { fwd: number; lat: number; up: number }, b: { fwd: number; lat: number; up: number }, top: number) {
  const leg = (q: { fwd: number; lat: number; up: number }) => {
    const dy = q.up - top, d = Math.min(THIGH + SHIN - 1e-4, Math.max(0.05, Math.hypot(q.fwd, dy, q.lat)));
    const knee = Math.acos(Math.max(-1, Math.min(1, (d * d - THIGH * THIGH - SHIN * SHIN) / (2 * THIGH * SHIN))));
    const sag = Math.hypot(q.fwd, dy);
    const toward = Math.atan2(q.fwd, -dy), lead = Math.acos(Math.max(-1, Math.min(1, (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d))));
    return { hip: -(toward + lead), knee, roll: Math.atan2(q.lat, Math.max(0.2, sag)) };
  };
  const l = leg(a), r = leg(b);
  return { hipL: l.hip, kneeL: l.knee, rollL: l.roll, hipR: r.hip, kneeR: r.knee, rollR: r.roll };
}
