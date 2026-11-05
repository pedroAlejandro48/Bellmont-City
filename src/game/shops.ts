// The shops around the park (pure): what each one is, where it is, and what it sells.
import { RESTAURANTS, generateCity, type Building, type RestaurantKind, type VenueKind } from "./config";
import { menuOf } from "./food";
import { doorOf } from "./places";

export type ShopKind = VenueKind;
export const SHOPS: Record<ShopKind, { name: string; code: string; blurb: string; color: string; ink: string; block: [number, number] }> = {
  grocery: { name: "Fresh Market", code: "B2", blurb: "Groceries for your fridge: cheaper than eating out", color: "#2e9d5b", ink: "#ffffff", block: [0, -1] },
  clothing: { name: "Threads", code: "B3", blurb: "New outfit colours", color: "#d6455d", ink: "#ffffff", block: [1, 0] },
  bikes: { name: "Spoke & Wheel", code: "B5", blurb: "Paint jobs for your bike", color: "#e07a1f", ink: "#ffffff", block: [-1, 0] },
  gym: { name: "Iron Bell Gym", code: "B7", blurb: "Train to run faster", color: "#33363f", ink: "#ffb547", block: [0, 1] },
  hospital: { name: "Bellmont General", code: "B8", blurb: "Treatment and health plans", color: "#ffffff", ink: "#d62f3a", block: [1, 1] },
  police: { name: "Police Station", code: "P7", blurb: "Pay fines, check your record", color: "#1d3b8a", ink: "#ffffff", block: [-1, -1] },
  apartments: { name: "Bellmont Residences", code: "H1", blurb: "Small apartments to rent, first week free", color: "#6c3fc0", ink: "#ffffff", block: [2, -2] },
};
export const SHOP_KINDS = Object.keys(SHOPS) as ShopKind[];
export const SHOP_REACH = 2.2;

/** Each shop's building (the one in its block nearest the park that isn't a restaurant) and its door. */
export function shopPlaces(seed: number): { kind: ShopKind; building: Building; door: { x: number; z: number; yaw: number } }[] {
  const city = generateCity(seed, 0, 0);
  // Every venue building (the six apartment buildings each count).
  return city.buildings.filter((c) => c.venue).map((b) => ({ kind: b.venue!, building: b, door: doorOf(b) }));
}

/** Groceries: cheaper than restaurant food for the same filling (`value` is the restaurant price it fills like). */
export const GROCERIES: { name: string; price: number; value: number; item?: import("./inventory").ItemKind }[] = [
  { name: "Apple", price: 1.2, value: 3, item: "apple" },
  { name: "Banana", price: 1, value: 3.5, item: "banana" },
  { name: "Orange", price: 1.2, value: 3, item: "orange" },
  { name: "Sandwich", price: 3.5, value: 9 },
  { name: "Salad Bowl", price: 4, value: 10 },
  { name: "Pasta Meal", price: 5, value: 15 },
  { name: "Bottled Water", price: 0.8, value: 1.5, item: "water" },
  { name: "Orange Juice", price: 2, value: 3 },
];

/** What a food fills like (its restaurant price, or a grocery's value), for nutrition. */
export function foodValue(name: string) {
  const g = GROCERIES.find((x) => x.name === name);
  if (g) return g.value;
  for (const k of Object.keys(RESTAURANTS) as RestaurantKind[]) for (const s of menuOf(k)) for (const it of s.items) if (it.name === name) return it.price;
  return 4;
}

export const OUTFITS = ["#ffffff", "#2b2d33", "#d6455d", "#3d7bff", "#2e9d5b", "#ffb547", "#8a5cd6", "#3a8fb7", "#c47a4a", "#ff8fb1"];
export const OUTFIT_PRICE = 25;
export const PAINTS = ["#27877b", "#c9281f", "#1f5fbf", "#ffb547", "#1d1f24", "#f2f3f7", "#8a5cd6", "#ff6fae", "#4caf50"];
export const PAINT_PRICE = 40;
export const WORKOUT_PRICE = 8;
export const TREATMENT_PRICE = 60;

/** Pay for a stocking shift: a base plus per shelf filled, more with work skill (before tax). */
export function clerkPay(stocked: number) { return Math.round((6 + stocked * 0.9) * 100) / 100; }
