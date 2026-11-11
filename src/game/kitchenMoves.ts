// The kitchen's moves (pure): timelines of poses in the floor's frame, like the bathroom's, each piece ending in
// an event the runner acts on (a thing taken, poured, washed…). Extra fields tell the kitchen's things how they are
// meanwhile: the cupboard's doors, the bin's lid, a can's lid, how far the pot is tipped, what's pouring, the tap.
import type { AptFloor } from "./aptRoom";
import { smooth, walkTo, type Reach } from "./restaurantRoom";
import type { WareKind } from "./pantry";

type V3 = [number, number, number];
export type KPose = {
  x: number; z: number; yaw: number; crouch: number; lean: number; left: Reach | null; right: Reach | null;
  /** The cupboard's doors (0 shut, 1 open), the bin's lid, the can's lid, the pot tipped (radians), the tap. */
  door?: number; lid?: number; canOpen?: number; potTilt?: number; canTilt?: number; water?: number;
  /** What's pouring: from a can into the pot, from the pot onto a plate, burnt food into the bin. */
  stream?: "can" | "pot" | "burnt" | null;
  /** How far the pouring has got (0..1: the food lands bit by bit). */
  pourK?: number;
  /** A thing shown in a hand just for this move (put away after washing, or out of the bag). */
  holdL?: WareKind | null; holdR?: WareKind | null;
};
export type KSeg = { dur: number; pose: (k: number) => KPose; end?: string };
export type KPlan = { segs: KSeg[]; total: number };
export const kplan = (segs: KSeg[]): KPlan => ({ segs, total: segs.reduce((a, s) => a + s.dur, 0) });
/** Where a plan is at `t`: the pose, the events passed since `prev`, and whether it's over. */
export function kplanAt(p: KPlan, t: number, prev = -1): { pose: KPose; events: string[]; done: boolean } {
  let at = 0;
  const events: string[] = [];
  for (const s of p.segs) {
    const end = at + s.dur;
    if (s.end && end > prev && end <= t) events.push(s.end);
    if (t < end) return { pose: s.pose(Math.max(0, (t - at) / s.dur)), events, done: false };
    at = end;
  }
  const last = p.segs[p.segs.length - 1]!;
  return { pose: last.pose(1), events, done: true };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerp3 = (a: V3, b: V3, k: number): V3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
/** A point by the body: `r` to its right, `f` ahead, `y` up. */
const rel = (x: number, z: number, yaw: number, r: number, f: number, y: number): V3 => [x + Math.sin(yaw) * f - Math.cos(yaw) * r, y, z + Math.cos(yaw) * f + Math.sin(yaw) * r];
const R = (at: V3, blend = 1, pole: Reach["pole"] = "out"): Reach | null => (blend > 0.001 ? { at, blend, pole } : null);
/** Hands carrying (each holding something, or not): out in front at the waist. */
export type Carry = { left: boolean; right: boolean };
const carryAt = (x: number, z: number, yaw: number, side: 1 | -1): V3 => rel(x, z, yaw, side * 0.17, 0.3, 0.95);
const carried = (x: number, z: number, yaw: number, c: Carry) => ({ left: c.left ? R(carryAt(x, z, yaw, -1), 1, "low") : null, right: c.right ? R(carryAt(x, z, yaw, 1), 1, "low") : null });

/** Small steps from where one is to a spot, turning to `yaw`; what's held is carried in front. */
export function walk(from: [number, number], fromYaw: number, to: [number, number], yaw: number, c: Carry): KSeg {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
  return { dur: Math.max(0.45, d / 0.85 + 0.4), pose: (k) => { const { at, yaw: y } = walkTo(k, from, to, fromYaw, yaw); return { x: at[0], z: at[1], yaw: y, crouch: 0, lean: 0.04, ...carried(at[0], at[1], y, c) }; } };
}
/** Standing still a moment, holding things. */
const still = (x: number, z: number, yaw: number, c: Carry, dur: number, end?: string, extra: Partial<KPose> = {}): KSeg => ({ dur, ...(end ? { end } : {}), pose: () => ({ x, z, yaw, crouch: 0, lean: 0, ...carried(x, z, yaw, c), ...extra }) });

/** The cupboard's door handles (left and right door, at the middle where they meet). */
export const cupboardHandles = (fl: AptFloor): [V3, V3] => { const c = fl.kitchen.cupboard; return [[c.x - 0.05, 0.7, c.z - 0.02], [c.x + 0.05, 0.7, c.z - 0.02]]; };
/** Where each door's handle is with the doors this open (they swing out on hinges at the cupboard's sides). */
export function handleAt(fl: AptFloor, side: -1 | 1, open: number): V3 {
  const c = fl.kitchen.cupboard, half = c.w / 2, hx = c.x + side * half, a = open * 1.6, len = half - 0.05;
  return [hx - side * Math.cos(a) * len, 0.7, c.z - 0.02 - Math.sin(a) * len];
}
/** A place inside the cupboard for its i-th pot or pan (two rows: floor and shelf). */
export function cupboardSlot(fl: AptFloor, i: number): V3 {
  const c = fl.kitchen.cupboard, col = i % 3, row = Math.floor(i / 3) % 2;
  return [c.x - 0.22 + col * 0.22, row ? 0.46 : 0.08, c.z + 0.28];
}
/** Spots on the counter beside the sink for each kind kept there (stacks). */
export function rackSpot(fl: AptFloor, w: WareKind): V3 {
  const r = fl.kitchen.rack, off: Partial<Record<WareKind, [number, number]>> = { plate: [0.2, 0.05], bowl: [0.02, 0.08], cup: [-0.16, 0.12], jar: [-0.3, 0.14], silverware: [-0.16, -0.06] };
  const o = off[w] ?? [0, 0];
  return [r[0] + o[0], r[1], r[2] + o[1]];
}

// ---------- the cupboard under the sink ----------
/** Crouched at the sink, both hands open the cupboard's doors (then wait for a choice: event "choose"). */
export function openCupboard(fl: AptFloor, from: [number, number], fromYaw: number, c: Carry): KSeg[] {
  const [x, z] = fl.kitchen.sinkStand, [hl, hr] = cupboardHandles(fl);
  const bend = (e: number) => ({ crouch: 0.48 * e, lean: 0.42 * e });
  return [
    walk(from, fromYaw, [x, z], 0, c),
    { dur: 0.8, pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, ...bend(e), left: R(hl, e), right: R(hr, e), door: 0 }; } },
    { dur: 0.9, end: "open", pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, ...bend(1), left: R(handleAt(fl, -1, e)), right: R(handleAt(fl, 1, e)), door: e }; } },
    { dur: 0.4, end: "choose", pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, ...bend(1), left: R(handleAt(fl, -1, 1), 1 - e), right: R(handleAt(fl, 1, 1), 1 - e), door: 1 }; } },
  ];
}
/** Crouched with the doors open: the right hand reaches in for slot `i`'s pot or pan (event "took"), brings it out,
 * the left pushes the doors shut, and up. */
