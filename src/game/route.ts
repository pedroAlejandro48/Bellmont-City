// GPS routes (pure). On foot the target is a point on a sidewalk and the route is straight there (through buildings,
// over the park: whatever is shortest); on a vehicle the target is the side of the nearest street and the route
// follows the streets (the shortest way along the grid, intersection to intersection).
import { BLOCK, HALF, blockCenter, blockIndex, streetCenter, streetHalfWidth } from "./config";

/** Every street's centre line across one axis, in order (the outermost two are the ring road). */
export const STREETS = Array.from({ length: 2 * HALF + 2 }, (_, i) => streetCenter(i - HALF - 1));
/** The sidewalk round each block: from SIDEWALK_IN to the block's edge, from its centre. */
const SIDEWALK_IN = BLOCK / 2 - 4.5, SIDEWALK_MID = BLOCK / 2 - 1.8;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const blockOf = (t: number) => clamp(blockIndex(t), -HALF, HALF);

/** The nearest point on a sidewalk (unchanged if it is on one already). */
export function sidewalkPoint(x: number, z: number): [number, number] {
  const bx = blockCenter(blockOf(x)), bz = blockCenter(blockOf(z));
  let lx = x - bx, lz = z - bz;
  const edge = BLOCK / 2;
  if (Math.abs(lx) <= edge && Math.abs(lz) <= edge && Math.max(Math.abs(lx), Math.abs(lz)) >= SIDEWALK_IN) return [x, z];
  lx = clamp(lx, -SIDEWALK_MID, SIDEWALK_MID); lz = clamp(lz, -SIDEWALK_MID, SIDEWALK_MID);
  if (SIDEWALK_MID - Math.abs(lx) < SIDEWALK_MID - Math.abs(lz)) lx = (lx < 0 ? -1 : 1) * SIDEWALK_MID;
  else lz = (lz < 0 ? -1 : 1) * SIDEWALK_MID;
  return [bx + lx, bz + lz];
}

const nearestIndex = (t: number) => STREETS.reduce((best, c, i) => (Math.abs(c - t) < Math.abs(STREETS[best]! - t) ? i : best), 0);
/** The street nearest a point: `x` a street running along z at x = STREETS[i], `z` one along x; `along` where on it. */
function onStreet(x: number, z: number) {
  const i = nearestIndex(x), j = nearestIndex(z);
  const lo = STREETS[0]!, hi = STREETS[STREETS.length - 1]!;
  return Math.abs(x - STREETS[i]!) <= Math.abs(z - STREETS[j]!)
    ? { axis: "x" as const, line: i, along: clamp(z, lo, hi), side: x - STREETS[i]! }
    : { axis: "z" as const, line: j, along: clamp(x, lo, hi), side: z - STREETS[j]! };
}

/** The side of the nearest street (by the kerb), for a vehicle to stop at. */
export function curbPoint(x: number, z: number): [number, number] {
  const s = onStreet(x, z), c = STREETS[s.line]!, off = (s.side < 0 ? -1 : 1) * (streetHalfWidth(c) - 1.6);
  return s.axis === "x" ? [c + off, s.along] : [s.along, c + off];
}

/** Where a route to (x, z) ends: on the sidewalk on foot, at the kerb on a vehicle. */
export const routeTarget = (x: number, z: number, vehicle: boolean) => (vehicle ? curbPoint(x, z) : sidewalkPoint(x, z));

