import { useState } from "react";
import { isDrinkName } from "@/game/food";
import { ITEMS } from "@/game/inventory";
import { lifeEvent } from "@/game/lifeRuntime";
import { canConsume, consume } from "@/game/needs";
import { foodValue } from "@/game/shops";
import { toast, type GameState } from "@/game/state";

/** The fridge in the apartment's kitchen: what's in it (eat or drink one), and storing what you carry. */
export function FridgePanel({ state, onClose }: { state: GameState; onClose: () => void }) {
  const [, tick] = useState(0), life = state.life;
  const held = (["left", "right"] as const).map((h) => state.hands[h]).filter((h): h is NonNullable<typeof h> => !!h && (h.items?.length ?? 0) > 0);
  const store = () => {
    for (const h of held) {
      life.fridge.push(...(h.items ?? []));
      // The pack itself is used up (its contents are in the fridge now).
      state.foodSend?.({ type: "trash", pack: h.id, x: state.pos.x, y: -5, z: state.pos.z });
    }
    // A bag of groceries empties into the fridge too (what doesn't fit stays in the bag).
    if (state.groceryBag) {
      while (state.groceryBag.length && life.fridge.length < 12) life.fridge.push(ITEMS[state.groceryBag.shift()!].name);
      if (!state.groceryBag.length) state.groceryBag = null;
    }
    life.fridge = life.fridge.slice(0, 12);
    tick((n) => n + 1);
  };
  const eat = (i: number) => {
    const name = life.fridge[i]!;
    if (!canConsume(state, name)) { toast(state, isDrinkName(name) ? "Not thirsty" : "You're full", "warn"); return; }
    const after = consume(state, name, foodValue(name));
    state.hunger = after.hunger; state.thirst = after.thirst;
    life.fridge.splice(i, 1);
    lifeEvent(state, "eat", 1);
    tick((n) => n + 1);
  };
  return <div className="home-panel" role="dialog" aria-label="Fridge">
    <div className="home-panel-head"><b>Fridge</b><button type="button" onClick={onClose} aria-label="Close">✕</button></div>
    {life.fridge.length === 0 ? <p className="phone-note">Empty. Bring food home and store it here.</p> :
      <ul className="phone-list">{life.fridge.map((f, i) => <li key={i}><span>{f}</span><button type="button" className="phone-btn" onClick={() => eat(i)}>{isDrinkName(f) ? "Drink" : "Eat"}</button></li>)}</ul>}
    <button type="button" className="phone-btn ghost" disabled={(!held.length && !state.groceryBag) || life.fridge.length >= 12} onClick={store}>Store the food you're carrying</button>
    <small className="phone-note">Holds 12 things.</small>
  </div>;
}
