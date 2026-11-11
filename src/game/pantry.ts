// The grocery's pantry goods (pure): canned food (cooked at home on the stove), candy (eaten from the inventory)
// and kitchenware (kept at home: pots and pans under the sink, the rest beside it).

export const CANS = ["blackBeans", "kidneyBeans", "bakedBeans", "cannedChicken", "tuna", "sausages", "chickenSoup", "beefSoup", "corn", "peas", "greenBeans", "carrots"] as const;
export const CANDIES = ["milkChocolate", "darkChocolate", "caramelBar", "peanutCups", "gummyBears", "sourWorms", "lollipop", "mintDrops"] as const;
export const WARES = ["pot", "pan", "plate", "bowl", "cup", "jar", "silverware"] as const;
export type CanKind = (typeof CANS)[number];
export type CandyKind = (typeof CANDIES)[number];
export type WareKind = (typeof WARES)[number];

/** Each can: its name, price, and how it looks (label colour, picture, the food's colours when cooked). */
export const CAN_INFO: Record<CanKind, { name: string; price: number; label: string; band: string; pic: "beans" | "bakedBeans" | "chicken" | "fish" | "sausage" | "soup" | "corn" | "peas" | "greenBeans" | "carrots"; food: [string, string] }> = {
  blackBeans: { name: "Black Beans", price: 1.29, label: "#2b2b33", band: "#7f5fbf", pic: "beans", food: ["#2a2230", "#4a3a3a"] },
  kidneyBeans: { name: "Kidney Beans", price: 1.29, label: "#8a1f2b", band: "#f2d16b", pic: "beans", food: ["#7a1e22", "#a83a2e"] },
  bakedBeans: { name: "Baked Beans", price: 1.49, label: "#2d63a8", band: "#e8a33d", pic: "bakedBeans", food: ["#c4552a", "#e07a3a"] },
  cannedChicken: { name: "Canned Chicken", price: 3.49, label: "#f2e6c9", band: "#c2401f", pic: "chicken", food: ["#e8d2a8", "#c9a46e"] },
  tuna: { name: "Tuna", price: 1.99, label: "#1f6fa8", band: "#f2f2ee", pic: "fish", food: ["#d9b9a0", "#b8907a"] },
  sausages: { name: "Sausages", price: 2.49, label: "#b5332a", band: "#f2d16b", pic: "sausage", food: ["#b0603a", "#d58a5a"] },
  chickenSoup: { name: "Chicken Soup", price: 2.29, label: "#e6b52e", band: "#c2401f", pic: "soup", food: ["#e8c25a", "#f2e3a8"] },
  beefSoup: { name: "Beef Soup", price: 2.79, label: "#6b3a22", band: "#e6b52e", pic: "soup", food: ["#7a4226", "#a8683a"] },
  corn: { name: "Sweet Corn", price: 0.99, label: "#2f7a3a", band: "#f2d43b", pic: "corn", food: ["#f2cf3b", "#e6b52e"] },
  peas: { name: "Green Peas", price: 0.99, label: "#e9efe2", band: "#3f9a3a", pic: "peas", food: ["#5aa83a", "#7cc24a"] },
  greenBeans: { name: "Green Beans", price: 1.09, label: "#f2efe6", band: "#2f7a3a", pic: "greenBeans", food: ["#4a8a2e", "#6aa83a"] },
  carrots: { name: "Sliced Carrots", price: 1.19, label: "#2a5f3a", band: "#f08a2a", pic: "carrots", food: ["#f0782a", "#f6a04a"] },
};
/** Each candy: name, price, wrapper colours, shape. */
export const CANDY_INFO: Record<CandyKind, { name: string; price: number; wrap: string; ink: string; shape: "bar" | "bag" | "pop" | "tin" | "cups" }> = {
  milkChocolate: { name: "Milk Chocolate", price: 1.49, wrap: "#5a2d1a", ink: "#f2d6a8", shape: "bar" },
  darkChocolate: { name: "Dark Chocolate", price: 2.19, wrap: "#1f1a1a", ink: "#d9b26a", shape: "bar" },
  caramelBar: { name: "Caramel Bar", price: 1.79, wrap: "#d98a1f", ink: "#5a2d1a", shape: "bar" },
  peanutCups: { name: "Peanut Cups", price: 1.89, wrap: "#f07a1a", ink: "#3a1f12", shape: "cups" },
  gummyBears: { name: "Gummy Bears", price: 1.39, wrap: "#e8344a", ink: "#ffe36a", shape: "bag" },
  sourWorms: { name: "Sour Worms", price: 1.29, wrap: "#7dd63a", ink: "#3a1f6a", shape: "bag" },
  lollipop: { name: "Lollipop", price: 0.59, wrap: "#ff5fa8", ink: "#ffffff", shape: "pop" },
  mintDrops: { name: "Mint Drops", price: 1.09, wrap: "#3ab6a8", ink: "#ffffff", shape: "tin" },
};
/** Kitchenware: name and price. */
export const WARE_INFO: Record<WareKind, { name: string; price: number }> = {
  pot: { name: "Cooking Pot", price: 18.99 }, pan: { name: "Frying Pan", price: 15.99 }, plate: { name: "Plate", price: 4.49 },
  bowl: { name: "Bowl", price: 3.99 }, cup: { name: "Cup", price: 3.49 }, jar: { name: "Glass Jar", price: 2.99 },
  silverware: { name: "Silverware Set", price: 6.99 },
};
export const isCan = (k: string): k is CanKind => (CANS as readonly string[]).includes(k);
export const isCandy = (k: string): k is CandyKind => (CANDIES as readonly string[]).includes(k);
export const isWare = (k: string): k is WareKind => (WARES as readonly string[]).includes(k);
export const canByName = (name: string) => CANS.find((c) => CAN_INFO[c].name === name) ?? null;

