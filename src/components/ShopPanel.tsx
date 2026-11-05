import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { timeInfo } from "@/game/config";
import { isDrinkName } from "@/game/food";
import { FINE_DAYS, HEALTH_PLAN, HOME_NAME, finesOwed, gainSkill, gainXp, moveOut, payFines, record, rentApartment, spend } from "@/game/life";
import { APT_FLOORS, freeFloors, rentFor } from "@/game/apartments";
import { guideDone, lifeEvent, payJob } from "@/game/lifeRuntime";
import { canConsume, consume } from "@/game/needs";
import { GROCERIES, OUTFITS, OUTFIT_PRICE, PAINTS, PAINT_PRICE, SHOPS, TREATMENT_PRICE, WORKOUT_PRICE, clerkPay, foodValue, shopPlaces } from "@/game/shops";
import { toast, type GameState } from "@/game/state";
import { giveItem } from "@/game/invRuntime";

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * The counter of the shop the player is at (state.shop): slides up from the bottom, closes with ✕, Escape or by
 * walking away. Payment is cash first, then the bank card.
 */
export function ShopPanel({ state }: { state: GameState }) {
  const [, tick] = useState(0);
  const refresh = () => tick((n) => n + 1);
  const shown = useRef<typeof state.shop>(null);
  const places = useMemo(() => shopPlaces(state.worldSeed), [state.worldSeed]);
  useEffect(() => {
    const id = window.setInterval(() => {
      // Leaving the building closes it.
      if (state.shop && state.interior?.phase !== "inside") state.shop = null;
      if (state.shop) shown.current = state.shop;
      refresh();
    }, 200);
    return () => window.clearInterval(id);
  }, [state, places]);
  const kind = state.shop ?? shown.current;
  const close = () => { state.shop = null; refresh(); };
  if (!kind) return null;
  const shop = SHOPS[kind];
  return <div className={`shop-panel ${state.shop ? "open" : ""}`} role="dialog" aria-label={shop.name} aria-hidden={!state.shop}>
    <div className="shop-head" style={{ background: shop.color === "#ffffff" ? "#d62f3a" : shop.color }}>
      <div><b>{shop.name}</b><small>{shop.blurb}</small></div>
      <button type="button" aria-label="Close" onClick={close}><X size={18} /></button>
    </div>
    <div className="shop-wallet"><span>Cash <b>{money(state.cash)}</b></span><span>Bank <b>{money(state.life.bank)}</b></span></div>
    <div className="phone-body shop-body">
      {kind === "grocery" && <Grocery state={state} refresh={refresh} />}
      {kind === "clothing" && <Swatches state={state} refresh={refresh} what="outfit" />}
      {kind === "bikes" && <Swatches state={state} refresh={refresh} what="paint" />}
      {kind === "gym" && <Gym state={state} refresh={refresh} />}
      {kind === "hospital" && <Hospital state={state} refresh={refresh} />}
      {kind === "police" && <Police state={state} refresh={refresh} />}
      {kind === "apartments" && <Reception state={state} refresh={refresh} />}
    </div>
  </div>;
}

type Props = { state: GameState; refresh: () => void };
const today = (state: GameState) => timeInfo(state.elapsed).day;
function pay(state: GameState, amount: number, label: string) {
  const r = spend(state.life, state.cash, amount, today(state), label);
  if (!r.ok) { toast(state, "Not enough money", "warn", `${label} costs ${money(amount)}.`); return false; }
  state.cash = r.cash;
  return true;
}

function Grocery({ state, refresh }: Props) {
  const [shift, setShift] = useState(false);
  const life = state.life, home = !!life.home, full = life.fridge.length >= 12;
  if (shift) return <ClerkShift state={state} onDone={() => { setShift(false); refresh(); }} />;
  return <>
    <p className="phone-note">Take what you want from the crates and shelves with your basket (E), then bring it here and press E to pay. Fruit and water go in your inventory from the bag (number keys).</p>
    <p className="phone-label">Work here</p>
    <div className="phone-job"><div><b>Shop clerk</b> <small>J10</small><p>Restock the shelves for 40 seconds. Paid per shelf filled.</p></div>
      <button type="button" className="phone-btn" disabled={!!state.job} title={state.job ? "Finish your current job first" : ""} onClick={() => setShift(true)}>Work a shift</button></div>
  </>;
}

