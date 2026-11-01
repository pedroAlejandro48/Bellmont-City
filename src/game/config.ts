// Pure, browser-safe world config + generation (no randomness at module scope).
export const DAY_SECONDS = 1200; // 20 minutes of daylight
export const NIGHT_SECONDS = 1200; // 20 minutes of night
export const CYCLE = DAY_SECONDS + NIGHT_SECONDS;
export const START_ELAPSED = 45; // early morning

export const BLOCK = 40;
export const STREET = 12;
export const PITCH = BLOCK + STREET;
export const N = 21;
export const HALF = Math.floor(N / 2);
/** Avenues around the park are 12 m wider than streets, pushing every block past them out by that much. */
const AVENUE_EXTRA = 12;
export const WORLD_HALF = HALF * PITCH + PITCH / 2 + AVENUE_EXTRA;
/** The city's street surface: a square reaching the outer edge of the ring road. */
export const CITY_GROUND_SIZE = WORLD_HALF * 2 + 12;
export const SIDEWALK_H = 0.15;

export type TimeInfo = {
  day: number;
  isDay: boolean;
  progress: number; // 0..1 through current day or night
  angle: number;
  elevation: number; // sin(angle) of the visible body (sun by day, moon by night)
  darkness: number; // 0 bright day .. 1 night
  hours: number; // 0..24 clock
};

export function timeInfo(elapsed: number): TimeInfo {
  const t = ((elapsed % CYCLE) + CYCLE) % CYCLE;
  const isDay = t < DAY_SECONDS;
  const progress = isDay ? t / DAY_SECONDS : (t - DAY_SECONDS) / NIGHT_SECONDS;
  const angle = Math.PI * progress;
  const elevation = Math.sin(angle);
  // Twilight straddles both horizons; every light uses this continuous blend.
  const solarElevation = Math.sin(t / CYCLE * Math.PI * 2);
  const daylight = Math.max(0, Math.min(1, (solarElevation + 0.12) / 0.42));
  const darkness = 1 - daylight * daylight * (3 - 2 * daylight);
  const hours = isDay ? 6 + 12 * progress : (18 + 12 * progress) % 24;
  return { day: Math.floor(elapsed / CYCLE) + 1, isDay, progress, angle, elevation, darkness, hours };
}

