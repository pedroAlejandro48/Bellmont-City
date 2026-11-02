// Restaurant customers who are not players (pure apart from the room's furniture they sit on): they come in
// off the sidewalk, queue for the register (behind players too), order in about ten seconds, then wait at the
// pick-up end of the counter for food to go, or take a number sign to a table, sit, are served and eat; then
// they leave the way they came. Busier at lunch (and at breakfast for the café); at night only the burger
// place gets anyone, about one an hour. They go through the same steps as players: the same door, walking and
// sitting scripts, the same orders, signs, trays and bites in the shared food simulation.
import { type RestaurantKind, restaurantOpen } from "./config";
import { EAT_SECONDS, GRAB_CONTACT, GRAB_TIME, PACK_SIZE, greetingLine, isDrinkName, menuOf, toldLine, type FoodSim, type Places } from "./food";
import { OPENER_PASS, doorState, type DoorUse } from "./doors";
import {
  COUNTER, ENTER, LEAVE, SIT, TABLE, enterLead, enterPose, leaveLead, leavePose, planSit, planWalkThrough, sitPose, toWorld,
  walkThroughPose, walkTime, walkTo, type Room, type SitPlan, type WalkThrough,
} from "./restaurantRoom";

export const DINER_WALK = 1.25;
const ORDER_SECONDS = 10;
const QUEUE_GAP = 0.85;
export const MAX_QUEUE = 3;

/** How long, on average, between customers arriving at a place at this hour (seconds; Infinity: nobody). */
export function arrivalGap(kind: RestaurantKind, hours: number) {
  if (!restaurantOpen(kind, hours)) return Infinity;
  if (hours < 6) return kind === "burger" ? 100 : Infinity; // ~one an in-game hour (100 s)
  const peak = kind === "cafe" ? hours >= 7 && hours < 10 : hours >= 12 && hours < 16;
  return peak ? 22 : 110;
}

type Step = "arrive" | "enter" | "queue" | "order" | "sign" | "wait" | "pickup" | "seat" | "eat" | "rise" | "toDoor" | "exit" | "leave" | "away";
export type Diner = {
  id: number; key: string; seed: number; step: Step; since: number;
  x: number; z: number; yaw: number; speed: number;
  /** The walk this step (from, to), or a script's own timeline. */
  from: [number, number]; fromYaw: number; to: [number, number]; toYaw: number;
  door: WalkThrough | null; doorOpen: boolean; side: 1 | -1;
  mode: "togo" | "here"; order: number; chair: number; plan: SitPlan | null; sit: number;
  /** Reaching (to the counter, or setting the sign down): where, and how far (0..1); and the bite cycle. */
  reach: [number, number, number] | null; reachK: number; hand: "left" | "right";
  /** The rest of a scripted pose (as a player's): leaning, shuffling in on a chair, and each hand's reach. */
  lean: number; shuffle: number;
  left: { at: [number, number, number]; k: number; pole: number } | null; right: { at: [number, number, number]; k: number; pole: number } | null;
};
const POLE_IDS = { low: 0, out: 1, back: 2 } as const;
export const POLE_NAMES = ["low", "out", "back"] as const;
/**
 * What a diner looks like to everyone: [id, key, x, z, yaw, speed, sit, hand, rx, ry, rz, reach, seed, lean, shuffle,
 * left hand x, y, z, reach, pole, right hand x, y, z, reach, pole].
 */
export type DinerRow = [number, string, number, number, number, number, number, number, number, number, number, number, number, ...number[]];

const r2 = (n: number) => Math.round(n * 100) / 100;
const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

export type DinerContext = {
  now: number; hours: number;
  rooms: (key: string) => { room: Room; places: Places; kind: RestaurantKind } | null;
  keys: string[];
  /** Players standing in a restaurant (room frame), for the queue. */
  people: (key: string) => { x: number; z: number }[];
  /** Chairs players are sitting on (`key#index`). */
  takenChairs: Set<string>;
  /** Everyone's uses of a door leaf (on this clock), for going through it like a player. */
  doorUses: (key: string, leaf: "left" | "right") => DoorUse[];
  addDoorUse: (use: DoorUse) => void;
  random: () => number;
};

export class DinerSim {
  diners: Diner[] = [];
  private nextId = 1;
  private nextAt = new Map<string, number>();

