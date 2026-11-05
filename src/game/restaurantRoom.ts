// Restaurant interiors: layout, furniture physics, and the scripted door and chair movements (pure, testable).
//
// Everything here is in the entrance's own frame: origin at the middle of the entrance wall on the floor, +z
// out to the street, +x to the right of someone standing outside looking at the door. Turns are multiples of
// 90°, so boxes in this frame stay boxes in the world.
import { BUILDING_ENTRANCE, buildingLayout, SIDEWALK_H, type Building, type RestaurantKind, type VenueKind } from "./config";
import { venueLayout } from "./venueRoom";

export const WALL = 0.2;
export const CEILING = 4.3;
/** The doorway: two 1 m glass leaves hinged at its outer edges, opening out to the street. */
export const LEAF = 1;
export const DOOR_H = 2.45;
export const HANDLE = { r: 0.88, y: 1.05, out: 0.07 };
export const PUSH = { r: 0.42, y: 1.05, in: -0.05 };
export const CHAIR = { half: 0.22, seatTop: 0.46, backTop: 0.95, back: 0.2 };
export const TABLE = { half: 0.45, top: 0.78, leg: 0.39, legHalf: 0.03 };
export const COUNTER = { depth: 0.7, height: 1.05 };
/** How deep the dining room is (the kitchen behind it gets the rest of the building). */
export const DINING = 6.9;
export const KITCHEN_DOOR = 1.2;
export const KITCHEN_DOOR_H = 2.3;
export const WINDOW = { y0: 0.8, y1: 3 };
const BODY = 0.35;
const WALK = 2.2;

export type Box = { x: number; z: number; hx: number; hz: number };
export type Item = { kind: "table" | "chair"; x: number; z: number; f: [number, number] };
export type Frame = { ox: number; oz: number; c: number; s: number; rot: number };
export type RoomLayout = {
  key: string; kind: RestaurantKind; frame: Frame;
  /** Width along the entrance wall and depth into the building. */
  width: number; depth: number;
  /** Where people can stand: inside the walls. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  counter: Box;
  /** Which side wall (local x sign) faces the other street, with windows. */
  windowSide: 1 | -1;
  /** The wall splitting the dining room (front) from the kitchen (back): its dining-side face, and the doorway. */
  divider: { z: number; doorX: number };
  /** Window openings (from x0 to x1, or z0 to z1, along the wall), on the entrance wall and the other street wall. */
  frontWindows: [number, number][]; sideWindows: [number, number][];
  /** Everything fixed that people and furniture bump into: the counter, the divider, the plants. */
  solids: Box[];
  plants: [number, number][];
  /** Set for a venue (a shop, the hospital, the police): a room without a kitchen, always open. */
  venue?: VenueKind;
};
export type Room = RoomLayout & { items: Item[]; doors: { left: number; right: number } };

export const roomKey = (b: { x: number; z: number }) => `${b.x}:${b.z}`;

