// The roof of an apartment building (pure): a ladder on the top floor's hallway wall (beside the elevator) up
// through a square hatch in the ceiling, into a small room on the roof the size of the elevator, open by a doorway
// (no door) onto the roof. Climbing it, up and down, as keyframes of where each hand and foot is held (on a rung,
// on the roof, on the floor) and where the body is, so every hold is locked where it is while the others move.
import type { Building } from "./config";
import { APT_FLOORS, floorY } from "./apartments";
import type { Box } from "./restaurantRoom";
import { SHAFT, venueLayout } from "./venueRoom";

export const ROOF_FLOOR = APT_FLOORS + 1;
/** The roof's surface above the top floor's floor (its slab and the roof's on top of it). */
export const ROOF_UP = 3.5;
/** The roof's surface, world height. */
export const roofY = () => floorY(APT_FLOORS) + ROOF_UP;
/** The rungs: the first this high, then every `gap`; how far their middle stands off the wall; half their width. */
export const RUNG = { y0: 0.3, gap: 0.29, n: 11, out: 0.17, half: 0.24 } as const;
export const rungY = (i: number) => RUNG.y0 + RUNG.gap * i;
export const BULK_H = 2.4;

export type RoofPlan = {
  /** The ladder's middle (x) on the hallway's back wall (z, its face). */
  ladX: number; wallZ: number;
  /** The hatch, and the room on the roof round it (its doorway on the z1 side, toward the building's front). */
  hatch: { x0: number; x1: number; z0: number; z1: number };
  bulk: { x0: number; x1: number; z0: number; z1: number; door: [number, number]; t: number };
  /** The roof's walls (the little room's), and how far the roof goes (the building's edge, with its lip). */
  solids: Box[];
  edge: { minX: number; maxX: number; minZ: number; maxZ: number };
};
/** In the building's entrance frame (that of its floors). */
export function roofPlan(b: Building): RoofPlan {
  const L = venueLayout(b), { minX, minZ } = L.bounds;
  const wallZ = minZ + SHAFT, ladX = minX + SHAFT + 1.4;
  const hatch = { x0: ladX - 0.45, x1: ladX + 0.45, z0: wallZ, z1: wallZ + 0.9 };
  const t = 0.12, bulk = { x0: ladX - 1.3, x1: ladX + 1.3, z0: wallZ - 0.9, z1: wallZ + 1.7, door: [ladX - 0.45, ladX + 0.45] as [number, number], t };
  const box = (x0: number, x1: number, z0: number, z1: number): Box => ({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2 });
  const solids = [
    box(bulk.x0, bulk.x1, bulk.z0, bulk.z0 + t), box(bulk.x0, bulk.x0 + t, bulk.z0, bulk.z1), box(bulk.x1 - t, bulk.x1, bulk.z0, bulk.z1),
    box(bulk.x0, bulk.door[0], bulk.z1 - t, bulk.z1), box(bulk.door[1], bulk.x1, bulk.z1 - t, bulk.z1),
  ];
  // (The roof's lip reaches 0.2 past the walls.)
  const W = 0.2 + 0.2;
  return { ladX, wallZ, hatch, bulk, solids, edge: { minX: -L.width / 2 - W, maxX: L.width / 2 + W, minZ: -L.depth - W, maxZ: W } };
}
/** In the hatch (deep enough in to fall). */
export const inHatch = (p: RoofPlan, x: number, z: number) => x > p.hatch.x0 + 0.12 && x < p.hatch.x1 - 0.12 && z > p.hatch.z0 + 0.08 && z < p.hatch.z1 - 0.12;
export const onRoof = (p: RoofPlan, x: number, z: number) => x > p.edge.minX && x < p.edge.maxX && z > p.edge.minZ && z < p.edge.maxZ;

// ---------- climbing ----------
/** A hold: height above the top floor's floor, and how far out from the wall's face (−: over the roof). */
type P = { y: number; z: number };
type Key = { d: number; z: number; y: number; lean: number; drop: number; fL: P; fR: P; hL: P | null; hR: P | null };
const rung = (i: number): P => ({ y: rungY(i), z: RUNG.out });
const ROOF_HAND: P = { y: ROOF_UP, z: -0.2 };
const top = RUNG.n - 1;
/** Climbing body: hips this far out from the wall. */
const OUT = 0.45, STAND = 0.62;
const lowY = (k: Pick<Key, "fL" | "fR">) => Math.min(k.fL.y, k.fR.y);

