// What stands in a room (in its own frame), and how tall: walls, furniture, counters, fixtures. Used where a body
// meets them — a hand put out to lean on one, a body collapsing against them (pure).
import { footprint, type Box, type Room } from "./restaurantRoom";
import { fixtureBox, type Fixture } from "./venueRoom";

export type Prop = Box & { h: number };
export const WALL_H = 2.8;

/** Apartment furniture heights (m). */
const APT_H: Record<string, number> = {
  counter: 0.92, sink: 0.92, oven: 0.92, microwave: 1.2, fridge: 1.85, table: 0.76, chair: 0.9, couch: 0.85, tvTable: 0.55,
  tv: 1.2, rug: 0, bed: 0.62, desk: 0.76, deskChair: 0.95, closet: 2.0, lamp: 1.6, trash: 0.6,
};
/** Shop and office fixtures' heights (m). */
const FIX_H: Record<string, number> = {
  desk: 0.76, chairOffice: 0.95, bench: 0.45, waitChair: 0.9, flag: 2, board: 2, redCross: 2, bed: 0.6, curtain: 2,
  treadmill: 1.3, weightBench: 0.5, dumbbells: 0.8, mirror: 2, mats: 0.05, rack: 1.6, shelfClothes: 1.8, fittingRoom: 2.2,
  bikeDisplay: 1.1, toolWall: 2.2, tireRack: 1.6, workbench: 0.9, shelf: 1.8, crate: 0.5, baskets: 0.6, checkout: 0.95,
  shaft: WALL_H, sofa: 0.85, armchair: 0.9, coffeeTable: 0.45, rug: 0, mailboxes: 1.6, painting: 2,
};
type AptFurn = { type: string; x: number; z: number; rot: number; w: number; d: number; solid: boolean };
const keyOf = (b: { x: number; z: number }) => `${b.x.toFixed(3)}|${b.z.toFixed(3)}`;
const cache = new WeakMap<object, Prop[]>();

/** Everything solid in a room, with its height, and its outside walls (not a roof's: its edges are open). */
export function roomProps(room: Room): Prop[] {
  const hit = cache.get(room);
  if (hit) return hit;
  const R = room as Room & { furniture?: AptFurn[]; fixtures?: Fixture[]; walls?: Box[]; roof?: boolean };
  const heights = new Map<string, number>();
  for (const f of R.furniture ?? []) heights.set(keyOf(f), APT_H[f.type] ?? 1);
  for (const f of R.fixtures ?? []) heights.set(keyOf(fixtureBox(f)), FIX_H[f.type] ?? 1);
  for (const w of R.walls ?? []) heights.set(keyOf(w), WALL_H);
  if (room.counter) heights.set(keyOf(room.counter), 1.05);
  const out: Prop[] = room.solids.map((b) => ({ ...b, h: heights.get(keyOf(b)) ?? 2 }));
  const inSolids = new Set(room.solids.map(keyOf));
  for (const w of R.walls ?? []) if (!inSolids.has(keyOf(w))) out.push({ ...w, h: WALL_H });
  if (!R.roof) {
    const b = room.bounds, T = 0.3;
    out.push(
      { x: b.minX - T / 2, z: (b.minZ + b.maxZ) / 2, hx: T / 2, hz: (b.maxZ - b.minZ) / 2 + T, h: WALL_H },
      { x: b.maxX + T / 2, z: (b.minZ + b.maxZ) / 2, hx: T / 2, hz: (b.maxZ - b.minZ) / 2 + T, h: WALL_H },
      { x: (b.minX + b.maxX) / 2, z: b.minZ - T / 2, hx: (b.maxX - b.minX) / 2 + T, hz: T / 2, h: WALL_H },
      { x: (b.minX + b.maxX) / 2, z: b.maxZ + T / 2, hx: (b.maxX - b.minX) / 2 + T, hz: T / 2, h: WALL_H },
    );
  }
  cache.set(room, out);
  return out;
}
/** The room's tables and chairs where they stand now (they move: never cached). */
export const roomItems = (room: Room): Prop[] => (room.items ?? []).map((it) => ({ ...footprint(it), h: it.kind === "table" ? 0.75 : 0.9 }));

/** Along a ray (2D, from o along unit d), how far to the first prop's side, and which; null if none within `max`. */
export function rayProps(props: readonly Prop[], ox: number, oz: number, dx: number, dz: number, max: number): { t: number; p: Prop } | null {
  let best: { t: number; p: Prop } | null = null;
  for (const p of props) {
    let t0 = 0, t1 = max;
    const slab = (o: number, d: number, lo: number, hi: number) => {
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) t1 = -1; return; }
      let a = (lo - o) / d, c = (hi - o) / d; if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    };
    slab(ox, dx, p.x - p.hx, p.x + p.hx); slab(oz, dz, p.z - p.hz, p.z + p.hz);
    if (t1 >= t0 && t0 > 0 && (!best || t0 < best.t)) best = { t: t0, p };
  }
  return best;
}