export function roomLayout(b: Building): RoomLayout {
  if (b.venue) return venueLayout(b);
  const L = buildingLayout(b);
  const alongX = L.door === "x";
  const ox = alongX ? b.x + L.sx * b.w / 2 : b.x, oz = alongX ? b.z : b.z + L.sz * b.d / 2;
  const rot = alongX ? L.sx * Math.PI / 2 : L.sz === 1 ? 0 : Math.PI;
  const frame = { ox, oz, c: Math.cos(rot), s: Math.sin(rot), rot };
  const width = alongX ? b.d : b.w, depth = alongX ? b.w : b.d;
  // The building's other street side, seen from the entrance.
  const [nx, nz] = alongX ? [0, L.sz] : [L.sx, 0];
  const windowSide = nx * frame.c - nz * frame.s > 0 ? 1 : -1;
  const bounds = { minX: -width / 2 + WALL, maxX: width / 2 - WALL, minZ: -depth + WALL, maxZ: -WALL };
  // The dining room takes the front DINING metres; the kitchen gets the rest, behind the divider.
  const dividerZ = bounds.maxZ - DINING;
  const length = Math.min(4, width * 0.34);
  const counter = { x: -windowSide * (width / 2 - WALL - 0.25 - length / 2), z: dividerZ + 1.1 + COUNTER.depth / 2, hx: length / 2, hz: COUNTER.depth / 2 };
  const doorX = counter.x;
  const solids: Box[] = [
    counter,
    { x: (bounds.minX + doorX - KITCHEN_DOOR / 2) / 2, z: dividerZ - WALL / 2, hx: (doorX - KITCHEN_DOOR / 2 - bounds.minX) / 2, hz: WALL / 2 },
    { x: (bounds.maxX + doorX + KITCHEN_DOOR / 2) / 2, z: dividerZ - WALL / 2, hx: (bounds.maxX - doorX - KITCHEN_DOOR / 2) / 2, hz: WALL / 2 },
  ];
  // Potted plants in the two front corners.
  const plants: [number, number][] = [[windowSide * (bounds.maxX - 0.4), bounds.maxZ - 0.45], [-windowSide * (bounds.maxX - 0.4), bounds.maxZ - 0.45]];
  for (const [x, z] of plants) solids.push({ x, z, hx: 0.28, hz: 0.28 });
  // An invisible wall at the open end of the counter, so customers can't go round behind it into the kitchen.
  const end = counter.x + windowSide * counter.hx;
  solids.push({ x: end + windowSide * 0.05, z: (dividerZ + counter.z) / 2, hx: 0.05, hz: (counter.z - dividerZ) / 2 });
  const frontWindows: [number, number][] = [[-width / 2 + 0.7, -LEAF - 0.75], [LEAF + 0.75, width / 2 - 0.7]];
  // Side windows stay clear of the divider: two in the dining room, one in the kitchen if it is deep enough.
  const dineFrom = dividerZ + 0.5, dineTo = bounds.maxZ - 0.5, half = (dineTo - dineFrom - 0.6) / 2;
  const sideWindows: [number, number][] = [[dineFrom, dineFrom + half], [dineTo - half, dineTo]];
  const kitchenTo = dividerZ - WALL - 0.6, kitchenFrom = bounds.minZ + 0.6;
  if (kitchenTo - kitchenFrom > 1.2) sideWindows.push([kitchenFrom, kitchenTo]);
  return { key: roomKey(b), kind: b.restaurant ?? "cafe", frame, width, depth, bounds, counter, windowSide, divider: { z: dividerZ, doorX }, frontWindows, sideWindows, solids, plants };
}

/** Four square tables, two chairs each (facing each other across the table), in the dining room by the windows. */
export function furnish(layout: RoomLayout): Item[] {
  const { bounds, windowSide: m } = layout;
  const edge = m === 1 ? bounds.maxX : -bounds.minX;
  const items: Item[] = [];
  for (const col of [1.45, 4.15]) for (const row of [3.0, 5.6]) {
    const x = m * (edge - col), z = bounds.maxZ - row;
    items.push({ kind: "table", x, z, f: [0, 1] });
    // Seats tucked under the table: the front of each seat 12 cm under the table top.
    for (const side of [-1, 1] as const) items.push({ kind: "chair", x: x + side * (TABLE.half + CHAIR.half - 0.12), z, f: [-side, 0] });
  }
  return items.slice(0, 12);
}

export function makeRoom(b: Building): Room {
  const layout = roomLayout(b);
  return { ...layout, items: layout.venue ? [] : furnish(layout), doors: { left: 0, right: 0 } };
}

export function toWorld(f: Frame, x: number, z: number): [number, number] {
  return [f.ox + x * f.c + z * f.s, f.oz - x * f.s + z * f.c];
}
export function toLocal(f: Frame, wx: number, wz: number): [number, number] {
  const dx = wx - f.ox, dz = wz - f.oz;
  return [dx * f.c - dz * f.s, dx * f.s + dz * f.c];
}
/** A heading in the room (facing (sin, cos)) as a world yaw, and back. */
export const worldYaw = (f: Frame, local: number) => local + f.rot;
export const localYaw = (f: Frame, world: number) => world - f.rot;

// ---------- furniture shapes ----------

const box = (x: number, z: number, hx: number, hz: number): Box => ({ x, z, hx, hz });
export const tableTop = (t: Item) => box(t.x, t.z, TABLE.half, TABLE.half);
export const tableLegs = (t: Item) => [-1, 1].flatMap((a) => [-1, 1].map((b) => box(t.x + a * TABLE.leg, t.z + b * TABLE.leg, TABLE.legHalf, TABLE.legHalf)));
export const chairSeat = (c: Item) => box(c.x, c.z, CHAIR.half, CHAIR.half);
export function chairBack(c: Item) {
  const [fx, fz] = c.f;
  return box(c.x - fx * CHAIR.back, c.z - fz * CHAIR.back, Math.abs(fx) * 0.025 + Math.abs(fz) * CHAIR.half, Math.abs(fz) * 0.025 + Math.abs(fx) * CHAIR.half);
}
/** What a person (or a wall) touches: a table's top, a chair's whole seat and back. */
export const footprint = (it: Item) => (it.kind === "table" ? tableTop(it) : chairSeat(it));

