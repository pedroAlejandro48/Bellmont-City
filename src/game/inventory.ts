// The inventory (pure): nine slots (3 × 3), the phone always in the first. Things that can be kept are listed in
// ITEMS; an empty bottle or can goes in too, till it's thrown away. (Canned food and kitchenware are bought too, but kept at home: the
// fridge, the sink's cupboard; candy goes straight into the inventory.)
import { CANDIES, CANDY_INFO, CANS, CAN_INFO, WARES, WARE_INFO, type CandyKind, type CanKind, type WareKind } from "./pantry";

/** A meal or drink from a restaurant kept in the fridge and taken out: `meal:<its name>`. */
export type MealKind = `meal:${string}`;
/** The drinks sold in bottles and cans. */
export type DrinkKind = "water" | "orangeJuice" | "appleJuice" | "cola" | "lemonSoda" | "energy";
export const DRINKS: readonly DrinkKind[] = ["water", "orangeJuice", "appleJuice", "cola", "lemonSoda", "energy"];
/** One of them drunk: its empty bottle or can (looking just as it did, without what was in it). Kept like anything
 * else (in the inventory, in a hand, on the ground) till it's thrown away. */
export type EmptyKind = `empty:${DrinkKind}`;
/** An empty in hand: one of those, or (from before empties kept their looks) just a bottle or a can. */
export type TrashKind = "bottle" | "can" | EmptyKind;
export const isEmptyKind = (k: unknown): k is EmptyKind => typeof k === "string" && k.startsWith("empty:") && (DRINKS as readonly string[]).includes(k.slice(6));
export const isTrashKind = (k: unknown): k is TrashKind => k === "bottle" || k === "can" || isEmptyKind(k);
/** What an empty was (an old plain bottle: water; an old plain can: cola). */
export const emptyBase = (t: TrashKind): DrinkKind => (t === "bottle" ? "water" : t === "can" ? "cola" : (t.slice(6) as DrinkKind));
/** As an item (the inventory, the ground): always one of the drinks' own. */
export const asEmpty = (t: TrashKind): EmptyKind => `empty:${emptyBase(t)}`;
/** A bottle or a can (how it's held, how it falls, what the bin prompt says). */
export const trashShape = (t: TrashKind): "bottle" | "can" => (t === "bottle" || t === "can" ? t : ITEMS[emptyBase(t)].trash!);
export type ItemKind = MealKind | EmptyKind | "phone" | "water" | "orangeJuice" | "appleJuice" | "cola" | "lemonSoda" | "energy" | "apple" | "banana" | "orange" | "pear" | "kiwi" | "plum" | "grape" | "peach" | "key" | CanKind | CandyKind | WareKind;
export type Inventory = (ItemKind | null)[];
export const SLOTS = 9;

