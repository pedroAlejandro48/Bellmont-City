// Shopping at the grocery (pure): the moves of taking a basket, picking things into it, paying at the checkout and
// putting the basket back, as timelines of poses in the room's frame. Players and the shoppers walking in share them;
// the checkout clerk's moves come from the same clock so the two sides meet. Every move eases in and out of the
// next (one movement, no stops).
import type { ItemKind } from "./inventory";
import { CANDIES, CANDY_INFO, CANS, CAN_INFO, WARES, WARE_INFO, shelfSections } from "./pantry";
import { smooth, walkTo, type Box, type Reach } from "./restaurantRoom";
import type { Fixture, VenueLayout } from "./venueRoom";

/** The drinks shelf's sections, left to right, and where each one's middle is along a shelf `w` wide. */
export const DRINK_SHELF: ItemKind[] = ["water", "orangeJuice", "appleJuice", "cola", "lemonSoda", "energy"];
export const drinkSection = (w: number, k: number) => -w / 2 + (k + 0.5) * (w / DRINK_SHELF.length);
/** What the grocery sells off its crates and shelf, and the price of one. */
export const GROCERY_PRICE: Partial<Record<ItemKind, number>> = {
  apple: 0.6, banana: 0.4, orange: 0.7, pear: 0.65, lemon: 0.5, lime: 0.45, grape: 2.2, peach: 0.8, water: 0.8, orangeJuice: 1.6, appleJuice: 1.6, cola: 1.2, lemonSoda: 1.2, energy: 2.4,
  ...Object.fromEntries(CANS.map((k) => [k, CAN_INFO[k].price])), ...Object.fromEntries(CANDIES.map((k) => [k, CANDY_INFO[k].price])), ...Object.fromEntries(WARES.map((k) => [k, WARE_INFO[k].price])),
};
export const BASKET_MAX = 10;

// ---------- finding a way round the shelves ----------
/** The store's furniture to walk round, and its floor (set once from its layout). */
let OBST: { boxes: Box[]; minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
export function setGroceryObstacles(boxes: Box[], bounds: { minX: number; maxX: number; minZ: number; maxZ: number }) { OBST = { boxes, ...bounds }; }
const PAD = 0.42;
/** Whether the straight line a→b passes through any of the boxes (grown by `pad`). */
function blocked(a: [number, number], b: [number, number], boxes: Box[], pad: number) {
  for (const o of boxes) {
    let t0 = 0, t1 = 1;
    const slab = (p: number, d: number, lo: number, hi: number) => {
      if (Math.abs(d) < 1e-9) { if (p <= lo || p >= hi) t1 = -1; return; }
      let u = (lo - p) / d, v = (hi - p) / d; if (u > v) [u, v] = [v, u];
      t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    };
    slab(a[0], b[0] - a[0], o.x - o.hx - pad, o.x + o.hx + pad);
    slab(a[1], b[1] - a[1], o.z - o.hz - pad, o.z + o.hz + pad);
    if (t1 > t0) return true;
  }
  return false;
}
/** The shortest way from a to b that keeps clear of the furniture: the corners to pass on the way (none when the
 * way is clear). Ends inside a box's margin (standing at a shelf) are fine: only the boxes not touching them count. */
export function route(a: [number, number], b: [number, number]): [number, number][] {
  if (!OBST) return [];
  const near = (p: [number, number], o: Box) => Math.abs(p[0] - o.x) < o.hx + PAD && Math.abs(p[1] - o.z) < o.hz + PAD;
  const boxes = OBST.boxes.filter((o) => !near(a, o) && !near(b, o));
  if (!blocked(a, b, boxes, PAD - 0.04)) return [];
  const { minX, maxX, minZ, maxZ } = OBST, m = PAD + 0.02;
  const corners: [number, number][] = [];
  for (const o of boxes) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const c: [number, number] = [o.x + sx * (o.hx + m), o.z + sz * (o.hz + m)];
    if (c[0] < minX + 0.3 || c[0] > maxX - 0.3 || c[1] < minZ + 0.3 || c[1] > maxZ - 0.3) continue;
    if (boxes.some((q) => Math.abs(c[0] - q.x) < q.hx + PAD - 0.05 && Math.abs(c[1] - q.z) < q.hz + PAD - 0.05)) continue;
    corners.push(c);
  }
  const nodes: [number, number][] = [a, ...corners, b], n = nodes.length, dist = Array(n).fill(Infinity), prev = Array(n).fill(-1), done = Array(n).fill(false);
  dist[0] = 0;
  for (;;) {
    let u = -1; for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || u === n - 1) break;
    done[u] = true;
    for (let v = 0; v < n; v++) {
      if (done[v] || v === u) continue;
      const d = Math.hypot(nodes[v]![0] - nodes[u]![0], nodes[v]![1] - nodes[u]![1]);
      if (dist[u] + d < dist[v] && !blocked(nodes[u]!, nodes[v]!, boxes, PAD - 0.04)) { dist[v] = dist[u] + d; prev[v] = u; }
    }
  }
  if (dist[n - 1] === Infinity) return [];
  const path: [number, number][] = [];
  for (let v = prev[n - 1]; v > 0; v = prev[v]) path.unshift(nodes[v]!);
  return path;
}
/** Walking from one spot to another the way round the furniture: a step for each leg, turning toward the next. */
export function walkRoute(from: [number, number], fromYaw: number, to: [number, number], endYaw: number, carry: { basket: boolean; bag: boolean }): Seg[] {
  const pts = [from, ...route(from, to), to], segs: Seg[] = [];
  let yaw = fromYaw;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!, last = i === pts.length - 2;
    const next = last ? endYaw : Math.atan2(pts[i + 2]![0] - b[0], pts[i + 2]![1] - b[1]);
    segs.push(walkSeg(a, yaw, b, next, carry));
    yaw = next;
  }
  return segs;
}
/** Held at the waist, out in front and to the right (body frame: x right, y up, z forward). */
export const CARRY = { right: 0.2, y: 0.92, fwd: 0.3 } as const;
export const BAG_CARRY = { left: 0.24, y: 0.78, fwd: 0.1 } as const;
const STEP = 0.85;