/** How far to move `b` so it no longer overlaps `a` (along the shorter way out), or null if apart. */
export function separation(a: Box, b: Box): [number, number] | null {
  const dx = b.x - a.x, dz = b.z - a.z;
  const ox = a.hx + b.hx - Math.abs(dx), oz = a.hz + b.hz - Math.abs(dz);
  if (ox <= 1e-6 || oz <= 1e-6) return null;
  return ox < oz ? [(dx >= 0 ? 1 : -1) * ox, 0] : [0, (dz >= 0 ? 1 : -1) * oz];
}

/**
 * The parts of two pieces of furniture that can collide. A seat slides under a table top (it is lower), but
 * not through the table's legs; a chair's back is tall enough to hit the table top.
 */
export function contacts(a: Item, b: Item): [Box, Box][] {
  if (a.kind === "table" && b.kind === "table") return [[tableTop(a), tableTop(b)]];
  if (a.kind === "chair" && b.kind === "chair") return [[chairSeat(a), chairSeat(b)]];
  if (a.kind === "chair") return [...tableLegs(b).flatMap((leg): [Box, Box][] => [[chairSeat(a), leg], [chairBack(a), leg]]), [chairBack(a), tableTop(b)]];
  return [...tableLegs(a).flatMap((leg): [Box, Box][] => [[leg, chairSeat(b)], [leg, chairBack(b)]]), [tableTop(a), chairBack(b)]];
}

/** Keeps a piece of furniture inside the walls and out of the counter, the divider and the plants. */
function settleStatic(room: RoomLayout, it: Item) {
  const fp = footprint(it), { minX, maxX, minZ, maxZ } = room.bounds;
  const reach = it.kind === "chair" ? Math.max(fp.hx, fp.hz) : fp.hx;
  it.x = Math.max(minX + reach, Math.min(maxX - reach, it.x));
  it.z = Math.max(minZ + reach, Math.min(maxZ - reach, it.z));
  for (const solid of room.solids) {
    const out = separation(solid, footprint(it));
    if (out) { it.x += out[0]; it.z += out[1]; }
  }
}

/**
 * Moves one piece of furniture, shoving whatever it runs into (which may shove others in turn). Walls and the
 * counter stop everything. Returns how far it really moved.
 */
export function moveItem(room: Room, index: number, dx: number, dz: number, depth = 0): [number, number] {
  const it = room.items[index];
  if (!it) return [0, 0];
  const x0 = it.x, z0 = it.z;
  it.x += dx; it.z += dz;
  settleStatic(room, it);
  for (let pass = 0; pass < 2; pass++) {
    room.items.forEach((other, j) => {
      if (j === index) return;
      for (const [mine, theirs] of contacts(it, other)) {
        const out = separation(mine, theirs);
        if (!out) continue;
        const moved: [number, number] = depth < 3 ? moveItem(room, j, out[0], out[1], depth + 1) : [0, 0];
        // Whatever the other piece could not give way, this one gives back.
        it.x -= out[0] - moved[0]; it.z -= out[1] - moved[1];
      }
    });
  }
  settleStatic(room, it);
  return [it.x - x0, it.z - z0];
}

function circleOut(px: number, pz: number, r: number, b: Box): [number, number] {
  const nx = Math.max(b.x - b.hx, Math.min(b.x + b.hx, px)), nz = Math.max(b.z - b.hz, Math.min(b.z + b.hz, pz));
  let dx = px - nx, dz = pz - nz;
  const d = Math.hypot(dx, dz);
  if (d >= r) return [0, 0];
  if (d > 1e-6) return [dx / d * (r - d), dz / d * (r - d)];
  const options = [px - (b.x - b.hx), b.x + b.hx - px, pz - (b.z - b.hz), b.z + b.hz - pz];
  const i = options.indexOf(Math.min(...options));
  dx = i === 0 ? -(options[0]! + r) : i === 1 ? options[1]! + r : 0;
  dz = i === 2 ? -(options[2]! + r) : i === 3 ? options[3]! + r : 0;
  return [dx, dz];
}

/**
 * A person at (x, z) in the room this frame. Walking, furniture is as solid as a wall. Running into it shoves
 * it along at walking pace (and the person slows to that pace). Returns where the person ends up.
 */
export function stepPerson(room: Room, x: number, z: number, running: boolean, dt: number): [number, number] {
  let px = x, pz = z;
  const { minX, maxX, minZ, maxZ } = room.bounds;
  for (let pass = 0; pass < 2; pass++) {
    room.items.forEach((it, i) => {
      let [ox, oz] = circleOut(px, pz, BODY, footprint(it));
      if (!ox && !oz) return;
      if (running) {
        const len = Math.hypot(ox, oz), amount = Math.min(len, WALK * dt);
        moveItem(room, i, -ox / len * amount, -oz / len * amount);
        [ox, oz] = circleOut(px, pz, BODY, footprint(it));
      }
      px += ox; pz += oz;
    });
    for (const solid of room.solids) { const [cx, cz] = circleOut(px, pz, BODY, solid); px += cx; pz += cz; }
    px = Math.max(minX + BODY, Math.min(maxX - BODY, px));
    pz = Math.max(minZ + BODY, Math.min(maxZ - BODY, pz));
  }
  return [px, pz];
}

