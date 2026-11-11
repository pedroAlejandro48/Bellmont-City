import type { AptFloor } from "./aptRoom";
import type { BathLink } from "./Bathroom";
import { curtainEdge } from "./Bathroom";
import { CHAIR, smooth, type Reach } from "./restaurantRoom";

/**
 * The bathroom's moves, as poses at each moment (in the floor's frame; hands' heights above its floor). Each also
 * sets what the bathroom's things show (`link`): the water, the curtain, the paper, the flush.
 */
export type Legs = { hipL: number; kneeL: number; hipR: number; kneeR: number };
export type BathPose = { x: number; z: number; yaw: number; lean: number; crouch: number; sit: number; shuffle: number; left: Reach | null; right: Reach | null; legs?: Legs };
type V3 = [number, number, number];

const cum = <T extends Record<string, number>>(d: T): T => { let a = 0; const o = {} as Record<string, number>; for (const k in d) o[k] = a += d[k]!; return o as T; };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerp3 = (a: V3, b: V3, k: number): V3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const hand = (at: V3, blend: number, pole: Reach["pole"] = "low"): Reach | null => (blend > 0.001 ? { at, blend, pole } : null);
/** A body-relative point: `r` to the right, `f` forward, at height y. */
const rel = (x: number, z: number, yaw: number, r: number, f: number, y: number): V3 => [x + Math.sin(yaw) * f - Math.cos(yaw) * r, y, z + Math.cos(yaw) * f + Math.sin(yaw) * r];

// ---------- the sink ----------
export const WASH = cum({ reach: 0.6, open: 0.6, into: 0.75, rub: 5.0, out: 0.6, close: 0.6, down: 0.55 });
/** Where one stands at the sink (a little closer than the spot one walks to). */
export const washStand = (fl: AptFloor): [number, number] => [fl.bath.sink.stand[0] + 0.08, fl.bath.sink.stand[1]];
/**
 * Washing the hands: the right hand turns the knob, the water runs; leaning in a little, both hands go into the
 * basin under it (elbows bent) and rub round each other for five seconds; out, the knob shut, the hands down.
 */
export function washAt(fl: AptFloor, u: number, link: BathLink): BathPose {
  const s = fl.bath.sink, [x, z] = washStand(fl), yaw = Math.PI / 2, k = (a: number, d: number) => smooth((u - a) / d);
  const knob: V3 = [s.tap[0] - 0.005, s.tap[1] + 0.045, s.tap[2]];
  const twist = (on: number): V3 => [knob[0] - 0.02 * on, knob[1] + 0.01 * on, knob[2] + 0.035 * on];
  // Under the water: the hands together, each going round the other.
  const under = (side: 1 | -1, ph: number, r: number): V3 => [s.bowl[0] - 0.05 + r * 0.03 * Math.cos(ph + (side > 0 ? 0 : Math.PI)), s.bowl[1] + 0.1 + r * 0.018 * Math.sin(2 * ph), s.bowl[2] + side * 0.05 + r * 0.025 * Math.sin(ph + (side > 0 ? 0 : Math.PI))];
  const base = { x, z, yaw, crouch: 0, sit: 0, shuffle: 0 };
  link.sink = u < WASH.out ? k(WASH.reach + 0.15, 0.45) : 1 - k(WASH.out + 0.15, 0.4);
  if (u < WASH.reach) return { ...base, lean: 0.12 * k(0, WASH.reach), left: null, right: hand(knob, k(0, WASH.reach), "out") };
  if (u < WASH.open) return { ...base, lean: 0.12, left: null, right: hand(twist(k(WASH.reach, WASH.open - WASH.reach)), 1, "out") };
  if (u < WASH.into) {
    const e = k(WASH.open, WASH.into - WASH.open);
    return { ...base, lean: lerp(0.12, 0.3, e), left: hand(under(-1, 0, 0), e), right: hand(lerp3(twist(1), under(1, 0, 0), e), 1) };
  }
  if (u < WASH.rub) {
    const ph = (u - WASH.into) * Math.PI * 2 * 1.5, r = Math.min(k(WASH.into, 0.4), 1 - k(WASH.rub - 0.35, 0.35));
    return { ...base, lean: 0.3 + 0.02 * Math.sin(ph), left: hand(under(-1, ph, r), 1), right: hand(under(1, ph, r), 1) };
  }
  if (u < WASH.out) {
    const e = k(WASH.rub, WASH.out - WASH.rub);
    return { ...base, lean: lerp(0.3, 0.14, e), left: hand(add(under(-1, 0, 0), [-0.08 * e, 0.06 * e, 0]), 1 - e), right: hand(lerp3(under(1, 0, 0), twist(1), e), 1, "out") };
  }
  if (u < WASH.close) return { ...base, lean: 0.14, left: null, right: hand(twist(1 - k(WASH.out, WASH.close - WASH.out)), 1, "out") };
  const e = k(WASH.close, WASH.down - WASH.close);
  return { ...base, lean: 0.14 * (1 - e), left: null, right: hand(knob, 1 - e, "out") };
}