export function formatClock(hours: number) {
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

export function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PARK_SEED = 2026;
export const PARK_RING_RADIUS = 6;
export const PARK_PATH_WIDTH = 2;
export const PARK_OBELISK_HEIGHT = 1.8 * 5;
export const GREEN_BLOCK_CHANCE = 0.02;
export const SIDEWALK_TREE_CENTER = 17.65;
export const TREE_BED_RADIUS = 1.5;
export const SIDEWALK_CANOPY_RADIUS = 2.15;
/** The ground floor is taller than the 3 m upper floors, leaving room for a shop sign above the doors. */
export const BUILDING_ENTRANCE = { doors: 2, accessible: false, floorHeight: 5 } as const;
export const PARK_CORNERS: [number, number][] = [[-17, -17], [17, -17], [17, 17], [-17, 17]];
export const PARK_BENCHES = PARK_CORNERS.map(([x, z]) => {
  const angle = Math.atan2(x, z);
  return { x: Math.sin(angle) * 12 + Math.cos(angle) * 2.2, z: Math.cos(angle) * 12 - Math.sin(angle) * 2.2, rot: angle - Math.PI / 2 };
});
export const PARK_TREES = PARK_CORNERS.flatMap(([x, z], i) => [
  { x: Math.sign(x) * 13, z: Math.sign(z) * 6.5, rot: i * 1.4, s: 1, sidewalk: false },
  { x: Math.sign(x) * 6.5, z: Math.sign(z) * 13, rot: i * 1.8, s: 1, sidewalk: false },
]);

export const PARK_ARCH = { z: 14.2, spring: 1.4, inner: 1.65, outer: 2.2, depth: 0.75, height: 3.6 } as const;
export const BENCH_SIT_SECONDS = 0.5;
export const BENCH_STAND_SECONDS = 0.5;
export const BENCH_REACH = 1;
export const BENCH_SEATS = PARK_BENCHES.flatMap((b, bench) => [-0.62, 0.62].map((side, slot) => ({
  id: bench * 2 + slot, bench, slot, x: b.x + Math.cos(b.rot) * side,
  z: b.z - Math.sin(b.rot) * side, yaw: b.rot,
})));
/**
 * Sitting down on a bench seat, sitting, or standing up from it, `t` (0..1) of the way through that phase: where
 * the body is and how seated it is (0 standing .. 1 sat). The seated pelvis rests 10 cm behind the seat's centre
 * (back against the backrest); the stand-off point in front keeps the shins clear of the slats. Shared by players
 * and NPCs so both move the same.
 */
export function benchPose(seat: { x: number; z: number; yaw: number }, phase: "sit" | "seated" | "stand", t: number, origin: { x: number; z: number }, originYaw: number) {
  const smooth = (n: number) => { const v = Math.max(0, Math.min(1, n)); return v * v * (3 - 2 * v); };
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  const fx = Math.sin(seat.yaw), fz = Math.cos(seat.yaw);
  const restX = seat.x - fx * 0.1, restZ = seat.z - fz * 0.1, frontX = seat.x + fx * 0.42, frontZ = seat.z + fz * 0.42;
  if (phase === "sit") {
    const step = smooth(t / 0.35), seated = smooth((t - 0.3) / 0.7);
    const ax = lerp(origin.x, frontX, step), az = lerp(origin.z, frontZ, step);
    const angle = Math.atan2(Math.sin(seat.yaw - originYaw), Math.cos(seat.yaw - originYaw));
    return { x: lerp(ax, restX, seated), z: lerp(az, restZ, seated), yaw: originYaw + angle * smooth(t / 0.3), seated };
  }
  if (phase === "stand") {
    const seated = 1 - smooth(t / 0.75), out = smooth((t - 0.6) / 0.4) * 0.1;
    return { x: lerp(frontX, restX, seated) + fx * out, z: lerp(frontZ, restZ, seated) + fz * out, yaw: seat.yaw, seated };
  }
  return { x: restX, z: restZ, yaw: seat.yaw, seated: 1 };
}
/**
 * How a body sits `seated` (0..1) of the way onto a bench: thighs level on the seat (their undersides on the
 * slats), shins down, a forward lean while lowering, and straight arms from the shoulders to the knees.
 */
export function benchJoints(seated: number) {
  const bend = Math.sin(seated * Math.PI);
  return { hip: -1.57 * seated, knee: 1.57 * seated, lean: 0.42 * bend, riderOffset: (BENCH_SEAT_TOP + 0.077 - 0.95) * seated, shoulder: -0.62 * seated - 0.35 * bend, elbow: -0.06 * seated, hands: seated };
}
export function nearestBenchSeat(x: number, z: number, occupied: ReadonlyMap<number, string>, owner = "player") {
  let nearest: typeof BENCH_SEATS[number] | null = null, distance = BENCH_REACH;
  for (const seat of BENCH_SEATS) {
    if (occupied.has(seat.id) && occupied.get(seat.id) !== owner) continue;
    const d = Math.hypot(x - seat.x - Math.sin(seat.yaw) * 0.45, z - seat.z - Math.cos(seat.yaw) * 0.45);
    if (d <= distance) { distance = d; nearest = seat; }
  }
  return nearest;
}
export type SolidBox = { x: number; z: number; hx: number; hz: number; yaw: number };
/**
 * Vintage lamp posts along the park's paths: two along each diagonal path (on the side away from its bench),
 * two flanking the entrance path, and three around the ring (the entrance side stays open).
 */
export const PARK_LAMPS: { x: number; z: number }[] = [
  ...PARK_CORNERS.flatMap(([cx, cz]) => {
    const a = Math.atan2(cx, cz), off = -1.5;
    return [9.5, 15.5].map((r) => ({ x: Math.sin(a) * r + Math.cos(a) * off, z: Math.cos(a) * r - Math.sin(a) * off }));
  }),
  { x: 1.6, z: 10 }, { x: -1.6, z: 10 },
  ...[Math.PI / 2, Math.PI, -Math.PI / 2].map((a) => ({ x: Math.sin(a) * 7.7, z: Math.cos(a) * 7.7 })),
];
export const PARK_LAMP_HEIGHT = 3.1;
/** Four small floodlights set in the ground around the obelisk's plinth, aimed up at it. */
export const OBELISK_UPLIGHTS = [0, 1, 2, 3].map((i) => { const a = Math.PI / 4 + i * Math.PI / 2; return { x: Math.sin(a) * 2.3, z: Math.cos(a) * 2.3 }; });
export const PARK_SOLIDS: SolidBox[] = [
  ...PARK_BENCHES.map((b) => ({ x: b.x, z: b.z, hx: 1.3, hz: 0.4, yaw: b.rot })),
  { x: 0, z: 0, hx: 1.25, hz: 1.25, yaw: 0 },
  ...PARK_LAMPS.map((l) => ({ x: l.x, z: l.z, hx: 0.12, hz: 0.12, yaw: 0 })),
  ...[-1, 1].map((side) => ({ x: side * (PARK_ARCH.inner + PARK_ARCH.outer) / 2, z: PARK_ARCH.z, hx: (PARK_ARCH.outer - PARK_ARCH.inner) / 2, hz: PARK_ARCH.depth / 2, yaw: 0 })),
];
// Bench geometry is modelled in absolute height on the raised park ground; these are heights above that ground.
export const BENCH_SEAT_TOP = 0.7425 - SIDEWALK_H;
export const BENCH_BACK_TOP = 1.44 - SIDEWALK_H;
/** Height above ground of the bench surface under feet at (x, z) that is at or below feetY (+ small step), else 0. */
export function benchStandHeight(x: number, z: number, feetY: number) {
  let best = 0;
  for (const b of PARK_BENCHES) {
    const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = x - b.x, dz = z - b.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) > 1.25) continue;
    if (Math.abs(lz) < 0.33 && feetY >= BENCH_SEAT_TOP - 0.08) best = Math.max(best, BENCH_SEAT_TOP);
    // Backrest top cap board is 26cm deep: a small forward hop lands on it, one more step drops off.
    if (Math.abs(lz + 0.32) < 0.13 && feetY >= BENCH_BACK_TOP - 0.08) best = Math.max(best, BENCH_BACK_TOP);
  }
  return best;
}
/** Thin backrest walls: solid until the feet are above the backrest top (too high to jump from the ground). */
export const BENCH_BACKRESTS: SolidBox[] = PARK_BENCHES.map((b) => ({ x: b.x - Math.sin(b.rot) * 0.32, z: b.z - Math.cos(b.rot) * 0.32, hx: 1.25, hz: 0.0425, yaw: b.rot }));
/** Minimum translation out of an oriented obstacle, shared by feet and bike. */
export function circleBoxPush(x: number, z: number, radius: number, box: SolidBox): [number, number] {
  const c = Math.cos(box.yaw), s = Math.sin(box.yaw), dx = x - box.x, dz = z - box.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const nx = Math.max(-box.hx, Math.min(box.hx, lx)), nz = Math.max(-box.hz, Math.min(box.hz, lz));
  let px = lx - nx, pz = lz - nz;
  const d = Math.hypot(px, pz);
  if (d >= radius) return [0, 0];
  if (d > 0.00001) { px *= (radius - d) / d; pz *= (radius - d) / d; }
  else if (box.hx - Math.abs(lx) < box.hz - Math.abs(lz)) { px = (lx >= 0 ? 1 : -1) * (box.hx - Math.abs(lx) + radius); pz = 0; }
  else { px = 0; pz = (lz >= 0 ? 1 : -1) * (box.hz - Math.abs(lz) + radius); }
  return [px * c + pz * s, -px * s + pz * c];
}
export const PERSON_MASS = 81;
export const SCOOTER_MASS = 110;
export function bikePushShare() { return PERSON_MASS / (PERSON_MASS + SCOOTER_MASS); }

/**
 * Streets are 12 m wide with one 6 m lane each way. Four avenues ring the park (at ±MAIN_ROAD_CENTER on each
 * axis) with two 6 m lanes each way, so they are 24 m wide; every block past them is pushed out 12 m, so all
 * blocks stay full size. The avenues at +MAIN_ROAD_CENTER are the main roads: they carry on into the
 * countryside.
 */
