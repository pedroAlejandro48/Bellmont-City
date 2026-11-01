// Ordering food at the restaurants (pure, testable): what each place sells, how an order is packed to go, where
// the staff stand and walk, what the cashier says, and the shared simulation of orders, the staff and the food.
//
// Places are in a restaurant's entrance frame (see restaurantRoom.ts): +z out to the street, the counter across
// the back of the dining room with the staff behind it (toward -z) and the kitchen behind the divider.
import { RESTAURANTS, type RestaurantKind } from "./config";
import { COUNTER, type RoomLayout } from "./restaurantRoom";

// ---------- menus ----------

/** The menu boards: sections of [name, price as printed]. */
export type MenuBoardSection = { title: string; items: [string, string][] };
export const MENU_BOARDS: Record<RestaurantKind, { sections: MenuBoardSection[]; note: string }> = {
  cafe: {
    note: "Oat, almond or soy milk +$0.60",
    sections: [
      { title: "Coffee", items: [["Espresso", "2.50"], ["Americano", "3.00"], ["Cappuccino", "3.75"], ["Latte", "4.00"], ["Mocha", "4.50"], ["Cold Brew", "4.25"], ["Bottled Water", "1.75"]] },
      { title: "Bakery", items: [["Butter Croissant", "3.25"], ["Blueberry Muffin", "3.00"], ["Cinnamon Roll", "3.75"], ["Almond Biscotti", "2.25"]] },
      { title: "Breakfast", items: [["Avocado Toast", "7.50"], ["Egg & Cheese Bagel", "6.25"], ["Yogurt Parfait", "5.50"], ["Pancake Stack", "8.00"]] },
    ],
  },
  pizza: {
    note: "All pizzas 12\" · wood-fired · gluten-free crust +$2",
    sections: [
      { title: "Pizze", items: [["Margherita", "12.00"], ["Pepperoni", "14.00"], ["Quattro Formaggi", "15.00"], ["Diavola", "15.00"], ["Capricciosa", "16.00"], ["Ortolana", "14.00"]] },
      { title: "Antipasti", items: [["Garlic Knots", "5.00"], ["Arancini (3)", "6.50"], ["Caesar Salad", "7.00"], ["Bruschetta", "6.00"]] },
      { title: "Dolci & Bevande", items: [["Tiramisù", "6.00"], ["Cannoli (2)", "5.00"], ["Panna Cotta", "5.50"], ["San Pellegrino", "2.50"], ["Bottled Water", "2.00"]] },
    ],
  },
  fine: {
    note: "Chef's omakase tasting menu · $85 per guest",
    sections: [
      { title: "Sushi & Sashimi", items: [["Salmon Nigiri (2)", "7"], ["Bluefin Tuna Nigiri (2)", "9"], ["Dragon Roll", "16"], ["Sashimi Moriawase", "28"]] },
      { title: "Kitchen", items: [["Miso Soup", "4"], ["Chicken Teriyaki", "19"], ["Tonkotsu Ramen", "17"], ["A5 Wagyu Tataki", "34"]] },
      { title: "Sweets & Tea", items: [["Matcha Mochi", "7"], ["Yuzu Sorbet", "6"], ["Sencha Green Tea", "3"], ["Sake (glass)", "9"], ["Bottled Water", "3"]] },
    ],
  },
  burger: {
    note: "Make it a combo: fries + drink +$3.50",
    sections: [
      { title: "Burgers", items: [["Classic Bell", "7.99"], ["Double Bell", "10.49"], ["Bacon BBQ", "9.99"], ["Crispy Chicken", "8.49"], ["Veggie Bell", "7.99"]] },
      { title: "Sides", items: [["Fries", "2.99"], ["Cheese Fries", "3.99"], ["Onion Rings", "3.49"], ["Nuggets (6)", "4.49"]] },
      { title: "Shakes & Drinks", items: [["Vanilla Shake", "4.49"], ["Chocolate Shake", "4.49"], ["Strawberry Shake", "4.49"], ["Fountain Soda", "1.99"], ["Bottled Water", "1.49"]] },
    ],
  },
};