// ---------- the toilet ----------
export const TOILET = cum({ sit: 1.0, settle: 0.35, reach: 0.7, tear: 0.5, back: 0.55, lean: 0.5, wipe: 2.7, drop: 0.6, rel: 0.45, up: 0.9, turn: 0.9, flush: 0.6, press: 0.45, back2: 0.5, watch: 1.4 });
/** Where one sits (back to the tank) and the spot by the bowl to flush it from. */
export const toiletSeat = (fl: AptFloor): [number, number] => [fl.bath.toilet.x + 0.1, fl.bath.toilet.z];
/**
 * Using the toilet: back to it and down onto the seat like onto a chair; the right hand takes paper off the roll,
 * a lean forward and three wipes from behind, the paper dropped into the bowl; up again, turned round to the tank
 * and the handle pressed; the water swirls away.
 */
export function toiletAt(fl: AptFloor, u: number, link: BathLink, now: number): BathPose {
  const T = fl.bath.toilet, [sx, sz] = toiletSeat(fl), front = T.front, yaw = Math.PI / 2, k = (a: number, d: number) => smooth((u - a) / d);
  const knee = (side: 1 | -1, x: number, z: number): V3 => rel(x, z, yaw, side * 0.12, 0.42, CHAIR.seatTop + 0.16);
  const knees = (b: number, x = sx, z = sz) => ({ left: hand(knee(-1, x, z), b, "out"), right: hand(knee(1, x, z), b, "out") });
  const roll: V3 = [T.paper[0] + 0.08, T.paper[1] - 0.04, T.paper[2] - 0.02];
  const torn: V3 = add(roll, [0.1, -0.1, -0.03]);
  const lap: V3 = rel(sx, sz, yaw, 0.1, 0.3, 0.64);
  const wipe0: V3 = rel(sx, sz, yaw, 0.1, -0.02, 0.5);
  const over: V3 = rel(sx, sz, yaw, 0.05, 0.12, 0.52);
  const seat = (sit: number) => ({ x: lerp(front[0], sx, sit), z: lerp(front[1], sz, sit), yaw, crouch: 0, sit, shuffle: 0 });
  // The paper: in the hand once torn off, then into the bowl.
  if (u < TOILET.reach + 0.25) link.paper = "none";
  else if (u < TOILET.drop) link.paper = "hand";
  else if (link.paper === "hand") { link.paper = "drop"; link.paperAt = now - (u - TOILET.drop); }
  // The flush: seconds since the handle went down.
  const fAt = TOILET.flush + 0.2;
  link.flush = u >= fAt && u - fAt < 3 ? u - fAt : -1;
  if (u < TOILET.sit) { const e = k(0, TOILET.sit); return { ...seat(e), lean: 0.25 * Math.sin(Math.PI * e), ...knees(e) }; }
  if (u < TOILET.settle) return { ...seat(1), lean: 0.06, ...knees(1) };
  if (u < TOILET.reach) { const e = k(TOILET.settle, TOILET.reach - TOILET.settle); return { ...seat(1), lean: 0.06, left: knees(1).left, right: hand(lerp3(knee(1, sx, sz), roll, e), 1, "out") }; }
  if (u < TOILET.tear) { const e = k(TOILET.reach, TOILET.tear - TOILET.reach); return { ...seat(1), lean: 0.06, left: knees(1).left, right: hand(lerp3(roll, torn, e), 1, "out") }; }
  if (u < TOILET.back) { const e = k(TOILET.tear, TOILET.back - TOILET.tear); return { ...seat(1), lean: 0.06, left: knees(1).left, right: hand(lerp3(torn, lap, e), 1, "out") }; }
  if (u < TOILET.lean) { const e = k(TOILET.back, TOILET.lean - TOILET.back); return { ...seat(1), lean: lerp(0.06, 0.42, e), left: knees(1).left, right: hand(lerp3(lap, wipe0, e), 1, "back") }; }
  if (u < TOILET.wipe) {
    // Three strokes, front to back; the hand comes forward again lifted a little between them.
    const w = (u - TOILET.lean) / (TOILET.wipe - TOILET.lean) * 3, ph = w - Math.floor(w);
    const back = ph < 0.6 ? smooth(ph / 0.6) : 1 - smooth((ph - 0.6) / 0.4), lift = ph < 0.6 ? 0 : Math.sin(Math.PI * (ph - 0.6) / 0.4) * 0.035;
    return { ...seat(1), lean: 0.42 + 0.03 * Math.sin(Math.PI * back), left: knees(1).left, right: hand(add(wipe0, add(rel(0, 0, yaw, 0, 0.05 - 0.13 * back, 0), [0, lift - 0.02 * back, 0])), 1, "back") };
  }
  if (u < TOILET.drop) { const e = k(TOILET.wipe, TOILET.drop - TOILET.wipe); return { ...seat(1), lean: 0.42, left: knees(1).left, right: hand(lerp3(wipe0, over, e), 1, "back") }; }
  if (u < TOILET.rel) { const e = k(TOILET.drop, TOILET.rel - TOILET.drop); return { ...seat(1), lean: lerp(0.42, 0.06, e), ...knees(1), right: hand(lerp3(over, knee(1, sx, sz), e), 1, "out") }; }
  if (u < TOILET.up) { const e = 1 - k(TOILET.rel, TOILET.up - TOILET.rel); return { ...seat(e), lean: 0.25 * Math.sin(Math.PI * e), ...knees(e, lerp(front[0], sx, e), lerp(front[1], sz, e)) }; }
  // Turned round (a couple of small steps) to the tank, and the handle pressed with the right hand.
  const spot: [number, number] = [T.x + 0.52, T.z - 0.02], fyaw = -Math.PI / 2;
  if (u < TOILET.turn) { const e = k(TOILET.up, TOILET.turn - TOILET.up); return { x: lerp(front[0], spot[0], e), z: lerp(front[1], spot[1], e), yaw: lerp(yaw, yaw + Math.PI, e), crouch: 0, sit: 0, shuffle: Math.sin(Math.PI * e), lean: 0, left: null, right: null }; }
  const handle: V3 = [T.flush[0] + 0.06, T.flush[1] + 0.02, T.flush[2]], pressed: V3 = add(handle, [0, -0.045, 0]);
  const at = { x: spot[0], z: spot[1], yaw: fyaw, crouch: 0, sit: 0, shuffle: 0 };
  if (u < TOILET.flush) { const e = k(TOILET.turn, TOILET.flush - TOILET.turn); return { ...at, lean: 0.32 * e, left: null, right: hand(handle, e, "out") }; }
  if (u < TOILET.press) { const e = Math.sin(Math.PI * k(TOILET.flush, TOILET.press - TOILET.flush)); return { ...at, lean: 0.32, left: null, right: hand(lerp3(handle, pressed, e), 1, "out") }; }
  if (u < TOILET.back2) { const e = k(TOILET.press, TOILET.back2 - TOILET.press); return { ...at, lean: 0.32 * (1 - e), left: null, right: hand(handle, 1 - e, "out") }; }
  return { ...at, lean: 0, left: null, right: null };
}

