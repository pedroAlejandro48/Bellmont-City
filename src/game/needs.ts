// Health, hunger and thirst over time, and what eating and drinking does for them (pure, testable).
import { MENU_BOARDS, isDrinkName, isWaterName } from "./food";

/** Thirst runs out over 24 in-game hours, hunger over 48. */
export const THIRST_PER_MINUTE = 100 / (24 * 60);
export const HUNGER_PER_MINUTE = 100 / (48 * 60);
/** With either at zero, health drops 10% an in-game minute; otherwise it heals 1% every 10 in-game minutes. */
export const STARVING_PER_MINUTE = 10;
export const HEALING_PER_MINUTE = 0.1;

export type Needs = { health: number; hunger: number; thirst: number };
const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** Needs after `minutes` in-game minutes. */
export function stepNeeds(n: Needs, minutes: number): Needs {
  const hunger = clamp(n.hunger - HUNGER_PER_MINUTE * minutes), thirst = clamp(n.thirst - THIRST_PER_MINUTE * minutes);
  if (n.health <= 0) return { health: 0, hunger, thirst };
  const starving = hunger <= 0 || thirst <= 0;
  return { health: clamp(n.health + (starving ? -STARVING_PER_MINUTE : HEALING_PER_MINUTE) * minutes), hunger, thirst };
}

const foodPrices = Object.values(MENU_BOARDS).flatMap((m) => m.sections.flatMap((s) => s.items)).filter(([name]) => !isDrinkName(name)).map(([, p]) => Number(p));
const CHEAPEST = Math.min(...foodPrices), DEAREST = Math.max(...foodPrices);

/**
 * What one item does: food fills hunger from 10% (the cheapest anywhere) to 50% (the dearest), in line with its
 * price; a drink gives 5% hunger and 10% thirst; a bottle of water 40% thirst.
 */
export function nutrition(name: string, price: number): { hunger: number; thirst: number } {
  if (isWaterName(name)) return { hunger: 0, thirst: 40 };
  if (isDrinkName(name)) return { hunger: 5, thirst: 10 };
  const k = DEAREST > CHEAPEST ? (price - CHEAPEST) / (DEAREST - CHEAPEST) : 0;
  return { hunger: 10 + 40 * Math.max(0, Math.min(1, k)), thirst: 0 };
}
/** Food can't be eaten on a full stomach, nor a drink drunk when not thirsty at all. */
export function canConsume(n: Needs, name: string) {
  return isDrinkName(name) ? n.thirst < 100 : n.hunger < 100;
}
export function consume(n: Needs, name: string, price: number): Needs {
  const g = nutrition(name, price);
  return { health: n.health, hunger: clamp(n.hunger + g.hunger), thirst: clamp(n.thirst + g.thirst) };
}