// ---------- doors ----------

/** A point on a door leaf `r` from its hinge, with the leaf opened `angle` (outward). */
export function onLeaf(leaf: "left" | "right", angle: number, r: number, out = 0): [number, number] {
  const side = leaf === "right" ? 1 : -1;
  return [side * (LEAF - r * Math.cos(angle)) + side * out * Math.sin(angle), r * Math.sin(angle) + out * Math.cos(angle)];
}

/** The place in front of the entrance where the door can be used (outside) and just inside it. */
export const nearDoorOutside = (x: number, z: number) => Math.abs(x) < 1.6 && z > 0.05 && z < 2.3;
export const nearDoorInside = (x: number, z: number) => Math.abs(x) < 1.6 && z < -0.1 && z > -2.4;

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
export const smooth = (t: number) => { const c = clamp01(t); return c * c * (3 - 2 * c); };
const seg = (t: number, a: number, b: number) => smooth((t - a) / (b - a));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp2 = (a: [number, number], b: [number, number], t: number): [number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const turn = (from: number, to: number, t: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * t;
/** Along a path of points, a fraction `t` of its length in. */
function along(points: [number, number][], t: number): [number, number] {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i]![0], p[1] - points[i]![1]));
  let d = clamp01(t) * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    const l = lengths[i]!;
    if (d <= l || i === lengths.length - 1) return lerp2(points[i]!, points[i + 1]!, l ? Math.min(1, d / l) : 1);
    d -= l;
  }
  return points[points.length - 1]!;
}

/** Walking pace for scripted steps (m/s). */
const STEP = 1.25;
/** How long walking from one spot to another takes, turning included. */
export const walkTime = (from: [number, number], to: [number, number]) => Math.hypot(to[0] - from[0], to[1] - from[1]) / STEP + 0.35;
/**
 * Walking `k` (0..1) of the way from one spot to another: turning to face the way to go, stepping there, then
 * turning to `endYaw`. A short shuffle (under 0.6 m) is stepped without turning away.
 */
export function walkTo(k: number, from: [number, number], to: [number, number], fromYaw: number, endYaw: number) {
  const at = lerp2(from, to, smooth(k));
  const dx = to[0] - from[0], dz = to[1] - from[1];
  if (Math.hypot(dx, dz) < 0.6) return { at, yaw: turn(fromYaw, endYaw, smooth(k / 0.8)) };
  const heading = Math.atan2(dx, dz);
  const yaw = k < 0.25 ? turn(fromYaw, heading, smooth(k / 0.25)) : k > 0.72 ? turn(heading, endYaw, smooth((k - 0.72) / 0.28)) : heading;
  return { at, yaw };
}
/**
 * Scripts start with a walk planned to take `base` seconds; when the walk is longer, the walk stretches and the
 * rest of the script starts later. Maps real time to script time, and returns the extra time.
 */
export function stretch(time: number, walk: number, base: number) {
  const extra = Math.max(0, walk - base);
  return { t: time < base + extra ? time * base / (base + extra) : time - extra, extra };
}

/** One hand reaching for a point (room frame, height above the floor), and the way its elbow points. */
export type Reach = { at: [number, number, number]; blend: number; pole: "low" | "out" | "back" };
/** One moment of a scripted movement, in the room frame. */
export type Pose = {
  x: number; z: number; yaw: number; sit: number; shuffle: number; lean: number;
  right: Reach | null; left: Reach | null;
};
export type DoorPose = Pose & { door: { left: number; right: number }; fade: number };

/** Going in: no fade any more; it is done once the door has closed behind (the camera came in with the player). */
/** `free`: when the character is clear of the door's swing, a step into the room, and can be moved again. */
export const ENTER = { open: 0.9, release: 2.0, walk: [2.3, 4.6] as const, close: [3.6, 5.8] as const, done: 5.85, free: 3.5 };
const FACE_IN = Math.PI, FACE_OUT = 0;
/** The lobby spot just inside, facing into the restaurant with the door behind. */
export const LOBBY: [number, number] = [0.5, -2.7];

/**
 * Going in: reach for the right door's handle, pull it open while stepping back, let go as it swings wide, walk
 * in while it slowly closes behind.
 */
