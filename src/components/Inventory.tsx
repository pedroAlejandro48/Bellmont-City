import { useEffect, useState } from "react";
import { ITEMS } from "@/game/inventory";
import { heldSlotOf, pressInventorySlot } from "@/game/invRuntime";
import type { GameState } from "@/game/state";

/**
 * The inventory: a button on the HUD (beside the cash and level) that opens a 3 × 3 grid. Each slot shows its
 * number key in the corner; pressing the number (or tapping the slot) takes the thing out or puts it away. The
 * thing in hand is outlined; trash in hand shows on the button.
 */
export function InventoryButton({ state }: { state: GameState }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick((n) => n + 1), 150); return () => window.clearInterval(id); }, []);
  const held = heldSlotOf(state), kind = held !== null ? state.life.inventory[held] : null;
  const toggle = () => { state.inventoryOpen = !state.inventoryOpen; if (state.inventoryOpen) state.keys.clear(); tick((n) => n + 1); };
  return <div className="inventory-anchor">
    <button type="button" className={`hud-panel hud-square inventory-button pointer-events-auto ${state.inventoryOpen ? "on" : ""}`} aria-label="Inventory (I)" aria-expanded={state.inventoryOpen} onClick={toggle}>
      <span className="inventory-button-icon" aria-hidden>{state.heldTrash ? (state.heldTrash === "can" ? "🥫" : "🧴") : kind ? ITEMS[kind].icon : <GridIcon />}</span>
      <span>I</span>
    </button>
    {/* All nine slots in a row above the health bars (no panel behind them). */}
    <div className={`inventory-grid pointer-events-auto ${state.inventoryOpen ? "open" : ""}`} role="dialog" aria-label="Inventory" aria-hidden={!state.inventoryOpen}>
      <div className="inventory-slots">
        {state.life.inventory.map((k, i) => <button key={i} type="button" className={`inventory-slot ${held === i ? "held" : ""} ${k ? "" : "empty"}`} aria-label={k ? `${i + 1}: ${ITEMS[k].name}` : `${i + 1}: empty`}
          onClick={() => { pressInventorySlot(state, i); state.inventoryOpen = false; tick((n) => n + 1); }}>
          <span className="inventory-num">{i + 1}</span>
          {k && <span className="inventory-icon" aria-hidden>{ITEMS[k].icon}</span>}
          {k && <span className="inventory-name">{ITEMS[k].name}</span>}
        </button>)}
      </div>
      {state.heldTrash && <p className="inventory-note">Holding an empty {state.heldTrash === "can" ? "can" : "bottle"}: press Q to put it down.</p>}
    </div>
  </div>;
}

function GridIcon() {
  return <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>{[3, 10, 17].flatMap((x) => [3, 10, 17].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="5" height="5" rx="1.2" fill="currentColor" />))}</svg>;
}
