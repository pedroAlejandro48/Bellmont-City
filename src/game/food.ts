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
  "Vanilla Shake", "Chocolate Shake", "Strawberry Shake", "Fountain Soda", "Bottled Water", "Orange Juice",
  "Apple Juice", "Cola", "Lemon Soda", "Volt Energy",
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
export type PackKind = "bag" | "cup" | "big" | "sign" | "tray";
export type Pack = { kind: PackKind; bags: number; cups: number; items?: string[] };
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
  sign: { w: 0.1, d: 0.07, h: 0.15, grip: 0.12 },
  tray: { w: 0.56, d: 0.42, h: 0.03, grip: 0.02 },
};
/** Eating one item, or drinking one drink, takes two in-game minutes (GAME_MINUTE is 1.67 s). */
/** A tray shows at most this many items at once (in a 2 × 2 grid); the rest come into view as these are eaten. */
export const TRAY_SHOWN = 4;
/**
 * What a tray shows, in its slots: everything not yet eaten (in the order it came), and, while there is room, the
 * plates left by what has been eaten. `state`: "left" (still there), "taken" (being eaten: its plate), "eaten".
 */
export function trayLayout(orig: readonly string[], items: readonly string[], eating: string | null) {
  const left = [...items];
  if (eating) { const i = left.indexOf(eating); if (i >= 0) left.splice(i, 1); }
  const entries = orig.map((name) => {
    const i = left.indexOf(name);
    if (i >= 0) { left.splice(i, 1); return { name, state: "left" as const }; }
    return { name, state: "eaten" as const };
  });
  // The one being eaten is the first eaten-looking entry with that name that's still in `items`.
  if (eating && items.includes(eating)) { const e = entries.find((x) => x.name === eating && x.state === "eaten"); if (e) (e as { state: string }).state = "taken"; }
  const waiting = entries.filter((e) => e.state !== "eaten").length;
  let room = Math.max(0, TRAY_SHOWN - waiting);
  const shown: { name: string; state: "left" | "taken" | "eaten" }[] = [];
  for (const e of entries) {
    if (shown.length >= TRAY_SHOWN) break;
    if (e.state !== "eaten") shown.push(e);
    else if (room > 0) { room--; shown.push(e); }
  }
  return shown;
}
export const EAT_SECONDS = 2 * (1200 / (12 * 60));

/** How long reaching for food on the counter takes, and when the hand gets to it (s). */
export const GRAB_TIME = 0.9, GRAB_CONTACT = 0.42;
/** How far a grab has the hand toward the food, `t` seconds in: up to it and back to the waist in one movement. */
export function grabReach(t: number) {
  const up = (k: number) => { const c = Math.max(0, Math.min(1, k)); return c * c * (3 - 2 * c); };
  return t < GRAB_CONTACT ? up(t / GRAB_CONTACT) : 1 - up((t - GRAB_CONTACT) / (GRAB_TIME - GRAB_CONTACT));
}

/** Packs an order's items by name: foods into bags (and big bags), drinks into cups or bottles, as packOrder. */
export function packItems(foods: string[], drinks: string[]): Pack[] {
  const packs = packOrder(foods.length, drinks.length);
  let f = 0, d = 0;
  return packs.map((p) => {
    const nf = p.kind === "bag" ? Math.min(BAG_HOLDS, foods.length - f) : p.kind === "big" ? Math.min(p.bags * BAG_HOLDS, foods.length - f) : 0;
    const items = [...foods.slice(f, f + nf), ...drinks.slice(d, d + p.cups)];
    f += nf; d += p.cups;
    return { ...p, items };
  });
}

/** Putting everything held down on the ground (Q): a squat, the food set down at the bottom, and back up. */
export const DROP_TIME = 1.3, DROP_CONTACT = 0.6;
export function dropReach(t: number) {
  const up = (k: number) => { const c = Math.max(0, Math.min(1, k)); return c * c * (3 - 2 * c); };
  return t < DROP_CONTACT ? up(t / DROP_CONTACT) : 1 - up((t - DROP_CONTACT) / (DROP_TIME - DROP_CONTACT));
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
  /** The waiter's place in the kitchen (the one who serves the tables). */
  waiter: Spot;
  /** Somewhere in the middle of the tables (for pointing at them). */
  tables: { x: number; z: number };
};