type ItemInfo = { name: string; icon: string; use: "eat" | "drink" | "open" | "hold"; value?: number; trash?: "bottle" | "can" };
/** The kinds of thing listed (everything but restaurant meals). */
export type BaseKind = Exclude<ItemKind, MealKind | EmptyKind>;
export const ITEMS: Record<BaseKind, { name: string; icon: string; use: "eat" | "drink" | "open" | "hold"; value?: number; trash?: "bottle" | "can" }> = {
  phone: { name: "Phone", icon: "📱", use: "open" },
  water: { name: "Bottled Water", icon: "💧", use: "drink", trash: "bottle" },
  orangeJuice: { name: "Orange Juice", icon: "🧃", use: "drink", trash: "bottle" },
  appleJuice: { name: "Apple Juice", icon: "🧃", use: "drink", trash: "bottle" },
  cola: { name: "Cola", icon: "🥤", use: "drink", trash: "can" },
  lemonSoda: { name: "Lemon Soda", icon: "🥤", use: "drink", trash: "can" },
  energy: { name: "Volt Energy", icon: "⚡", use: "drink", trash: "can" },
  apple: { name: "Apple", icon: "🍎", use: "eat", value: 3 },
  banana: { name: "Banana", icon: "🍌", use: "eat", value: 3.5 },
  orange: { name: "Orange", icon: "🍊", use: "eat", value: 3 },
  pear: { name: "Pear", icon: "🍐", use: "eat", value: 3 },
  kiwi: { name: "Kiwi", icon: "🥝", use: "eat", value: 2.5 },
  plum: { name: "Plum", icon: "🟣", use: "eat", value: 2.5 },
  grape: { name: "Grapes", icon: "🍇", use: "eat", value: 4 },
  peach: { name: "Peach", icon: "🍑", use: "eat", value: 3 },
  key: { name: "Apartment key", icon: "🔑", use: "hold" },
  ...Object.fromEntries(CANS.map((k) => [k, { name: CAN_INFO[k].name, icon: "🥫", use: "hold" as const }])),
  ...Object.fromEntries(CANDIES.map((k) => [k, { name: CANDY_INFO[k].name, icon: CANDY_INFO[k].shape === "pop" ? "🍭" : CANDY_INFO[k].shape === "bag" ? "🍬" : "🍫", use: "eat" as const }])),
  ...Object.fromEntries(WARES.map((k) => [k, { name: WARE_INFO[k].name, icon: k === "pot" || k === "pan" ? "🍳" : k === "cup" ? "☕" : k === "glass" ? "🥛" : k === "silverware" ? "🍴" : "🍽️", use: "hold" as const }])),
} as Record<BaseKind, ItemInfo>;
export const isItemKind = (k: unknown): k is ItemKind => typeof k === "string" && (k in ITEMS || (k.startsWith("meal:") && k.length > 5) || isEmptyKind(k));
const DRINK_WORDS = /(water|juice|cola|soda|shake|tea|coffee|lemonade|drink|latte|smoothie|milk)/i;
/** What a thing is called, its icon and what it's for (restaurant meals and drinks too). */
export function itemInfo(k: ItemKind): { name: string; icon: string; use: "eat" | "drink" | "open" | "hold"; value?: number; trash?: "bottle" | "can" } {
  const known = (ITEMS as Partial<Record<string, ItemInfo>>)[k];
  if (known) return known;
  if (isEmptyKind(k)) { const b = ITEMS[emptyBase(k)]; return { name: `Empty ${b.name}`, icon: b.icon, use: "hold", trash: b.trash! }; }
  const name = k.slice(5), drink = DRINK_WORDS.test(name);
  return { name, icon: drink ? "🥤" : "🍱", use: drink ? "drink" : "eat" };
}
/** The thing in the inventory a name stands for (fruit, drinks, candy; else a restaurant meal). */
export function kindByName(name: string): ItemKind {
  const k = (Object.keys(ITEMS) as BaseKind[]).find((x) => ITEMS[x].name === name && x !== "phone");
  return k ?? (`meal:${name}` as MealKind);
}

/** Fruit the store no longer sells, kept as what replaced it (lemons are kiwis now, limes plums). */
export const oldKind = (k: unknown) => (k === "lemon" ? "kiwi" : k === "lime" ? "plum" : k);
export function newInventory(): Inventory {
  const inv: Inventory = Array(SLOTS).fill(null);
  inv[0] = "phone";
  return inv;
}
/** Reads a saved inventory: nine slots, the phone first (and nowhere else), unknown things dropped. */
export function readInventory(v: unknown): Inventory {
  const inv = newInventory();
  if (!Array.isArray(v)) return inv;
  for (let i = 1; i < SLOTS; i++) { const k = oldKind(v[i]); inv[i] = isItemKind(k) && k !== "phone" ? k : null; }
  return inv;
}
/** Puts a thing in `slot` if given and empty, else the first empty slot; the slot used, or -1 when full. */
export function addItem(inv: Inventory, kind: ItemKind, slot?: number) {
  if (kind === "phone") return -1;
  const i = slot !== undefined && slot > 0 && slot < SLOTS && inv[slot] === null ? slot : inv.findIndex((x, j) => j > 0 && x === null);
  if (i < 0) return -1;
  inv[i] = kind;
  return i;
}
export function removeItem(inv: Inventory, slot: number): ItemKind | null {
  if (slot <= 0 || slot >= SLOTS) return null;
  const k = inv[slot] ?? null;
  inv[slot] = null;
  return k;
}
export const freeSlots = (inv: Inventory) => inv.filter((x, i) => i > 0 && x === null).length;

/**
 * A number key pressed (`slot` 0..8) with `held` the slot in hand now: what happens. Pressing the slot in hand puts
 * it away; another full slot is taken out instead; an empty one stores what the hand carries when it can.
 */
export function pressSlot(inv: Inventory, held: number | null, slot: number): { kind: "hide" | "show" | "store" | "nothing"; slot: number } {
  if (slot === held) return { kind: "hide", slot };
  if (inv[slot]) return { kind: "show", slot };
  return { kind: slot > 0 ? "store" : "nothing", slot };
}
