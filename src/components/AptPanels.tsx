import { useEffect, useState } from "react";
import { APT_FLOORS } from "@/game/apartments";
import type { GameState } from "@/game/state";
import { FridgePanel } from "./FridgePanel";
import { shownFloor } from "@/game/Apartments";
import { CLOSET_MAX } from "@/game/life";
import { CANS, CAN_INFO, CAPACITY, mealEffect, type CanKind, type WareKind } from "@/game/pantry";

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
      <div className="elevator-display"><span>{e ? (shownFloor(e, state.simulationTime) === 1 ? "L" : shownFloor(e, state.simulationTime)) : ""}</span><small>{e?.phase === "moving" ? (e.target! > e.floor ? "▲" : "▼") : ""}</small></div>
      <div className="elevator-buttons">
        {Array.from({ length: APT_FLOORS }, (_, k) => APT_FLOORS - k).map((f) => <button key={f} type="button" className={`elevator-button ${e?.floor === f ? "here" : ""} ${home && here && home.building === here && home.floor === f ? "home" : ""}`} onClick={() => press(f)} aria-label={f === 1 ? "Lobby" : `Floor ${f}`}>
          <span>{f === 1 ? "L" : f}</span>
        </button>)}
      </div>
      <p className="elevator-note">{home && here && home.building === here ? `Your floor is ${home.floor} (lit gold).` : "Choose a floor."}</p>
    </div>
    {lock === "closet" && <div className="fridge-wrap"><div className="home-panel" role="dialog" aria-label="Closet">
      <div className="home-panel-head"><b>Closet <small className="closet-count">{state.life.closet.length}/{CLOSET_MAX}</small></b><button type="button" aria-label="Close" onClick={() => { state.uiLock = null; tick((n) => n + 1); }}>✕</button></div>
      {state.life.closet.length > 0
        ? <ul className="phone-list">{state.life.closet.map((c, k) => <li key={k}><span><i className="closet-swatch" style={{ background: c.color }} />{c.name}<small>{c.part === "upper" ? "Top" : "Bottoms"}</small></span></li>)}</ul>
        : <p className="phone-note">No clothes here yet.</p>}
    </div></div>}
    {lock === "fridge" && <div className="fridge-wrap"><FridgePanel state={state} onClose={() => { state.uiLock = null; tick((n) => n + 1); }} /></div>}
    {lock === "rack" && <div className="fridge-wrap"><RackPanel state={state} onClose={() => { state.uiLock = null; tick((n) => n + 1); }} /></div>}
    {lock === "cook" && <div className="fridge-wrap"><CookPanel state={state} onClose={() => { state.uiLock = null; tick((n) => n + 1); }} /></div>}
    {lock === "cupboard" && <div className="cupboard-hint" role="dialog" aria-label="Cupboard"><span>Click a pot or pan to take it</span><button type="button" onClick={() => { state.uiLock = null; tick((n) => n + 1); }}>Close</button></div>}
    <div className={`home-sleep ${lock === "sleep" ? "on" : ""}`}><span>Zzz…</span></div>
  </>;
}

/** The counter beside the sink: take a plate, a bowl, a cup or silverware (one hand each). */
function RackPanel({ state, onClose }: { state: GameState; onClose: () => void }) {
  const k = state.life.kitchen, count = (w: WareKind) => k.rack.filter((x) => x === w).length;
  const take = (w: WareKind) => { state.kitchenAsk = { rack: w }; onClose(); };
  const opts: [WareKind, string, string][] = [["plate", "🍽️", "Plate"], ["bowl", "🥣", "Bowl"], ["cup", "☕", "Cup"], ["glass", "🥛", "Glass"], ["silverware", "🍴", "Silverware"]];
  return <div className="home-panel" role="dialog" aria-label="Counter">
    <div className="home-panel-head"><b>Counter</b><button type="button" onClick={onClose} aria-label="Close">✕</button></div>
    <div className="kitchen-choices">
      {opts.map(([w, icon, name]) => <button key={w} type="button" className="kitchen-choice" disabled={!count(w)} onClick={() => take(w)}>
        <span className="kitchen-icon">{icon}</span><span>{name}</span><small>{count(w)}</small>
      </button>)}
    </div>
  </div>;
}
/** The stove: which cans go in the pot (up to three) or pan (two), from the fridge; then it cooks. */
function CookPanel({ state, onClose }: { state: GameState; onClose: () => void }) {
  const k = state.life.kitchen, burner = state.kitchenAsk?.burner ?? 0, ware = k.stoves[burner]?.ware ?? "pot", cap = CAPACITY[ware];
  const have = CANS.map((c) => ({ c, n: state.life.fridge.filter((f) => f === CAN_INFO[c].name).length })).filter((x) => x.n > 0);
  const [pick, setPick] = useState<CanKind[]>([]);
  const add = (c: CanKind) => { if (pick.length < cap && pick.filter((x) => x === c).length < (have.find((h) => h.c === c)?.n ?? 0)) setPick([...pick, c]); };
  const drop = (i: number) => setPick(pick.filter((_, j) => j !== i));
  const fill = mealEffect(pick.length);
  return <div className="home-panel" role="dialog" aria-label="Cook">
    <div className="home-panel-head"><b>Cook in the {ware}</b><button type="button" onClick={onClose} aria-label="Close">✕</button></div>
    <p className="phone-note">Up to {cap} cans. Takes 30 minutes; take it off within 10 more or it burns.</p>
    <ul className="phone-list">{have.map(({ c, n }) => <li key={c}><span>🥫 {CAN_INFO[c].name} <small>×{n}</small></span><button type="button" className="phone-btn" disabled={pick.length >= cap} onClick={() => add(c)}>Add</button></li>)}</ul>
    <p className="phone-label">In the {ware} · {pick.length}/{cap}</p>
    {pick.length ? <div className="kitchen-picks">{pick.map((c, i) => <button key={i} type="button" className="kitchen-pick" onClick={() => drop(i)}>{CAN_INFO[c].name} ✕</button>)}</div> : <p className="phone-note">Nothing yet.</p>}
    {pick.length > 0 && <p className="phone-note">Fills {Math.round(fill.hunger)}% hunger, +{fill.thirst}% thirst, +{fill.energy}% energy.</p>}
    <button type="button" className="phone-btn" disabled={!pick.length} onClick={() => { state.kitchenAsk = { cans: pick, burner }; onClose(); }}>Open the cans and cook</button>
  </div>;
}
