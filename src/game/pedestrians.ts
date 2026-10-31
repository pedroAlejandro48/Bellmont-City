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
/** Room kept between someone walking past and whatever they pass (beyond touching). */
const PASS_MARGIN = 0.3;
/**
 * The way to step this frame: straight for `target` if the next couple of metres are clear, else the smallest
 * turn to one side or the other that is clear (trying the side chosen last time first, so nobody dithers), and
 * back onto the line once past. Unlike adding up a push from each thing, this never walks into a gap that is too
 * narrow (between a tree and someone standing by it, say) just because the pushes cancel out.
 */
export function steer(x: number, z: number, target: [number, number], obstacles: readonly Obstacle[], prefer: 1 | -1 = 1): [number, number, 1 | -1] {
  let dx = target[0] - x, dz = target[1] - z;
  const dist = Math.hypot(dx, dz) || 1;
  dx /= dist; dz /= dist;
  const look = Math.min(2.4, dist + 0.3);
  // Only what is ahead or alongside matters (something just behind can't be walked into).
  const relevant = obstacles.filter((o) => (o.x - x) * dx + (o.z - z) * dz > -(o.r + NPC_RADIUS));
  const clear = (ux: number, uz: number) => relevant.every((o) => {
    const rx = o.x - x, rz = o.z - z, along = Math.max(0, Math.min(look, rx * ux + rz * uz));
    const room = o.r + NPC_RADIUS + PASS_MARGIN;
    // Already brushing it: any step that does not take us further in is fine.
    if (Math.hypot(rx, rz) < room) return rx * ux + rz * uz <= 0.05;
    return Math.hypot(rx - ux * along, rz - uz * along) >= room;
  });
  for (let step = 0; step <= 8; step++) {
    for (const side of step === 0 ? [1] : [prefer, -prefer]) {
      const a = side * step * (Math.PI / 12);
      const c = Math.cos(a), s = Math.sin(a), ux = dx * c - dz * s, uz = dx * s + dz * c;
      if (clear(ux, uz)) return [ux, uz, step === 0 ? prefer : (side as 1 | -1)];
    }
  }
  return [dx, dz, prefer];
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

type Box = { x: number; z: number; hx: number; hz: number; yaw: number };
/** A point in a box's own frame (its local x along hx, z along hz). */
function toBox(b: Box, x: number, z: number): [number, number] {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw), dx = x - b.x, dz = z - b.z;
  return [dx * c - dz * s, dx * s + dz * c];
}
/** Whether the straight walk from a to b passes through the box grown by `pad` on every side. */
export function segmentHitsBox(b: Box, a: [number, number], c: [number, number], pad: number) {
  const [ax, az] = toBox(b, a[0], a[1]), [cx, cz] = toBox(b, c[0], c[1]);
  const hx = b.hx + pad, hz = b.hz + pad;
  let t0 = 0, t1 = 1;
  for (const [p, d, h] of [[ax, cx - ax, hx], [az, cz - az, hz]] as const) {
    if (Math.abs(d) < 1e-9) { if (Math.abs(p) > h) return false; continue; }
    let lo = (-h - p) / d, hi = (h - p) / d;
    if (lo > hi) [lo, hi] = [hi, lo];
    t0 = Math.max(t0, lo); t1 = Math.min(t1, hi);
    if (t0 > t1) return false;
  }
  return true;
}
/**
 * Walking round a vehicle or bike that stands in the way (however long it is): the corner of it to head for,
 * whichever makes the shorter way round, or null when the way is clear. `previous` keeps a chosen side unless the
 * other is clearly shorter, so nobody dithers in front of a bus.
 */
export function detour(x: number, z: number, target: [number, number], boxes: readonly Box[], chosen: [number, number] | null): [number, number] | null {
  const pad = NPC_RADIUS + 0.15;
  // A corner already reached is done with: from there, on to the next.
  const previous = chosen && Math.hypot(chosen[0] - x, chosen[1] - z) > 1.2 ? chosen : null;
  const blocking = boxes.filter((b) => segmentHitsBox(b, [x, z], target, pad) && Math.hypot(b.x - x, b.z - z) < Math.max(b.hx, b.hz) + 8);
  if (!blocking.length) return null;
  // The nearest blocker decides.
  const b = blocking.reduce((n, o) => (Math.hypot(o.x - x, o.z - z) < Math.hypot(n.x - x, n.z - z) ? o : n));
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw), m = NPC_RADIUS + 0.6;
  const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([u, v]) => {
    const lx = u! * (b.hx + m), lz = v! * (b.hz + m);
    return [b.x + lx * c + lz * s, b.z - lx * s + lz * c] as [number, number];
  });
  let best: [number, number] | null = null, bestCost = Infinity, previousCost = Infinity;
  for (const corner of corners) {
    if (Math.hypot(corner[0] - x, corner[1] - z) < 0.3) continue;
    if (segmentHitsBox(b, [x, z], corner, pad - 0.05)) continue;
    // From a corner that still has the vehicle between it and the target, it is another corner further.
    const onward = segmentHitsBox(b, corner, target, pad - 0.05) ? 2 * (b.hx + b.hz) : 0;
    const cost = Math.hypot(corner[0] - x, corner[1] - z) + Math.hypot(target[0] - corner[0], target[1] - corner[1]) + onward;
    if (previous && Math.hypot(previous[0] - corner[0], previous[1] - corner[1]) < 1.5) previousCost = cost;
    if (cost < bestCost) { bestCost = cost; best = corner; }
  }
  if (previous && previousCost < bestCost + 2) return corners.find((k) => Math.hypot(previous[0] - k[0], previous[1] - k[1]) < 1.5) ?? best;
  return best;
}