export function takeFromCupboard(fl: AptFloor, i: number): KSeg[] {
  const [x, z] = fl.kitchen.sinkStand, slot = cupboardSlot(fl, i), hold = carryAt(x, z, 0, 1), mid: V3 = [slot[0], 0.62, fl.kitchen.cupboard.z - 0.1];
  const bend = (e: number) => ({ crouch: 0.48 * e, lean: 0.42 * e });
  return [
    { dur: 0.8, end: "took", pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, ...bend(1), left: null, right: R([slot[0], slot[1] + 0.12, slot[2]], e, "low"), door: 1 }; } },
    { dur: 0.6, pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, ...bend(1), left: null, right: R(lerp3([slot[0], slot[1] + 0.12, slot[2]], mid, e), 1, "low"), door: 1 }; } },
    { dur: 0.8, end: "shut", pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, ...bend(1), left: R(handleAt(fl, -1, 1 - e)), right: R(mid, 1, "low"), door: 1 - e }; } },
    { dur: 0.6, pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, ...bend(1 - e), left: R(handleAt(fl, 1, 0), 1 - e), right: R(lerp3(mid, hold, e), 1, "low"), door: 0 }; } },
  ];
}
/** Putting pots and pans away (`n` of them, into slots from `first`): crouch, doors open, each in, doors shut, up. */
export function intoCupboard(fl: AptFloor, from: [number, number], fromYaw: number, first: number, n: number, c: Carry, wares: WareKind[] = []): KSeg[] {
  const [x, z] = fl.kitchen.sinkStand, segs = openCupboard(fl, from, fromYaw, c).slice(0, 3);
  const bend = { crouch: 0.48, lean: 0.42 };
  for (let k = 0; k < n; k++) {
    const slot = cupboardSlot(fl, first + k), hold = carryAt(x, z, 0, 1);
    const w = wares[k] ?? null;
    segs.push({ dur: 0.8, end: "in", pose: (q) => { const e = smooth(q); return { x, z, yaw: 0, ...bend, left: null, right: R(lerp3(hold, [slot[0], slot[1] + 0.12, slot[2]], e), 1, "low"), door: 1, holdR: w }; } });
    segs.push({ dur: 0.45, pose: (q) => { const e = smooth(q); return { x, z, yaw: 0, ...bend, left: null, right: R(lerp3([slot[0], slot[1] + 0.12, slot[2]], hold, e), 1 - 0.5 * e, "low"), door: 1 }; } });
  }
  segs.push({ dur: 0.8, pose: (q) => { const e = smooth(q); return { x, z, yaw: 0, ...bend, left: R(handleAt(fl, -1, 1 - e)), right: R(handleAt(fl, 1, 1 - e)), door: 1 - e }; } });
  segs.push({ dur: 0.6, pose: (q) => { const e = smooth(q); return { x, z, yaw: 0, crouch: 0.48 * (1 - e), lean: 0.42 * (1 - e), left: R(handleAt(fl, -1, 0), 1 - e), right: R(handleAt(fl, 1, 0), 1 - e), door: 0 }; } });
  return segs;
}