export const ROAD_LANE_WIDTH = 6;
export const MAIN_ROAD_WIDTH = 4 * ROAD_LANE_WIDTH;
export const MAIN_ROAD_CENTER = PITCH / 2 - STREET / 2 + MAIN_ROAD_WIDTH / 2;
/** Free road kept between vehicles placed near each other (m): over two bus lengths, so traffic starts spread out. */
export const TRAFFIC_SPAWN_GAP = 25;
/** The gap a moving vehicle keeps behind the one ahead before it stops (m): one bus length. */
export const TRAFFIC_FOLLOW_GAP = 11.1;
export function roadLaneOffsets(main: boolean) { return main ? [ROAD_LANE_WIDTH / 2, ROAD_LANE_WIDTH * 1.5] : [ROAD_LANE_WIDTH / 2]; }
/** Centre line of street k across one axis (k = 0 and k = -1 are the avenues either side of the park). */
export function streetCenter(k: number) {
  if (k === 0) return MAIN_ROAD_CENTER;
  if (k === -1) return -MAIN_ROAD_CENTER;
  return k * PITCH + PITCH / 2 + (k > 0 ? AVENUE_EXTRA : -AVENUE_EXTRA);
}
/** A four-lane avenue (either side of the park), as opposed to a two-lane street. */
export const isAvenue = (center: number) => Math.abs(Math.abs(center) - MAIN_ROAD_CENTER) < 0.1;
export function streetHalfWidth(center: number) { return isAvenue(center) ? MAIN_ROAD_WIDTH / 2 : STREET / 2; }
/** The grid index of the street (or block) nearest to t, roughly; neighbours cover the rest. */
const gridGuess = (t: number) => Math.round((t - PITCH / 2 - Math.sign(t) * AVENUE_EXTRA) / PITCH);
/** The street centres around coordinate t, in order. */
function streetsNear(t: number) {
  const k = gridGuess(t);
  return [k - 2, k - 1, k, k + 1, k + 2].map(streetCenter);
}
/** The nearest street centre to t across one axis. */
export function nearestStreet(t: number) {
  return streetsNear(t).reduce((best, c) => (Math.abs(c - t) < Math.abs(best - t) ? c : best));
}
/** The next street centre strictly ahead of t when moving in `dir`. */
export function nextStreet(t: number, dir: 1 | -1) {
  const k = gridGuess(t);
  const candidates = [k - 2, k - 1, k, k + 1, k + 2, k + 3].map(streetCenter);
  return dir === 1 ? Math.min(...candidates.filter((c) => c > t + 1e-6)) : Math.max(...candidates.filter((c) => c < t - 1e-6));
}
/** The middle of block i across one axis (block 0 is the park). */
export function blockCenter(i: number) { return i * PITCH + Math.sign(i) * AVENUE_EXTRA; }
/** Where block i spans across one axis: always a full 40 m. */
export function blockSpan(i: number): [number, number] {
  const c = blockCenter(i);
  return [c - BLOCK / 2, c + BLOCK / 2];
}
/** The block whose middle is nearest to t. */
export function blockIndex(t: number) {
  const i = Math.round(t / PITCH);
  return [i - 1, i, i + 1].reduce((best, k) => (Math.abs(blockCenter(k) - t) < Math.abs(blockCenter(best) - t) ? k : best));
}
export function roadLane(axis: "x" | "z", dir: 1 | -1, center: number, slot = 0) {
  const main = isAvenue(center);
  const offset = roadLaneOffsets(main)[slot] ?? 3;
  return center + (axis === "x" ? dir : -dir) * offset;
}
export function isTrafficRoad(x: number, z: number, seed: number) {
  if (Math.max(Math.abs(x), Math.abs(z)) > WORLD_HALF + 6) return isWildernessRoad(x, z, seed, MAIN_ROAD_WIDTH / 2);
  const onStreet = (v: number) => { const c = nearestStreet(v); return Math.abs(v - c) <= streetHalfWidth(c); };
  return onStreet(x) || onStreet(z) || Math.abs(Math.abs(x) - WORLD_HALF) <= 6 || Math.abs(Math.abs(z) - WORLD_HALF) <= 6;
}
export function trafficSpawnClear(x: number, z: number, length: number, all: { x: number; z: number; kind: VehicleKind }[]) {
  return all.every((v) => Math.hypot(x - v.x, z - v.z) >= (length + VEHICLE_SIZE[v.kind][0]) / 2 + TRAFFIC_SPAWN_GAP);
}

// ---------- traffic lights ----------

/** One in-game minute in real seconds (12 in-game hours of daylight take DAY_SECONDS). */
export const GAME_MINUTE = DAY_SECONDS / (12 * 60);
/** Signal timing, in in-game minutes: green, then yellow, then red for as long as the other road's green and yellow. */
export const SIGNAL = { green: 7, yellow: 3, red: 10 } as const;
export type Signal = "green" | "yellow" | "red";
/**
 * The light for traffic moving along `axis` at a signalled intersection. The two roads alternate: while one has
 * green then yellow, the other has red.
 */
export function signalState(axis: "x" | "z", elapsed: number): Signal {
  const cycle = (SIGNAL.green + SIGNAL.yellow + SIGNAL.red) * GAME_MINUTE;
  const t = (((elapsed + (axis === "z" ? (SIGNAL.green + SIGNAL.yellow) * GAME_MINUTE : 0)) % cycle) + cycle) % cycle;
  return t < SIGNAL.green * GAME_MINUTE ? "green" : t < (SIGNAL.green + SIGNAL.yellow) * GAME_MINUTE ? "yellow" : "red";
}
/** Street indices with lights where they cross an avenue: the avenues themselves, then every third street out. */
export const SIGNAL_STREETS = [0, 3, 6, 9, -1, -4, -7, -10];
const signalStreet = (center: number) => SIGNAL_STREETS.some((k) => Math.abs(streetCenter(k) - center) < 0.1);
/** A signalled intersection: an avenue crossing one of the signal streets (x, z are the two roads' centre lines). */
export function isSignalled(x: number, z: number) {
  return (isAvenue(x) && signalStreet(z)) || (isAvenue(z) && signalStreet(x));
}
/** Every signalled intersection in the city. */
export const SIGNALLED: [number, number][] = SIGNAL_STREETS.flatMap((k) => SIGNAL_STREETS.map((j) => [streetCenter(k), streetCenter(j)] as [number, number]))
  .filter(([x, z]) => isSignalled(x, z));
/** Zebra crossings sit this far out from the crossing road's kerb, and are this wide. */
export const CROSSWALK = { gap: 0.4, width: 3.2 };
/** The four crossings around a signalled intersection, as boxes (centre and half sizes). */
export function crosswalks(x: number, z: number) {
  const hx = streetHalfWidth(x), hz = streetHalfWidth(z);
  const mid = CROSSWALK.gap + CROSSWALK.width / 2, half = CROSSWALK.width / 2;
  return [
    { x: x - hx - mid, z, hx: half, hz, across: "z" as const }, { x: x + hx + mid, z, hx: half, hz, across: "z" as const },
    { x, z: z - hz - mid, hx, hz: half, across: "x" as const }, { x, z: z + hz + mid, hx, hz: half, across: "x" as const },
  ];
}
/** Whether (px, pz) is on a zebra crossing (of the signalled intersections near it). */
export function onCrosswalk(px: number, pz: number) {
  const x = nearestStreet(px), z = nearestStreet(pz);
  for (const cx of [x, nearestStreet(px + 20), nearestStreet(px - 20)]) for (const cz of [z, nearestStreet(pz + 20), nearestStreet(pz - 20)]) {
    if (!isSignalled(cx, cz)) continue;
    if (crosswalks(cx, cz).some((c) => Math.abs(px - c.x) <= c.hx && Math.abs(pz - c.z) <= c.hz)) return true;
  }
  return false;
}
/** Where vehicles on a road crossing at `cross` stop: the near edge of its crossing, from the crossing's centre line. */
export const stopLineFrom = (cross: number) => streetHalfWidth(cross) + CROSSWALK.gap + CROSSWALK.width + 0.4;

