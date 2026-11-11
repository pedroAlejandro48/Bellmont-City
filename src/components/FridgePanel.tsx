import { useState } from "react";
import { isDrinkName } from "@/game/food";
import { ITEMS } from "@/game/inventory";
import { canByName, isWare } from "@/game/pantry";
import { lifeEvent } from "@/game/lifeRuntime";
import { canConsume, consume } from "@/game/needs";
import { foodValue } from "@/game/shops";
import { toast, type GameState } from "@/game/state";

/** The fridge holds 15 things to eat on its shelves and 9 drinks in its door. */
export const FRIDGE_FOOD = 15, FRIDGE_DRINKS = 9;
export const fridgeSplit = (list: string[]) => ({ food: list.filter((n) => !isDrinkName(n)), drinks: list.filter((n) => isDrinkName(n)) });

/** The fridge in the apartment's kitchen: what's on its shelves and in its door (eat or drink one), and storing what
 * you carry — food on the shelves, drinks in the door, as long as there's room. */
export function FridgePanel({ state, onClose }: { state: GameState; onClose: () => void }) {
  const [, tick] = useState(0), life = state.life;
  const held = (["left", "right"] as const).map((h) => state.hands[h]).filter((h): h is NonNullable<typeof h> => !!h && (h.items?.length ?? 0) > 0);
  const { food, drinks } = fridgeSplit(life.fridge);
  // Room counts what's already on its way in.
  const room = (name: string) => {
    const all = [...life.fridge, ...state.fridgeLoad.map((l) => l.name)], split = fridgeSplit(all);
    return isDrinkName(name) ? split.drinks.length < FRIDGE_DRINKS : split.food.length < FRIDGE_FOOD;
  };
  // Storing: the character puts each thing in by hand (Apartments), food on the shelves, drinks in the door.
  const store = () => {
    let left = 0;
    for (const h of held) {
      const items = h.items ?? [];
      for (const n of items) { if (room(n)) state.fridgeLoad.push({ name: n, bag: null }); else left++; }
      // The pack itself is used up (what fitted goes in the fridge).
      state.foodSend?.({ type: "trash", pack: h.id, x: state.pos.x, y: -5, z: state.pos.z });
    }
    if (state.groceryBag) {
      // Taken out of the bag one at a time as they go in (what doesn't fit stays in it).
      // (Kitchenware isn't food: it stays in the bag, to be put away by the sink.)
      for (const k of state.groceryBag) { if (isWare(k)) continue; const name = ITEMS[k].name; if (room(name)) state.fridgeLoad.push({ name, bag: k }); else left++; }
    }
    if (left) toast(state, "The fridge is full", "warn", `${left} thing${left > 1 ? "s" : ""} didn't fit.`);
    tick((n) => n + 1);
  };
  const loading = state.fridgeLoad.length > 0;
  const eat = (name: string) => {
    if (!canConsume(state, name)) { toast(state, isDrinkName(name) ? "Not thirsty" : "You're full", "warn"); return; }
    const after = consume(state, name, foodValue(name));
    state.hunger = after.hunger; state.thirst = after.thirst; state.energy = after.energy; state.health = after.health;
    life.fridge.splice(life.fridge.indexOf(name), 1);
    lifeEvent(state, "eat", 1);
    tick((n) => n + 1);
  };
  const list = (items: string[], verb: string) => items.length === 0 ? <p className="phone-note">Empty.</p> :
    <ul className="phone-list">{items.map((f, i) => <li key={i}><span>{canByName(f) ? `🥫 ${f}` : f}</span>{canByName(f) ? <span className="phone-note">Cook it on the stove</span> : <button type="button" className="phone-btn" onClick={() => eat(f)}>{verb}</button>}</li>)}</ul>;
  return <div className="home-panel" role="dialog" aria-label="Fridge">
    <div className="home-panel-head"><b>Fridge</b><button type="button" onClick={onClose} aria-label="Close">✕</button></div>
    <p className="phone-label">Shelves · {food.length}/{FRIDGE_FOOD}</p>
    {list(food, "Eat")}
    <p className="phone-label">Door · {drinks.length}/{FRIDGE_DRINKS}</p>
    {list(drinks, "Drink")}
    <button type="button" className="phone-btn ghost" disabled={loading || (!held.length && !state.groceryBag?.some((k) => !isWare(k)))} onClick={store}>{loading ? "Putting it away…" : "Store the food you're carrying"}</button>
  </div>;
}