function kitchenStation(room: RoomLayout): Spot {
  const { divider, bounds, windowSide: ws } = room;
  const depth = divider.z - bounds.minZ;
  const z = divider.z - Math.max(1.4, Math.min(depth * 0.6, depth - 0.7));
  const x = Math.max(bounds.minX + 0.6, Math.min(bounds.maxX - 0.6, divider.doorX + ws * 2.2));
  return { x, z, yaw: Math.PI / 2 * -ws };
}
export function placesOf(room: RoomLayout): Places {
  const { counter, windowSide: ws, divider, bounds } = room;
  const register = { x: counter.x + ws * (counter.hx - 0.45), z: counter.z };
  const back = counter.z - counter.hz, front = counter.z + counter.hz;
  // Pick-up spots run along the counter away from the register, two rows deep.
  const slots: { x: number; z: number }[] = [];
  // Food to go is set out from the far end of the counter (away from the register) first.
  for (const dz of [0.08, -0.16]) {
    const row: { x: number; z: number }[] = [];
    for (let i = 0; ; i++) {
      const x = register.x - ws * (0.75 + i * 0.5);
      if (Math.abs(x - counter.x) > counter.hx - 0.22) break;
      row.push({ x, z: counter.z + dz });
    }
    slots.push(...row.reverse());
  }
  const edge = ws === 1 ? bounds.maxX : -bounds.minX;
  return {
    register,
    cashier: { x: register.x, z: back - 0.4, yaw: 0 },
    customer: { x: register.x, z: front + 0.45, yaw: Math.PI },
    slots,
    // The runner's station well inside the kitchen and off to the side, out of sight from the dining room.
    kitchen: kitchenStation(room),
    waiter: (() => { const k = kitchenStation(room), x = Math.max(room.bounds.minX + 0.6, Math.min(room.bounds.maxX - 0.6, k.x - ws * 1.1)); return { x, z: Math.max(room.bounds.minZ + 0.6, k.z - 0.4), yaw: k.yaw }; })(),
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

export type Trip = {
  task: "deliver" | "clear" | "serve" | "bus"; slots: number[];
  /** Serving or clearing a table: the spot on the table (room frame) the waiter works at, where the waiter stands
   * (beside the table, next to the diner) and which way they face there. */
  to?: [number, number]; stand?: [number, number]; face?: number;
};
/** Who does a trip: the runner (food to go, on the counter) or the waiter (the tables). */
export const tripWorker = (task: Trip["task"]) => (task === "serve" || task === "bus" ? "waiter" : "runner");
/** Where the waiter stands to put a tray down at (or take one from) `spot` on a table: beside the table, at the
 * diner's end, facing the spot. */
export function tableStand(items: { kind: string; x: number; z: number }[] | undefined, spot: [number, number], exit: [number, number]): { stand: [number, number]; face: number } {
  let table: { x: number; z: number } | undefined, best = Infinity;
  for (const it of items ?? []) if (it.kind === "table") { const d = Math.hypot(it.x - spot[0], it.z - spot[1]); if (d < best) { best = d; table = it; } }
  if (!table) return { stand: [spot[0], spot[1] - 0.6], face: 0 };
  const dx = spot[0] - table.x, dz = spot[1] - table.z, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
  const a: [number, number] = [spot[0] + uz * 0.62 - ux * 0.05, spot[1] - ux * 0.62 - uz * 0.05], b: [number, number] = [spot[0] - uz * 0.62 - ux * 0.05, spot[1] + ux * 0.62 - uz * 0.05];
  const stand = Math.hypot(a[0] - exit[0], a[1] - exit[1]) <= Math.hypot(b[0] - exit[0], b[1] - exit[1]) ? a : b;
  return { stand, face: Math.atan2(spot[0] - stand[0], spot[1] - stand[1]) };
}
/** Where the runner stands at the counter for a trip (between its slots, on the staff side). */
export function tripStand(p: Places, room: RoomLayout, slots: number[]): { x: number; z: number } {
  const xs = slots.map((i) => p.slots[i]?.x ?? p.register.x);
  const x = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return { x, z: room.counter.z - room.counter.hz - 0.3 };
}
function tripPath(p: Places, room: RoomLayout, trip: Trip): [number, number][] {
  // From the station, across the kitchen to just inside its doorway, and through it.
  const inner: [number, number] = [p.doorway.x, Math.max(p.kitchen.z, room.divider.z - 1.1)];
  const home = trip.to ? p.waiter : p.kitchen;
  const out: [number, number][] = [[home.x, home.z], inner, [p.doorway.x, p.doorway.z]];
  if (trip.to) {
    // Out from behind the counter round its open end, and up to the table, facing it (from the counter's side).
    const { counter, windowSide: ws, divider } = room;
    const end = counter.x + ws * (counter.hx + 0.5), staffZ = (divider.z + counter.z - counter.hz) / 2;
    return [...out, [end, staffZ], [end, counter.z + counter.hz + 0.7], trip.stand ?? [trip.to[0], trip.to[1] - 0.6]];
  }
  const stand = tripStand(p, room, trip.slots);
  return [...out, [stand.x, stand.z]];
}
const pathLength = (pts: [number, number][]) => pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - pts[i]![0], q[1] - pts[i]![1]), 0);
/** How long a trip takes: out to the counter, the handling there, and back. */
export function tripTimes(p: Places, room: RoomLayout, trip: Trip) {
  const walk = pathLength(tripPath(p, room, trip)) / STAFF_WALK;
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
export function runnerPose(p: Places, room: RoomLayout, trip: Trip | null, t: number, worker: "runner" | "waiter" = "runner"): StaffPose {
  if (!trip) { const home = worker === "waiter" ? p.waiter : p.kitchen; return { x: home.x, z: home.z, yaw: home.yaw, speed: 0, carrying: false, reach: 0 }; }
  const pts = tripPath(p, room, trip), times = tripTimes(p, room, trip), len = pathLength(pts);
  const carryingOut = trip.task === "deliver" || trip.task === "serve", carryingBack = trip.task === "clear" || trip.task === "bus" || trip.task === "serve";
  if (t < times.walk) {
    const { at, heading } = along(pts, t * STAFF_WALK);
    // Easing round to face the counter over the last metre.
    const left = len - t * STAFF_WALK;
    return { x: at[0], z: at[1], yaw: turnTo(heading, trip.face ?? 0, 1 - left / 1), speed: STAFF_WALK, carrying: carryingOut, reach: 0 };
  }
  if (t < times.back) {
    const k = (t - times.walk) / HANDLE_TIME, end = pts[pts.length - 1]!;
    const reach = Math.sin(Math.PI * Math.max(0, Math.min(1, k)));
    const handed = t >= times.handover;
    return { x: end[0], z: end[1], yaw: trip.face ?? 0, speed: 0, carrying: trip.task === "serve" ? true : carryingOut ? !handed : handed, reach };
  }
  const back = [...pts].reverse(), d = (t - times.back) * STAFF_WALK;
  const { at, heading } = along(back, d);
  const start = turnTo(trip.face ?? 0, heading, smooth(d / 0.5));
  return { x: at[0], z: at[1], yaw: d < 0.5 ? start : heading, speed: t < times.done ? STAFF_WALK : 0, carrying: carryingBack, reach: 0 };
}

// ---------- the shared simulation ----------

export type Mode = "togo" | "here";
/** A pack of food somewhere: in the kitchen, in the runner's hands, on the counter, held by a player, or gone. */
export type FoodPack = Pack & {
  id: number; order: number; key: string; where: "kitchen" | "runner" | "counter" | "held" | "ground" | "table" | "aside" | "trash" | "gone"; slot: number; holder: string; hand: "left" | "right";
  /** Who ordered it (only they can take it off the counter). */
  owner: string; items: string[];
  /** Put down (on the ground, a table, a bench, or falling into a bin): where (world, `gy` its base) and facing which way. */
  gx: number; gz: number; gyaw: number; gy: number;
  /** A number sign's number (0 for food). */
  sign: number;
  /** Being eaten from: the item and when it was started (and when it was put somewhere, for a falling bin). */
  eating: { item: string; at: number } | null; at: number;
  /** A tray whose diner has finished with it (or gone): the runner clears it away. */
  done: boolean;
  /** A bottle of water (still a bottle once it is empty). */
  bottle?: boolean;
  /** A tray: everything that came on it, in order (eaten things leave their plates behind). */
  orig?: string[];
};
export type Order = { id: number; by: string; key: string; kind: RestaurantKind; mode: Mode; names: string[]; placedAt: number; readyAt: number };
/** Someone at a counter talking to the cashier. */
export type Session = { by: string; text: string; at: number; stage: "greet" | "told"; mode: Mode | null };
export type RunnerTrip = Trip & { at: number; packs: number[]; done: boolean };

export type FoodRequest =
  | { type: "greet"; key: string; text: string }
  | { type: "bye"; key: string }
  | { type: "order"; key: string; kind: RestaurantKind; names: string[]; mode: Mode; text: string }
  | { type: "grab"; pack: number; hand: "left" | "right" }
  /** Picking up something lying on the ground (anyone's). */
  | { type: "pickup"; pack: number; hand: "left" | "right" }
  /** Putting down everything held, where each one lands. */
  | { type: "drop"; packs: { id: number; x: number; z: number; yaw: number }[] }
  /** Setting something held on a table (a number sign) or beside oneself on a bench. */
  | { type: "set"; pack: number; where: "table" | "aside"; x: number; y: number; z: number; yaw: number }
  /** Starting to eat (or drink) an item from a pack, and having finished it. */
  | { type: "eat"; pack: number; item: string }
  | { type: "ate"; pack: number; item: string }
  /** Done with a tray (finished, full, or gone): it is cleared away. */
  | { type: "leave"; pack: number }
  /** An empty thrown in a bin at (x, z). */
  | { type: "trash"; pack: number; x: number; y: number; z: number };

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
      if (req.mode === "here") {
        // Eating in: a number sign to take now (two digits, none the same in the place at once), and a tray
        // with the number on it, which comes out to the table where the sign is.
        const used = new Set(this.packs.filter((p) => p.key === req.key && p.sign).map((p) => p.sign));
        let n = 10 + Math.floor(Math.random() * 90);
        for (let k = 0; used.has(n) && k < 90; k++) n = 10 + ((n - 10 + 1) % 90);
        const slots = this.placesOf(req.key)?.places.slots ?? [];
        const taken = new Set(this.packs.filter((p) => p.key === req.key && p.where === "counter").map((p) => p.slot));
        // The number sign by the register (the far end of the counter is for food to go).
        const reg = this.placesOf(req.key)?.places.register;
        let slot = -1; slots.forEach((q, i) => { if (!taken.has(i) && (slot < 0 || Math.abs(q.x - (reg?.x ?? 0)) + Math.abs(q.z - (reg?.z ?? 0)) < Math.abs(slots[slot]!.x - (reg?.x ?? 0)) + Math.abs(slots[slot]!.z - (reg?.z ?? 0)))) slot = i; });
        const base = { order: id, key: req.key, holder: "", hand: "right" as const, owner: by, gx: 0, gz: 0, gyaw: 0, gy: 0, eating: null, at: now, done: false, bags: 0, cups: 0 };
        this.packs.push({ ...base, kind: "sign", items: [], id: this.nextId++, where: "counter", slot: Math.max(0, slot), sign: n });
        this.packs.push({ ...base, kind: "tray", items: [...names], orig: [...names], id: this.nextId++, where: "kitchen", slot: -1, sign: n });
      }
      if (req.mode === "togo") {
        const isDrink = (n: string) => !!priceOf(req.kind, n)?.drink;
        for (const pack of packItems(names.filter((n) => !isDrink(n)), names.filter(isDrink))) this.packs.push({ ...pack, bottle: pack.kind === "cup" && pack.items?.[0] === "Bottled Water", items: pack.items ?? [], id: this.nextId++, order: id, key: req.key, where: "kitchen", slot: -1, holder: "", hand: "right", owner: by, gx: 0, gz: 0, gyaw: 0, gy: 0, sign: 0, eating: null, at: now, done: false });
      }
    } else if (req.type === "grab") {
      const p = this.packs.find((q) => q.id === req.pack);
      // Only whoever ordered it can take it off the counter.
      if (!p || p.where !== "counter" || p.owner !== by) return;
      if (this.packs.some((q) => q.where === "held" && q.holder === by && q.hand === req.hand)) return;
      Object.assign(p, { where: "held", holder: by, hand: req.hand, slot: -1 });
    } else if (req.type === "pickup") {
      const p = this.packs.find((q) => q.id === req.pack);
      // Off the ground (anyone's), or back from beside oneself on a bench.
      if (!p || !(p.where === "ground" || (p.where === "aside" && p.holder === by))) return;
      if (this.packs.some((q) => q.where === "held" && q.holder === by && q.hand === req.hand)) return;
      Object.assign(p, { where: "held", holder: by, hand: req.hand, slot: -1 });
    } else if (req.type === "set") {
      const p = this.packs.find((q) => q.id === req.pack);
      if (p && p.where === "held" && p.holder === by) Object.assign(p, { where: req.where, gx: req.x, gy: req.y, gz: req.z, gyaw: req.yaw, at: now, holder: req.where === "aside" ? by : "" });
    } else if (req.type === "eat") {
      const p = this.packs.find((q) => q.id === req.pack);
      if (p && p.items.includes(req.item)) p.eating = { item: req.item, at: now };
    } else if (req.type === "ate") {
      const p = this.packs.find((q) => q.id === req.pack);
      if (!p) return;
      const i = p.items.indexOf(req.item);
      if (i >= 0) p.items.splice(i, 1);
      p.eating = null;
      if (p.kind === "tray" && !p.items.length) p.done = true;
    } else if (req.type === "leave") {
      const p = this.packs.find((q) => q.id === req.pack);
      if (p) { p.done = true; p.eating = null; }
    } else if (req.type === "trash") {
      const p = this.packs.find((q) => q.id === req.pack);
      if (p && p.where === "held" && p.holder === by) Object.assign(p, { where: "trash", holder: "", gx: req.x, gy: req.y, gz: req.z, at: now });
    } else if (req.type === "drop") {
      for (const d of req.packs) {
        const p = this.packs.find((q) => q.id === d.id);
        if (p && p.where === "held" && p.holder === by) Object.assign(p, { where: "ground", holder: "", gx: d.x, gz: d.z, gyaw: d.yaw, gy: 0 });
      }
    }
  }

  /** Moves everything on to `now`. `inside(by, key)`: whether that player is in that restaurant; `present`: still here. */
  step(now: number, inside: (by: string, key: string) => boolean, present: (by: string) => boolean) {
    // Food held (or set beside them) by someone who left the room is gone with them.
    for (const p of this.packs) if ((p.where === "held" || p.where === "aside") && !present(p.holder)) p.where = "gone";
    // Something thrown in a bin is gone once it has dropped to the bottom.
    for (const p of this.packs) if (p.where === "trash" && now - p.at > 1.2) p.where = "gone";
    for (const [key, s] of this.sessions) if (!present(s.by)) this.sessions.delete(key);
    const keys = new Set([...this.orders.map((o) => o.key), ...[...this.trips.keys()].map((k) => k.split("|")[0]!), ...this.packs.filter((p) => p.where === "table").map((p) => p.key)]);
    for (const key of keys) {
      const at = this.placesOf(key);
      if (!at) continue;
      const local = (x: number, z: number): [number, number] => { const f = at.room.frame, dx = x - f.ox, dz = z - f.oz; return [dx * f.c - dz * f.s, dx * f.s + dz * f.c]; };
      // Two workers in the kitchen: the runner (food to go, on the counter) and the waiter (the tables), each
      // on their own trip (the waiter's is kept under `key|w`).
      for (const tk of [key, `${key}|w`]) {
        const trip = this.trips.get(tk);
        if (!trip) continue;
        const times = tripTimes(at.places, at.room, trip), t = now - trip.at;
        const mine = trip.packs.map((id) => this.packs.find((p) => p.id === id)).filter((p): p is FoodPack => !!p);
        if (t >= times.handover) {
          if (trip.task === "deliver") mine.forEach((p, i) => { if (p.where === "runner") { p.where = "counter"; p.slot = trip.slots[i] ?? 0; } });
          else if (trip.task === "clear") { for (const p of mine) if (p.where === "counter") { p.where = "runner"; p.slot = -1; } }
          else if (trip.task === "serve") {
            // The tray goes down where the number sign stood, and the sign goes back with the waiter.
            const [sign, tray] = mine;
            if (sign && tray && sign.where === "table" && tray.where === "runner") { Object.assign(tray, { where: "table", gx: sign.gx, gy: sign.gy, gz: sign.gz, gyaw: sign.gyaw, at: now }); sign.where = "runner"; }
          } else if (trip.task === "bus") { for (const p of mine) if (p.where === "table") p.where = "runner"; }
        }
        if (t >= times.done) {
          for (const p of mine) if (p.where === "runner" && trip.task !== "deliver") p.where = "gone";
          this.trips.delete(tk);
        }
      }
      const ordersHere = this.orders.filter((o) => o.key === key);
      const byOf = (p: FoodPack) => ordersHere.find((o) => o.id === p.order)?.by ?? p.owner;
      const exit: [number, number] = [at.room.counter.x + at.room.windowSide * (at.room.counter.hx + 0.5), at.room.counter.z + at.room.counter.hz + 0.7];
      const toTable = (gx: number, gz: number) => { const to = local(gx, gz); return { to, ...tableStand((at.room as RoomLayout & { items?: { kind: string; x: number; z: number }[] }).items, to, exit) }; };
      // ---- the waiter: trays out to tables, and cleared away ----
      if (!this.trips.has(`${key}|w`)) {
        const start = (t: Omit<RunnerTrip, "at" | "done">) => { this.trips.set(`${key}|w`, { ...t, at: now, done: false }); };
        const ready = this.packs.find((p) => p.key === key && p.kind === "tray" && p.where === "kitchen" && now >= (ordersHere.find((o) => o.id === p.order)?.readyAt ?? Infinity));
        const signFor = (tray: FoodPack) => this.packs.find((q) => q.order === tray.order && q.kind === "sign");
        const toClear = this.packs.find((p) => p.key === key && p.where === "table" && (p.kind === "tray" ? p.done || !inside(byOf(p), key) : !inside(byOf(p), key)));
        if (ready && !inside(byOf(ready), key)) ready.where = "gone";
        const sign = ready && ready.where === "kitchen" ? signFor(ready) : undefined;
        if (ready && sign?.where === "table") { ready.where = "runner"; start({ task: "serve", slots: [], packs: [sign.id, ready.id], ...toTable(sign.gx, sign.gz) }); }
        else if (toClear) start({ task: "bus", slots: [], packs: [toClear.id], ...toTable(toClear.gx, toClear.gz) });
      }
      // ---- the runner: food to go out to the counter, and food left there taken back ----
      if (!this.trips.has(key)) {
        const start = (t: Omit<RunnerTrip, "at" | "done">) => { this.trips.set(key, { ...t, at: now, done: false }); };
        const leftover = this.packs.filter((p) => p.key === key && p.where === "counter" && p.kind !== "sign" && !inside(byOf(p), key));
        if (leftover.length) { const two = leftover.slice(0, 2); start({ task: "clear", slots: two.map((p) => p.slot), packs: two.map((p) => p.id) }); }
        else for (const o of ordersHere) {
          if (now < o.readyAt) continue;
          const waiting = this.packs.filter((p) => p.order === o.id && p.where === "kitchen" && p.kind !== "tray");
          if (!waiting.length) continue;
          if (!inside(o.by, key)) { for (const p of waiting) p.where = "gone"; continue; }
          const used = new Set(this.packs.filter((p) => p.key === key && p.where === "counter").map((p) => p.slot));
          const free = at.places.slots.map((_, i) => i).filter((i) => !used.has(i));
          const two = waiting.slice(0, Math.min(2, free.length));
          if (!two.length) continue;
          two.forEach((p) => { p.where = "runner"; });
          start({ task: "deliver", slots: free.slice(0, two.length), packs: two.map((p) => p.id) });
          break;
        }
      }
    }
    this.packs = this.packs.filter((p) => p.where !== "gone");
    this.orders = this.orders.filter((o) => this.packs.some((p) => p.order === o.id) || now - o.placedAt < 120);
  }

  snapshot(now: number): FoodSnapshot {
    return {
      v: 1,
      s: [...this.sessions].map(([key, s]) => [key, s.by, s.text, cents(now - s.at), s.stage === "told" ? (s.mode === "togo" ? 1 : 2) : 0]),
      r: [...this.trips].map(([key, t]) => [key, TASKS.indexOf(t.task), cents(now - t.at), t.slots, t.packs, cents(t.to?.[0] ?? 0), cents(t.to?.[1] ?? 0), t.to ? 1 : 0, cents(t.stand?.[0] ?? 0), cents(t.stand?.[1] ?? 0), cents(t.face ?? 0)]),
      p: this.packs.map((p) => [p.id, p.key, KINDS.indexOf(p.kind), p.bags, p.cups, WHERE.indexOf(p.where), p.slot, p.holder, p.hand === "left" ? 0 : 1, p.order, p.owner, p.items.join("|"), cents(p.gx), cents(p.gz), cents(p.gyaw), cents(p.gy), p.sign, p.eating?.item ?? "", p.eating ? cents(now - p.eating.at) : 0, cents(now - p.at), p.done ? 1 : 0, p.bottle ? 1 : 0, p.orig?.join("|") ?? ""]),
    };
  }

  /** Someone else now holds what `from` held (a customer who has left the restaurant, handed to the street). */
  transfer(from: string, to: string) { for (const p of this.packs) if (p.holder === from) p.holder = to; }

  /** Takes over from what the previous host last showed (when the host leaves). */
  adopt(view: FoodView, now: number) {
    this.sessions = new Map([...view.sessions].map(([k, s]) => [k, { ...s, at: now - (s.ago) }]));
    this.trips = new Map([...view.trips].map(([k, t]) => [k, { task: t.task, slots: t.slots, packs: t.packs, ...(t.to ? { to: t.to } : {}), ...(t.stand ? { stand: t.stand, face: t.face ?? 0 } : {}), at: now - t.ago, done: false }]));
    this.packs = view.packs.map((p) => ({ ...p, at: now + p.at, eating: p.eating ? { item: p.eating.item, at: now + p.eating.at } : null }));
    this.nextId = Math.max(this.nextId, ...this.packs.map((p) => Math.max(p.id, p.order) + 1));
  }
}