/** What comes in a cup (to go: a lidded cup; everything else goes in a bag). */
const DRINKS = new Set([
  "Espresso", "Americano", "Cappuccino", "Latte", "Mocha", "Cold Brew",
  "San Pellegrino", "Sencha Green Tea", "Sake (glass)",
  "Vanilla Shake", "Chocolate Shake", "Strawberry Shake", "Fountain Soda", "Bottled Water",
]);
export const isDrinkName = (name: string) => DRINKS.has(name);
/** Bottled water comes in a bottle (everything else to drink in a lidded cup). */
export const isWaterName = (name: string) => name === "Bottled Water";

export type MenuItem = { name: string; price: number; drink: boolean };
export type MenuSection = { title: string; items: MenuItem[] };
export function menuOf(kind: RestaurantKind): MenuSection[] {
  return MENU_BOARDS[kind].sections.map((s) => ({ title: s.title, items: s.items.map(([name, price]) => ({ name, price: Number(price), drink: DRINKS.has(name) })) }));
}
export function priceOf(kind: RestaurantKind, name: string) {
  for (const s of menuOf(kind)) for (const it of s.items) if (it.name === name) return it;
  return null;
}
/** Money to the cent. */
export const cents = (n: number) => Math.round(n * 100) / 100;
export const money = (n: number) => `$${cents(n).toFixed(2)}`;
export function orderTotal(kind: RestaurantKind, names: string[]) {
  return cents(names.reduce((sum, n) => sum + (priceOf(kind, n)?.price ?? 0), 0));
}

// ---------- packing an order to go ----------

/** One thing to carry: a paper bag (up to 3 foods), a lidded cup, or a big handled bag (3 bags and 4 cups). */
export type PackKind = "bag" | "cup" | "big";
export type Pack = { kind: PackKind; bags: number; cups: number };
export const BAG_HOLDS = 3, BIG_BAGS = 3, BIG_CUPS = 4, HOLDER_CUPS = 4;

/**
 * How an order to go is packed: a bag per 3 foods and a cup per drink. One bag and one cup at most are handed
 * over as they are; any more (two bags, or two cups) go into big bags with handles, each taking 3 bags and 4
 * cups (the cups in a 4-cup holder).
 */
export function packOrder(foods: number, drinks: number): Pack[] {
  const bags = Math.ceil(Math.max(0, foods) / BAG_HOLDS), cups = Math.max(0, drinks);
  if (bags <= 1 && cups <= 1) {
    const out: Pack[] = [];
    if (bags) out.push({ kind: "bag", bags: 1, cups: 0 });
    if (cups) out.push({ kind: "cup", bags: 0, cups: 1 });
    return out;
  }
  const count = Math.max(Math.ceil(bags / BIG_BAGS), Math.ceil(cups / BIG_CUPS));
  const out: Pack[] = [];
  let b = bags, c = cups;
  for (let i = 0; i < count; i++) {
    const left = count - i;
    const nb = Math.min(BIG_BAGS, Math.ceil(b / left)), nc = Math.min(BIG_CUPS, Math.ceil(c / left));
    out.push({ kind: "big", bags: nb, cups: nc });
    b -= nb; c -= nc;
  }
  return out;
}

/** Sizes (m): a pack's footprint and height, and where a hand holds it (above its base, toward the holder). */
export const PACK_SIZE: Record<PackKind, { w: number; d: number; h: number; grip: number }> = {
  bag: { w: 0.24, d: 0.15, h: 0.3, grip: 0.3 },
  cup: { w: 0.1, d: 0.1, h: 0.17, grip: 0.1 },
  big: { w: 0.4, d: 0.22, h: 0.36, grip: 0.47 },
};

/** How long reaching for food on the counter takes, and when the hand gets to it (s). */
export const GRAB_TIME = 0.9, GRAB_CONTACT = 0.42;
/** How far a grab has the hand toward the food, `t` seconds in: up to it and back to the waist in one movement. */
export function grabReach(t: number) {
  const up = (k: number) => { const c = Math.max(0, Math.min(1, k)); return c * c * (3 - 2 * c); };
  return t < GRAB_CONTACT ? up(t / GRAB_CONTACT) : 1 - up((t - GRAB_CONTACT) / (GRAB_TIME - GRAB_CONTACT));
}

// ---------- the counter and the staff ----------