// ---------- the stove ----------
/** To the oven, and the pot (or pan) in the right hand set on the burner (event "onStove"). */
export function toStove(fl: AptFloor, from: [number, number], fromYaw: number, c: Carry, bi = 0): KSeg[] {
  const [x, z] = fl.kitchen.ovenStand, b = fl.kitchen.burners[bi]!, hold = carryAt(x, z, 0, 1), over: V3 = [b[0] + 0.12, b[1] + 0.06, b[2]];
  return [
    walk(from, fromYaw, [x, z], 0, c),
    { dur: 0.8, end: "onStove", pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, crouch: 0, lean: 0.18 * e, left: c.left ? R(carryAt(x, z, 0, -1), 1, "low") : null, right: R(lerp3(hold, over, e), 1, "low") }; } },
    { dur: 0.45, pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, crouch: 0, lean: 0.18 * (1 - e), left: c.left ? R(carryAt(x, z, 0, -1), 1, "low") : null, right: R(over, 1 - e, "low") }; } },
  ];
}
/** Cans into the pot, one after another: each comes up in the left hand, the right pulls its ring and peels the
 * lid back (event "opened:i"), the left tips it over the pot and it pours (event "canIn:i"), and it's tossed in the
 * bin beside the oven (event "toss:i"). Then the cooking starts (event "cook"). */