  rows(): DinerRow[] {
    const hand = (h: Diner["left"]) => (h ? [r2(h.at[0]), r2(h.at[1]), r2(h.at[2]), r2(h.k), h.pole] : [0, 0, 0, 0, 0]);
    return this.diners.filter((d) => d.step !== "away").map((d) => [d.id, d.key, r2(d.x), r2(d.z), r2(d.yaw), r2(d.speed), r2(d.sit), d.reach ? (d.hand === "left" ? 1 : 2) : 0, r2(d.reach?.[0] ?? 0), r2(d.reach?.[1] ?? 0), r2(d.reach?.[2] ?? 0), r2(d.reachK), d.seed, r2(d.lean), d.shuffle, ...hand(d.left), ...hand(d.right)]);
  }

  step(ctx: DinerContext, food: FoodSim) {
    const { now } = ctx;
    // New arrivals, now and then, up to a few per place.
    for (const key of ctx.keys) {
      const at = ctx.rooms(key);
      if (!at) continue;
      const gap = arrivalGap(at.kind, ctx.hours);
      const due = this.nextAt.get(key);
      if (due === undefined) { this.nextAt.set(key, now + (Number.isFinite(gap) ? gap * ctx.random() : 30)); continue; }
      if (now < due) continue;
      this.nextAt.set(key, now + (Number.isFinite(gap) ? gap * (0.5 + ctx.random()) : 60));
      if (!Number.isFinite(gap) || this.diners.filter((d) => d.key === key).length >= 6) continue;
      const side = ctx.random() < 0.5 ? 1 : -1, start: [number, number] = [side * 11, 2.3];
      this.diners.push({
        id: this.nextId++, key, seed: Math.floor(ctx.random() * 1e6), step: "arrive", since: now, x: start[0], z: start[1], yaw: -side * Math.PI / 2, speed: 0,
        from: start, fromYaw: -side * Math.PI / 2, to: [0.15, 1.45], toYaw: Math.PI, door: null, doorOpen: false, side,
        mode: ctx.random() < 0.5 ? "togo" : "here", order: 0, chair: -1, plan: null, sit: 0, reach: null, reachK: 0, hand: "right", lean: 0, shuffle: 0, left: null, right: null,
      });
    }
    for (const d of this.diners) this.stepOne(d, ctx, food);
    this.diners = this.diners.filter((d) => d.step !== "away");
  }