const ENTER_STAND: [number, number] = [-0.05, 0.48];
/** Extra seconds going in takes for walking up to the door from further away. */
export const enterLead = (from: [number, number]) => stretch(0, walkTime(from, ENTER_STAND), 0.7).extra;
export function enterPose(time: number, from: [number, number], fromYaw: number): DoorPose {
  const stand = ENTER_STAND, back: [number, number] = [0, 1.0];
  const { t } = stretch(time, walkTime(from, stand), 0.7);
  const opened = t < ENTER.release ? 35 * seg(t, ENTER.open, ENTER.release) : 35 + 65 * Math.sin(Math.PI / 2 * clamp01((t - ENTER.release) / 0.8));
  const closing = seg(t, ENTER.close[0], ENTER.close[1]);
  const right = (opened * (1 - closing)) * Math.PI / 180;
  let at: [number, number], yaw: number;
  if (t < 0.7) ({ at, yaw } = walkTo(t / 0.7, from, stand, fromYaw, FACE_IN));
  else if (t < ENTER.open) { at = stand; yaw = FACE_IN; }
  else if (t < ENTER.walk[0]) { at = lerp2(stand, back, seg(t, ENTER.open, ENTER.release)); yaw = FACE_IN; }
  else { at = along([back, [0.5, 0.35], LOBBY], seg(t, ENTER.walk[0], ENTER.walk[1])); yaw = FACE_IN; }
  const handle = onLeaf("right", right, HANDLE.r, HANDLE.out);
  const hold = seg(t, 0.4, ENTER.open) * (1 - seg(t, ENTER.release, ENTER.release + 0.3));
  return {
    x: at[0], z: at[1], yaw, sit: 0, shuffle: 0, lean: 0.12 * hold,
    right: hold > 0 ? { at: [handle[0], HANDLE.y, handle[1]], blend: hold, pole: "low" } : null, left: null,
    door: { left: 0, right }, fade: 0,
  };
}

/** `free`: when the character is out on the sidewalk, clear of the door's swing, and can be moved again. */
export const LEAVE = { push: [1.1, 2.3] as const, release: 2.1, walk: [2.3, 4.4] as const, close: [3.4, 5.4] as const, done: 5.45, free: 3.45 };
/** Just outside, facing the street. */
export const OUTSIDE: [number, number] = [-0.45, 2.6];

/**
 * Coming out: walk up to the door, push the right-hand door open with the right hand while walking on, let go
 * as it swings wide, and stop outside while it closes behind.
 */
const LEAVE_START: [number, number] = [-0.45, -1.0];
/** Extra seconds coming out takes for walking up to the door from further away. */
export const leaveLead = (from: [number, number]) => stretch(0, walkTime(from, LEAVE_START), 0.7).extra;
export function leavePose(time: number, from: [number, number], fromYaw: number): DoorPose {
  const start = LEAVE_START, reach: [number, number] = [-0.45, -0.5];
  const { t } = stretch(time, walkTime(from, start), 0.7);
  const pushed = seg(t, LEAVE.push[0], LEAVE.push[1]);
  const coast = clamp01((t - LEAVE.push[1]) / 0.6);
  const opened = (70 * pushed + 25 * Math.sin(Math.PI / 2 * coast)) * (1 - seg(t, LEAVE.close[0], LEAVE.close[1]));
  const left = opened * Math.PI / 180;
  const point = onLeaf("left", left, PUSH.r, PUSH.in);
  let at: [number, number], yaw = FACE_OUT;
  if (t < 0.7) ({ at, yaw } = walkTo(t / 0.7, from, start, fromYaw, FACE_OUT));
  else if (t < LEAVE.push[0]) at = lerp2(start, reach, seg(t, 0.7, LEAVE.push[0]));
  else if (t < LEAVE.push[1]) at = [reach[0], lerp(reach[1], -0.05, pushed)];
  else at = [reach[0], lerp(-0.05, OUTSIDE[1], smooth((t - LEAVE.push[1]) / (LEAVE.walk[1] - LEAVE.push[1])))];
  const hold = seg(t, 0.4, 0.9) * (1 - seg(t, LEAVE.release, LEAVE.release + 0.4));
  return {
    x: at[0], z: at[1], yaw, sit: 0, shuffle: 0, lean: 0.1 * hold,
    right: hold > 0 ? { at: [point[0], PUSH.y, point[1]], blend: hold, pole: "low" } : null, left: null,
    door: { left, right: 0 }, fade: 0,
  };
}

// ---------- chairs ----------

/** Standing behind a chair (on the side of its back), facing it: the only place it can be sat on from. */
export function behindChair(c: Item, x: number, z: number, yaw: number) {
  const [fx, fz] = c.f, dx = x - c.x, dz = z - c.z;
  const back = -(dx * fx + dz * fz), lateral = Math.abs(dx * fz - dz * fx);
  const facing = Math.sin(yaw) * fx + Math.cos(yaw) * fz;
  return back > CHAIR.half + 0.15 && back < 1.3 && lateral < 0.45 && facing > 0.35;
}