export type Spot = { x: number; z: number; yaw: number };
export type Places = {
  register: { x: number; z: number };
  cashier: Spot;
  /** Where a customer stands to order, and how close counts as "at the counter". */
  customer: Spot;
  /** Spots on the counter top for food to pick up, nearest the register first. */
  slots: { x: number; z: number }[];
  /** The kitchen runner's place in the kitchen, and the kitchen doorway. */
  kitchen: Spot; doorway: { x: number; z: number };
  /** Somewhere in the middle of the tables (for pointing at them). */
  tables: { x: number; z: number };
};

export function placesOf(room: RoomLayout): Places {
  const { counter, windowSide: ws, divider, bounds } = room;
  const register = { x: counter.x + ws * (counter.hx - 0.45), z: counter.z };
  const back = counter.z - counter.hz, front = counter.z + counter.hz;
  // Pick-up spots run along the counter away from the register, two rows deep.
  const slots: { x: number; z: number }[] = [];
  for (const dz of [0.08, -0.16]) for (let i = 0; ; i++) {
    const x = register.x - ws * (0.75 + i * 0.5);
    if (Math.abs(x - counter.x) > counter.hx - 0.22) break;
    slots.push({ x, z: counter.z + dz });
  }
  const edge = ws === 1 ? bounds.maxX : -bounds.minX;
  return {
    register,
    cashier: { x: register.x, z: back - 0.4, yaw: 0 },
    customer: { x: register.x, z: front + 0.45, yaw: Math.PI },
    slots,
    kitchen: { x: divider.doorX, z: divider.z - 1.7, yaw: 0 },
    doorway: { x: divider.doorX, z: divider.z + 0.3 },
    tables: { x: ws * (edge - 2.8), z: bounds.maxZ - 4.3 },
  };
}

/** Standing at the counter in front of the register (close enough to be served). */
export function atCounter(p: Places, x: number, z: number) {
  return Math.abs(x - p.register.x) < 0.75 && z > p.customer.z - 0.4 && z < p.customer.z + 0.75;
}
/** Close enough to the counter to reach a pack on it (and on the customer's side). */
export function canReach(slot: { x: number; z: number }, x: number, z: number) {
  return z > slot.z && Math.hypot(x - slot.x, z - slot.z) < 1.05;
}

// ---------- what the cashier says ----------

/**
 * The cashier's lines, freshly put together every time from a large set of pieces (so they rarely repeat):
 * a greeting with the place's name and an ask for the order, and what to do once it is paid.
 */
const HELLO = ["Hi there", "Hey", "Hello", "Hi", "Hey there", "Welcome", "Good to see you", "Hi, welcome", "Hello there", "Hey, hi"];
const WELCOME = ["welcome to {name}", "welcome in to {name}", "thanks for coming to {name}", "you're at {name}", "this is {name}", "welcome to {name}, glad you stopped by"];
const ASK = ["What can I get for you?", "What can I get started for you?", "What'll it be today?", "What are you in the mood for?", "Ready to order?", "What sounds good today?", "What can I get you?", "What would you like?", "Take a look, what can I get you?", "Know what you'd like?", "What are we having today?"];
const TIME: Record<string, string[]> = {
  morning: ["Good morning", "Morning", "Morning, hi"],
  afternoon: ["Good afternoon", "Afternoon"],
  evening: ["Good evening", "Evening"],
  night: ["Hey, night owl", "Late one, huh", "Evening"],
};
const KIND_TOUCH: Record<RestaurantKind, string[]> = {
  cafe: ["Coffee's fresh.", "Pastries just came out.", "The cold brew's great today.", ""],
  pizza: ["The oven's nice and hot.", "Fresh dough today.", ""],
  fine: ["Irasshaimase!", "The fish came in this morning.", ""],
  burger: ["Grill's fired up.", "Fries are hot.", ""],
};
const pick = <T,>(list: readonly T[], r: () => number) => list[Math.floor(r() * list.length) % list.length]!;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function greetingLine(kind: RestaurantKind, hours: number, r: () => number = Math.random) {
  const name = RESTAURANTS[kind].name;
  const part = hours < 5 ? "night" : hours < 12 ? "morning" : hours < 17 ? "afternoon" : hours < 22 ? "evening" : "night";
  const hello = r() < 0.35 ? pick(TIME[part]!, r) : pick(HELLO, r);
  const touch = r() < 0.3 ? pick(KIND_TOUCH[kind], r) : "";
  const line = `${hello}, ${pick(WELCOME, r).replace("{name}", name)}! ${touch ? `${touch} ` : ""}${pick(ASK, r)}`;
  return cap(line.replace(/\s+/g, " ").trim());
}