/** Signal poles stand this tall; their arm reaches out over the road with a street lamp and the lights under it. */
export const SIGNAL_POLE = { height: 6.6, arm: 6.3, head: 5.75 };
/**
 * The signal for each approach to each signalled intersection: a pole on the far right-hand corner (as the
 * driver sees it), its arm reaching back over the approaching lanes, the lights hung under the lamp at its tip.
 * `fx, fz` is the approaching traffic's direction; the lights face against it.
 */
export const SIGNAL_POLES = SIGNALLED.flatMap(([cx, cz]) => (["x", "z"] as const).flatMap((axis) => ([1, -1] as const).map((dir) => {
  const fx = axis === "x" ? dir : 0, fz = axis === "z" ? dir : 0, rx = -fz, rz = fx;
  const crossHalf = streetHalfWidth(axis === "x" ? cx : cz), roadHalf = streetHalfWidth(axis === "x" ? cz : cx);
  const out = crossHalf + CROSSWALK.gap + CROSSWALK.width + 2.6, side = roadHalf + 1.3, tip = roadHalf * 0.45;
  return { axis, dir, fx, fz, rx, rz, x: cx + fx * out + rx * side, z: cz + fz * out + rz * side, tipX: cx + fx * out + rx * tip, tipZ: cz + fz * out + rz * tip, reach: side - tip };
})));

export type Building = { x: number; z: number; w: number; d: number; h: number; variant: number; restaurant?: RestaurantKind; door?: "x" | "z" };

export type RestaurantKind = "cafe" | "pizza" | "fine" | "burger";
/** The city's four restaurants, with their opening hours on the 24 h clock (`closes` 24 = open all day). */
export const RESTAURANTS: Record<RestaurantKind, { name: string; food: string; opens: number; closes: number }> = {
  cafe: { name: "Morning Bell Café", food: "Coffee · Pastries · Breakfast", opens: 6, closes: 17 },
  pizza: { name: "Nonna Lucia's", food: "Pizzeria", opens: 11, closes: 20 },
  fine: { name: "Hanami", food: "Japanese Fine Dining", opens: 12, closes: 22 },
  burger: { name: "Big Bell Burgers", food: "Open 24 hours", opens: 0, closes: 24 },
};
export const RESTAURANT_KINDS = Object.keys(RESTAURANTS) as RestaurantKind[];
export function restaurantOpen(kind: RestaurantKind, hours: number) {
  const { opens, closes } = RESTAURANTS[kind];
  return hours >= opens && hours < closes;
}
const blockRandom = (seed: number, i: number, j: number) => rng(i === 0 && j === 0 ? PARK_SEED : seed ^ Math.imul(i + 101, 73856093) ^ Math.imul(j + 101, 19349663));
/** Every block holds a 2×2 of buildings, listed by column (x) then row (z). */
const buildingColumns = (_size: number) => [-8, 8];
/** The blocks across the avenues from the park, one on each side. */
const PARK_NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
/**
 * The four restaurants: one in each block across the avenues from the park, in one of its two buildings
 * facing the park, with the door on the park side. Which goes where is shuffled per world (from its seed, so
 * every player in a world, and every streamed piece of it, agrees).
 */
export function restaurantSpots(seed: number) {
  const r = rng(seed ^ 0x7e57a0);
  const kinds = [...RESTAURANT_KINDS];
  for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j]!, kinds[i]!]; }
  const spots = new Map<string, { index: number; kind: RestaurantKind; door: "x" | "z" }>();
  PARK_NEIGHBOURS.forEach(([i, j], n) => {
    // Building index = column * 2 + row; the park-facing pair is the column (or row) nearer the park.
    const facing = i === 1 ? [0, 1] : i === -1 ? [2, 3] : j === 1 ? [0, 2] : [1, 3];
    spots.set(`${i},${j}`, { index: facing[Math.floor(r() * 2)]!, kind: kinds[n]!, door: i !== 0 ? "x" : "z" });
  });
  return spots;
}
export type Prop = { x: number; z: number; rot: number; s: number; sidewalk?: boolean };
export type City = {
  /** Block centres and sizes (w across x, d across z). */
  blocks: { x: number; z: number; w: number; d: number; park: boolean }[];
  buildings: Building[];
  trees: Prop[];
  lamps: Prop[];
};

/** Spacing between the two stripes of a main road's double yellow centre line (m). */
export const DOUBLE_LINE_GAP = 0.34;

/** Local marking window: each orientation is bounded independently. */
export function cityRoadDashes(x: number, z: number) {
  // Streets: a dashed yellow centre line. Main roads: a double solid yellow centre line (`solid`, one entry per
  // stripe, each covering a full 6 m step) and dashed white lane dividers (`divider`).
  const dashes: { x: number; z: number; rot: number; divider?: boolean; solid?: boolean }[] = [];
  for (const axis of ["x", "z"] as const) {
    const along = axis === "x" ? x : z, across = axis === "x" ? z : x;
    const cell = blockIndex(across);
    for (let k = Math.max(-HALF - 1, cell - 4); k <= Math.min(HALF, cell + 4); k++) {
      const street = streetCenter(k);
      for (let p = Math.ceil(Math.max(-WORLD_HALF, along - 220) / 6) * 6; p < Math.min(WORLD_HALF, along + 220); p += 6) {
        // No markings inside intersections (nor over the zebra crossings around signalled ones).
        const cross = nearestStreet(p);
        const signalled = axis === "x" ? isSignalled(cross, street) : isSignalled(street, cross);
        if (Math.abs(p - cross) < streetHalfWidth(cross) + (signalled ? CROSSWALK.gap + CROSSWALK.width + 0.8 : 1)) continue;
        const main = isAvenue(street);
        if (main) for (const offset of [-DOUBLE_LINE_GAP / 2, DOUBLE_LINE_GAP / 2]) dashes.push({ x: axis === "x" ? p : street + offset, z: axis === "x" ? street + offset : p, rot: axis === "x" ? 0 : Math.PI / 2, solid: true });
        else dashes.push({ x: axis === "x" ? p : street, z: axis === "x" ? street : p, rot: axis === "x" ? 0 : Math.PI / 2 });
        if (main) for (const offset of [-ROAD_LANE_WIDTH, ROAD_LANE_WIDTH]) dashes.push({ x: axis === "x" ? p : street + offset, z: axis === "x" ? street + offset : p, rot: axis === "x" ? 0 : Math.PI / 2, divider: true });
      }
    }
  }
  return dashes;
}