/** The table a chair faces, if any (within reach in front of the seat). */
export function tableAhead(room: Room, c: Item) {
  const [fx, fz] = c.f;
  let best: { index: number; gap: number } | null = null;
  room.items.forEach((t, index) => {
    if (t.kind !== "table") return;
    const dx = t.x - c.x, dz = t.z - c.z, ahead = dx * fx + dz * fz, lateral = Math.abs(dx * fz - dz * fx);
    const gap = ahead - TABLE.half - CHAIR.half;
    if (ahead > 0 && lateral < TABLE.half && gap < 1.0 && (!best || gap < best.gap)) best = { index, gap };
  });
  return best as { index: number; gap: number } | null;
}

/** How far a chair can slide along (dx, dz) before touching anything (furniture other than `ignore`, walls). */
export function freeSlide(room: Room, index: number, dx: number, dz: number, distance: number) {
  const it = room.items[index];
  if (!it) return 0;
  const len = Math.hypot(dx, dz) || 1;
  let free = 0;
  for (let d = 0.02; d <= distance + 1e-6; d += 0.02) {
    const moved = { ...it, x: it.x + dx / len * d, z: it.z + dz / len * d };
    const fp = footprint(moved), { minX, maxX, minZ, maxZ } = room.bounds;
    if (fp.x - fp.hx < minX || fp.x + fp.hx > maxX || fp.z - fp.hz < minZ || fp.z + fp.hz > maxZ || room.solids.some((solid) => separation(solid, fp))) break;
    if (room.items.some((o, j) => j !== index && contacts(moved, o).some(([a, b]) => separation(a, b)))) break;
    free = d;
  }
  return Math.min(free, distance);
}

export type SitPlan = {
  chair: number; f: [number, number]; side: 1 | -1;
  start: [number, number]; startYaw: number;
  /** Chair: where it was, pulled out, and slid back in to the table. */
  c0: [number, number]; c1: [number, number]; c2: [number, number];
  table: number | null;
  /** Extra seconds for walking up to the chair from further away. */
  extra: number;
};

export const SIT = { approach: 0.7, pull: [0.9, 1.7] as const, around: [1.9, 3.4] as const, down: [3.4, 4.3] as const, scoot: [4.3, 5.3] as const, hands: [5.3, 6.1] as const, done: 6.1 };

export function planSit(room: Room, chair: number, x: number, z: number, yaw: number): SitPlan | null {
  const c = room.items[chair];
  if (!c || c.kind !== "chair") return null;
  const [fx, fz] = c.f;
  const table = tableAhead(room, c);
  // Pull it out until there is room to stand between the seat and the table.
  const want = table ? Math.max(0, 0.68 - table.gap) : 0;
  const pull = freeSlide(room, chair, -fx, -fz, want);
  const gap = table ? table.gap + pull : Infinity;
  const scoot = table ? Math.max(0, gap - 0.1) : 0;
  const c0: [number, number] = [c.x, c.z], c1: [number, number] = [c.x - fx * pull, c.z - fz * pull];
  const c2: [number, number] = [c1[0] + fx * scoot, c1[1] + fz * scoot];
  // Walk around whichever side has more room.
  const clearance = (side: number) => {
    const sx = c1[0] + fz * side * 0.65, sz = c1[1] - fx * side * 0.65;
    const near = room.items.filter((o, j) => j !== chair).map((o) => { const b = footprint(o); return Math.max(Math.abs(sx - b.x) - b.hx, Math.abs(sz - b.z) - b.hz); });
    const { minX, maxX, minZ, maxZ } = room.bounds;
    return Math.min(sx - minX, maxX - sx, sz - minZ, maxZ - sz, ...near);
  };
  const side = clearance(1) >= clearance(-1) ? 1 : -1;
  const extra = stretch(0, walkTime([x, z], [c.x - fx * 0.64, c.z - fz * 0.64]), SIT.approach).extra;
  return { chair, f: [fx, fz], side, start: [x, z], startYaw: yaw, c0, c1, c2, table: table?.index ?? null, extra };
}