  private walk(d: Diner, to: [number, number], toYaw: number, now: number) {
    d.from = [d.x, d.z]; d.fromYaw = d.yaw; d.to = to; d.toYaw = toYaw; d.since = now;
  }
  /** Moves along this step's walk; true once there. */
  private walking(d: Diner, now: number) {
    const T = walkTime(d.from, d.to), k = Math.min(1, (now - d.since) / T);
    const w = walkTo(k, d.from, d.to, d.fromYaw, d.toYaw);
    const nx = w.at[0], nz = w.at[1];
    d.speed = k < 1 ? Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1]) / T : 0;
    d.x = nx; d.z = nz; d.yaw = w.yaw;
    return k >= 1;
  }
  private go(d: Diner, step: Step, now: number) { d.step = step; d.since = now; d.speed = 0; }

  private stepOne(d: Diner, ctx: DinerContext, food: FoodSim) {
    const { now } = ctx, at = ctx.rooms(d.key);
    if (!at) { d.step = "away"; return; }
    const { room, places, kind } = at, me = `npc:${d.id}`;
    const t = now - d.since;
    d.reach = null; d.reachK = 0; d.lean = 0; d.shuffle = 0; d.left = null; d.right = null;
    const hands = (pose: { left: { at: [number, number, number]; blend: number; pole: "low" | "out" | "back" } | null; right: { at: [number, number, number]; blend: number; pole: "low" | "out" | "back" } | null; lean: number; shuffle: number }) => {
      d.lean = pose.lean; d.shuffle = pose.shuffle;
      d.left = pose.left ? { at: pose.left.at, k: pose.left.blend, pole: POLE_IDS[pose.left.pole] } : null;
      d.right = pose.right ? { at: pose.right.at, k: pose.right.blend, pole: POLE_IDS[pose.right.pole] } : null;
    };
    // Told where to wait and pointed there: the cashier is free for whoever is next.
    const talk = food.sessions.get(d.key);
    if (talk?.by === me && d.step !== "queue" && d.step !== "order" && (talk.stage === "told" ? now - talk.at > 3.8 : true)) food.handle(me, { type: "bye", key: d.key }, now);
    switch (d.step) {
      case "arrive": {
        if (this.walking(d, now)) {
          // At the door: open it, or walk through behind whoever has it open; wait while it closes.
          const ds = doorState(ctx.doorUses(d.key, "right"), now);
          if (ds.phase === "closing") return;
          const from: [number, number] = [d.x, d.z];
          if (ds.phase === "closed") { d.doorOpen = true; d.door = null; ctx.addDoorUse({ key: d.key, leaf: "right", mode: "open", start: now, lead: enterLead(from), pass: enterLead(from) + OPENER_PASS.right }); }
          else { d.doorOpen = false; d.door = planWalkThrough("in", from, d.yaw, Math.max(0, ds.closesAt - 0.6 - now)); ctx.addDoorUse({ key: d.key, leaf: "right", mode: "follow", start: now, lead: 0, pass: d.door.pass }); }
          d.from = from; d.fromYaw = d.yaw; this.go(d, "enter", now);
        }
        return;
      }
      case "enter": {
        const end = d.door ? d.door.done : ENTER.done + enterLead(d.from);
        const pose = d.door ? walkThroughPose(Math.min(t, end), d.door) : enterPose(Math.min(t, end), d.from, d.fromYaw);
        d.speed = Math.hypot(pose.x - d.x, pose.z - d.z) > 1e-4 ? DINER_WALK : 0;
        d.x = pose.x; d.z = pose.z; d.yaw = pose.yaw;
        hands(pose);
        if (t >= end) { this.walk(d, queueSpot(places, 0), Math.PI, now); this.go(d, "queue", now); d.from = [d.x, d.z]; }
        return;
      }
      case "queue": {
        // Behind everyone already in line (players and other customers), and up the line as it moves.
        const ahead = lineAhead(d, this.diners, ctx.people(d.key), places);
        if (ahead >= MAX_QUEUE) { this.toDoor(d, now); return; }
        const spot = queueSpot(places, ahead);
        if (Math.hypot(spot[0] - d.to[0], spot[1] - d.to[1]) > 0.05) this.walk(d, spot, Math.PI, now);
        const there = this.walking(d, now);
        const session = food.sessions.get(d.key);
        if (there && ahead === 0 && (!session || session.by === me)) {
          food.handle(me, { type: "greet", key: d.key, text: greetingLine(kind, ctx.hours, ctx.random) }, now);
          this.go(d, "order", now);
        }
        return;
      }
      case "order": {
        d.yaw = Math.PI;
        if (t >= ORDER_SECONDS) {
          const items = menuOf(kind).flatMap((s) => s.items), n = 1 + Math.floor(ctx.random() * 3);
          const foods = items.filter((i) => !i.drink), drinks = items.filter((i) => i.drink);
          const names = [...Array.from({ length: n }, () => foods[Math.floor(ctx.random() * foods.length)]!.name), ...(ctx.random() < 0.7 ? [drinks[Math.floor(ctx.random() * drinks.length)]!.name] : [])];
          // Three already waiting for food to go: this one eats in instead.
          if (d.mode === "togo" && this.diners.filter((o) => o.key === d.key && (o.step === "wait" || o.step === "pickup")).length >= MAX_QUEUE) d.mode = "here";
          food.handle(me, { type: "order", key: d.key, kind, names, mode: d.mode, text: toldLine(d.mode, ctx.random) }, now);
          d.order = food.orders[food.orders.length - 1]?.id ?? 0;
          if (d.mode === "togo") { this.walk(d, pickupSpot(places, this.diners.filter((o) => o !== d && o.key === d.key && (o.step === "wait" || o.step === "pickup")).length), Math.PI, now); this.go(d, "wait", now); }
          else this.go(d, "sign", now);
        }
        return;
      }
      case "sign": {
        // Take the number sign off the counter, just as a player does.
        const sign = food.packs.find((p) => p.order === d.order && p.kind === "sign");
        if (!sign) { this.toDoor(d, now); return; }
        if (sign.where === "counter") {
          const slot = places.slots[sign.slot] ?? places.slots[0]!;
          const spot: [number, number] = [slot.x, room.counter.z + room.counter.hz + 0.4];
          if (Math.hypot(d.to[0] - spot[0], d.to[1] - spot[1]) > 0.05) this.walk(d, spot, Math.PI, now);
          if (!this.walking(d, now)) return;
          const g = Math.max(0, now - d.since - walkTime(d.from, d.to));
          d.reach = [slot.x, COUNTER.height + PACK_SIZE.sign.grip, slot.z]; d.reachK = g < GRAB_CONTACT ? smooth(g / GRAB_CONTACT) : 1 - smooth((g - GRAB_CONTACT) / (GRAB_TIME - GRAB_CONTACT));
          if (g >= GRAB_CONTACT) food.handle(me, { type: "grab", pack: sign.id, hand: "right" }, now);
          return;
        }
        if (sign.where === "held" && sign.holder === me) {
          // A free chair at a table: sit down there (the chair pulled out, around, down, and in to the table).
          const chair = room.items.findIndex((it, i) => it.kind === "chair" && !ctx.takenChairs.has(`${d.key}#${i}`) && !this.diners.some((o) => o !== d && o.key === d.key && o.chair === i));
          const plan = chair >= 0 ? planSit(room, chair, d.x, d.z, d.yaw) : null;
          if (!plan || plan.table === null) { this.toDoor(d, now); return; }
          d.chair = chair; d.plan = plan; this.go(d, "seat", now);
        }
        return;
      }
      case "seat": {
        const plan = d.plan!, done = SIT.done + plan.extra;
        const pose = sitPose(plan, Math.min(t, done), room);
        const c = room.items[plan.chair]; if (c) { c.x = pose.chair[0]; c.z = pose.chair[1]; }
        d.x = pose.x; d.z = pose.z; d.yaw = pose.yaw; d.sit = pose.sit; hands(pose);
        d.speed = t < plan.extra + SIT.approach || (t > SIT.around[0] + plan.extra && t < SIT.around[1] + plan.extra) ? DINER_WALK : 0;
        if (t >= done) {
          // The sign goes on the table in front.
          const sign = food.packs.find((p) => p.order === d.order && p.kind === "sign" && p.holder === me);
          const table = plan.table !== null ? room.items[plan.table] : undefined;
          if (sign && table && c) {
            const dx = c.x - table.x, dz = c.z - table.z, l = Math.hypot(dx, dz) || 1;
            const [wx, wz] = toWorld(room.frame, table.x + dx / l * (TABLE.half - 0.16), table.z + dz / l * (TABLE.half - 0.16));
            food.handle(me, { type: "set", pack: sign.id, where: "table", x: wx, y: 0.15 + TABLE.top, z: wz, yaw: room.frame.rot + d.yaw + Math.PI }, now);
          }
          this.go(d, "eat", now);
        }
        return;
      }
      case "eat": {
        d.sit = 1;
        if (d.plan) { const rest = sitPose(d.plan, SIT.done + d.plan.extra, room); hands(rest); d.x = rest.x; d.z = rest.z; d.yaw = rest.yaw; }
        const tray = food.packs.find((p) => p.order === d.order && p.kind === "tray");
        if (!tray) { if (t > 120) this.rise(d, now); return; }
        if (tray.where !== "table") return;
        if (tray.eating) {
          if (now - tray.eating.at >= EAT_SECONDS) food.handle(me, { type: "ate", pack: tray.id, item: tray.eating.item }, now);
          return;
        }
        const next = tray.items.find((n) => !isDrinkName(n)) ?? tray.items[0];
        if (next) food.handle(me, { type: "eat", pack: tray.id, item: next }, now);
        else { food.handle(me, { type: "leave", pack: tray.id }, now); this.rise(d, now); }
        return;
      }
      case "rise": {
        const plan = d.plan!, done = SIT.done + plan.extra, back = Math.max(0, done - t);
        const pose = sitPose(plan, back, room);
        const c = room.items[plan.chair]; if (c) { c.x = pose.chair[0]; c.z = pose.chair[1]; }
        d.x = pose.x; d.z = pose.z; d.yaw = pose.yaw; d.sit = pose.sit; hands(pose);
        d.speed = back < plan.extra + SIT.approach || (back > SIT.around[0] + plan.extra && back < SIT.around[1] + plan.extra) ? DINER_WALK : 0;
        if (back <= plan.extra + SIT.approach) { d.sit = 0; d.chair = -1; this.toDoor(d, now); }
        return;
      }
      case "wait": {
        // In line at the far end of the counter (one behind the other) until this order's food is out, moving up
        // as those ahead take theirs; then take it, one in each hand.
        const ahead = this.diners.filter((o) => o !== d && o.key === d.key && (o.step === "wait" || o.step === "pickup") && o.id < d.id).length;
        const spot = pickupSpot(places, ahead);
        if (Math.hypot(spot[0] - d.to[0], spot[1] - d.to[1]) > 0.05) this.walk(d, spot, Math.PI, now);
        this.walking(d, now);
        const mine = food.packs.filter((p) => p.order === d.order && p.where === "counter");
        if (mine.length && d.speed === 0) { this.go(d, "pickup", now); d.from = [d.x, d.z]; }
        if (t > 150 && !food.packs.some((p) => p.order === d.order)) this.toDoor(d, now);
        return;
      }
      case "pickup": {
        const next = food.packs.find((p) => p.order === d.order && p.where === "counter");
        const handsFull = food.packs.filter((p) => p.where === "held" && p.holder === me).length >= 2;
        if (!next || handsFull) { this.toDoor(d, now); return; }
        const slot = places.slots[next.slot] ?? places.slots[0]!, spot: [number, number] = [slot.x, room.counter.z + room.counter.hz + 0.4];
        if (Math.hypot(d.to[0] - spot[0], d.to[1] - spot[1]) > 0.05) this.walk(d, spot, Math.PI, now);
        if (!this.walking(d, now)) return;
        const g = now - d.since - walkTime(d.from, d.to);
        const hand = food.packs.some((p) => p.where === "held" && p.holder === me && p.hand === "right") ? "left" : "right";
        d.hand = hand; d.reach = [slot.x, COUNTER.height + PACK_SIZE[next.kind].grip, slot.z];
        d.reachK = g < GRAB_CONTACT ? smooth(g / GRAB_CONTACT) : 1 - smooth((g - GRAB_CONTACT) / (GRAB_TIME - GRAB_CONTACT));
        if (g >= GRAB_CONTACT) food.handle(me, { type: "grab", pack: next.id, hand }, now);
        if (g >= GRAB_TIME) { d.from = [d.x, d.z]; d.since = now; }
        return;
      }
      case "toDoor": {
        if (!this.walking(d, now)) return;
        const ds = doorState(ctx.doorUses(d.key, "left"), now);
        if (ds.phase === "closing") return;
        const from: [number, number] = [d.x, d.z];
        if (ds.phase === "closed") { d.door = null; ctx.addDoorUse({ key: d.key, leaf: "left", mode: "open", start: now, lead: leaveLead(from), pass: leaveLead(from) + OPENER_PASS.left }); }
        else { d.door = planWalkThrough("out", from, d.yaw, Math.max(0, ds.closesAt - 0.6 - now)); ctx.addDoorUse({ key: d.key, leaf: "left", mode: "follow", start: now, lead: 0, pass: d.door.pass }); }
        d.from = from; d.fromYaw = d.yaw; this.go(d, "exit", now);
        return;
      }
      case "exit": {
        const end = d.door ? d.door.done : LEAVE.done + leaveLead(d.from);
        const pose = d.door ? walkThroughPose(Math.min(t, end), d.door) : leavePose(Math.min(t, end), d.from, d.fromYaw);
        d.speed = Math.hypot(pose.x - d.x, pose.z - d.z) > 1e-4 ? DINER_WALK : 0;
        d.x = pose.x; d.z = pose.z; d.yaw = pose.yaw;
        hands(pose);
        if (t >= end) { this.walk(d, [d.side * 11, 2.3], d.side * Math.PI / 2, now); d.step = "leave"; }
        return;
      }
      case "leave": {
        // Off along the sidewalk, and out of the game.
        if (this.walking(d, now)) d.step = "away";
        return;
      }
      default: return;
    }
  }
  /** Whether a customer (`npc:<id>`) is still about, and whether they are inside the place. */
  present(by: string) { return this.diners.some((d) => `npc:${d.id}` === by); }
  inside(by: string, key: string) { return this.diners.some((d) => `npc:${d.id}` === by && d.key === key && d.step !== "arrive" && d.step !== "exit" && d.step !== "leave"); }
  private toDoor(d: Diner, now: number) { this.walk(d, [-0.45, -1.0], 0, now); this.go(d, "toDoor", now); d.from = [d.x, d.z]; }
  private rise(d: Diner, now: number) { this.go(d, "rise", now); }
}

/** The line for the register: the customer spot, and back toward the door from there. */
export function queueSpot(p: Places, k: number): [number, number] { return [p.customer.x, p.customer.z + 0.05 + k * QUEUE_GAP]; }
/** Waiting for food to go: along the counter past the pick-up spots. */
export function pickupSpot(p: Places, k: number): [number, number] {
  // Facing the far end of the counter (where food to go is set out first), and back from it in a line.
  const far = p.slots[0]!;
  return [far.x, p.customer.z + 0.15 + k * QUEUE_GAP];
}
/** How many are in line ahead of this customer (players standing in the line, and customers already queueing). */
export function lineAhead(d: Diner, diners: Diner[], people: { x: number; z: number }[], p: Places) {
  const inLine = (x: number, z: number) => Math.abs(x - p.customer.x) < 0.6 && z > p.customer.z - 0.4 && z < p.customer.z + 0.4 + MAX_QUEUE * QUEUE_GAP;
  const mine = d.z;
  let n = 0;
  for (const q of people) if (inLine(q.x, q.z) && q.z < mine - 0.2) n++;
  for (const o of diners) if (o !== d && o.key === d.key && (o.step === "queue" || o.step === "order") && (o.step === "order" || o.id < d.id)) n++;
  return n;
}