export function generateCity(seed = 1337, focusX = 0, focusZ = 0): City {
  const fi = blockIndex(focusX);
  const fj = blockIndex(focusZ);
  const city: City = { blocks: [], buildings: [], trees: [], lamps: [] };
  const restaurants = restaurantSpots(seed);
  for (let i = Math.max(-HALF, fi - 3); i <= Math.min(HALF, fi + 3); i++) {
    for (let j = Math.max(-HALF, fj - 3); j <= Math.min(HALF, fj + 3); j++) {
      const r = blockRandom(seed, i, j);
      const restaurant = restaurants.get(`${i},${j}`);
      const [x0, x1] = blockSpan(i), [z0, z1] = blockSpan(j);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, bw = x1 - x0, bd = z1 - z0;
      const center = i === 0 && j === 0;
      // The blocks holding the restaurants are never parks.
      const green = r() < GREEN_BLOCK_CHANCE;
      const park = center || (green && !restaurant);
      city.blocks.push({ x: cx, z: cz, w: bw, d: bd, park });
      const dist = Math.hypot(i, j);
      const first = city.buildings.length;
      if (!park) {
        for (const sx of buildingColumns(bw))
          for (const sz of buildingColumns(bd)) {
            const w = 11 + r() * 3.5;
            const d = 11 + r() * 3.5;
            const floors = Math.floor(3 + r() * (dist < 1.5 ? 18 : dist < 3 ? 10 : 6));
            // A taller ground floor, then 3 m floors above it.
            const building: Building = { x: cx + sx, z: cz + sz, w, d, h: floors * 3 + BUILDING_ENTRANCE.floorHeight - 3, variant: Math.floor(r() * 4) };
            if (restaurant && restaurant.index === city.buildings.length - first) { building.restaurant = restaurant.kind; building.door = restaurant.door; }
            city.buildings.push(building);
          }
      } else if (!center) {
        const reach = (size: number) => Math.floor((size / 2 - 8) / 6);
        for (let a = -reach(bw); a <= reach(bw); a++)
          for (let b = -reach(bd); b <= reach(bd); b++)
            if (r() < 0.7)
              city.trees.push({ x: cx + a * 6 + (r() - 0.5) * 2, z: cz + b * 6 + (r() - 0.5) * 2, rot: r() * 6, s: 0.98 + r() * 0.04 });
      }
      // sidewalk props on each of the four edges
      const edges: [number, number, number][] = [
        [0, 1, 0],
        [0, -1, Math.PI],
        [1, 0, Math.PI / 2],
        [-1, 0, -Math.PI / 2],
      ];
      // Props sit the same distance in from each kerb, however wide the block.
      const inset = (size: number, fromEdge: number) => size / 2 - (BLOCK / 2 - fromEdge);
      for (const [ex, ez, rot] of edges) {
        const along = ex !== 0 ? bd : bw;
        for (const k of [-1, 1].map((sign) => sign * Math.min(15, along / 2 - 5))) {
          const px = ex !== 0 ? cx + ex * inset(bw, 19.2) : cx + k;
          const pz = ez !== 0 ? cz + ez * inset(bd, 19.2) : cz + k;
          city.lamps.push({ x: px, z: pz, rot, s: 1 });
        }
        for (const k of [-6, 6]) {
          // Center the full bed in the pavement between buildings and curb.
          const px = ex !== 0 ? cx + ex * inset(bw, SIDEWALK_TREE_CENTER) : cx + k;
          const pz = ez !== 0 ? cz + ez * inset(bd, SIDEWALK_TREE_CENTER) : cz + k;
          city.trees.push({ x: px, z: pz, rot: r() * 6, s: 0.98 + r() * 0.04, sidewalk: true });
        }
      }
    }
  }
  // Stable, individually generated forest cells, streamed around the player.
  if (Math.max(Math.abs(focusX), Math.abs(focusZ)) > WORLD_HALF - 300) {
    const gx = Math.floor(focusX / 14), gz = Math.floor(focusZ / 14);
    for (let i = gx - 18; i <= gx + 18; i++) for (let j = gz - 18; j <= gz + 18; j++) {
      const r = rng(seed ^ Math.imul(i, 83492791) ^ Math.imul(j, 2971215073));
      const x = i * 14 + (r() - 0.5) * 8, z = j * 14 + (r() - 0.5) * 8;
      if (Math.max(Math.abs(x), Math.abs(z)) < WORLD_HALF + 9 || isWildernessRoad(x, z, seed, MAIN_ROAD_WIDTH / 2 + 6)) continue;
      city.trees.push({ x, z, rot: r() * Math.PI * 2, s: 0.98 + r() * 0.04 });
    }
  }
  // No sidewalk tree hides a restaurant's sign.
  for (const b of city.buildings) {
    if (!b.restaurant) continue;
    const L = buildingLayout(b);
    const ex = L.door === "x" ? b.x + L.sx * b.w / 2 : b.x, ez = L.door === "z" ? b.z + L.sz * b.d / 2 : b.z;
    city.trees = city.trees.filter((t) => !t.sidewalk || Math.hypot(t.x - ex, t.z - ez) > 7);
  }
  if (city.blocks.some((b) => b.x === 0 && b.z === 0)) city.trees.push(...PARK_TREES);
  return city;
}

/**
 * The whole city's buildings and street lamps (no trees), for drawing the parts beyond the streamed
 * neighbourhood: lit windows and lamps on the horizon. The same buildings generateCity makes, block by block.
 */
export function wholeCity(seed: number) {
  const buildings: Building[] = [], lamps: Prop[] = [], seen = new Set<string>();
  // Each call covers 7 × 7 blocks around its focus; these foci cover every block.
  const foci = [-7, 0, 7, HALF - 3];
  for (const fi of foci) for (const fj of foci) {
    const part = generateCity(seed, blockCenter(fi), blockCenter(fj));
    for (const b of part.buildings) { const key = `b${b.x}:${b.z}`; if (!seen.has(key)) { seen.add(key); buildings.push(b); } }
    for (const l of part.lamps) { const key = `l${l.x}:${l.z}`; if (!seen.has(key)) { seen.add(key); lamps.push(l); } }
  }
  return { buildings, lamps };
}
/** The part of the whole city outside the neighbourhood streamed around (x, z) (which is drawn in full). */
export function farCity(all: { buildings: Building[]; lamps: Prop[] }, x: number, z: number) {
  const fi = blockIndex(x), fj = blockIndex(z);
  const near = (px: number, pz: number) => Math.abs(blockIndex(px) - fi) <= 3 && Math.abs(blockIndex(pz) - fj) <= 3;
  return { buildings: all.buildings.filter((b) => !near(b.x, b.z)), lamps: all.lamps.filter((l) => !near(l.x, l.z)) };
}