const SHIFT = 40, SLOTS = 12;
/** The clerk's shift: shelves run empty one by one; tap an empty one to restock it before it's gone too long. */
function ClerkShift({ state, onDone }: { state: GameState; onDone: () => void }) {
  const [empty, setEmpty] = useState<number[]>([]);
  const [stocked, setStocked] = useState(0);
  const [left, setLeft] = useState(SHIFT);
  const done = useRef(false);
  useEffect(() => {
    const start = performance.now();
    const id = window.setInterval(() => {
      const t = (performance.now() - start) / 1000, l = Math.max(0, SHIFT - t);
      setLeft(l);
      // Shelves empty faster as the shift goes on (up to five empty at once).
      setEmpty((e) => {
        if (e.length >= 5 || Math.random() > 0.18 + t * 0.006) return e;
        const free = Array.from({ length: SLOTS }, (_, i) => i).filter((i) => !e.includes(i));
        return [...e, free[Math.floor(Math.random() * free.length)]!];
      });
      if (l <= 0 && !done.current) { done.current = true; window.clearInterval(id); }
    }, 100);
    return () => window.clearInterval(id);
  }, []);
  const finished = left <= 0;
  const collect = () => {
    const pay = clerkPay(stocked);
    payJob(state, "clerk", "Shop clerk shift", pay, 0);
    onDone();
  };
  return <>
    <div className="clerk-top"><b>{finished ? "Shift over!" : `${Math.ceil(left)} s left`}</b><span>{stocked} shelves restocked</span></div>
    <div className="phone-bar"><i style={{ width: `${(100 * left) / SHIFT}%` }} /></div>
    <div className="clerk-grid">{Array.from({ length: SLOTS }, (_, i) => {
      const isEmpty = empty.includes(i);
      return <button key={i} type="button" disabled={finished || !isEmpty} className={`clerk-shelf ${isEmpty ? "empty" : ""}`} aria-label={isEmpty ? "Restock this shelf" : "Stocked shelf"}
        onClick={() => { setEmpty((e) => e.filter((x) => x !== i)); setStocked((n) => n + 1); }}>
        <span>{["🍎", "🥖", "🥗", "🍝", "💧", "🧃"][i % 6]}</span>
      </button>;
    })}</div>
    {finished ? <button type="button" className="phone-btn" onClick={collect}>Collect {money(clerkPay(stocked))} pay</button>
      : <p className="phone-note">Tap the empty shelves to restock them.</p>}
  </>;
}

function Swatches({ state, refresh, what }: Props & { what: "outfit" | "paint" }) {
  const life = state.life, list = what === "outfit" ? OUTFITS : PAINTS, price = what === "outfit" ? OUTFIT_PRICE : PAINT_PRICE;
  const current = what === "outfit" ? life.outfit : life.bikePaint;
  return <>
    <p className="phone-label">{what === "outfit" ? "Outfit colour" : "Bike paint"} · {money(price)}</p>
    <div className="swatches">{list.map((c) => <button key={c} type="button" className={`swatch ${current === c ? "on" : ""}`} style={{ background: c }} aria-label={`Colour ${c}`}
      onClick={() => {
        if (current === c) return;
        if (!pay(state, price, what === "outfit" ? "New outfit" : "Bike paint")) return;
        if (what === "outfit") life.outfit = c; else life.bikePaint = c;
        toast(state, what === "outfit" ? "Looking sharp!" : "Fresh paint!", "money");
        refresh();
      }} />)}</div>
    {current && <button type="button" className="phone-btn ghost" onClick={() => { if (what === "outfit") life.outfit = null; else life.bikePaint = null; refresh(); }}>Back to the original (free)</button>}
    <p className="phone-note">{what === "outfit" ? "Your colour shows on your character everywhere you play." : "Paint goes on your own bike."}</p>
  </>;
}

function Gym({ state, refresh }: Props) {
  const life = state.life, done = life.workoutDay === today(state);
  const [busy, setBusy] = useState(false);
  return <>
    <div className="bank-card" style={{ background: "linear-gradient(135deg,#33363f,#5a5f6b)" }}><span>Fitness</span><b>{Math.round(life.skills.fitness)} pts</b><span>Each fitness level makes you run 2.5% faster.</span></div>
    <button type="button" className={`phone-btn ${busy ? "working" : ""}`} disabled={done || busy || state.hunger < 10 || state.thirst < 10} onClick={() => {
      if (!pay(state, WORKOUT_PRICE, "Gym session")) return;
      setBusy(true);
      window.setTimeout(() => {
        life.workoutDay = today(state); gainSkill(life, "fitness", 60);
        const up = gainXp(life, 20); if (up) toast(state, `Level ${up}!`, "level");
        state.hunger = Math.max(0, state.hunger - 8); state.thirst = Math.max(0, state.thirst - 12);
        toast(state, "Great workout!", "info", "+60 fitness · +20 XP. You're hungry and thirsty now.");
        setBusy(false); refresh();
      }, 2500);
    }}>{busy ? "Working out…" : done ? "Come back tomorrow" : `Work out · ${money(WORKOUT_PRICE)}`}</button>
    <p className="phone-note">One session a day. Running anywhere trains fitness too.</p>
  </>;
}