export function cansIn(fl: AptFloor, n: number, bi = 0): KSeg[] {
  const [x, z] = fl.kitchen.ovenStand, b = fl.kitchen.burners[bi]!, front = rel(x, z, 0, -0.04, 0.3, 1.1), ring: V3 = [front[0], front[1] + 0.11, front[2] + 0.02];
  const over: V3 = [b[0] - 0.02, b[1] + 0.32, b[2] - 0.04], toss: V3 = rel(x, z, 0, -0.35, 0.25, 1.05);
  const segs: KSeg[] = [];
  for (let i = 0; i < n; i++) {
    segs.push({ dur: 0.55, end: `show:${i}`, pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, crouch: 0, lean: 0.06, left: R(lerp3(carryAt(x, z, 0, -1), front, e), 1, "low"), right: null, canOpen: 0 }; } });
    segs.push({ dur: 0.55, pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, crouch: 0, lean: 0.08, left: R(front, 1, "low"), right: R(ring, e, "out"), canOpen: 0 }; } });
    segs.push({ dur: 0.7, end: `opened:${i}`, pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, crouch: 0, lean: 0.08, left: R(front, 1, "low"), right: R([ring[0], ring[1] + 0.06 * e, ring[2] - 0.05 * e], 1, "out"), canOpen: e }; } });
    segs.push({ dur: 0.35, pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, crouch: 0, lean: 0.08, left: R(front, 1, "low"), right: R(ring, 1 - e, "out"), canOpen: 1 }; } });
    segs.push({ dur: 0.6, pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, crouch: 0, lean: 0.08 + 0.12 * e, left: R(lerp3(front, over, e), 1, "low"), right: null, canOpen: 1, canTilt: 1.9 * e }; } });
    segs.push({ dur: 1.1, end: `canIn:${i}`, pose: (k) => ({ x, z, yaw: 0, crouch: 0, lean: 0.2, left: R([over[0], over[1] + 0.01 * Math.sin(k * 12), over[2]], 1, "low"), right: null, canOpen: 1, canTilt: 1.9 + 0.25 * k, stream: k > 0.06 && k < 0.9 ? "can" : null, pourK: Math.min(1, Math.max(0, (k - 0.06) / 0.84)) }) });
    segs.push({ dur: 0.55, end: `toss:${i}`, pose: (k) => { const e = smooth(k); return { x, z, yaw: -0.5 * Math.sin(Math.PI * k), crouch: 0, lean: 0.12, left: R(lerp3(over, toss, e), 1, "low"), right: null, canOpen: 1, canTilt: 2.1 * (1 - e) }; } });
  }
  segs.push({ dur: 0.4, end: "cook", pose: (k) => ({ x, z, yaw: 0, crouch: 0, lean: 0.1 * (1 - k), left: R(toss, 1 - smooth(k), "low"), right: null }) });
  return segs;
}
/** Taking the pot off the stove by its handle, into the right hand (event "lift"). */
export function offStove(fl: AptFloor, from: [number, number], fromYaw: number, c: Carry, bi = 0): KSeg[] {
  const [x, z] = fl.kitchen.ovenStand, b = fl.kitchen.burners[bi]!, hold = carryAt(x, z, 0, 1), on: V3 = [b[0] + 0.12, b[1] + 0.06, b[2]];
  return [
    walk(from, fromYaw, [x, z], 0, c),
    { dur: 0.7, end: "lift", pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, crouch: 0, lean: 0.18 * e, left: c.left ? R(carryAt(x, z, 0, -1), 1, "low") : null, right: R(on, e, "low") }; } },
    { dur: 0.6, pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, crouch: 0, lean: 0.18 * (1 - e), left: c.left ? R(carryAt(x, z, 0, -1), 1, "low") : null, right: R(lerp3(on, hold, e), 1, "low") }; } },
  ];
}

// ---------- pouring, the sink, the counter, the table, the bin ----------
/** Where one is: the plate up in the left hand, the pot lifted in the right and tipped over it until the food has
 * slid out onto the plate (event "poured"), then both back down. */
export function pourToPlate(x: number, z: number, yaw: number): KSeg[] {
  const plate = rel(x, z, yaw, -0.06, 0.36, 1.0), pot = rel(x, z, yaw, 0.08, 0.36, 1.18);
  return [
    { dur: 0.7, pose: (k) => { const e = smooth(k); return { x, z, yaw, crouch: 0, lean: 0.12 * e, left: R(lerp3(carryAt(x, z, yaw, -1), plate, e), 1, "low"), right: R(lerp3(carryAt(x, z, yaw, 1), pot, e), 1, "low"), potTilt: 0 }; } },
    { dur: 0.6, pose: (k) => { const e = smooth(k); return { x, z, yaw, crouch: 0, lean: 0.14, left: R(plate, 1, "low"), right: R(pot, 1, "low"), potTilt: 1.5 * e }; } },
    { dur: 1.5, end: "poured", pose: (k) => ({ x, z, yaw, crouch: 0, lean: 0.14, left: R(plate, 1, "low"), right: R([pot[0], pot[1] + 0.02 * Math.sin(k * 14), pot[2]], 1, "low"), potTilt: 1.5 + 0.35 * k, stream: k < 0.9 ? "pot" : null, pourK: Math.min(1, k / 0.9) }) },
    { dur: 0.8, pose: (k) => { const e = smooth(k); return { x, z, yaw, crouch: 0, lean: 0.14 * (1 - e), left: R(lerp3(plate, carryAt(x, z, yaw, -1), e), 1, "low"), right: R(lerp3(pot, carryAt(x, z, yaw, 1), e), 1, "low"), potTilt: 1.85 * (1 - e) }; } },
  ];
}
/** To the sink, and what's carried set down in it (event "inSink"). */
export function toSink(fl: AptFloor, from: [number, number], fromYaw: number, c: Carry): KSeg[] {
  const [x, z] = fl.kitchen.sinkStand, b = fl.kitchen.basin;
  const inL: V3 = [b[0] - 0.08, b[1] + 0.06, b[2]], inR: V3 = [b[0] + 0.08, b[1] + 0.06, b[2]];
  return [
    walk(from, fromYaw, [x, z], 0, c),
    { dur: 0.7, end: "inSink", pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, crouch: 0, lean: 0.25 * e, left: c.left ? R(lerp3(carryAt(x, z, 0, -1), inL, e), 1, "low") : null, right: c.right ? R(lerp3(carryAt(x, z, 0, 1), inR, e), 1, "low") : null }; } },
    { dur: 0.45, pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, crouch: 0, lean: 0.25 * (1 - e), left: c.left ? R(inL, 1 - e, "low") : null, right: c.right ? R(inR, 1 - e, "low") : null }; } },
  ];
}
/** Washing up `n` things at the sink: the tap on, each one held under it in the left hand and scrubbed round with
 * the right for five seconds (event "washed:i"), the tap off. */
