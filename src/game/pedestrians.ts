// Pedestrians (NPCs): where they walk and when they cross (pure, testable).
//
// Each walks the sidewalk loop around a block, corner to corner, now and then crossing to the next block. Across
// an avenue they only use a signalled intersection's zebra crossing, starting when the traffic they cross has
// just got a red light; small streets they cross wherever they reach the corner.
import { GAME_MINUTE, HALF, SIGNAL, blockCenter, blockIndex, isAvenue, isSignalled, rng, signalState, streetCenter } from "./config";

/** How far from a block's middle its sidewalk loop runs (between the building fronts and the kerb). */
export const WALK_RING = 18.4;
export const WALK_SPEED = 1.3;
/** Crossing an avenue, people walk briskly to be over before the light changes. */
export const CROSS_SPEED = 1.9;
export const NPC_RADIUS = 0.35;

/** A block's corners on its sidewalk loop, counter-clockwise from the (+x, +z) one. */
const CORNERS: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
export function cornerPoint(i: number, j: number, corner: number): [number, number] {
  const [sx, sz] = CORNERS[((corner % 4) + 4) % 4]!;
  return [blockCenter(i) + sx * WALK_RING, blockCenter(j) + sz * WALK_RING];
}

/** The street between block i and block i + side (across one axis). */
export const streetBetween = (i: number, side: 1 | -1) => streetCenter(side === 1 ? i : i - 1);

export type Leg =
  | { kind: "ring"; i: number; j: number; from: number; to: number }
  | { kind: "cross"; i: number; j: number; from: [number, number]; to: [number, number]; toBlock: [number, number]; toCorner: number;
      /** The road crossed: its axis of traffic and centre line, and whether it is an avenue (signalled). */
      roadAxis: "x" | "z"; road: number; avenue: boolean };

/** Where a leg ends. */
export function legEnd(leg: Leg): [number, number] {
  return leg.kind === "ring" ? cornerPoint(leg.i, leg.j, leg.to) : leg.to;
}

/**
 * Having reached `corner` of block (i, j) walking from corner `from`, what next: on round the loop (mostly the
 * same way), or across a street to the facing corner of the next block. Avenues are only crossed where there
 * are lights; the ring road at the city's edge never.
 */
export function nextLeg(i: number, j: number, corner: number, from: number, random: () => number): Leg {
  const [sx, sz] = CORNERS[((corner % 4) + 4) % 4]!;
  const crossings: Leg[] = [];
  // Across the street on the x side (traffic there runs along z), and on the z side (traffic runs along x).
  for (const axis of ["x", "z"] as const) {
    const side = (axis === "x" ? sx : sz) as 1 | -1;
    const ni = axis === "x" ? i + side : i, nj = axis === "z" ? j + side : j;
    if (Math.abs(ni) > HALF || Math.abs(nj) > HALF) continue;
    const road = streetBetween(axis === "x" ? i : j, side);
    const otherRoad = streetBetween(axis === "x" ? j : i, (axis === "x" ? sz : sx) as 1 | -1);
    const avenue = isAvenue(road);
    // The intersection this corner faces: the crossed road and the one along this side of the block.
    const [ix, iz] = axis === "x" ? [road, otherRoad] : [otherRoad, road];
    if (avenue && !isSignalled(ix, iz)) continue;
    const toCorner = CORNERS.findIndex(([cx, cz]) => (axis === "x" ? cx === -sx && cz === sz : cx === sx && cz === -sz));
    crossings.push({ kind: "cross", i, j, from: cornerPoint(i, j, corner), to: cornerPoint(ni, nj, toCorner), toBlock: [ni, nj], toCorner, roadAxis: axis === "x" ? "z" : "x", road, avenue });
  }
  if (crossings.length && random() < 0.35) return crossings[Math.floor(random() * crossings.length)]!;
  // Round the loop, usually carrying on the same way.
  const onward = corner + (corner - from === 1 || corner - from === -3 ? 1 : -1);
  const back = corner - (onward - corner);
  return { kind: "ring", i, j, from: corner, to: random() < 0.85 ? onward : back };
}

/** How long the light for traffic along `axis` has left before it changes from red (in seconds). */
export function redRemaining(axis: "x" | "z", elapsed: number) {
  if (signalState(axis, elapsed) !== "red") return 0;
  let t = 0;
  while (t < SIGNAL.red * GAME_MINUTE && signalState(axis, elapsed + t) === "red") t += 0.25;
  return t;
}

/** May someone start across this road now? Avenues: only with red for the traffic and time to get over. */
export function mayCross(leg: Extract<Leg, { kind: "cross" }>, elapsed: number) {
  if (!leg.avenue) return true;
  const length = Math.hypot(leg.to[0] - leg.from[0], leg.to[1] - leg.from[1]);
  return redRemaining(leg.roadAxis, elapsed) > length / CROSS_SPEED + 1;
}

/** Blocks beside the avenues are busier: pick a block near (x, z), favouring those. */
export function spawnBlock(fi: number, fj: number, random: () => number): [number, number] {
  for (let attempt = 0; attempt < 40; attempt++) {
    const i = Math.max(-HALF, Math.min(HALF, fi + Math.floor(random() * 7) - 3));
    const j = Math.max(-HALF, Math.min(HALF, fj + Math.floor(random() * 7) - 3));
    const busy = Math.abs(i) <= 1 || Math.abs(j) <= 1;
    if (busy || random() < 0.2) return [i, j];
  }
  return [fi, fj];
}