/** The way from `from` to the target for (x, z), as points to draw a line through. */
export function routeTo(from: [number, number], to: [number, number], vehicle: boolean): [number, number][] {
  const end = routeTarget(to[0], to[1], vehicle);
  if (!vehicle) return [from, end];
  const n = STREETS.length, a = onStreet(from[0], from[1]), b = onStreet(end[0], end[1]);
  const at = (s: ReturnType<typeof onStreet>): [number, number] => (s.axis === "x" ? [STREETS[s.line]!, s.along] : [s.along, STREETS[s.line]!]);
  const p0 = at(a), p1 = at(b);
  // The two intersections either side of a point on a street (node = i * n + j: streets x = STREETS[i], z = STREETS[j]).
  const ends = (s: ReturnType<typeof onStreet>) => {
    let k = STREETS.findIndex((c) => c >= s.along);
    if (k < 0) k = n - 1;
    const ks = [...new Set([Math.max(0, k - 1), k])];
    return ks.map((m) => ({ node: s.axis === "x" ? s.line * n + m : m * n + s.line, d: Math.abs(STREETS[m]! - s.along) }));
  };
  const nodeXZ = (v: number): [number, number] => [STREETS[Math.floor(v / n)]!, STREETS[v % n]!];
  // The same stretch of the same street: straight along it.
  const sameStretch = a.axis === b.axis && a.line === b.line && ends(a).map((e) => e.node).join() === ends(b).map((e) => e.node).join();
  if (sameStretch) return [from, p0, p1, end];
  const dist = new Float64Array(n * n).fill(Infinity), prev = new Int32Array(n * n).fill(-1), done = new Uint8Array(n * n);
  for (const e of ends(a)) if (e.d < dist[e.node]!) dist[e.node] = e.d;
  const goal = new Map(ends(b).map((e) => [e.node, e.d] as [number, number]));
  let best = Infinity, bestNode = -1;
  for (;;) {
    let u = -1, du = Infinity;
    for (let v = 0; v < n * n; v++) if (!done[v] && dist[v]! < du) { du = dist[v]!; u = v; }
    if (u < 0 || du >= best) break;
    done[u] = 1;
    const g = goal.get(u);
    if (g !== undefined && du + g < best) { best = du + g; bestNode = u; }
    const i = Math.floor(u / n), j = u % n;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const i2 = i + di, j2 = j + dj;
      if (i2 < 0 || j2 < 0 || i2 >= n || j2 >= n) continue;
      const v = i2 * n + j2, w = du + Math.abs(STREETS[i2]! - STREETS[i]!) + Math.abs(STREETS[j2]! - STREETS[j]!);
      if (w < dist[v]!) { dist[v] = w; prev[v] = u; }
    }
  }
  const path: [number, number][] = [];
  for (let v = bestNode; v >= 0; v = prev[v]!) path.unshift(nodeXZ(v));
  return [from, p0, ...path, p1, end];
}

/** How long a route is (metres). */
export const routeLength = (pts: [number, number][]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]) : 0), 0);

export type Turn = "straight" | "right" | "left" | "uturn" | "arrive";
/** Which block a point is in (both axes). */
const blockOf2 = (x: number, z: number) => `${blockIndex(x)},${blockIndex(z)}`;
/**
 * What to do next on the way: once in the destination's block (the last street crossed), arrived (✓). On a vehicle,
 * what to do at the next corner of the route (a U-turn first if it runs back the way you're heading); on foot (the
 * route is straight), which way the destination lies from the way you face.
 */
export function nextTurn(pts: [number, number][], heading: number, vehicle: boolean, target: [number, number]): Turn {
  const here = pts[0]!;
  if (blockOf2(here[0], here[1]) === blockOf2(target[0], target[1])) return "arrive";
  const fx = Math.sin(heading), fz = Math.cos(heading);
  const side = (dx: number, dz: number): Turn => {
    const l = Math.hypot(dx, dz) || 1, ahead = (dx * fx + dz * fz) / l, cross = (fx * dz - fz * dx) / l;
    if (ahead < -0.7) return "uturn";
    if (Math.abs(cross) < 0.5 && ahead > 0) return "straight";
    return cross > 0 ? "right" : "left";
  };
  if (!vehicle || pts.length < 5) return side(target[0] - here[0], target[1] - here[1]);
  // pts: here, on the street, the corners…, the end on the street, the target.
  const a = pts[1]!, c = pts[2]!, d = pts[3]!;
  const d1x = c[0] - a[0], d1z = c[1] - a[1], l1 = Math.hypot(d1x, d1z);
  if (l1 > 0.5 && (d1x * fx + d1z * fz) / l1 < -0.5) return "uturn";
  const d2x = d[0] - c[0], d2z = d[1] - c[1], l2 = Math.hypot(d2x, d2z);
  if (l1 < 0.5 || l2 < 0.5) return "straight";
  const turn = (d1x * d2z - d1z * d2x) / (l1 * l2), along = (d1x * d2x + d1z * d2z) / (l1 * l2);
  if (along < -0.7) return "uturn";
  if (Math.abs(turn) < 0.5) return "straight";
  return turn > 0 ? "right" : "left";
}