/** A candy: half an energy drink's energy and half its harm to health, and a little hunger. */
export const CANDY_EFFECT = { hunger: 8, thirst: 0, energy: 20, health: -7.5 };

/**
 * The shelves' sections: the pantry shelf has cans on its front (+z, toward the door) and candy on its back; the
 * kitchenware shelf the big things on its front and the small ones on its back. Each section: what, which side,
 * and where along the shelf (−w/2..w/2) it starts and ends.
 */
export function shelfSections(tag: string, w: number): { kind: string; side: 1 | -1; u0: number; u1: number }[] {
  const lay = (kinds: readonly string[], side: 1 | -1) => kinds.map((kind, i) => ({ kind, side, u0: -w / 2 + (i * w) / kinds.length, u1: -w / 2 + ((i + 1) * w) / kinds.length }));
  if (tag === "pantry") return [...lay(CANS, 1), ...lay(CANDIES, -1)];
  if (tag === "kitchenware") return [...lay(["pot", "pan", "plate", "bowl"], 1), ...lay(["cup", "jar", "silverware"], -1)];
  return [];
}

// ---------- cooking ----------
/** A pot holds up to three cans, a pan two. */
export const CAPACITY: Record<"pot" | "pan", number> = { pot: 3, pan: 2 };
/** Cooking takes 30 in-game minutes; left on the stove 10 more after that, it burns. */
export const COOK_MINUTES = 30, BURN_AFTER = 10;
/** What a cooked meal of `n` cans gives: 35% hunger a can (three fill you), and 10% thirst and energy a can. */
export function mealEffect(n: number) {
  return { hunger: n >= 3 ? 100 : 35 * n, thirst: 10 * n, energy: 10 * n };
}
/** How a pot on the stove is (game minutes since it went on): cooking, ready, or burnt. */
export function cookState(minutes: number): "cooking" | "ready" | "burnt" {
  return minutes < COOK_MINUTES ? "cooking" : minutes < COOK_MINUTES + BURN_AFTER ? "ready" : "burnt";
}