/** A spot on block (i, j)'s sidewalk loop, on the leg toward `to`. */
export function spawnOnRing(i: number, j: number, random: () => number) {
  const from = Math.floor(random() * 4), dir = random() < 0.5 ? 1 : -1, to = from + dir;
  const a = cornerPoint(i, j, from), b = cornerPoint(i, j, to), k = 0.1 + random() * 0.8;
  const leg: Leg = { kind: "ring", i, j, from: ((from % 4) + 4) % 4, to: ((to % 4) + 4) % 4 };
  return { x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, leg };
}

export type Obstacle = { x: number; z: number; r: number };
/**
 * The way to step this frame: toward `target`, bending around anything in the way within a couple of metres
 * (then back onto the line once past it).
 */
export function steer(x: number, z: number, target: [number, number], obstacles: readonly Obstacle[]): [number, number] {
  let dx = target[0] - x, dz = target[1] - z;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len; dz /= len;
  const px = -dz, pz = dx;
  let side = 0;
  for (const o of obstacles) {
    const rx = o.x - x, rz = o.z - z;
    const ahead = rx * dx + rz * dz, lateral = rx * px + rz * pz;
    const clear = o.r + NPC_RADIUS + 0.3;
    if (ahead <= -0.2 || ahead > 2.6 || Math.abs(lateral) >= clear) continue;
    // Step to whichever side of it is nearer to open; strongest when close.
    const push = (clear - Math.abs(lateral)) / clear * (1.4 - Math.min(1, ahead / 2.6) * 0.6);
    side += (lateral > 0 ? -1 : 1) * push;
  }
  let sx = dx + px * side * 1.6, sz = dz + pz * side * 1.6;
  const s = Math.hypot(sx, sz) || 1;
  sx /= s; sz /= s;
  return [sx, sz];
}

/** Each NPC's colour: about half pink, half blue. */
export function npcGender(seed: number, index: number): "female" | "male" {
  return rng(seed ^ (index * 2654435761))() < 0.5 ? "female" : "male";
}

/**
 * A walking route for someone found at (x, z) heading `yaw` (when another player takes over running the NPCs):
 * along their block's sidewalk loop toward the corner ahead.
 */
export function legFromPosition(x: number, z: number, yaw: number): Leg {
  const i = Math.max(-HALF, Math.min(HALF, blockIndex(x))), j = Math.max(-HALF, Math.min(HALF, blockIndex(z)));
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  let best = 0, bestScore = -Infinity;
  for (let c = 0; c < 4; c++) {
    const [cx, cz] = cornerPoint(i, j, c), dx = cx - x, dz = cz - z, d = Math.hypot(dx, dz) || 1;
    // Prefer a corner ahead, then a near one.
    const score = (dx * fx + dz * fz) / d * 2 - d / 20;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  const [ax, az] = cornerPoint(i, j, best + 1), [bx, bz] = cornerPoint(i, j, best - 1);
  const from = Math.hypot(ax - x, az - z) > Math.hypot(bx - x, bz - z) ? best + 1 : best - 1;
  return { kind: "ring", i, j, from: ((from % 4) + 4) % 4, to: best };
}

/**
 * NPCs shared in a multiplayer room. One player (the host) runs them and publishes a snapshot several times a
 * second; everyone else shows the host's NPCs and sends the host any hits their own traffic causes.
 */
export type NpcSnapshot = {
  /** Per NPC: id, x, z, yaw, speed, mode (0 walk, 1 stand, 2 wait), seconds since knocked down (-1 = up), hit direction x, z, seed. */
  list: number[][];
};
export type NpcLink = {
  isHost: () => boolean;
  publish: (snapshot: NpcSnapshot) => void;
  /** The host's latest snapshot (null when this player is the host or none has arrived). */
  latest: () => NpcSnapshot | null;
  sendHit: (id: number, direction: [number, number]) => void;
  /** Hits other players reported since last asked (host only). */
  takeHits: () => { id: number; direction: [number, number] }[];
};
export function isNpcSnapshot(value: unknown): value is NpcSnapshot {
  const v = value as { list?: unknown } | null;
  return typeof v === "object" && v !== null && Array.isArray(v.list) && v.list.every((row) => Array.isArray(row) && row.length >= 10 && row.every((n) => typeof n === "number" && Number.isFinite(n)));
}

/** At most this many people are about at once (daytime). */
export const NPC_MAX = 50;
/** How many people are about at an hour of the day: busy by day, fewer in the evening, a handful late at night. */
export function npcTarget(hours: number) {
  const h = ((hours % 24) + 24) % 24;
  if (h >= 6 && h < 20) return NPC_MAX;
  if (h >= 20 || h < 1) return 22;
  return 10;
}
/** People only appear or leave at least a block away from every player, so nobody pops in or out in view. */
export const NPC_APPEAR_DISTANCE = 60;

/**
 * A parked bike or a vehicle as things to step around: a row of circles along its length, each as wide as the
 * vehicle, so its ends are kept clear as well as its middle.
 */
export function boxObstacles(box: { x: number; z: number; hx: number; hz: number; yaw: number }): Obstacle[] {
  const c = Math.cos(box.yaw), s = Math.sin(box.yaw);
  // The box's local x and z directions in the world.
  const long = box.hx >= box.hz, half = long ? box.hx : box.hz, r = (long ? box.hz : box.hx) + 0.05;
  const [ux, uz] = long ? [c, -s] : [s, c];
  const count = Math.max(1, Math.ceil((half * 2) / Math.max(0.4, r)));
  return Array.from({ length: count + 1 }, (_, k) => {
    const a = -half + r + (half * 2 - 2 * r) * (count ? k / count : 0.5);
    return { x: box.x + ux * a, z: box.z + uz * a, r };
  });
}
