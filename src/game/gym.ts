// The gym's workout (pure): four exercises of STAGE_MS each — bench press, standing dumbbell curls, pull-ups and
// the treadmill — the body put straight onto each machine in turn (no walking between), then back in front of the
// desk. Everything follows from when the workout started (server time), so everyone in a room sees the same.
import type { Box } from "./restaurantRoom";
import type { Fixture, VenueLayout } from "./venueRoom";

export const STAGES = ["bench", "curls", "pullup", "treadmill"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_MS = 3000;
export const WORKOUT_MS = STAGE_MS * STAGES.length;

/** Which exercise `elapsed` ms into a workout is (null before it starts or once it's over), and how far into it (s). */
export function stageAt(elapsed: number): { stage: Stage; index: number; t: number } | null {
  if (elapsed < 0 || elapsed >= WORKOUT_MS) return null;
  const index = Math.floor(elapsed / STAGE_MS);
  return { stage: STAGES[index]!, index, t: (elapsed - index * STAGE_MS) / 1000 };
}

/**
 * Whether a new workout may start now: not while anyone else here is still on the first exercise (the bench) —
 * starting at least a whole exercise behind everyone means nobody ever needs the same machine at once.
 */
export function canStart(others: readonly { start: number }[], now: number) {
  return others.every((o) => now - o.start >= STAGE_MS);
}

/** Where each exercise is done (the room's frame): the body's root and facing. The bench's is the hips' spot. */
export type Station = { x: number; z: number; yaw: number; fixture: Fixture };
export function stations(layout: VenueLayout): Record<Stage, Station> | null {
  const find = (type: Fixture["type"]) => layout.fixtures.find((f) => f.type === type);
  const bench = find("weightBench"), bells = find("dumbbells"), bar = find("pullupBar"), mill = find("treadmill");
  if (!bench || !bells || !bar || !mill) return null;
  // A fixture's own frame (x across, z out of its front) to the room's.
  const at = (f: Fixture, lx: number, lz: number, turn = 0): Station => {
    const c = Math.cos(f.rot), s = Math.sin(f.rot);
    return { x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c, yaw: f.rot + turn, fixture: f };
  };
  return {
    // Lying along the bench, the head toward its rack (its −z end): the hips 0.25 toward the foot end.
    bench: at(bench, 0, BENCH.hips),
    // In front of the dumbbell rack, facing away from it (into the room).
    curls: at(bells, 0, 1.25),
    // Under the bar, facing out of the frame; the bar a little ahead of the shoulders.
    pullup: at(bar, 0, -PULLUP.ahead),
    // On the treadmill's belt, facing its console (its −z end).
    treadmill: at(mill, 0, 0.15, Math.PI),
  };
}

// ---------- the poses (joint angles as the character rig takes them; see CharacterBody) ----------
/** The bench: its top's height, where the hips lie (along it), the bar's rest (in its rack) and its travel. */
export const BENCH = { top: 0.5, hipY: 0.66, hips: 0.25, rackZ: -0.45, rackY: 1.15, gripZ: -0.22, grip: 0.31, low: 0.86, high: 1.16 };
/** The pull-up bar's height and how far ahead of the shoulders it is; the body's lift at the bottom and top. */
export const PULLUP = { barY: 2.3, ahead: 0.1, grip: 0.32, low: 0.26, high: 0.72 };
/** The treadmill belt's height. */
export const BELT_Y = 0.21;

/** A smooth 0..1..0 over one cycle: down (or up) for `a` of it, back over the rest, easing at both ends. */
function cycle(u: number, a: number) {
  const w = u - Math.floor(u);
  const e = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
  return w < a ? e(w / a) : 1 - e((w - a) / (1 - a));
}
/** Each exercise repeats a whole number of times in its 3 s, so they never look started or finished. */
const REP = 1.5;

export type Joints = {
  /** The root's lift off the floor (world), and a tilt forward/back (rad). */
  rootY: number; rootTilt: number;
  /** The hips' height above the root and their turn about x (lying: −π/2). */
  hipsY: number; hipsX: number;
  torso: [number, number, number]; head: [number, number, number];
  thighL: [number, number]; thighR: [number, number]; shinL: [number, number]; shinR: [number, number];
  /** Arms as angles (x, z) — or, when `grips` is set, both hands reach those points instead (root frame). */
  armL: [number, number]; armR: [number, number]; foreL: number; foreR: number;
  grips?: { left: [number, number, number]; right: [number, number, number]; /** The elbows' pull (torso frame). */ poleL: [number, number, number]; poleR: [number, number, number] };
};

/** The bar's height on the bench `t` s in (lowered to the chest and pressed up, twice in 3 s). */
export const benchBarY = (t: number) => BENCH.low + (BENCH.high - BENCH.low) * (1 - cycle(t / REP + 0.15, 0.55));
/** How far up the body is on the pull-up bar (0 hanging, 1 chin over), `t` s in. */
export const pullupK = (t: number) => cycle(t / REP + 0.05, 0.45);
/** Each arm's curl (0 hanging, 1 up at the shoulder), the left and right half a rep apart. */
export const curlK = (t: number, side: 1 | -1) => cycle(t / REP + (side === 1 ? 0 : 0.5), 0.45);
/** The treadmill's stride: exactly four strides in 3 s. */
export const STRIDE = (2 * Math.PI * 4) / 3;

export function poseAt(stage: Stage, t: number): Joints {
  const base: Joints = {
    rootY: 0, rootTilt: 0, hipsY: 0.95, hipsX: 0, torso: [0, 0, 0], head: [0, 0, 0],
    thighL: [0, 0.1], thighR: [0, -0.1], shinL: [0.05, 0], shinR: [0.05, 0], armL: [0, 0.12], armR: [0, -0.12], foreL: -0.15, foreR: -0.15,
  };
  if (stage === "bench") {
    // Flat on the back (the hips turned −π/2: the torso along the bench toward its rack, the face up), the feet
    // planted on the floor either side, hands on the bar a little wider than the shoulders.
    const y = benchBarY(t), lowness = 1 - (y - BENCH.low) / (BENCH.high - BENCH.low);
    const drop = 0.29;
    return {
      ...base, hipsY: BENCH.hipY, hipsX: -Math.PI / 2, torso: [0, 0, 0], head: [0.12 + 0.04 * lowness, 0, 0],
      thighL: [drop, 0.38], thighR: [drop, -0.38], shinL: [Math.PI / 2 - drop, -0.3], shinR: [Math.PI / 2 - drop, 0.3],
      grips: {
        left: [BENCH.grip, y, BENCH.gripZ - BENCH.hips], right: [-BENCH.grip, y, BENCH.gripZ - BENCH.hips],
        // (Lying, the torso's −z is the floor: the elbows go out and down under the bar.)
        poleL: [1, -0.25, -0.75], poleR: [-1, -0.25, -0.75],
      },
    };
  }
  if (stage === "curls") {
    // Standing tall, the elbows at the sides; one dumbbell comes up as the other goes down.
    const kL = curlK(t, 1), kR = curlK(t, -1), sway = Math.sin((2 * Math.PI * t) / REP) * 0.025;
    return {
      ...base, hipsY: 0.95 - 0.01 * Math.abs(sway) * 10, torso: [0.02, 0, sway], head: [0.05, 0, -sway * 0.5],
      thighL: [0, 0.09], thighR: [0, -0.09], shinL: [0.04, 0], shinR: [0.04, 0],
      armL: [-0.04 - 0.22 * kL, 0.13], armR: [-0.04 - 0.22 * kR, -0.13],
      foreL: -0.12 - 2.15 * kL, foreR: -0.12 - 2.15 * kR,
    };
  }
  if (stage === "pullup") {
    // Hanging from the bar (both hands on it), pulled up until the chin is over it and let down again; the knees
    // a little bent, the feet crossed at the ankles (only the lower legs cross).
    const k = pullupK(t), lift = PULLUP.low + (PULLUP.high - PULLUP.low) * k;
    return {
      ...base, rootY: lift, rootTilt: 0.03 * Math.sin((2 * Math.PI * t) / REP), hipsY: 0.95,
      torso: [-0.06 - 0.06 * k, 0, 0], head: [-0.12 * k, 0, 0],
      thighL: [-0.22, 0.02], thighR: [-0.18, -0.02], shinL: [0.62, -0.17], shinR: [0.5, 0.17],
      grips: {
        left: [PULLUP.grip, PULLUP.barY, PULLUP.ahead], right: [-PULLUP.grip, PULLUP.barY, PULLUP.ahead],
        poleL: [1, -0.35, 0.2], poleR: [-1, -0.35, 0.2],
      },
    };
  }
  // The treadmill: running in place (the belt takes the feet back), as the run looks in the street.
  const ph = STRIDE * t, sin = Math.sin(ph), cos = Math.cos(ph);
  return {
    ...base, rootY: BELT_Y, hipsY: 0.95 - Math.abs(cos) * 0.095, torso: [0.3, 0, 0], head: [-0.15, 0, 0],
    thighL: [-sin * 0.95, 0.12], thighR: [sin * 0.95, -0.12], shinL: [0.38 + 1.55 * Math.max(0, cos), 0], shinR: [0.38 + 1.55 * Math.max(0, -cos), 0],
    armL: [sin * 1.0, 0.12], armR: [-sin * 1.0, -0.12], foreL: -1.5, foreR: -1.5,
  };
}

/**
 * A free place to stand near (x, z) (the room's frame) when the workout's over: the spot itself if nobody's on it,
 * else the nearest of a few rings round it that isn't on anyone, in anything solid or out of the room.
 */
export function freeSpotNear(x: number, z: number, people: readonly { x: number; z: number; r: number }[], solids: readonly Box[], bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): [number, number] {
  const R = 0.3;
  const free = (px: number, pz: number) =>
    px > bounds.minX + R && px < bounds.maxX - R && pz > bounds.minZ + R && pz < bounds.maxZ - R
    && people.every((p) => Math.hypot(p.x - px, p.z - pz) > p.r + R + 0.15)
    && solids.every((b) => Math.abs(px - b.x) > b.hx + R || Math.abs(pz - b.z) > b.hz + R);
  if (free(x, z)) return [x, z];
  for (const ring of [0.75, 1.3, 1.9, 2.5]) {
    const n = Math.round((2 * Math.PI * ring) / 0.6);
    // (Beside first — along the desk — then the rest of the ring.)
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(Math.sin((2 * Math.PI * a) / n)) - Math.abs(Math.sin((2 * Math.PI * b) / n)));
    for (const i of order) {
      const a = (2 * Math.PI * i) / n, px = x + Math.cos(a) * ring, pz = z + Math.sin(a) * ring;
      if (free(px, pz)) return [px, pz];
    }
  }
  return [x, z];
}
