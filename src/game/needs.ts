// Health, hunger and thirst over time, and what eating and drinking does for them (pure, testable).
import { CYCLE } from "./config";
import { MENU_BOARDS, isDrinkName, isWaterName } from "./food";

/** Thirst runs out over 24 in-game hours, hunger over 48. */
export const THIRST_PER_MINUTE = 100 / (24 * 60);
export const HUNGER_PER_MINUTE = 100 / (48 * 60);
/** With either at zero, health drops 10% an in-game minute; otherwise it heals 1% every 10 in-game minutes. */
export const STARVING_PER_MINUTE = 10;
export const HEALING_PER_MINUTE = 0.1;

/** Energy runs down 75% over an in-game day (three times as fast while running); sleep fills it. */
export const ENERGY_PER_MINUTE = 75 / (24 * 60);
export const RUN_ENERGY_FACTOR = 3;
export type Needs = { health: number; hunger: number; thirst: number; energy?: number };
/** Shop drinks: what one does (juices fill a little too; an energy drink gives energy). */
export const DRINK_EFFECTS: Record<string, { hunger: number; thirst: number; energy: number }> = {
  "Orange Juice": { hunger: 5, thirst: 30, energy: 0 },
  "Apple Juice": { hunger: 5, thirst: 30, energy: 0 },
  "Cola": { hunger: 3, thirst: 25, energy: 5 },
  "Lemon Soda": { hunger: 3, thirst: 25, energy: 5 },
  "Volt Energy": { hunger: 0, thirst: 15, energy: 40 },
};
/** Energy after `minutes` in-game minutes (running uses it faster). */
export function stepEnergy(energy: number, minutes: number, running: boolean) {
  return clamp(energy - ENERGY_PER_MINUTE * minutes * (running ? RUN_ENERGY_FACTOR : 1));
}
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
export function nutrition(name: string, price: number): { hunger: number; thirst: number; energy: number } {
  if (isWaterName(name)) return { hunger: 0, thirst: 40, energy: 0 };
  const d = DRINK_EFFECTS[name];
  if (d) return { ...d };
  if (isDrinkName(name)) return { hunger: 5, thirst: 10, energy: 0 };
  const k = DEAREST > CHEAPEST ? (price - CHEAPEST) / (DEAREST - CHEAPEST) : 0;
  return { hunger: 10 + 40 * Math.max(0, Math.min(1, k)), thirst: 0, energy: 0 };
}
/** Food can't be eaten on a full stomach, nor a drink drunk when not thirsty at all. */
export function canConsume(n: Needs, name: string) {
  if (DRINK_EFFECTS[name]?.energy && (n.energy ?? 100) < 100) return true;
  return isDrinkName(name) ? n.thirst < 100 : n.hunger < 100;
}
export function consume(n: Needs, name: string, price: number): Needs & { energy: number } {
  const g = nutrition(name, price);
  return { health: n.health, hunger: clamp(n.hunger + g.hunger), thirst: clamp(n.thirst + g.thirst), energy: clamp((n.energy ?? 100) + g.energy) };
}

/** Bedtime: from 9 PM to 5 AM. */
export const canSleepAt = (hours: number) => hours >= 21 || hours < 5;
/** Asleep at `elapsed` (game seconds): when one wakes, at 6 AM — the next morning before midnight, that same
 * morning after it (the game's day turns at 6 AM, so either way it's the next 6 AM). */
export function wakeElapsed(elapsed: number) {
  return (Math.floor(elapsed / CYCLE) + 1) * CYCLE + 1;
}