export type GPose = { x: number; z: number; yaw: number; crouch: number; lean: number; left: Reach | null; right: Reach | null };
/** One piece of a move: its length and the pose at each moment of it (0..1). Events fire as a piece ends. */
export type Seg = { dur: number; pose: (k: number) => GPose; end?: string };
export type Plan = { segs: Seg[]; total: number };
export const plan = (segs: Seg[]): Plan => ({ segs, total: segs.reduce((a, s) => a + s.dur, 0) });

/** Where a plan is at time t: the pose, and the events passed since `prev`. */
export function planAt(p: Plan, t: number, prev = -1): { pose: GPose; events: string[]; done: boolean } {
  let at = 0;
  const events: string[] = [];
  for (const s of p.segs) {
    if (s.end && at + s.dur > prev && at + s.dur <= t) events.push(s.end);
    if (t < at + s.dur) return { pose: s.pose(Math.max(0, (t - at) / s.dur)), events, done: false };
    at += s.dur;
  }
  const last = p.segs[p.segs.length - 1]!;
  return { pose: last.pose(1), events, done: true };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerp3 = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
/** A point in the body's frame (right, up, forward) at a spot facing `yaw`, in the room's frame. */
export function bodyPoint(x: number, z: number, yaw: number, right: number, y: number, fwd: number): [number, number, number] {
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
  return [x + fx * fwd + rx * right, y, z + fz * fwd + rz * right];
}
export const carryPoint = (x: number, z: number, yaw: number) => bodyPoint(x, z, yaw, CARRY.right, CARRY.y, CARRY.fwd);
export const bagPoint = (x: number, z: number, yaw: number) => bodyPoint(x, z, yaw, -BAG_CARRY.left, BAG_CARRY.y, BAG_CARRY.fwd);
const carryReach = (x: number, z: number, yaw: number, blend = 1): Reach => ({ at: carryPoint(x, z, yaw), blend, pole: "low" });
const bagReach = (x: number, z: number, yaw: number, blend = 1): Reach => ({ at: bagPoint(x, z, yaw), blend, pole: "out" });

/** Small steps from one spot to another, turning to `endYaw`; the basket (and a bag) stay in hand. */
export function walkSeg(from: [number, number], fromYaw: number, to: [number, number], endYaw: number, carry: { basket: boolean; bag: boolean }): Seg {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
  return {
    dur: Math.max(0.45, d / STEP + 0.4),
    pose: (k) => {
      const { at, yaw } = walkTo(k, from, to, fromYaw, endYaw);
      return { x: at[0], z: at[1], yaw, crouch: 0, lean: 0.04, left: carry.bag ? bagReach(at[0], at[1], yaw) : null, right: carry.basket ? carryReach(at[0], at[1], yaw) : null };
    },
  };
}

// ---------- the basket pile ----------
/** The pile of baskets: where one stands to take one, and the top basket's handle. */
export function pileSpot(pile: Fixture): { stand: [number, number]; yaw: number; top: [number, number, number] } {
  return { stand: [pile.x, pile.z - 0.62], yaw: 0, top: [pile.x, 0.2 + 5 * 0.07 + 0.16, pile.z] };
}
/**
 * Taking a basket: steps up to the pile, a squat as the right hand goes down to the top basket's handle, and up
 * again bringing it to the waist (the basket leaves the pile at the bottom of the squat: event "basket").
 */
export function takeBasket(from: [number, number], fromYaw: number, pile: Fixture, bag: boolean): Plan {
  const s = pileSpot(pile), [x, z] = s.stand, yaw = s.yaw, carry = carryPoint(x, z, yaw);
  const handle: [number, number, number] = [s.top[0] - 0.03, s.top[1], s.top[2] - 0.04];
  const left = bag ? bagReach(x, z, yaw) : null;
  return plan([
    ...walkRoute(from, fromYaw, s.stand, yaw, { basket: false, bag }),
    { dur: 0.75, end: "basket", pose: (k) => { const e = smooth(k); return { x, z, yaw, crouch: 0.42 * e, lean: 0.38 * e, left, right: { at: handle, blend: e, pole: "low" } }; } },
    { dur: 0.75, pose: (k) => { const e = smooth(k); return { x, z, yaw, crouch: 0.42 * (1 - e), lean: 0.38 * (1 - e) + 0.04 * e, left, right: { at: lerp3(handle, carry, e), blend: 1, pole: "low" } }; } },
  ]);
}
/** Putting the basket back on the pile: the same squat the other way round, then on to the door. */
export function returnBasket(from: [number, number], fromYaw: number, pile: Fixture, bag: boolean): Plan {
  const s = pileSpot(pile), [x, z] = s.stand, yaw = s.yaw, carry = carryPoint(x, z, yaw);
  const handle: [number, number, number] = [s.top[0] - 0.03, s.top[1] + 0.07, s.top[2] - 0.04];
  const left = bag ? bagReach(x, z, yaw) : null;
  const door: [number, number] = [0, -1.25];
  return plan([
    ...walkRoute(from, fromYaw, s.stand, yaw, { basket: true, bag }),
    { dur: 0.8, end: "basketDown", pose: (k) => { const e = smooth(k); return { x, z, yaw, crouch: 0.42 * e, lean: 0.38 * e, left, right: { at: lerp3(carry, handle, e), blend: 1, pole: "low" } }; } },
    { dur: 0.6, pose: (k) => { const e = smooth(k); return { x, z, yaw, crouch: 0.42 * (1 - e), lean: 0.38 * (1 - e), left, right: { at: handle, blend: 1 - e, pole: "low" } }; } },
    walkSeg(s.stand, yaw, door, 0, { basket: false, bag }),
  ]);
}

// ---------- picking from a crate or the shelf ----------
export type Source = { kind: ItemKind; stand: [number, number]; yaw: number; take: [number, number, number]; fixture: number };
/** The crates (each one fruit) and the water on the shelf: where one stands to take from each. */
export function sources(layout: VenueLayout): Source[] {
  const out: Source[] = [];
  layout.fixtures.forEach((f, i) => {
    if (f.type === "crate" && f.tag && f.tag in GROCERY_PRICE) {
      // A crate along the left wall faces +x: stand in front of it, facing it.
      const fx = Math.sin(f.rot), fz = Math.cos(f.rot);
      out.push({ kind: f.tag as ItemKind, stand: [f.x + fx * (f.d / 2 + 0.5), f.z + fz * (f.d / 2 + 0.5)], yaw: f.rot + Math.PI, take: [f.x + fx * 0.04, 0.5, f.z + fz * 0.04], fixture: i });
    }
    if (f.type === "shelf" && (f.tag === "pantry" || f.tag === "kitchenware")) {
      // A section for each thing on either face: stand in front of it (on that face's side), facing it.
      const ax = Math.cos(f.rot), az = -Math.sin(f.rot);
      for (const sec of shelfSections(f.tag, f.w)) {
        const u = (sec.u0 + sec.u1) / 2, fx = Math.sin(f.rot) * sec.side, fz = Math.cos(f.rot) * sec.side;
        const cx = f.x + ax * u, cz = f.z + az * u;
        out.push({ kind: sec.kind as ItemKind, stand: [cx + fx * (f.d / 2 + 0.5), cz + fz * (f.d / 2 + 0.5)], yaw: Math.atan2(-fx, -fz), take: [cx + fx * 0.15, 1.08, cz + fz * 0.15], fixture: i });
      }
    }
    if (f.type === "shelf" && f.tag === "bottles") {
      // The drinks shelf: a section for each drink, side by side; stand in front of the one you want.
      const fx = Math.sin(f.rot), fz = Math.cos(f.rot), ax = Math.cos(f.rot), az = -Math.sin(f.rot);
      DRINK_SHELF.forEach((kind, k) => {
        const u = drinkSection(f.w, k);
        const cx = f.x + ax * u, cz = f.z + az * u;
        out.push({ kind, stand: [cx + fx * (f.d / 2 + 0.5), cz + fz * (f.d / 2 + 0.5)], yaw: f.rot + Math.PI, take: [cx + fx * 0.15, 1.12, cz + fz * 0.15], fixture: i });
      });
    }
  });
  return out;
}
/**
 * Picking one: small steps to stand square in front of it, the left hand reaches over and takes one (event "take"),
 * crosses over to above the basket at the right hip and lets go (event "drop": it falls in), and comes back.
 */
export function pickItem(from: [number, number], fromYaw: number, src: Source, bag: boolean): Plan {
  const [x, z] = src.stand, yaw = src.yaw, carry = carryPoint(x, z, yaw);
  const over: [number, number, number] = [carry[0], carry[1] + 0.22, carry[2]];
  const low = src.take[1] < 0.8;
  const right = (blend = 1) => carryReach(x, z, yaw, blend);
  // With a bag in the left hand, the bag is set on the floor? No: the left hand keeps the bag and the right hand
  // (with the basket on the forearm) does the picking. Without a bag, the free left hand picks.
  return plan([
    ...walkRoute(from, fromYaw, src.stand, yaw, { basket: true, bag }),
    { dur: 0.7, end: "take", pose: (k) => { const e = smooth(k); return { x, z, yaw, crouch: (low ? 0.18 : 0) * e, lean: (low ? 0.34 : 0.12) * e, left: { at: src.take, blend: e, pole: "out" }, right: right() }; } },
    { dur: 0.65, end: "drop", pose: (k) => { const e = smooth(k); return { x, z, yaw, crouch: (low ? 0.18 : 0) * (1 - e), lean: (low ? 0.34 : 0.12) * (1 - e) + 0.06 * e, left: { at: lerp3(src.take, over, e), blend: 1, pole: "out" }, right: right() }; } },
    { dur: 0.45, pose: (k) => { const e = smooth(k); return { x, z, yaw, crouch: 0, lean: 0.06 * (1 - e), left: bag ? bagReach(x, z, yaw, 1) : { at: over, blend: 1 - e, pole: "out" }, right: right() }; } },
  ]);
}

/** Where a new thing lands in the basket (basket frame: x across, z along, y up from its floor), among those in it. */
export function landingSpot(inBasket: { x: number; y: number; z: number }[], random: () => number): { x: number; y: number; z: number } {
  const x = (random() - 0.5) * 0.3, z = (random() - 0.5) * 0.18;
  // On the floor, or on top of whatever it lands on.
  const under = inBasket.filter((p) => Math.hypot(p.x - x, p.z - z) < 0.075);
  const y = under.length ? Math.max(...under.map((p) => p.y)) + 0.06 : 0;
  return { x, y: Math.min(y, 0.18), z };
}

// ---------- the checkout ----------
/** The checkout's spots (room frame): the basket set down on the belt, the bag by the register, where the hand-over
 * meets, and where the clerk stands. */
export function checkoutSpots(layout: VenueLayout) {
  const c = layout.fixtures.find((f) => f.type === "checkout")!, s = layout.service, top = 0.96;
  // The counter's customer edge (it faces -x into the store).
  const edge = c.x - c.d / 2;
  return {
    basket: [edge + 0.22, top, s.z + 0.45] as [number, number, number],
    bag: [edge + 0.42, top, s.z - 0.15] as [number, number, number],
    meet: [edge - 0.05, 1.05, s.z - 0.05] as [number, number, number],
    clerk: layout.staff,
  };
}
/** Bagging takes this long per thing, then the clerk takes the bag (0.5 s) and holds it out (0.7 s). */
export const PER_ITEM = 1.0, GRAB_BAG = 0.5, HOLD_OUT = 0.7;
export const baggingTime = (n: number) => n * PER_ITEM;
/**
 * Paying, the customer's side: the basket goes from the waist onto the belt (event "basketDown"), the hands rest
 * while the clerk bags everything, then the left hand comes up for the bag as it's held out (event "bag") while the
 * right takes the empty basket back (event "basketUp"), and both come back to carry.
 */
export function payPlan(at: [number, number], yaw: number, layout: VenueLayout, n: number): Plan {
  const [x, z] = at, sp = checkoutSpots(layout), carry = carryPoint(x, z, yaw), held = bagPoint(x, z, yaw);
  const onBelt: [number, number, number] = [sp.basket[0], sp.basket[1] + 0.12, sp.basket[2]];
  const wait = baggingTime(n) + GRAB_BAG;
  return plan([
    { dur: 0.9, end: "basketDown", pose: (k) => { const e = smooth(k); return { x, z, yaw, crouch: 0, lean: 0.14 * Math.sin(Math.PI * k), left: null, right: { at: lerp3(carry, onBelt, e), blend: 1, pole: "low" } }; } },
    { dur: wait, pose: (k) => { const e = smooth(Math.min(1, k * wait / 0.5)); return { x, z, yaw, crouch: 0, lean: 0, left: null, right: { at: onBelt, blend: 1 - e, pole: "low" } }; } },
    { dur: HOLD_OUT, end: "bag", pose: (k) => { const e = smooth(k); return { x, z, yaw, crouch: 0, lean: 0.1 * e, left: { at: sp.meet, blend: e, pole: "out" }, right: { at: onBelt, blend: e, pole: "low" } }; } },
    { dur: 0.75, end: "basketUp", pose: (k) => { const e = smooth(k); return { x, z, yaw, crouch: 0, lean: 0.1 * (1 - e), left: { at: lerp3(sp.meet, held, e), blend: 1, pole: "out" }, right: { at: lerp3(onBelt, carry, e), blend: 1, pole: "low" } }; } },
  ]);
}
/**
 * The clerk's side, from the moment the basket is down: for each thing, the hand goes to it in the basket, takes
 * it, and puts it in the bag; then takes the bag by its handles and holds it out to the customer, and lets go.
 * `item(i)` is where thing i is (room frame). Returns the right hand's reach, and what is in the hand.
 */
export function clerkAt(t: number, n: number, item: (i: number) => [number, number, number], layout: VenueLayout): { reach: Reach | null; holding: number | "bag" | null; bagged: number; given: boolean } {
  const sp = checkoutSpots(layout), mouth: [number, number, number] = [sp.bag[0], sp.bag[1] + 0.3, sp.bag[2]];
  const rest: [number, number, number] = [sp.clerk.x - 0.35, 0.95, sp.clerk.z];
  if (t < 0) return { reach: null, holding: null, bagged: 0, given: false };
  const B = baggingTime(n);
  if (t < B) {
    const i = Math.floor(t / PER_ITEM), k = (t - i * PER_ITEM) / PER_ITEM, at = item(i);
    const over: [number, number, number] = [at[0], at[1] + 0.1, at[2]];
    // To the thing (0..0.4), lift it over to the bag's mouth (0.4..0.85), let go and head for the next (0.85..1).
    if (k < 0.4) return { reach: { at: lerp3(i === 0 ? rest : mouth, at, smooth(k / 0.4)), blend: i === 0 ? smooth(k / 0.4) : 1, pole: "out" }, holding: null, bagged: i, given: false };
    if (k < 0.85) return { reach: { at: lerp3(over, mouth, smooth((k - 0.4) / 0.45)), blend: 1, pole: "out" }, holding: i, bagged: i, given: false };
    return { reach: { at: mouth, blend: 1, pole: "out" }, holding: null, bagged: i + 1, given: false };
  }
  const handles: [number, number, number] = [sp.bag[0], sp.bag[1] + 0.34, sp.bag[2]];
  if (t < B + GRAB_BAG) return { reach: { at: lerp3(mouth, handles, smooth((t - B) / GRAB_BAG)), blend: 1, pole: "out" }, holding: null, bagged: n, given: false };
  if (t < B + GRAB_BAG + HOLD_OUT) return { reach: { at: lerp3(handles, [sp.meet[0], sp.meet[1] + 0.32, sp.meet[2]], smooth((t - B - GRAB_BAG) / HOLD_OUT)), blend: 1, pole: "out" }, holding: "bag", bagged: n, given: false };
  const back = smooth((t - B - GRAB_BAG - HOLD_OUT) / 0.6);
  return { reach: back < 1 ? { at: lerp3([sp.meet[0], sp.meet[1] + 0.32, sp.meet[2]], rest, back), blend: 1 - back, pole: "out" } : null, holding: null, bagged: n, given: true };
}
export const checkoutLength = (n: number) => baggingTime(n) + GRAB_BAG + HOLD_OUT + 0.6;