const THANKS = ["Thank you!", "Thanks!", "Perfect, thank you!", "Great choice!", "You got it!", "Awesome, thanks!", "Sounds good!", "Coming right up!"];
const TOGO = ["Please wait over there, your order will be out shortly.", "Your food will be right over there in a few minutes.", "If you can wait right over there, it'll be ready soon.", "Pick it up right over there when it's ready.", "It'll come out right there, just a few minutes.", "Hang tight over there, we'll have it out in a bit."];
const HERE = ["Grab any table you like and we'll bring it out to you.", "Have a seat at any table, it'll be right out.", "Pick a table over there and wait, we'll bring it to you.", "Go ahead and choose a table, we'll bring your food over.", "Find yourself a table over there, it won't be long."];
export function toldLine(mode: "togo" | "here", r: () => number = Math.random) {
  return `${pick(THANKS, r)} ${pick(mode === "togo" ? TOGO : HERE, r)}`;
}
export const notEnoughLine = (r: () => number = Math.random) => pick(["Oh, looks like that's a bit more than you have.", "Sorry, that card didn't go through. Maybe something smaller?", "Hmm, that's not quite enough. Want to change your order?"], r);

// ---------- the kitchen runner's trips ----------

/** Walking pace for the staff (m/s), and how long setting down or picking up food takes. */
export const STAFF_WALK = 1.3;
export const HANDLE_TIME = 1.1;
/** The moment in handling when the food leaves (or reaches) the hands. */
export const HANDOVER = 0.5;