/** Sitting down, `t` seconds in (standing up plays it backward). Returns the person and where the chair is. */
export function sitPose(plan: SitPlan, time: number, room: Room): Pose & { chair: [number, number] } {
  const t = time < SIT.approach + plan.extra ? time * SIT.approach / (SIT.approach + plan.extra) : time - plan.extra;
  const [fx, fz] = plan.f, rx = fz * plan.side, rz = -fx * plan.side;
  const face = Math.atan2(fx, fz);
  const behind = (c: [number, number], extra = 0): [number, number] => [c[0] - fx * (0.64 + extra), c[1] - fz * (0.64 + extra)];
  const pulled = seg(t, SIT.pull[0], SIT.pull[1]), scooted = seg(t, SIT.scoot[0], SIT.scoot[1]);
  const chair = scooted > 0 ? lerp2(plan.c1, plan.c2, scooted) : lerp2(plan.c0, plan.c1, pulled);
  const beside: [number, number] = [plan.c1[0] + rx * 0.66, plan.c1[1] + rz * 0.66];
  const front: [number, number] = [plan.c1[0] + fx * 0.5, plan.c1[1] + fz * 0.5];
  const seatAt = (c: [number, number]): [number, number] => [c[0] - fx * 0.04, c[1] - fz * 0.04];
  let at: [number, number], yaw = face;
  if (t < SIT.approach) ({ at, yaw } = walkTo(t / SIT.approach, plan.start, behind(plan.c0), plan.startYaw, face));
  else if (t < SIT.pull[0]) at = behind(plan.c0);
  else if (t < SIT.around[0]) at = behind(chair);
  else if (t < SIT.down[0]) {
    const k = seg(t, SIT.around[0], SIT.around[1]);
    const path: [number, number][] = [behind(plan.c1), [beside[0] - fx * 0.3, beside[1] - fz * 0.3], [beside[0] + fx * 0.45, beside[1] + fz * 0.45], front];
    at = along(path, k);
    const ahead = along(path, Math.min(1, k + 0.08));
    const heading = Math.hypot(ahead[0] - at[0], ahead[1] - at[1]) > 1e-3 ? Math.atan2(ahead[0] - at[0], ahead[1] - at[1]) : face;
    // Walk around facing the way he goes, then turn his back to the chair (facing the table).
    yaw = turn(heading, face, seg(t, SIT.around[1] - 0.35, SIT.around[1]));
  } else if (t < SIT.scoot[0]) at = lerp2(front, seatAt(plan.c1), seg(t, SIT.down[0], SIT.down[1]));
  else at = seatAt(chair);
  const sit = seg(t, SIT.down[0] + 0.1, SIT.down[1]);
  const bendDown = Math.sin(Math.PI * seg(t, SIT.down[0], SIT.down[1]));
  // Both hands on the top of the backrest while pulling it out.
  const grip = seg(t, 0.45, SIT.pull[0]) * (1 - seg(t, SIT.pull[1], SIT.pull[1] + 0.3));
  // Then on the front of the seat while sitting and shuffling in; then up onto the table.
  const seatHold = seg(t, SIT.down[0], SIT.down[0] + 0.35) * (1 - seg(t, SIT.hands[0], SIT.hands[0] + 0.3));
  const tableT = seg(t, SIT.hands[0], SIT.hands[1]);
  const table = plan.table !== null ? room.items[plan.table] : null;
  const hand = (side: 1 | -1): Reach | null => {
    const lx = fz * side, lz = -fx * side; // the person's left (side 1) and right (side -1) as seen facing f
    if (grip > 0) {
      const b = [chair[0] - fx * CHAIR.back + lx * 0.17, CHAIR.backTop + 0.02, chair[1] - fz * CHAIR.back + lz * 0.17] as [number, number, number];
      return { at: b, blend: grip, pole: "out" };
    }
    const seatFront: [number, number, number] = [chair[0] + fx * (CHAIR.half - 0.03) + lx * 0.2, CHAIR.seatTop + 0.02, chair[1] + fz * (CHAIR.half - 0.03) + lz * 0.2];
    if (tableT <= 0) return seatHold > 0 ? { at: seatFront, blend: seatHold, pole: "out" } : null;
    const knee: [number, number, number] = [at[0] + fx * 0.42 + lx * 0.12, CHAIR.seatTop + 0.16, at[1] + fz * 0.42 + lz * 0.12];
    if (!table) return { at: knee, blend: tableT, pole: "out" };
    // Elbows back so the hands come up in front of the table edge, then forward to rest on it.
    const edge = TABLE.half - (table.x - chair[0]) * fx - (table.z - chair[1]) * fz; // negative: distance from seat centre to the edge
    const toEdge = -edge;
    const lifted: [number, number, number] = [chair[0] + fx * (toEdge - 0.1) + lx * 0.2, TABLE.top + 0.16, chair[1] + fz * (toEdge - 0.1) + lz * 0.2];
    const rest: [number, number, number] = [chair[0] + fx * (toEdge + 0.2) + lx * 0.15, TABLE.top + 0.05, chair[1] + fz * (toEdge + 0.2) + lz * 0.15];
    const k1 = smooth(tableT / 0.55), k2 = smooth((tableT - 0.45) / 0.55);
    const p: [number, number, number] = [0, 1, 2].map((i) => lerp(lerp(seatFront[i]!, lifted[i]!, k1), rest[i]!, k2)) as [number, number, number];
    return { at: p, blend: 1, pole: "back" };
  };
  return {
    x: at[0], z: at[1], yaw, sit, chair,
    shuffle: Math.sin(Math.PI * scooted) > 0 && scooted < 1 ? 1 : 0,
    lean: 0.38 * grip + 0.45 * bendDown + 0.12 * tableT * (table ? 1 : 0),
    left: hand(1), right: hand(-1),
  };
}