// ---------- the shower ----------
export const SHOWER = cum({
  reach: 0.55, open: 1.2, let: 0.3, stepIn: 2.0, turn: 0.8, reachC: 0.45, close: 1.2, let2: 0.3, face: 0.8, valve: 0.6,
  wash: 8.5, valveOff: 0.6, turn2: 0.8, reachO: 0.45, open2: 1.2, let3: 0.3, stepOut: 2.0, turn3: 0.9, reachC2: 0.45, close2: 1.2, let4: 0.4,
});
/** Outside the shower (where one walks to) and inside it. */
export const showerSpots = (fl: AptFloor) => {
  const s = fl.bath.shower, cx = (s.x0 + s.x1) / 2;
  return { out: [cx, s.curtainZ - 0.5] as [number, number], mid: [cx, s.curtainZ + 0.03] as [number, number], in: [cx, (s.curtainZ + s.z1) / 2] as [number, number] };
};
/**
 * A step over the shower's curb, walking forward from `a` to `b`: the leading (left) leg lifted high, thigh up and
 * knee bent, over it and down on the far side (astride it), then the trailing leg the same way.
 */
function stepOver(a: [number, number], mid: [number, number], b: [number, number], v: number) {
  const v1 = Math.min(1, v * 2), v2 = Math.max(0, v * 2 - 1), l1 = Math.sin(Math.PI * v1), l2 = Math.sin(Math.PI * v2);
  const at = v < 0.5 ? [lerp(a[0], mid[0], smooth(v1)), lerp(a[1], mid[1], smooth(v1))] : [lerp(mid[0], b[0], smooth(v2)), lerp(mid[1], b[1], smooth(v2))];
  return { x: at[0]!, z: at[1]!, lean: 0.08 + 0.06 * (l1 + l2), legs: { hipL: -1.25 * l1 + 0.2 * l2, kneeL: 1.8 * l1, hipR: -1.05 * l2 + 0.25 * l1, kneeR: 2.0 * l2 + 0.15 * l1 } };
}
/**
 * Showering: the curtain pulled open (left hand), stepping in over the curb, turned round to draw it shut, the water
 * on (right hand at the valve), washing the hair and arms, the water off, the curtain opened again, stepping out
 * the same way (forward, over the curb), turned round and the curtain drawn shut behind.
 */