/** Up from the floor in front of the ladder to standing on the roof (just past the hatch, facing away from it). */
function upKeys(): { keys: Key[]; topOut: number } {
  const keys: Key[] = [];
  let k: Key = { d: 0, z: STAND, y: 0, lean: 0, drop: 0, fL: { y: 0, z: STAND }, fR: { y: 0, z: STAND }, hL: null, hR: null };
  keys.push(k);
  const push = (d: number, ch: Partial<Key>) => { k = { ...k, ...ch, d }; keys.push(k); };
  // Hands up onto the rungs, leaning in.
  push(0.55, { hR: rung(5), hL: rung(4), lean: 0.12, z: 0.52 });
  // The feet onto the first rungs (the hips over them).
  const feet = { L: -1, R: -1 }, hands = { L: 4, R: 5 };
  const foot = (side: "L" | "R", to: number) => {
    feet[side] = to;
    const fp = rung(to), other = side === "L" ? k.fR : k.fL;
    const next = { ...k, [`f${side}`]: fp } as Key;
    push(0.48, { [`f${side}`]: fp, y: Math.max(0, Math.min(fp.y, other.y)), z: OUT, lean: 0.14 });
    void next;
  };
  const hand = (side: "L" | "R") => {
    const to = hands[side] + 2;
    hands[side] = to;
    push(0.38, { [`h${side}`]: to > top ? ROOF_HAND : rung(to) });
  };
  foot("R", 0); foot("L", 1);
  // Then: a hand up two rungs, the foot on the other side up two, the other hand, the other foot — till both hands
  // are on the roof and both feet on the last rung.
  const order: ["h" | "f", "L" | "R"][] = [["h", "L"], ["f", "R"], ["h", "R"], ["f", "L"]];
  for (let guard = 0; guard < 40 && !(feet.L === top && feet.R === top); guard++) {
    for (const [what, side] of order) {
      if (what === "h") { if (hands[side] <= top) hand(side); }
      else { const to = Math.min(top, feet[side] + 2); if (to !== feet[side]) foot(side, to); }
      if (feet.L === top && feet.R === top) break;
    }
  }
  // Up the last rungs: bent over the hatch's edge, the hips down, the hands on the roof.
  for (const kk of keys) {
    if (kk.hL?.y === ROOF_UP && kk.hR?.y === ROOF_UP) { const u = Math.max(0, Math.min(1, (kk.y - 2.3) / 0.9)); kk.lean = 0.14 + 0.86 * u; kk.drop = 0.45 * u; }
  }
  const topOut = keys.reduce((a, q) => a + q.d, 0);
  // One foot onto the roof (the other still on the last rung), straightening a little; letting go of the roof;
  // then onto that foot, the other one up beside it, standing.
  push(0.7, { fR: { y: ROOF_UP, z: -0.2 }, z: 0.2, lean: 0.62, drop: 0.32 });
  push(0.6, { hL: null, hR: null, z: 0.02, y: ROOF_UP - 0.12, lean: 0.3, drop: 0.12 });
  push(0.7, { fL: { y: ROOF_UP, z: -0.3 }, z: -0.25, y: ROOF_UP, lean: 0.04, drop: 0 });
  return { keys, topOut };
}
/** Down from the roof: crouched, the hands down on the roof first; one foot back down onto the last rung, then the
 * other (the hands still on the roof); then down the ladder, the hands following the rungs, to the floor. */