export function floorHeight(x: number, z: number) {
  const i = blockIndex(x);
  const j = blockIndex(z);
  if (Math.abs(i) > HALF || Math.abs(j) > HALF) return 0;
  const [x0, x1] = blockSpan(i), [z0, z1] = blockSpan(j);
  return x >= x0 && x <= x1 && z >= z0 && z <= z1 ? SIDEWALK_H : 0;
}

export type SaveData = {
  health: number;
  elapsed: number;
  pos: [number, number, number];
  rotY: number;
  camYaw: number;
  accident?: SavedAccident | null;
  worldSeed?: number;
  camPitch?: number;
  scooter?: SavedScooter | null;
  benchSeat?: number | null;
  cash?: number;
  /** 0..100: how fed and how watered the character is. */
  hunger?: number;
  thirst?: number;
};
/** Every character starts with this much money. */
export const STARTING_CASH = 200;

export type SavedScooter = { pos: [number, number, number]; yaw: number; fallen: boolean; riding: boolean };

export type SavedAccident = { phase: "down" | "rising"; remaining: number; direction: [number, number]; seed: number };

export const DEFAULT_SAVE: SaveData = {
  health: 100,
  elapsed: START_ELAPSED,
  pos: [0, SIDEWALK_H, 18],
  rotY: 0,
  camYaw: 0,
  camPitch: 0.22,
  worldSeed: 1337,
  scooter: null,
  benchSeat: null,
  cash: STARTING_CASH,
  hunger: 100,
  thirst: 100,
};

export const VEHICLE_DAMAGE = 20;
export const DEATH_SCREEN_SECONDS = 5;
export const TURN_SPEED = 2.4;

export function healthAfterImpact(health: number) {
  return Math.max(0, health - VEHICLE_DAMAGE);
}

export function deathScreenFinished(startedAt: number, now: number) {
  return now - startedAt >= DEATH_SCREEN_SECONDS * 1000;
}

export function resetProgress(previousSeed = 1337): SaveData {
  let worldSeed = Math.floor(Math.random() * 2147483646) + 1;
  if (worldSeed === previousSeed) worldSeed = (worldSeed % 2147483646) + 1;
  return { ...DEFAULT_SAVE, elapsed: 0, worldSeed, pos: [...DEFAULT_SAVE.pos] };
}

export function groundedHeading(yaw: number, left: boolean, right: boolean, dt: number) {
  return yaw + (Number(left) - Number(right)) * TURN_SPEED * dt;
}

export function headingVelocity(yaw: number, speed: number): [number, number] {
  return [Math.sin(yaw) * speed, Math.cos(yaw) * speed];
}

// camYaw is the target-to-camera azimuth; walking faces the opposite direction.
export function cameraRelativeVelocity(camYaw: number, forward: number, right: number, speed: number): [number, number] {
  const length = Math.hypot(forward, right);
  if (length === 0) return [0, 0];
  const yaw = camYaw + Math.PI;
  return [(Math.sin(yaw) * forward - Math.cos(yaw) * right) * speed / length,
    (Math.cos(yaw) * forward + Math.sin(yaw) * right) * speed / length];
}

export function cameraRecenterReady(forwardSince: number | null, lastMouseLookAt: number, now: number) {
  return forwardSince !== null && now - forwardSince > 1000 && now - lastMouseLookAt > 1000;
}

export type VehicleKind = "car" | "taxi" | "bus" | "truck";
export const VEHICLE_SIZE: Record<VehicleKind, [number, number, number]> = {
  car: [4.4, 1.75, 1.9], taxi: [4.4, 2.05, 1.9], bus: [11.1, 3.4, 2.55], truck: [8.8, 3.5, 2.5],
};

export const PLAYER_HEIGHT = 1.95;
export const THROW_DISTANCE = PLAYER_HEIGHT * 2;
export const ACCIDENT_STOP_SECONDS = 5;
export const QUEUE_RELEASE_SECONDS = 5;
export const KNOCKDOWN_SECONDS = 2;
export const GET_UP_SECONDS = 2.6;
export const CRASH_STOP_SECONDS = 3.5;
export const VEHICLE_MASS: Record<VehicleKind, number> = { car: 1400, taxi: 1400, bus: 11000, truck: 19000 };

/** A vehicle's ground footprint as a solid box (yaw is its body rotation about Y; it drives along local +x). */
export function vehicleFootprint(x: number, z: number, yaw: number, kind: VehicleKind): SolidBox {
  const [length, , width] = VEHICLE_SIZE[kind];
  return { x, z, hx: width / 2, hz: length / 2, yaw: yaw + Math.PI / 2 };
}
/** Resolves a bike (three circles along its length) out of solid boxes. Returns how far it moved and the
 * first box it touched (-1 when clear). */
export function bikeOutOfBoxes(x: number, z: number, yaw: number, boxes: readonly SolidBox[]): { dx: number; dz: number; hit: number } {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  let dx = 0, dz = 0, hit = -1;
  for (const [i, box] of boxes.entries()) {
    for (const along of [0.6, 0, -0.6]) {
      const [px, pz] = circleBoxPush(x + dx + fx * along, z + dz + fz * along, 0.3, box);
      if (px || pz) { dx += px; dz += pz; if (hit < 0) hit = i; }
    }
  }
  return { dx, dz, hit };
}

/** Whether a bike (three circles along its length) overlaps a round body such as a person. */
export function bikeTouchesCircle(x: number, z: number, yaw: number, body: { x: number; z: number; r: number }) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  return [0.6, 0, -0.6].some((along) => Math.hypot(x + fx * along - body.x, z + fz * along - body.z) < 0.3 + body.r);
}

/** Whether a bike's footprint would overlap any of these round bodies (people) or boxes (vehicles, bikes). */
export function footprintBlocked(box: SolidBox, bodies: readonly { x: number; z: number; r: number }[], boxes: readonly SolidBox[]) {
  if (bodies.some((b) => { const [dx, dz] = circleBoxPush(b.x, b.z, b.r, box); return dx !== 0 || dz !== 0; })) return true;
  // A box is checked as circles along its length, each as wide as the box.
  return boxes.some((other) => {
    const fx = Math.sin(other.yaw), fz = Math.cos(other.yaw);
    const steps = Math.max(1, Math.ceil(other.hz / Math.max(0.2, other.hx)));
    for (let i = -steps; i <= steps; i++) {
      const along = (i / steps) * Math.max(0, other.hz - other.hx);
      const [dx, dz] = circleBoxPush(other.x + fx * along, other.z + fz * along, other.hx, box);
      if (dx !== 0 || dz !== 0) return true;
    }
    return false;
  });
}