export type Trip = { task: "deliver" | "clear"; slots: number[] };
/** Where the runner stands at the counter for a trip (between its slots, on the staff side). */
export function tripStand(p: Places, room: RoomLayout, slots: number[]): { x: number; z: number } {
  const xs = slots.map((i) => p.slots[i]?.x ?? p.register.x);
  const x = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return { x, z: room.counter.z - room.counter.hz - 0.3 };
}
function tripPath(p: Places, room: RoomLayout, slots: number[]): [number, number][] {
  const stand = tripStand(p, room, slots);
  return [[p.kitchen.x, p.kitchen.z], [p.doorway.x, p.doorway.z - 0.5], [p.doorway.x, p.doorway.z], [stand.x, stand.z]];
}
const pathLength = (pts: [number, number][]) => pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - pts[i]![0], q[1] - pts[i]![1]), 0);
/** How long a trip takes: out to the counter, the handling there, and back. */
export function tripTimes(p: Places, room: RoomLayout, slots: number[]) {
  const walk = pathLength(tripPath(p, room, slots)) / STAFF_WALK;
  return { walk, handover: walk + HANDOVER, back: walk + HANDLE_TIME, done: 2 * walk + HANDLE_TIME };
}
function along(pts: [number, number][], d: number): { at: [number, number]; heading: number } {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d <= l || i === pts.length - 1) {
      const k = l ? Math.max(0, Math.min(1, d / l)) : 1;
      return { at: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], heading: Math.atan2(b[0] - a[0], b[1] - a[1]) };
    }
    d -= l;
  }
  const last = pts[pts.length - 1]!;
  return { at: last, heading: 0 };
}
const turnTo = (from: number, to: number, k: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * Math.max(0, Math.min(1, k));
const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

export type StaffPose = {
  x: number; z: number; yaw: number; speed: number;
  /** Whether the trip's food is in the runner's hands now. */
  carrying: boolean;
  /** 0..1: reaching to the counter to set food down or pick it up. */
  reach: number;
};
/** The runner `t` seconds into a trip (null trip: standing at the kitchen station). */
export function runnerPose(p: Places, room: RoomLayout, trip: Trip | null, t: number): StaffPose {
  if (!trip) return { x: p.kitchen.x, z: p.kitchen.z, yaw: p.kitchen.yaw, speed: 0, carrying: false, reach: 0 };
  const pts = tripPath(p, room, trip.slots), times = tripTimes(p, room, trip.slots), len = pathLength(pts);
  const carryingOut = trip.task === "deliver", carryingBack = trip.task === "clear";
  if (t < times.walk) {
    const { at, heading } = along(pts, t * STAFF_WALK);
    // Easing round to face the counter over the last metre.
    const left = len - t * STAFF_WALK;
    return { x: at[0], z: at[1], yaw: turnTo(heading, 0, 1 - left / 1), speed: STAFF_WALK, carrying: carryingOut, reach: 0 };
  }
  if (t < times.back) {
    const k = (t - times.walk) / HANDLE_TIME, end = pts[pts.length - 1]!;
    const reach = Math.sin(Math.PI * Math.max(0, Math.min(1, k)));
    const handed = t >= times.handover;
    return { x: end[0], z: end[1], yaw: 0, speed: 0, carrying: carryingOut ? !handed : handed, reach };
  }
  const back = [...pts].reverse(), d = (t - times.back) * STAFF_WALK;
  const { at, heading } = along(back, d);
  const start = turnTo(0, heading, smooth(d / 0.5));
  return { x: at[0], z: at[1], yaw: d < 0.5 ? start : heading, speed: t < times.done ? STAFF_WALK : 0, carrying: carryingBack, reach: 0 };
}

// ---------- the shared simulation ----------

export type Mode = "togo" | "here";
/** A pack of food somewhere: in the kitchen, in the runner's hands, on the counter, held by a player, or gone. */
export type FoodPack = Pack & { id: number; order: number; key: string; where: "kitchen" | "runner" | "counter" | "held" | "gone"; slot: number; holder: string; hand: "left" | "right" };
export type Order = { id: number; by: string; key: string; kind: RestaurantKind; mode: Mode; names: string[]; placedAt: number; readyAt: number };
/** Someone at a counter talking to the cashier. */
export type Session = { by: string; text: string; at: number; stage: "greet" | "told"; mode: Mode | null };
export type RunnerTrip = Trip & { at: number; packs: number[]; done: boolean };

export type FoodRequest =
  | { type: "greet"; key: string; text: string }
  | { type: "bye"; key: string }
  | { type: "order"; key: string; kind: RestaurantKind; names: string[]; mode: Mode; text: string }
  | { type: "grab"; pack: number; hand: "left" | "right" };

/** Seconds from paying until the food is ready to come out. */
export const prepSeconds = (count: number) => Math.min(30, 7 + 1.5 * count);

/**
 * Orders, the cashiers' conversations, the kitchen runners and the food, run by one player (the room's host, or
 * the player alone) and shown to everyone. Times are the host's clock in seconds.
 */
export class FoodSim {
  orders: Order[] = [];
  packs: FoodPack[] = [];
  sessions = new Map<string, Session>();
  trips = new Map<string, RunnerTrip>();
  private nextId = 1;
  private placesOf: (key: string) => { places: Places; room: RoomLayout } | null;
  constructor(placesOf: (key: string) => { places: Places; room: RoomLayout } | null) { this.placesOf = placesOf; }

  /** Handles one request from player `by` at time `now`. */
  handle(by: string, req: FoodRequest, now: number) {
    if (req.type === "greet") {
      const s = this.sessions.get(req.key);
      if (!s || s.by === by) this.sessions.set(req.key, { by, text: req.text.slice(0, 160), at: now, stage: "greet", mode: null });
    } else if (req.type === "bye") {
      if (this.sessions.get(req.key)?.by === by) this.sessions.delete(req.key);
    } else if (req.type === "order") {
      const s = this.sessions.get(req.key);
      if (s && s.by !== by) return;
      const names = req.names.filter((n) => priceOf(req.kind, n)).slice(0, 60);
      if (!names.length) return;
      const id = this.nextId++;
      this.orders.push({ id, by, key: req.key, kind: req.kind, mode: req.mode, names, placedAt: now, readyAt: now + prepSeconds(names.length) });
      this.sessions.set(req.key, { by, text: req.text.slice(0, 160), at: now, stage: "told", mode: req.mode });
      if (req.mode === "togo") {
        const drinks = names.filter((n) => priceOf(req.kind, n)?.drink).length;
        for (const pack of packOrder(names.length - drinks, drinks)) this.packs.push({ ...pack, id: this.nextId++, order: id, key: req.key, where: "kitchen", slot: -1, holder: "", hand: "right" });
      }
    } else if (req.type === "grab") {
      const p = this.packs.find((q) => q.id === req.pack);
      if (!p || p.where !== "counter") return;
      if (this.packs.some((q) => q.where === "held" && q.holder === by && q.hand === req.hand)) return;
      Object.assign(p, { where: "held", holder: by, hand: req.hand, slot: -1 });
    }
  }

  /** Moves everything on to `now`. `inside(by, key)`: whether that player is in that restaurant; `present`: still here. */
  step(now: number, inside: (by: string, key: string) => boolean, present: (by: string) => boolean) {
    // Food held by someone who left the room is gone with them.
    for (const p of this.packs) if (p.where === "held" && !present(p.holder)) p.where = "gone";
    for (const [key, s] of this.sessions) if (!present(s.by)) this.sessions.delete(key);
    const keys = new Set([...this.orders.map((o) => o.key), ...this.trips.keys()]);
    for (const key of keys) {
      const at = this.placesOf(key);
      if (!at) continue;
      let trip = this.trips.get(key);
      if (trip) {
        const times = tripTimes(at.places, at.room, trip.slots), t = now - trip.at;
        const mine = trip.packs.map((id) => this.packs.find((p) => p.id === id)).filter((p): p is FoodPack => !!p);
        if (t >= times.handover) {
          if (trip.task === "deliver") mine.forEach((p, i) => { if (p.where === "runner") { p.where = "counter"; p.slot = trip!.slots[i] ?? 0; } });
          else for (const p of mine) if (p.where === "counter") { p.where = "runner"; p.slot = -1; }
        }
        if (t >= times.done) {
          if (trip.task === "clear") for (const p of mine) if (p.where === "runner") p.where = "gone";
          this.trips.delete(key); trip = undefined;
        }
      }
      if (trip) continue;
      // Food left behind on the counter by someone who has gone out: taken back to the kitchen.
      const ordersHere = this.orders.filter((o) => o.key === key);
      const leftover = this.packs.filter((p) => p.key === key && p.where === "counter" && !inside(ordersHere.find((o) => o.id === p.order)?.by ?? "", key));
      if (leftover.length) {
        const two = leftover.slice(0, 2);
        this.trips.set(key, { task: "clear", slots: two.map((p) => p.slot), at: now, packs: two.map((p) => p.id), done: false });
        continue;
      }
      // Ready food comes out, two packs a trip; if whoever ordered it has left, it is never brought out.
      for (const o of ordersHere) {
        if (now < o.readyAt) continue;
        const waiting = this.packs.filter((p) => p.order === o.id && p.where === "kitchen");
        if (!waiting.length) continue;
        if (!inside(o.by, key)) { for (const p of waiting) p.where = "gone"; continue; }
        const used = new Set(this.packs.filter((p) => p.key === key && p.where === "counter").map((p) => p.slot));
        const free = at.places.slots.map((_, i) => i).filter((i) => !used.has(i));
        const two = waiting.slice(0, Math.min(2, free.length));
        if (!two.length) continue;
        two.forEach((p) => { p.where = "runner"; });
        this.trips.set(key, { task: "deliver", slots: free.slice(0, two.length), at: now, packs: two.map((p) => p.id), done: false });
        break;
      }
    }
    this.packs = this.packs.filter((p) => p.where !== "gone");
    this.orders = this.orders.filter((o) => this.packs.some((p) => p.order === o.id) || now - o.placedAt < 120);
  }

  snapshot(now: number): FoodSnapshot {
    return {
      v: 1,
      s: [...this.sessions].map(([key, s]) => [key, s.by, s.text, cents(now - s.at), s.stage === "told" ? (s.mode === "togo" ? 1 : 2) : 0]),
      r: [...this.trips].map(([key, t]) => [key, t.task === "deliver" ? 0 : 1, cents(now - t.at), t.slots, t.packs]),
      p: this.packs.map((p) => [p.id, p.key, p.kind === "bag" ? 0 : p.kind === "cup" ? 1 : 2, p.bags, p.cups, WHERE.indexOf(p.where), p.slot, p.holder, p.hand === "left" ? 0 : 1, p.order]),
    };
  }

  /** Takes over from what the previous host last showed (when the host leaves). */
  adopt(view: FoodView, now: number) {
    this.sessions = new Map([...view.sessions].map(([k, s]) => [k, { ...s, at: now - (s.ago) }]));
    this.trips = new Map([...view.trips].map(([k, t]) => [k, { task: t.task, slots: t.slots, packs: t.packs, at: now - t.ago, done: false }]));
    this.packs = view.packs.map((p) => ({ ...p }));
    this.nextId = Math.max(this.nextId, ...this.packs.map((p) => Math.max(p.id, p.order) + 1));
  }
}

const WHERE = ["kitchen", "runner", "counter", "held", "gone"] as const;

/** What the host shares: sessions [key, by, text, ago, stage], trips [key, task, ago, slots, packs], packs. */
export type FoodSnapshot = {
  v: 1;
  s: [string, string, string, number, number][];
  r: [string, number, number, number[], number[]][];
  p: [number, string, number, number, number, number, number, string, number, number][];
};
/** A snapshot read back, with times as ages (seconds) when it was taken. */
export type FoodView = {
  sessions: Map<string, { by: string; text: string; ago: number; stage: "greet" | "told"; mode: Mode | null }>;
  trips: Map<string, Trip & { ago: number; packs: number[] }>;
  packs: FoodPack[];
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
export function readSnapshot(value: unknown): FoodView | null {
  const v = value as Partial<FoodSnapshot> | null;
  if (typeof v !== "object" || v === null || v.v !== 1) return null;
  // The realtime database leaves out empty lists, so a missing one is empty.
  const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : typeof x === "object" && x !== null ? Object.values(x) : []);
  const view: FoodView = { sessions: new Map(), trips: new Map(), packs: [] };
  for (const s of list(v.s)) {
    if (!Array.isArray(s)) continue;
    const [key, by, text, ago, stage] = s;
    if (isStr(key) && isStr(by) && isStr(text) && isNum(ago) && isNum(stage)) view.sessions.set(key, { by, text, ago, stage: stage ? "told" : "greet", mode: stage === 1 ? "togo" : stage === 2 ? "here" : null });
  }
  for (const r of list(v.r)) {
    if (!Array.isArray(r)) continue;
    const [key, task, ago, slots, packs] = r;
    const sl = list(slots), pk = list(packs);
    if (isStr(key) && isNum(task) && isNum(ago) && sl.every(isNum) && pk.every(isNum)) view.trips.set(key, { task: task ? "clear" : "deliver", ago, slots: sl as number[], packs: pk as number[] });
  }
  for (const p of list(v.p)) {
    if (!Array.isArray(p)) continue;
    const [id, key, kind, bags, cups, where, slot, holder, hand, order] = p;
    if (!isNum(id) || !isStr(key) || !isNum(kind) || !isNum(bags) || !isNum(cups) || !isNum(where) || !isNum(slot) || !isStr(holder) || !isNum(hand) || !isNum(order)) continue;
    view.packs.push({ id, key, kind: kind === 0 ? "bag" : kind === 1 ? "cup" : "big", bags, cups, where: WHERE[where] ?? "gone", slot, holder, hand: hand === 0 ? "left" : "right", order });
  }
  return view;
}

/** The host's own state as a view (ages from `now`), so every player draws from the same kind of data. */
export function viewOf(sim: FoodSim, now: number): FoodView {
  const view = readSnapshot(sim.snapshot(now));
  return view ?? { sessions: new Map(), trips: new Map(), packs: [] };
}

/** How one player's game talks to whoever runs the food (themselves when alone). */
export type FoodLink = {
  /** This player's id in the room ("me" alone). */
  me: () => string;
  isHost: () => boolean;
  publish: (snapshot: FoodSnapshot) => void;
  /** The host's latest snapshot, and when it arrived (local ms), or null when this player is the host. */
  latest: () => { view: FoodView; at: number } | null;
  send: (req: FoodRequest) => void;
  /** Requests waiting for the host to handle. */
  takeRequests: () => { by: string; req: FoodRequest }[];
  /** Which restaurant each other player is in (by their id). */
  others: () => Map<string, string | null>;
  /** Tells the others which restaurant this player is in. */
  setInside: (key: string | null) => void;
};

/** Playing alone: this player runs everything. */
export function localFoodLink(): FoodLink {
  let queue: { by: string; req: FoodRequest }[] = [];
  return {
    me: () => "me", isHost: () => true, publish: () => {}, latest: () => null,
    send: (req) => { queue.push({ by: "me", req }); },
    takeRequests: () => { const out = queue; queue = []; return out; },
    others: () => new Map(), setInside: () => {},
  };
}