/** Pieces of a restaurant's room in world space (for the physics colliders of its walls and ceiling). */
export function roomShell(b: Building) {
  const layout = roomLayout(b), { frame, width, depth } = layout;
  const fh = BUILDING_ENTRANCE.floorHeight;
  const piece = (x: number, z: number, hx: number, hz: number, y: number, hy: number) => {
    const [wx, wz] = toWorld(frame, x, z);
    const turned = Math.abs(frame.s) > 0.5;
    return { x: wx, z: wz, y: SIDEWALK_H + y, hx: turned ? hz : hx, hz: turned ? hx : hz, hy };
  };
  return [
    piece(0, -WALL / 2, width / 2, WALL / 2, fh / 2, fh / 2),
    piece(0, -depth + WALL / 2, width / 2, WALL / 2, fh / 2, fh / 2),
    piece(-width / 2 + WALL / 2, -depth / 2, WALL / 2, depth / 2, fh / 2, fh / 2),
    piece(width / 2 - WALL / 2, -depth / 2, WALL / 2, depth / 2, fh / 2, fh / 2),
    piece(0, -depth / 2, width / 2, depth / 2, (CEILING + fh) / 2, (fh - CEILING) / 2),
    // The divider either side of the kitchen doorway, and above it (a restaurant's; venues have none).
    ...(layout.venue ? [] : [
      ...layout.solids.slice(1, 3).map((w) => piece(w.x, w.z, w.hx, w.hz, CEILING / 2, CEILING / 2)),
      piece(layout.divider.doorX, layout.divider.z - WALL / 2, KITCHEN_DOOR / 2, WALL / 2, (KITCHEN_DOOR_H + CEILING) / 2, (CEILING - KITCHEN_DOOR_H) / 2),
    ]),
  ];
}

// ---------- walking through a door someone else holds open ----------

/**
 * Walking in or out through a door someone else has opened: up to a spot clear of the door's swing, waiting
 * there (`wait`) until whoever is ahead is through, then on through the open side of the doorway, without
 * reaching for the door.
 */
export type WalkThrough = { dir: "in" | "out"; from: [number, number]; fromYaw: number; approach: number; hold: number; points: [number, number][]; pass: number; done: number };
export function planWalkThrough(dir: "in" | "out", from: [number, number], fromYaw: number, wait = 0): WalkThrough {
  // Going in through the right-hand doorway (the leaf that opens out to the right stands clear at x ≈ 1);
  // coming out through the left.
  const start: [number, number] = dir === "in" ? [0.4, 1.35] : [-0.45, -1.3];
  const points: [number, number][] = dir === "in" ? [start, [0.4, 0.35], [0.5, -0.5], LOBBY] : [start, [-0.45, 0.3], OUTSIDE];
  const approach = walkTime(from, start), hold = Math.max(0, wait - approach);
  // Through (and clear of the leaf's swing) once this far along the path.
  const through = dir === "in" ? 2.16 : 2.5;
  const length = points.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - points[i]![0], q[1] - points[i]![1]), 0);
  return { dir, from, fromYaw, approach, hold, points, pass: approach + hold + through / STEP, done: approach + hold + length / STEP + 0.15 };
}
export function walkThroughPose(time: number, plan: WalkThrough): Pose {
  const face = plan.dir === "in" ? FACE_IN : FACE_OUT;
  let at: [number, number], yaw = face;
  if (time < plan.approach) ({ at, yaw } = walkTo(time / plan.approach, plan.from, plan.points[0]!, plan.fromYaw, face));
  else if (time < plan.approach + plan.hold) at = plan.points[0]!;
  else {
    const length = plan.points.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - plan.points[i]![0], q[1] - plan.points[i]![1]), 0);
    at = along(plan.points, ((time - plan.approach - plan.hold) * STEP) / length);
  }
  return { x: at[0], z: at[1], yaw, sit: 0, shuffle: 0, lean: 0, left: null, right: null };
}
