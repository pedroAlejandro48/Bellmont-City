import { useEffect, useState } from "react";
import { APT_FLOORS } from "@/game/apartments";
import type { GameState } from "@/game/state";
import { FridgePanel } from "./FridgePanel";

/**
 * Panels for life in an apartment building: the elevator's buttons (close up, when inside the car), the fridge,
 * and the night passing while asleep.
 */
export function AptPanels({ state }: { state: GameState }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick((n) => n + 1), 150); return () => window.clearInterval(id); }, []);
  const e = state.elevator, lock = state.uiLock;
  const press = (floor: number) => {
    if (!e || e.phase !== "choose") return;
    state.uiLock = null;
    e.target = floor;
    // The same floor: the doors just stay open and out they go.
    e.phase = floor === e.floor ? "leaving" : "closing"; e.t0 = state.simulationTime;
    tick((n) => n + 1);
  };
  const home = state.life.home, here = e?.building;
  return <>
    <div className={`elevator-panel ${lock === "elevator" && e ? "open" : ""}`} role="dialog" aria-label="Elevator" aria-hidden={lock !== "elevator"}>
      <div className="elevator-display"><span>{e ? e.floor : ""}</span><small>{e?.phase === "moving" ? (e.target! > e.floor ? "▲" : "▼") : ""}</small></div>
      <div className="elevator-buttons">
        {Array.from({ length: APT_FLOORS }, (_, k) => APT_FLOORS - k).map((f) => <button key={f} type="button" className={`elevator-button ${e?.floor === f ? "here" : ""} ${home && here && home.building === here && home.floor === f ? "home" : ""}`} onClick={() => press(f)} aria-label={f === 1 ? "Lobby" : `Floor ${f}`}>
          <span>{f === 1 ? "L" : f}</span>
        </button>)}
      </div>
      <p className="elevator-note">{home && here && home.building === here ? `Your floor is ${home.floor} (lit gold).` : "Choose a floor."}</p>
    </div>
    {lock === "fridge" && <div className="fridge-wrap"><FridgePanel state={state} onClose={() => { state.uiLock = null; tick((n) => n + 1); }} /></div>}
    <div className={`home-sleep ${lock === "sleep" ? "on" : ""}`}><span>Zzz…</span></div>
  </>;
}
