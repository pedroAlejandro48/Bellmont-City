import { useState } from "react";
import { isDrinkName } from "@/game/food";
import { ITEMS } from "@/game/inventory";
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
  const room = (name: string) => (isDrinkName(name) ? fridgeSplit(life.fridge).drinks.length < FRIDGE_DRINKS : fridgeSplit(life.fridge).food.length < FRIDGE_FOOD);
  const store = () => {
    let left = 0;
    for (const h of held) {
      const items = h.items ?? [], kept = items.filter((n) => room(n) && (life.fridge.push(n), true));
      left += items.length - kept.length;
      // The pack itself is used up (what fitted is in the fridge now).
      state.foodSend?.({ type: "trash", pack: h.id, x: state.pos.x, y: -5, z: state.pos.z });
    }
    if (state.groceryBag) {
      const rest: typeof state.groceryBag = [];
      for (const k of state.groceryBag) { const name = ITEMS[k].name; if (room(name)) life.fridge.push(name); else rest.push(k); }
      state.groceryBag = rest.length ? rest : null;
      left += rest.length;
    }
    if (left) toast(state, "The fridge is full", "warn", `${left} thing${left > 1 ? "s" : ""} didn't fit.`);
    tick((n) => n + 1);
  };
  const eat = (name: string) => {
    if (!canConsume(state, name)) { toast(state, isDrinkName(name) ? "Not thirsty" : "You're full", "warn"); return; }
    const after = consume(state, name, foodValue(name));
    state.hunger = after.hunger; state.thirst = after.thirst;
    life.fridge.splice(life.fridge.indexOf(name), 1);
    lifeEvent(state, "eat", 1);
    tick((n) => n + 1);
  };
  const list = (items: string[], verb: string) => items.length === 0 ? <p className="phone-note">Empty.</p> :
    <ul className="phone-list">{items.map((f, i) => <li key={i}><span>{f}</span><button type="button" className="phone-btn" onClick={() => eat(f)}>{verb}</button></li>)}</ul>;
  return <div className="home-panel" role="dialog" aria-label="Fridge">
    <div className="home-panel-head"><b>Fridge</b><button type="button" onClick={onClose} aria-label="Close">✕</button></div>
    <p className="phone-label">Shelves · {food.length}/{FRIDGE_FOOD}</p>
    {list(food, "Eat")}
    <p className="phone-label">Door · {drinks.length}/{FRIDGE_DRINKS}</p>
    {list(drinks, "Drink")}
    <button type="button" className="phone-btn ghost" disabled={!held.length && !state.groceryBag} onClick={store}>Store the food you're carrying</button>
  </div>;
}