const WHERE = ["kitchen", "runner", "counter", "held", "gone", "ground", "table", "aside", "trash"] as const;
const TASKS = ["deliver", "clear", "serve", "bus"] as const;
const KINDS = ["bag", "cup", "big", "sign", "tray"] as const;

/** What the host shares: sessions [key, by, text, ago, stage], trips [key, task, ago, slots, packs], packs. */
export type FoodSnapshot = {
  v: 1;
  /** Customers who aren't players (diners.ts rows), and their uses of the doors [key, leaf, mode, ago, lead, pass]. */
  c?: unknown[]; u?: [string, number, number, number, number, number][];
  s: [string, string, string, number, number][];
  r: [string, number, number, number[], number[], number, number, number, number, number, number][];
  p: [number, string, number, number, number, number, number, string, number, number, string, string, number, number, number, number, number, string, number, number, number, number, string][];
};
/** A snapshot read back, with times as ages (seconds) when it was taken. */
export type FoodView = {
  sessions: Map<string, { by: string; text: string; ago: number; stage: "greet" | "told"; mode: Mode | null }>;
  trips: Map<string, Trip & { ago: number; packs: number[] }>;
  packs: FoodPack[];
  diners: import("./diners").DinerRow[];
  doors: { key: string; leaf: "left" | "right"; mode: "open" | "follow"; ago: number; lead: number; pass: number }[];
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
export function readSnapshot(value: unknown): FoodView | null {
  const v = value as Partial<FoodSnapshot> | null;
  if (typeof v !== "object" || v === null || v.v !== 1) return null;
  // The realtime database leaves out empty lists, so a missing one is empty.
  const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : typeof x === "object" && x !== null ? Object.values(x) : []);
  const view: FoodView = { sessions: new Map(), trips: new Map(), packs: [], diners: [], doors: [] };
  for (const s of list(v.s)) {
    if (!Array.isArray(s)) continue;
    const [key, by, text, ago, stage] = s;
    if (isStr(key) && isStr(by) && isStr(text) && isNum(ago) && isNum(stage)) view.sessions.set(key, { by, text, ago, stage: stage ? "told" : "greet", mode: stage === 1 ? "togo" : stage === 2 ? "here" : null });
  }
  for (const r of list(v.r)) {
    if (!Array.isArray(r)) continue;
    const [key, task, ago, slots, packs, tx, tz, hasTo, sx, sz, face] = r;
    const sl = list(slots), pk = list(packs);
    if (isStr(key) && isNum(task) && isNum(ago) && sl.every(isNum) && pk.every(isNum)) view.trips.set(key, { task: TASKS[task] ?? "deliver", ago, slots: sl as number[], packs: pk as number[], ...(hasTo === 1 && isNum(tx) && isNum(tz) ? { to: [tx, tz] as [number, number], ...(isNum(sx) && isNum(sz) ? { stand: [sx, sz] as [number, number], face: isNum(face) ? face : 0 } : {}) } : {}) });
  }
  for (const p of list(v.p)) {
    if (!Array.isArray(p)) continue;
    const [id, key, kind, bags, cups, where, slot, holder, hand, order, owner, items, gx, gz, gyaw, gy, sign, eatItem, eatAgo, atAgo, done, bottle, orig] = p;
    if (!isNum(id) || !isStr(key) || !isNum(kind) || !isNum(bags) || !isNum(cups) || !isNum(where) || !isNum(slot) || !isStr(holder) || !isNum(hand) || !isNum(order)) continue;
    view.packs.push({
      id, key, kind: KINDS[kind] ?? "bag", bags, cups, where: WHERE[where] ?? "gone", slot, holder, hand: hand === 0 ? "left" : "right", order,
      owner: isStr(owner) ? owner : "", items: isStr(items) && items ? items.split("|") : [], gx: isNum(gx) ? gx : 0, gz: isNum(gz) ? gz : 0, gyaw: isNum(gyaw) ? gyaw : 0,
      gy: isNum(gy) ? gy : 0, sign: isNum(sign) ? sign : 0,
      // Ages: `eating.at` and `at` are kept as "seconds ago" in a view (adopt turns them back into times).
      eating: isStr(eatItem) && eatItem ? { item: eatItem, at: -(isNum(eatAgo) ? eatAgo : 0) } : null, at: -(isNum(atAgo) ? atAgo : 0), done: done === 1, bottle: bottle === 1, ...(isStr(orig) && orig ? { orig: orig.split("|") } : {}),
    });
  }
  for (const row of list(v.c)) {
    if (!Array.isArray(row) || row.length < 13) continue;
    const r = row as unknown[];
    if (isNum(r[0]) && isStr(r[1]) && r.slice(2).every(isNum)) view.diners.push(r as import("./diners").DinerRow);
  }
  for (const row of list(v.u)) {
    if (!Array.isArray(row)) continue;
    const [key, leaf, mode, ago, lead, pass] = row as unknown[];
    if (isStr(key) && isNum(leaf) && isNum(mode) && isNum(ago) && isNum(lead) && isNum(pass)) view.doors.push({ key, leaf: leaf ? "left" : "right", mode: mode ? "follow" : "open", ago, lead, pass });
  }
  return view;
}

/** The host's own state as a view (ages from `now`), so every player draws from the same kind of data. */
export function viewOf(sim: FoodSim, now: number): FoodView {
  const view = readSnapshot(sim.snapshot(now));
  return view ?? { sessions: new Map(), trips: new Map(), packs: [], diners: [], doors: [] };
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