function Hospital({ state, refresh }: Props) {
  const life = state.life, cost = life.insured ? 0 : TREATMENT_PRICE;
  return <>
    <div className="phone-stat"><span>Health</span><b className={state.health < 50 ? "bad" : "good"}>{Math.round(state.health)}%</b></div>
    <button type="button" className="phone-btn" disabled={state.health >= 99.5} onClick={() => {
      if (cost > 0 && !pay(state, cost, "Hospital treatment")) return;
      if (cost === 0) record(life, today(state), "Hospital treatment (insured)", 0);
      state.health = 100; toast(state, "You feel much better", "info", "Health is full."); refresh();
    }}>Get treated · {cost ? money(cost) : "free with your plan"}</button>
    <p className="phone-label">Health plan (B9)</p>
    <div className="phone-job"><div><b>{life.insured ? "You're covered" : "Bellmont Care"}</b><p>{money(HEALTH_PLAN)} a day from your bank. Treatment is free while it's on.</p></div>
      <button type="button" className={`phone-btn ${life.insured ? "ghost" : ""}`} onClick={() => { life.insured = !life.insured; toast(state, life.insured ? "Health plan started" : "Health plan cancelled", "info"); refresh(); }}>{life.insured ? "Cancel" : "Sign up"}</button></div>
  </>;
}

/** The apartment building's reception: which floors are free today (higher ones cost less), renting one. */
function Reception({ state, refresh }: Props) {
  const life = state.life, day = today(state), building = state.interior?.key ?? "";
  const free = freeFloors(state.worldSeed, building, day), home = life.home;
  const mineHere = home?.building === building;
  return <>
    {mineHere && home && <div className="bank-card home"><span>You live here</span><b>Floor {home.floor}</b><span>{money(home.weekly)} a week · next payment on day {home.nextRent}</span></div>}
    {mineHere && <p className="phone-note">Take the elevator (in the corner) to your floor; hold your key (its number) at your door.</p>}
    <p className="phone-label">{HOME_NAME}s · free floors today</p>
    <p className="phone-note">The first week is free; then the week's rent comes out of your bank every seven days. Higher floors cost less. Which floors are free changes every two days.</p>
    <ul className="phone-list">{Array.from({ length: APT_FLOORS - 1 }, (_, k) => APT_FLOORS - k).map((f) => {
      const open = free.includes(f) && !(mineHere && home?.floor === f);
      return <li key={f} className={open ? "" : "taken"}>
        <span>Floor {f}<small>{money(rentFor(f))} a week{mineHere && home?.floor === f ? " · yours" : open ? "" : " · taken"}</small></span>
        <button type="button" className="phone-btn" disabled={!open} onClick={() => {
          if (home && !mineHere && !window.confirm(`Move out of your apartment on floor ${home.floor} elsewhere?`)) return;
          if (home) moveOut(life, day);
          const r = rentApartment(life, building, f, rentFor(f), day);
          if (r === "full") { toast(state, "No room for the key", "warn", "Make space in your inventory first."); return; }
          toast(state, "Welcome home!", "money", `Floor ${f}. Your key is in your inventory. The first week is free.`);
          guideDone(state, 4); refresh();
        }}>Rent</button>
      </li>;
    })}</ul>
    {mineHere && <button type="button" className="phone-btn ghost" onClick={() => { if (window.confirm("Move out and hand back your key?")) { moveOut(life, day); toast(state, "You moved out", "info"); refresh(); } }}>Move out</button>}
  </>;
}

function Police({ state, refresh }: Props) {
  const life = state.life, owed = finesOwed(life), day = today(state);
  return <>
    <div className="phone-stat"><span>Criminal record</span><b className={life.record ? "bad" : "good"}>{life.record ? `${life.record} conviction${life.record > 1 ? "s" : ""}` : "Clean"}</b></div>
    <p className="phone-label">Unpaid tickets</p>
    {life.fines.length === 0 ? <p className="phone-note">Nothing to pay. Ride under 30 mph and stop at red lights to keep it that way.</p> :
      <ul className="phone-list">{life.fines.map((f, i) => <li key={i}><span>{f.reason}<small>Day {f.day} · due by day {f.day + FINE_DAYS}</small></span><b className="bad">{money(f.amount)}</b></li>)}</ul>}
    <button type="button" className="phone-btn" disabled={owed <= 0 || life.bank < owed} onClick={() => { if (payFines(life, day)) toast(state, "Fines paid", "money", "Thank you. Ride safe!"); refresh(); }}>Pay {money(owed)} from the bank</button>
    <p className="phone-note">Tickets not paid within {FINE_DAYS} days go on your loan with 25% extra and on your record, which lowers what the bank will lend.</p>
  </>;
}