function downKeys(): { keys: Key[]; bottom: number } {
  const up = upKeys().keys;
  const bentAt = up.findIndex((q) => q.fL.z === RUNG.out && q.fR.z === RUNG.out && q.fL.y === rungY(top) && q.fR.y === rungY(top));
  const bent = up[bentAt]!;
  const keys: Key[] = [];
  const stand: Key = { d: 0, z: -0.12, y: ROOF_UP, lean: 0.04, drop: 0, fL: { y: ROOF_UP, z: -0.2 }, fR: { y: ROOF_UP, z: -0.12 }, hL: null, hR: null };
  keys.push(stand);
  // Squatting down, the hands on the roof (in front, by the edge).
  keys.push({ ...stand, d: 0.8, lean: 0.85, drop: 0.55, hL: ROOF_HAND, hR: ROOF_HAND, z: -0.05 });
  keys.push({ ...keys[keys.length - 1]!, d: 0.75, fR: rung(top), z: 0.24, y: ROOF_UP - 0.15, lean: 0.9, drop: 0.45 });
  keys.push({ ...bent, d: 0.75, hL: ROOF_HAND, hR: ROOF_HAND });
  // The climb up, backward from there.
  for (let i = bentAt - 1; i >= 0; i--) keys.push({ ...up[i]!, d: up[i + 1]!.d });
  return { keys, bottom: 0 };
}
const THIGH = 0.46, SHIN = 0.46, HIP = 0.95, ANKLE = HIP - THIGH - SHIN;
/** A leg reaching an ankle `f` ahead of the hips and `y` above their floor, the hips `drop` lower (as bathMoves'). */
function legTo(f: number, y: number, drop: number): { hip: number; knee: number } {
  const dz = f, dy = (y + ANKLE) - (HIP - drop), d = Math.min(THIGH + SHIN - 1e-4, Math.max(0.05, Math.hypot(dz, dy)));
  const knee = Math.acos(Math.max(-1, Math.min(1, (d * d - THIGH * THIGH - SHIN * SHIN) / (2 * THIGH * SHIN))));
  const toward = Math.atan2(dz, -dy), lead = Math.acos(Math.max(-1, Math.min(1, (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d))));
  return { hip: -(toward + lead), knee };
}
const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
const lerpP = (a: P, b: P, e: number): P => ({ y: a.y + (b.y - a.y) * e, z: a.z + (b.z - a.z) * e });
export type ClimbPose = {
  /** Ladder frame: x across the wall from the ladder's middle, z out from the wall, y above the top floor. */
  z: number; y: number; lean: number;
  legs: { hipL: number; kneeL: number; hipR: number; kneeR: number; drop: number };
  hands: { left: { at: [number, number, number]; blend: number } | null; right: { at: [number, number, number]; blend: number } | null };
};
const UP = upKeys(), DOWN = downKeys();
const total = (ks: Key[]) => ks.reduce((a, q) => a + q.d, 0);
export const CLIMB = { up: total(UP.keys), down: total(DOWN.keys), topOut: UP.topOut, downOff: total(DOWN.keys.slice(0, 4)) } as const;
/** Where the body and its holds are `t` seconds into climbing up (or down). */
export function climbPose(dir: "up" | "down", t: number): ClimbPose {
  const ks = dir === "up" ? UP.keys : DOWN.keys;
  let i = 1, at = 0;
  while (i < ks.length - 1 && at + ks[i]!.d < t) { at += ks[i]!.d; i++; }
  const a = ks[i - 1]!, b = ks[i]!, e = smooth((t - at) / b.d), arc = Math.sin(Math.PI * e);
  const num = (x: number, y: number) => x + (y - x) * e;
  const z = num(a.z, b.z), y = num(a.y, b.y), lean = num(a.lean, b.lean), drop = num(a.drop, b.drop);
  // A moving foot comes off its hold, out and up a little, and onto the next; a hand the same, less.
  const foot = (p: P, q: P) => { const m = lerpP(p, q, e); return p.y === q.y && p.z === q.z ? m : { y: m.y + 0.1 * arc, z: m.z + 0.12 * arc }; };
  const fL = foot(a.fL, b.fL), fR = foot(a.fR, b.fR);
  const L = legTo(z - fL.z, fL.y - y, drop), R = legTo(z - fR.z, fR.y - y, drop);
  const hand = (p: P | null, q: P | null, side: number) => {
    const x = side * (p && q && (p.y === ROOF_UP || q.y === ROOF_UP) ? 0.25 : 0.2);
    if (!p && !q) return null;
    if (p && q) { const m = lerpP(p, q, e), moving = p.y !== q.y || p.z !== q.z; return { at: [x, m.y + (moving ? 0.05 * arc : 0), m.z + (moving ? 0.1 * arc : 0)] as [number, number, number], blend: 1 }; }
    const h = (p ?? q)!;
    return { at: [x, h.y, h.z] as [number, number, number], blend: p ? 1 - e : e };
  };
  // (Facing the wall, the right hand is on the +x side.)
  return { z, y, lean, legs: { hipL: L.hip, kneeL: L.knee, hipR: R.hip, kneeR: R.knee, drop }, hands: { left: hand(a.hL, b.hL, -1), right: hand(a.hR, b.hR, 1) } };
}
void lowY;
