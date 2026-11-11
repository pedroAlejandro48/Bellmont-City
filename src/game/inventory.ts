// The inventory (pure): nine slots (3 × 3), the phone always in the first. Things that can be kept are listed in
// ITEMS; trash (an empty bottle) can't go in. (Canned food and kitchenware are bought too, but kept at home: the
// fridge, the sink's cupboard; candy goes straight into the inventory.)
import { CANDIES, CANDY_INFO, CANS, CAN_INFO, WARES, WARE_INFO, type CandyKind, type CanKind, type WareKind } from "./pantry";

export type ItemKind = "phone" | "water" | "orangeJuice" | "appleJuice" | "cola" | "lemonSoda" | "energy" | "apple" | "banana" | "orange" | "pear" | "lemon" | "lime" | "grape" | "peach" | "key" | CanKind | CandyKind | WareKind;
export type Inventory = (ItemKind | null)[];
export const SLOTS = 9;

export const ITEMS: Record<ItemKind, { name: string; icon: string; use: "eat" | "drink" | "open" | "hold"; value?: number; trash?: "bottle" | "can" }> = {
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
  lemon: { name: "Lemon", icon: "🍋", use: "eat", value: 1.5 },
  lime: { name: "Lime", icon: "🟢", use: "eat", value: 1.5 },
  grape: { name: "Grapes", icon: "🍇", use: "eat", value: 4 },
  peach: { name: "Peach", icon: "🍑", use: "eat", value: 3 },
  key: { name: "Apartment key", icon: "🔑", use: "hold" },
  ...Object.fromEntries(CANS.map((k) => [k, { name: CAN_INFO[k].name, icon: "🥫", use: "hold" as const }])),
  ...Object.fromEntries(CANDIES.map((k) => [k, { name: CANDY_INFO[k].name, icon: CANDY_INFO[k].shape === "pop" ? "🍭" : CANDY_INFO[k].shape === "bag" ? "🍬" : "🍫", use: "eat" as const }])),
  ...Object.fromEntries(WARES.map((k) => [k, { name: WARE_INFO[k].name, icon: k === "pot" || k === "pan" ? "🍳" : k === "cup" ? "☕" : k === "glass" ? "🥛" : k === "silverware" ? "🍴" : "🍽️", use: "hold" as const }])),
} as Record<ItemKind, { name: string; icon: string; use: "eat" | "drink" | "open" | "hold"; value?: number; trash?: "bottle" | "can" }>;
export const isItemKind = (k: unknown): k is ItemKind => typeof k === "string" && k in ITEMS;

export function newInventory(): Inventory {
  const inv: Inventory = Array(SLOTS).fill(null);
  inv[0] = "phone";
  return inv;
}
/** Reads a saved inventory: nine slots, the phone first (and nowhere else), unknown things dropped. */
export function readInventory(v: unknown): Inventory {
  const inv = newInventory();
  if (!Array.isArray(v)) return inv;
  for (let i = 1; i < SLOTS; i++) { const k = v[i]; inv[i] = isItemKind(k) && k !== "phone" ? k : null; }
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