/** Only cars and taxis give way to a bike pushing them; buses and trucks are too heavy to move. */
export function bikeCanPushVehicle(kind: VehicleKind) { return kind === "car" || kind === "taxi"; }
/** Rapier collision groups: traffic and bikes never touch through physics; the game resolves those contacts
 * itself (bikes push cars slowly, buses and trucks not at all). Format: membership << 16 | filter. */
export const VEHICLE_COLLISION_GROUPS = (0x0004 << 16) | 0xffff;
export const SCOOTER_COLLISION_GROUPS = (0x0002 << 16) | (0xffff & ~0x0004);
/** How fast a bike can shove a car (m/s): a slow, heavy push. */
export const BIKE_PUSH_SPEED = 0.5;
/** How fast a slow bike shoves another bike (fallen or parked) along: walking pace. */
export const BIKE_SHOVE_SPEED = 2.2;

export type RoadPath = { axis: "x" | "z"; dir: 1 | -1; lane: number };
export function roadForward(path: RoadPath): [number, number] { return path.axis === "x" ? [path.dir, 0] : [0, path.dir]; }
export function roadLeft(path: RoadPath): [number, number] { return path.axis === "x" ? [0, -path.dir] : [path.dir, 0]; }
export function forwardDistance(path: RoadPath, from: [number, number], to: [number, number]) {
  return path.dir * (path.axis === "x" ? to[0] - from[0] : to[1] - from[1]);
}
export function sameRoad(a: RoadPath, b: RoadPath) { return a.axis === b.axis && a.dir === b.dir && Math.abs(a.lane - b.lane) < 0.2; }
export function queueMayResume(stoodUpAt: number | null, now: number) { return stoodUpAt !== null && now >= stoodUpAt + QUEUE_RELEASE_SECONDS; }
export function brakingGap(speed: number) { return 2.5 + speed * 0.55 + speed * speed / 16; }
export function collisionVelocity(massA: number, massB: number, velocityA: number, velocityB: number, restitution = 0.12): [number, number] {
  const momentum = massA * velocityA + massB * velocityB;
  return [(momentum - massB * restitution * (velocityA - velocityB)) / (massA + massB), (momentum + massA * restitution * (velocityA - velocityB)) / (massA + massB)];
}

// Ramp to full turn speed in ~0.7s; releasing stops steering immediately.
export function rampTurn(rate: number, input: number, dt: number) {
  if (!input) return 0;
  const start = Math.sign(rate) === Math.sign(input) ? rate : 0;
  return Math.sign(input) * Math.min(TURN_SPEED, Math.abs(start) + 3.4 * dt);
}
export function wildernessCenter(axis: "x" | "z", distance: number, seed: number) {
  const beyond = Math.max(0, Math.abs(distance) - WORLD_HALF);
  const phase = (seed % 1000) * 0.01 + (axis === "x" ? 0 : 2);
  const fade = 1 - Math.exp(-beyond / 150);
  return MAIN_ROAD_CENTER + fade * (45 * Math.sin(beyond / 240 + phase) + 20 * Math.sin(beyond / 97 + phase));
}
export function isWildernessRoad(x: number, z: number, seed: number, halfWidth = MAIN_ROAD_WIDTH / 2) {
  return (Math.abs(x) >= WORLD_HALF && Math.abs(z - wildernessCenter("x", x, seed)) < halfWidth) ||
    (Math.abs(z) >= WORLD_HALF && Math.abs(x - wildernessCenter("z", z, seed)) < halfWidth);
}

export const MPH_TO_MPS = 0.44704;
export const TRAFFIC_MPH = 30;
export const SCOOTER_MAX_MPH = 45;
export const SCOOTER_REVERSE_MPH = 8;
export const TRAFFIC_SPEED = TRAFFIC_MPH * MPH_TO_MPS;
export const SCOOTER_MAX_SPEED = SCOOTER_MAX_MPH * MPH_TO_MPS;
export const SCOOTER_REVERSE_SPEED = SCOOTER_REVERSE_MPH * MPH_TO_MPS;
/** Vehicles at or below this speed only nudge people (on foot or on a bike); faster ones cause an accident. */
export const HARMLESS_CONTACT_MPH = 10;
export const HARMLESS_CONTACT_SPEED = HARMLESS_CONTACT_MPH * MPH_TO_MPS;
export function vehicleContactHurts(vehicleSpeed: number) { return vehicleSpeed > HARMLESS_CONTACT_SPEED; }
/** A bike going faster than this crashes into whatever it hits (and both people crash if it hits a person). */
export const BIKE_CRASH_MPH = 20;
export const BIKE_CRASH_SPEED = BIKE_CRASH_MPH * MPH_TO_MPS;
export function bikeImpactCrashes(bikeSpeed: number) { return Math.abs(bikeSpeed) > BIKE_CRASH_SPEED; }
export const SCOOTER_INTERACT_METERS = 0.5;
export const SCOOTER_PROMPT_FADE_SECONDS = 0.2;
export const SCOOTER_BYPASS_WAIT_SECONDS = 15;
export const SCOOTER_MOUNT_SECONDS = 1.6;
export const SCOOTER_PICKUP_SECONDS = 2;
export const TRAFFIC_CORNER_SPEED = 6;
// Local compound bounds hug visible wheels and leave the air below the chassis empty.
export const SCOOTER_COLLISION_PARTS = [
  { half: [0.075, 0.275, 0.275], center: [0, 0.28, -0.65] },
  { half: [0.075, 0.275, 0.275], center: [0, 0.28, 0.65] },
  { half: [0.24, 0.05, 0.475], center: [0, 0.36, 0] },
  { half: [0.3, 0.26, 0.5], center: [0, 0.47, -0.42] },
  { half: [0.29, 0.48, 0.1], center: [0, 0.73, 0.42] },
  { half: [0.4, 0.05, 0.075], center: [0, 1.1, 0.46] },
] as const;
export function scooterFootprint(x: number, z: number, yaw: number, fallen: boolean, side: 1 | -1 = 1): SolidBox {
  const offset = fallen ? 0.6 * side : 0;
  return { x: x + Math.cos(yaw) * offset, z: z - Math.sin(yaw) * offset, hx: fallen ? 0.65 : 0.3, hz: 0.925, yaw };
}

/** How high a bike lying on its side reaches: what someone standing on it stands at. */
export const FALLEN_BIKE_TOP = 0.5;
/** Standing on a fallen bike: its top, if (x, z) is over the solid middle of it and the feet are up there already. */
export function fallenBikeStandHeight(x: number, z: number, feetY: number, box: SolidBox) {
  if (feetY < FALLEN_BIKE_TOP - 0.12) return 0;
  const c = Math.cos(box.yaw), sn = Math.sin(box.yaw), dx = x - box.x, dz = z - box.z;
  const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
  return Math.abs(lx) < box.hx - 0.05 && Math.abs(lz) < box.hz - 0.1 ? FALLEN_BIKE_TOP : 0;
}