export function showerAt(fl: AptFloor, u: number, link: BathLink): BathPose {
  const s = fl.bath.shower, P = showerSpots(fl), k = (a: number, d: number) => smooth((u - a) / d);
  const edge = (open: number, side: 1 | -1): V3 => { const e = curtainEdge(fl, open); return [e[0], e[1], e[2] + side * 0.06]; };
  const base = { crouch: 0, sit: 0, shuffle: 0, lean: 0 };
  const curtain = (c: number) => { link.curtain = Math.max(0, Math.min(1, c)); };
  const valve: V3 = [(s.x0 + s.x1) / 2 + 0.03, 1.12, s.z1 - 0.08];
  link.shower = u < SHOWER.valve ? 0 : u < SHOWER.valveOff ? Math.min(k(SHOWER.face + 0.2, 0.4), 1 - k(SHOWER.wash + 0.15, 0.4)) : 0;
  // Outside, facing in (+z): the left hand takes the curtain's edge and pulls it open.
  if (u < SHOWER.reach) { curtain(0); return { ...base, x: P.out[0], z: P.out[1], yaw: 0, lean: 0.08, left: hand(edge(0, -1), k(0, SHOWER.reach), "out"), right: null }; }
  if (u < SHOWER.open) { const c = k(SHOWER.reach, SHOWER.open - SHOWER.reach); curtain(c); return { ...base, x: P.out[0], z: P.out[1], yaw: 0, lean: 0.08, left: hand(edge(c, -1), 1, "out"), right: null }; }
  if (u < SHOWER.let) { curtain(1); return { ...base, x: P.out[0], z: P.out[1], yaw: 0, left: hand(edge(1, -1), 1 - k(SHOWER.open, SHOWER.let - SHOWER.open), "out"), right: null }; }
  if (u < SHOWER.stepIn) { curtain(1); return { ...base, ...stepOver(P.out, P.mid, P.in, (u - SHOWER.let) / (SHOWER.stepIn - SHOWER.let)), yaw: 0, left: null, right: null }; }
  // Inside: turned round to the curtain, drawn shut (left hand), turned back to the water.
  if (u < SHOWER.turn) { curtain(1); const e = k(SHOWER.stepIn, SHOWER.turn - SHOWER.stepIn); return { ...base, x: P.in[0], z: P.in[1], yaw: Math.PI * e, shuffle: Math.sin(Math.PI * e), left: null, right: null }; }
  if (u < SHOWER.reachC) { curtain(1); return { ...base, x: P.in[0], z: P.in[1], yaw: Math.PI, lean: 0.08, left: hand(edge(1, 1), k(SHOWER.turn, SHOWER.reachC - SHOWER.turn), "out"), right: null }; }
  if (u < SHOWER.close) { const c = 1 - k(SHOWER.reachC, SHOWER.close - SHOWER.reachC); curtain(c); return { ...base, x: P.in[0], z: P.in[1], yaw: Math.PI, lean: 0.08, left: hand(edge(c, 1), 1, "out"), right: null }; }
  if (u < SHOWER.let2) { curtain(0); return { ...base, x: P.in[0], z: P.in[1], yaw: Math.PI, left: hand(edge(0, 1), 1 - k(SHOWER.close, SHOWER.let2 - SHOWER.close), "out"), right: null }; }
  curtain(u < SHOWER.reachO ? 0 : u < SHOWER.open2 ? k(SHOWER.reachO, SHOWER.open2 - SHOWER.reachO) : u < SHOWER.reachC2 ? 1 : 1 - k(SHOWER.reachC2, SHOWER.close2 - SHOWER.reachC2));
  const inside = { ...base, x: P.in[0], z: P.in[1] };
  if (u < SHOWER.face) { const e = k(SHOWER.let2, SHOWER.face - SHOWER.let2); return { ...inside, yaw: Math.PI * (1 + e), shuffle: Math.sin(Math.PI * e), left: null, right: null }; }
  if (u < SHOWER.valve) return { ...inside, yaw: 0, lean: 0.1, left: null, right: hand(add(valve, [0, 0, -0.03 * Math.sin(Math.PI * k(SHOWER.face + 0.3, 0.3))]), Math.sin(Math.PI * k(SHOWER.face, SHOWER.valve - SHOWER.face)), "out") };
  if (u < SHOWER.wash) {
    // Under the water: hands through the hair, then down the arms and the chest.
    const w = u - SHOWER.valve, ph = w * Math.PI * 2 * 1.3, r = Math.min(k(SHOWER.valve, 0.5), 1 - k(SHOWER.wash - 0.5, 0.5));
    const hair = w < 4.2, x = P.in[0], z = P.in[1];
    const lh: V3 = hair ? rel(x, z, 0, -0.09 + 0.03 * Math.cos(ph), 0.05 + 0.03 * Math.sin(ph), 1.68 + 0.03 * Math.sin(2 * ph)) : rel(x, z, 0, 0.1 + 0.05 * Math.sin(ph * 0.5), 0.2, 1.22 + 0.06 * Math.cos(ph));
    const rh: V3 = hair ? rel(x, z, 0, 0.09 - 0.03 * Math.cos(ph), 0.05 - 0.03 * Math.sin(ph), 1.68 - 0.03 * Math.sin(2 * ph)) : rel(x, z, 0, -0.06 + 0.05 * Math.cos(ph * 0.5), 0.22, 1.3 + 0.05 * Math.sin(ph));
    return { ...inside, yaw: 0, lean: 0.04, left: hand(lh, r, hair ? "out" : "low"), right: hand(rh, r, hair ? "out" : "low") };
  }
  if (u < SHOWER.valveOff) return { ...inside, yaw: 0, lean: 0.1, left: null, right: hand(add(valve, [0, 0, -0.03 * Math.sin(Math.PI * k(SHOWER.wash + 0.3, 0.3))]), Math.sin(Math.PI * k(SHOWER.wash, SHOWER.valveOff - SHOWER.wash)), "out") };
  // Round to the curtain again; the right hand opens it (its edge is on that side now).
  if (u < SHOWER.turn2) { const e = k(SHOWER.valveOff, SHOWER.turn2 - SHOWER.valveOff); return { ...inside, yaw: Math.PI * e, shuffle: Math.sin(Math.PI * e), left: null, right: null }; }
  if (u < SHOWER.reachO) return { ...inside, yaw: Math.PI, lean: 0.08, left: null, right: hand(edge(0, 1), k(SHOWER.turn2, SHOWER.reachO - SHOWER.turn2), "out") };
  if (u < SHOWER.open2) return { ...inside, yaw: Math.PI, lean: 0.08, left: null, right: hand(edge(link.curtain, 1), 1, "out") };
  if (u < SHOWER.let3) return { ...inside, yaw: Math.PI, left: null, right: hand(edge(1, 1), 1 - k(SHOWER.open2, SHOWER.let3 - SHOWER.open2), "out") };
  // Out the same way as in: forward over the curb, the left leg first.
  if (u < SHOWER.stepOut) return { ...base, ...stepOver(P.in, P.mid, P.out, (u - SHOWER.let3) / (SHOWER.stepOut - SHOWER.let3)), yaw: Math.PI, left: null, right: null };
  const outside = { ...base, x: P.out[0], z: P.out[1] };
  if (u < SHOWER.turn3) { const e = k(SHOWER.stepOut, SHOWER.turn3 - SHOWER.stepOut); return { ...outside, yaw: Math.PI * (1 - e), shuffle: Math.sin(Math.PI * e), left: null, right: null }; }
  if (u < SHOWER.reachC2) return { ...outside, yaw: 0, lean: 0.08, left: null, right: hand(edge(1, -1), k(SHOWER.turn3, SHOWER.reachC2 - SHOWER.turn3), "out") };
  if (u < SHOWER.close2) return { ...outside, yaw: 0, lean: 0.08, left: null, right: hand(edge(link.curtain, -1), 1, "out") };
  return { ...outside, yaw: 0, left: null, right: hand(edge(0, -1), 1 - k(SHOWER.close2, SHOWER.let4 - SHOWER.close2), "out") };
}
/** The held view while showering: from the bathroom's far corner, toward the shower (floor frame, heights above it). */
export function showerView(fl: AptFloor): { pos: V3; at: V3 } {
  const b = fl.bath, s = b.shower;
  return { pos: [b.x1 - 0.3, 2.05, Math.max(b.z0 + 0.3, s.curtainZ - 1.9)], at: [(s.x0 + s.x1) / 2, 1.0, s.curtainZ + 0.15] };
}