export function washUp(fl: AptFloor, n: number): KSeg[] {
  const [x, z] = fl.kitchen.sinkStand, b = fl.kitchen.basin, lever: V3 = [b[0] + 0.05, b[1] + 0.27, b[2] - 0.18];
  const held: V3 = [b[0] - 0.02, b[1] + 0.12, b[2]];
  const segs: KSeg[] = [
    { dur: 0.6, pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, crouch: 0, lean: 0.25 * e, left: null, right: R(lever, e), water: 0 }; } },
    { dur: 0.5, pose: (k) => ({ x, z, yaw: 0, crouch: 0, lean: 0.25, left: null, right: R([lever[0] + 0.04 * k, lever[1], lever[2]]), water: smooth(k) }) },
  ];
  for (let i = 0; i < n; i++) {
    segs.push({ dur: 0.5, end: `wash:${i}`, pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, crouch: 0, lean: 0.3, left: R(lerp3([b[0] - 0.12, b[1] + 0.03, b[2]], held, e), 1, "low"), right: R([b[0] + 0.1, b[1] + 0.16, b[2]], 1, "low"), water: 1 }; } });
    segs.push({ dur: 5, end: `washed:${i}`, pose: (k) => { const ph = k * 5 * Math.PI * 2 * 1.6; return { x, z, yaw: 0, crouch: 0, lean: 0.3 + 0.02 * Math.sin(ph), left: R([held[0] + 0.01 * Math.sin(ph * 0.5), held[1], held[2]], 1, "low"), right: R([held[0] + 0.05 + 0.045 * Math.cos(ph), held[1] + 0.03, held[2] + 0.045 * Math.sin(ph)], 1, "low"), water: 1 }; } });
  }
  segs.push({ dur: 0.6, pose: (k) => ({ x, z, yaw: 0, crouch: 0, lean: 0.25, left: R(held, 1 - smooth(k), "low"), right: R([lever[0] + 0.04 * (1 - k), lever[1], lever[2]]), water: 1 - smooth(k) }) });
  segs.push({ dur: 0.4, pose: (k) => ({ x, z, yaw: 0, crouch: 0, lean: 0.25 * (1 - smooth(k)), left: null, right: R(lever, 1 - smooth(k)), water: 0 }) });
  return segs;
}
/** At the counter beside the sink: a hand to a spot on it and back (event `ev` as it gets there). */
export function atRack(fl: AptFloor, from: [number, number], fromYaw: number, spot: V3, hand: "left" | "right", ev: string, c: Carry, show: WareKind | null = null): KSeg[] {
  const [x, z] = fl.kitchen.rackStand, side = hand === "left" ? -1 : 1, hold = carryAt(x, z, 0, side);
  const other = hand === "left" ? (c.right ? R(carryAt(x, z, 0, 1), 1, "low") : null) : (c.left ? R(carryAt(x, z, 0, -1), 1, "low") : null);
  const reach = (e: number) => R(lerp3(hold, [spot[0], spot[1] + 0.05, spot[2]], e), 1, "low");
  const pose = (e: number, lean: number, held: boolean): KPose => ({ x, z, yaw: 0, crouch: 0, lean, left: hand === "left" ? reach(e) : other, right: hand === "right" ? reach(e) : other, ...(held && show ? (hand === "left" ? { holdL: show } : { holdR: show }) : {}) });
  const walking = walk(from, fromYaw, [x, z], 0, c);
  const carryIt: KSeg = show ? { dur: walking.dur, pose: (k) => { const p = walking.pose(k); return { ...p, ...(hand === "left" ? { left: R(carryAt(p.x, p.z, p.yaw, -1), 1, "low"), holdL: show } : { right: R(carryAt(p.x, p.z, p.yaw, 1), 1, "low"), holdR: show }) }; } } : walking;
  return [carryIt, { dur: 0.7, end: ev, pose: (k) => pose(smooth(k), 0.2 * smooth(k), true) }, { dur: 0.55, pose: (k) => pose(1 - smooth(k), 0.2 * (1 - smooth(k)), false) }];
}
/** To the table and the plate (left hand) set down at a chair's place (event "down"). */
export function toTable(place: { at: V3; stand: [number, number]; yaw: number }, from: [number, number], fromYaw: number, c: Carry): KSeg[] {
  const [x, z] = place.stand, yaw = place.yaw, hold = carryAt(x, z, yaw, -1), at: V3 = [place.at[0], place.at[1] + 0.03, place.at[2]];
  return [
    walk(from, fromYaw, [x, z], yaw, c),
    { dur: 0.8, end: "down", pose: (k) => { const e = smooth(k); return { x, z, yaw, crouch: 0.1 * e, lean: 0.3 * e, left: R(lerp3(hold, at, e), 1, "low"), right: c.right ? R(carryAt(x, z, yaw, 1), 1, "low") : null }; } },
    { dur: 0.5, pose: (k) => { const e = smooth(k); return { x, z, yaw, crouch: 0.1 * (1 - e), lean: 0.3 * (1 - e), left: R(at, 1 - e, "low"), right: c.right ? R(carryAt(x, z, yaw, 1), 1, "low") : null }; } },
  ];
}
/** Picking a used plate (and its silverware) up off the table with both hands (event "up"). */
export function fromTable(place: { at: V3; stand: [number, number]; yaw: number }, from: [number, number], fromYaw: number): KSeg[] {
  const [x, z] = place.stand, yaw = place.yaw, at: V3 = [place.at[0], place.at[1] + 0.03, place.at[2]];
  const pair = (p: V3, e: number) => ({ left: R(lerp3(carryAt(x, z, yaw, -1), [p[0] - 0.06, p[1], p[2]], e), 1, "low"), right: R(lerp3(carryAt(x, z, yaw, 1), [p[0] + 0.06, p[1], p[2]], e), 1, "low") });
  return [
    walk(from, fromYaw, [x, z], yaw, { left: false, right: false }),
    { dur: 0.8, end: "up", pose: (k) => { const e = smooth(k); return { x, z, yaw, crouch: 0.1 * e, lean: 0.3 * e, ...pair(at, e) }; } },
    { dur: 0.6, pose: (k) => { const e = smooth(k); return { x, z, yaw, crouch: 0.1 * (1 - e), lean: 0.3 * (1 - e), left: R(carryAt(x, z, yaw, -1), 1, "low"), right: R(carryAt(x, z, yaw, 1), smooth(1 - e) * 0 + (1 - e), "low") }; } },
  ];
}
/** At the bin: the lid opens, the burnt pot is tipped over it and the black food slides in (event "dumped"). */
export function dumpInBin(fl: AptFloor, from: [number, number], fromYaw: number, c: Carry): KSeg[] {
  const [x, z] = fl.kitchen.trashStand, t = fl.kitchen.trash, over: V3 = [t[0] + 0.02, t[1] + 0.38, t[2] - 0.12], hold = carryAt(x, z, 0, 1);
  const left = c.left ? R(carryAt(x, z, 0, -1), 1, "low") : null;
  return [
    walk(from, fromYaw, [x, z], 0, c),
    { dur: 0.5, pose: (k) => ({ x, z, yaw: 0, crouch: 0, lean: 0.1 * k, left, right: R(hold, 1, "low"), lid: smooth(k) }) },
    { dur: 0.6, pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, crouch: 0, lean: 0.1 + 0.15 * e, left, right: R(lerp3(hold, over, e), 1, "low"), lid: 1, potTilt: 1.4 * e }; } },
    { dur: 1.5, end: "dumped", pose: (k) => ({ x, z, yaw: 0, crouch: 0, lean: 0.25, left, right: R([over[0], over[1] + 0.03 * Math.abs(Math.sin(k * 9)), over[2]], 1, "low"), lid: 1, potTilt: 1.4 + 0.5 * k, stream: k < 0.85 ? "burnt" : null, pourK: Math.min(1, k / 0.85) }) },
    { dur: 0.7, pose: (k) => { const e = smooth(k); return { x, z, yaw: 0, crouch: 0, lean: 0.25 * (1 - e), left, right: R(lerp3(over, hold, e), 1, "low"), lid: 1 - e, potTilt: 1.9 * (1 - e) }; } },
  ];
}
export { still };