// Distance to the scooter's side/seat footprint, not its distant front wheel.
export function scooterInteractionDistance(player: [number, number], bike: [number, number], yaw: number) {
  const dx = player[0] - bike[0], dz = player[1] - bike[1];
  const forward = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  const side = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  return Math.hypot(Math.max(0, Math.abs(forward) - 0.55), Math.max(0, Math.abs(side) - 0.3));
}
// Parked scooter tipping: a stand-like restoring spring holds small tilts; past the
// critical angle gravity wins and it falls on that side.
export const SCOOTER_TIP = { stiffness: 40, damping: 3, critical: 0.35, impulsePerSpeed: 0.7 } as const;
export function scooterTipStep(angle: number, vel: number, dt: number): { angle: number; vel: number; fallen: 0 | 1 | -1 } {
  const acc = -SCOOTER_TIP.stiffness * angle - SCOOTER_TIP.damping * vel;
  vel += acc * dt; angle += vel * dt;
  if (Math.abs(angle) >= SCOOTER_TIP.critical) return { angle, vel, fallen: angle > 0 ? 1 : -1 };
  return { angle, vel, fallen: 0 };
}
export function canInteractScooter(player: [number, number], bike: [number, number], yaw: number, fallen = false, side: 1 | -1 = 1) {
  if (fallen) {
    // A fallen bike is lifted only from the side it fell toward.
    if (scooterSide(player, bike, yaw) !== side) return false;
    const box = scooterFootprint(...bike, yaw, true, side), dx = player[0] - box.x, dz = player[1] - box.z;
    return Math.hypot(Math.max(0, Math.abs(dx * Math.cos(yaw) - dz * Math.sin(yaw)) - box.hx), Math.max(0, Math.abs(dx * Math.sin(yaw) + dz * Math.cos(yaw)) - box.hz)) <= SCOOTER_INTERACT_METERS;
  }
  return scooterInteractionDistance(player, bike, yaw) <= SCOOTER_INTERACT_METERS;
}
/** +1 = scooter's left (local +x), -1 = right. Dismounting always uses the right. */
export function scooterSide(player: [number, number], bike: [number, number], yaw: number): 1 | -1 {
  return (player[0] - bike[0]) * Math.cos(yaw) - (player[1] - bike[1]) * Math.sin(yaw) >= 0 ? 1 : -1;
}
export function scooterNextAction(fallen: boolean, riding: boolean): "pickup" | "mount" | "dismount" {
  return riding ? "dismount" : fallen ? "pickup" : "mount";
}
export function scooterBypassReady(startedAt: number, now: number) { return now - startedAt >= SCOOTER_BYPASS_WAIT_SECONDS; }
export function scooterCanDismount(speed: number) { return speed === 0; }
/** Fixed-radius steering: tightest at or below 10 mph, a clean 90° street corner at 25 mph, wider above. */
export const SCOOTER_MIN_RADIUS = 4;
export const SCOOTER_CORNER_RADIUS = 9;
export function scooterTurnRadius(speed: number) {
  const mph = Math.abs(speed) / MPH_TO_MPS;
  if (mph <= 10) return SCOOTER_MIN_RADIUS;
  if (mph <= 25) return SCOOTER_MIN_RADIUS + (mph - 10) / 15 * (SCOOTER_CORNER_RADIUS - SCOOTER_MIN_RADIUS);
  return SCOOTER_CORNER_RADIUS + (mph - 25) * 0.6;
}
/** steer is -1..1 (smoothed key input); the bike only rotates while it rolls forward/back. */
export function scooterTurn(yaw: number, steer: number, speed: number, dt: number) {
  return speed === 0 ? yaw : yaw + Math.max(-1, Math.min(1, steer)) * speed / scooterTurnRadius(speed) * dt;
}
export function smoothSteer(steer: number, input: number, dt: number) {
  return steer + (input - steer) * (1 - Math.exp(-10 * dt));
}
export function recenterOrbit(orbit: number, movingForward: boolean, dt: number) {
  if (!movingForward) return orbit;
  const shortest = Math.atan2(Math.sin(orbit), Math.cos(orbit));
  return shortest * Math.exp(-4 * dt);
}
export function scooterSpeed(current: number, forward: boolean, reverse: boolean, dt: number) {
  const requested = forward === reverse ? 0 : reverse ? -SCOOTER_REVERSE_SPEED : SCOOTER_MAX_SPEED;
  // Brake completely before changing direction; never jump across zero in one step.
  const braking = current * requested < 0;
  const target = braking ? 0 : requested;
  const acceleration = braking || (forward && reverse) ? 14 : reverse ? 2.4 : forward ? 3.8 : 1.8;
  return Math.max(-SCOOTER_REVERSE_SPEED, Math.min(SCOOTER_MAX_SPEED, current + Math.sign(target - current) * Math.min(Math.abs(target - current), acceleration * dt)));
}

/** Facade styles (window size/shape families) available per wall colour. */
export const FACADE_STYLES = 3;
export type BuildingLayout = {
  /** Street-facing directions on each axis (buildings sit in block corners). */
  sx: 1 | -1; sz: 1 | -1;
  /** Y rotation that maps local +X/+Z faces onto the two street sides. */
  rot: number; swap: boolean;
  /** Which street side carries the single main door. */
  door: "x" | "z";
  /** Optional single wooden back door on one interior side. */
  backDoor: "x" | "z" | null;
  style: number;
  /** Ground-floor interior lights on at night (random per building). */
  groundLit: boolean;
};
/** Deterministic per-building facade layout derived from its position only (keeps world RNG unchanged). */
export function buildingLayout(b: { x: number; z: number; door?: "x" | "z" | undefined }): BuildingLayout {
  const sx = b.x - blockCenter(blockIndex(b.x)) >= 0 ? 1 : -1;
  const sz = b.z - blockCenter(blockIndex(b.z)) >= 0 ? 1 : -1;
  let h = (Math.imul(Math.round(b.x * 10), 73856093) ^ Math.imul(Math.round(b.z * 10), 19349663)) >>> 0;
  // Avalanche-mix so low bits (door side, style) are not tied to coordinate parity.
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0; h = (h ^ (h >>> 16)) >>> 0;
  const rot = sx === 1 ? (sz === 1 ? 0 : Math.PI / 2) : sz === 1 ? -Math.PI / 2 : Math.PI;
  const back = (h >>> 3) % 8;
  return { sx, sz, rot, swap: sx !== sz, door: b.door ?? (h % 2 ? "x" : "z"), backDoor: back === 0 ? "x" : back === 1 ? "z" : null, style: (h >>> 7) % FACADE_STYLES, groundLit: ((h >>> 11) & 1) === 1 };
}
