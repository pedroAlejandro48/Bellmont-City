// Inventory pictures, drawn here (not emoji, which look different on every phone and computer): each thing as it
// is — a full bottle with its drink in it, an empty one clear; a can, an empty one crushed and scratched. Empties
// (trash now) carry a little bin in the corner.
import type { ReactElement, ReactNode } from "react";
import { CANDY_INFO, CAN_INFO, type CandyKind, type CanKind } from "@/game/pantry";
import { emptyBase, isTrashKind, itemInfo, type ItemKind, type TrashKind } from "@/game/inventory";

type Drink = { liquid: string; cap: string; label: string; can?: { body: string; band: string } };
const DRINKS: Record<string, Drink> = {
  water: { liquid: "#7cc4f2", cap: "#2f7bd8", label: "#e8f4fb" },
  orangeJuice: { liquid: "#f59a1f", cap: "#f07a12", label: "#fff1d6" },
  appleJuice: { liquid: "#e6c34a", cap: "#4caf3a", label: "#eef8dc" },
  cola: { liquid: "", cap: "", label: "", can: { body: "#c8202a", band: "#f4f4f4" } },
  lemonSoda: { liquid: "", cap: "", label: "", can: { body: "#e8e04a", band: "#3f9a3a" } },
  energy: { liquid: "", cap: "", label: "", can: { body: "#1d1f26", band: "#7dff3a" } },
};

const Svg = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 48 48" width="1em" height="1em" aria-hidden style={{ display: "block", overflow: "visible" }}>{children}</svg>;

/** A bottle: its drink up to the shoulder (full), or clear inside with a dent (empty). */
function Bottle({ d, full }: { d: Drink; full: boolean }) {
  return <>
    <rect x="20" y="3" width="8" height="5" rx="1.5" fill={full ? d.cap : "#9aa3ab"} />
    <path d="M20 8h8v4c0 2 5 3 5 8v22a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3V20c0-5 5-6 5-8z" fill={full ? "rgba(220,240,250,0.35)" : "rgba(220,235,245,0.18)"} stroke="#cfe3ef" strokeWidth="1.6" />
    {full && <path d="M16.6 21h14.8v21a1.6 1.6 0 0 1-1.6 1.6H18.2a1.6 1.6 0 0 1-1.6-1.6z" fill={d.liquid} />}
    <rect x="15.8" y="26" width="16.4" height="8" fill={full ? d.label : "rgba(255,255,255,0.35)"} opacity={full ? 0.95 : 0.6} />
    {!full && <path d="M16 30l4 2-3 3" fill="none" stroke="#cfe3ef" strokeWidth="1.3" />}
    <path d="M19 14c-1 2-1.5 4-1.5 6" stroke="#fff" strokeOpacity="0.7" strokeWidth="1.4" fill="none" />
  </>;
}
/** A can: round with its band and ring pull (full), or crushed in the middle, faded and scratched (empty). */
function Can({ c, full }: { c: { body: string; band: string }; full: boolean }) {
  if (full) return <>
    <path d="M13 9c0-2 22-2 22 0v31c0 3-22 3-22 0z" fill={c.body} />
    <rect x="13" y="21" width="22" height="7" fill={c.band} />
    <ellipse cx="24" cy="9" rx="11" ry="3" fill="#c9ced3" stroke="#8d949b" strokeWidth="1" />
    <ellipse cx="26" cy="8.6" rx="3" ry="1.3" fill="none" stroke="#6f767d" strokeWidth="1" />
    <path d="M16 12v26" stroke="#fff" strokeOpacity="0.35" strokeWidth="2" />
  </>;
  const shape = "M12 10c0-2 24-2 24 0l-4 12 5 4-3 14c0 3-20 3-20 0l-3-14 5-4z";
  return <g transform="rotate(-12 24 26)">
    <path d={shape} fill={c.body} opacity="0.75" />
    <path d={shape} fill="#6f767d" opacity="0.35" />
    <path d="M13 24l5 2 5-3 5 3 5-2" fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="1.6" />
    <ellipse cx="24" cy="10" rx="12" ry="3" fill="#aeb4b9" stroke="#80878d" strokeWidth="1" />
    <path d="M17 31l6 3M25 33l5-4M19 37l4-1M27 15l-4 4" stroke="rgba(255,255,255,0.6)" strokeWidth="1" />
  </g>;
}
/** The little bin on an empty: it's trash now. */
const TrashBadge = () => <g transform="translate(30 28)">
  <circle cx="8" cy="8" r="9" fill="#3a3f47" stroke="#fff" strokeWidth="1.5" />
  <path d="M4 5.5h8M6.5 5.5V4h3v1.5M5 7h6l-.7 6.5H5.7z" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
</g>;
function drinkIcon(kind: string, full: boolean) {
  const d = DRINKS[kind]!;
  return d.can ? <Can c={d.can} full={full} /> : <Bottle d={d} full={full} />;
}

const FRUIT: Record<string, () => ReactElement> = {
  apple: () => <><path d="M24 14c-8-5-17 0-15 12 2 11 9 17 15 14 6 3 13-3 15-14 2-12-7-17-15-12z" fill="#d93a2e" /><path d="M24 14c0-4 1-7 3-9" stroke="#6b4423" strokeWidth="2.4" fill="none" strokeLinecap="round" /><path d="M26 10c4-4 9-3 10-1-3 3-7 3-10 1z" fill="#4caf3a" /><ellipse cx="16" cy="22" rx="3" ry="5" fill="#fff" opacity="0.3" /></>,
  banana: () => <><path d="M8 14c3 16 18 26 34 20-3 4-12 9-22 5S5 24 6 12z" fill="#f3d23b" stroke="#c9a520" strokeWidth="1.2" /><path d="M6 12l-1-4 3 0z" fill="#6b4423" /><path d="M42 34l3 1-2 2z" fill="#4a3a1a" /></>,
  orange: () => <><circle cx="24" cy="27" r="16" fill="#f28a1a" /><circle cx="18" cy="21" r="4" fill="#fff" opacity="0.25" />{[[28, 30], [20, 32], [30, 22], [24, 36], [16, 27]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="0.9" fill="#d06d0a" />)}<path d="M24 11c3-4 8-4 9-2-3 3-6 3-9 2z" fill="#4caf3a" /></>,
  pear: () => <><path d="M24 8c-4 0-5 5-5 9 0 4-8 7-8 16 0 8 6 12 13 12s13-4 13-12c0-9-8-12-8-16 0-4-1-9-5-9z" fill="#b5c94a" /><path d="M24 8c0-3 1-5 2-6" stroke="#6b4423" strokeWidth="2" fill="none" /><ellipse cx="18" cy="32" rx="2.5" ry="5" fill="#fff" opacity="0.25" /></>,
  kiwi: () => <><ellipse cx="20" cy="26" rx="14" ry="12" fill="#7a5a33" /><circle cx="30" cy="27" r="11" fill="#7a5a33" /><circle cx="30" cy="27" r="9" fill="#8dc63f" /><circle cx="30" cy="27" r="3.2" fill="#f4f1c9" />{Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2; return <circle key={i} cx={30 + Math.cos(a) * 5} cy={27 + Math.sin(a) * 5} r="0.8" fill="#222" />; })}</>,
  plum: () => <><ellipse cx="24" cy="28" rx="14" ry="15" fill="#5b2a5e" /><path d="M24 14c1 8 1 20-1 28" stroke="#3e1a40" strokeWidth="1.2" fill="none" /><ellipse cx="18" cy="23" rx="3" ry="5" fill="#fff" opacity="0.22" /><path d="M24 13c0-3 1-5 3-6" stroke="#6b4423" strokeWidth="1.8" fill="none" /></>,
  grape: () => <><path d="M24 6v6" stroke="#6b4423" strokeWidth="2" />{[[18, 14], [26, 14], [34, 15], [14, 21], [22, 21], [30, 21], [18, 28], [26, 28], [34, 27], [22, 35], [30, 34], [26, 41]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4.6" fill="#6b2d6b" stroke="#4a1d4a" strokeWidth="0.8" />)}<path d="M26 10c4-3 9-2 10 0-3 3-7 2-10 0z" fill="#4caf3a" /></>,
  peach: () => <><circle cx="24" cy="27" r="16" fill="#f6a57a" /><path d="M24 11c-3 8-3 22 0 32" stroke="#e07c55" strokeWidth="1.5" fill="none" /><circle cx="17" cy="24" r="7" fill="#f27a5a" opacity="0.45" /><path d="M24 11c3-4 8-4 9-2-3 3-6 3-9 2z" fill="#4caf3a" /></>,
};
function cannedFood(k: CanKind) {
  const c = CAN_INFO[k];
  return <>
    <rect x="11" y="12" width="26" height="28" rx="2" fill={c.label} stroke="#7d848b" strokeWidth="1" />
    <rect x="11" y="16" width="26" height="5" fill={c.band} />
    <circle cx="24" cy="30" r="5" fill={c.food[1]} stroke={c.food[0]} strokeWidth="1.5" />
    <ellipse cx="24" cy="12" rx="13" ry="3" fill="#c9ced3" stroke="#8d949b" strokeWidth="1" />
    <ellipse cx="24" cy="40" rx="13" ry="2.5" fill="#9aa1a7" />
  </>;
}
function candy(k: CandyKind) {
  const c = CANDY_INFO[k];
  switch (c.shape) {
    case "bar": return <><rect x="6" y="17" width="36" height="14" rx="2" fill={c.wrap} /><path d="M6 17l-3 3v8l3 3M42 17l3 3v8l-3 3" fill={c.wrap} opacity="0.8" /><rect x="14" y="21" width="20" height="6" rx="1" fill={c.ink} opacity="0.9" /></>;
    case "bag": return <><path d="M12 8h24l-2 4c4 8 4 20 0 28l2 4H12l2-4c-4-8-4-20 0-28z" fill={c.wrap} /><circle cx="24" cy="26" r="6" fill={c.ink} /></>;
    case "pop": return <><rect x="23" y="24" width="2.4" height="20" rx="1" fill="#f2f2ee" /><circle cx="24" cy="16" r="12" fill={c.wrap} /><path d="M16 16a8 8 0 0 1 16 0a5 5 0 0 1-10 0a2 2 0 0 1 4 0" fill="none" stroke={c.ink} strokeWidth="2" /></>;
    case "tin": return <><ellipse cx="24" cy="30" rx="16" ry="9" fill="#9aa1a7" /><ellipse cx="24" cy="26" rx="16" ry="9" fill={c.wrap} /><ellipse cx="24" cy="26" rx="9" ry="4.5" fill={c.ink} opacity="0.85" /></>;
    case "cups": return <><path d="M8 14h32l-3 20c-1 4-25 4-26 0z" fill={c.wrap} /><circle cx="18" cy="24" r="5" fill="#a0602a" /><circle cx="30" cy="24" r="5" fill="#a0602a" /></>;
  }
}
const WARE: Record<string, () => ReactElement> = {
  pot: () => <><rect x="9" y="17" width="30" height="22" rx="3" fill="#b9c0c6" stroke="#7d848b" /><rect x="5" y="19" width="5" height="3" rx="1.5" fill="#3a3f47" /><rect x="38" y="19" width="5" height="3" rx="1.5" fill="#3a3f47" /><ellipse cx="24" cy="17" rx="15" ry="3" fill="#8d949b" /></>,
  pan: () => <><ellipse cx="19" cy="26" rx="14" ry="9" fill="#2f3339" /><ellipse cx="19" cy="25" rx="11" ry="6.5" fill="#454a52" /><rect x="31" y="23" width="15" height="4" rx="2" fill="#2f3339" transform="rotate(-10 31 25)" /></>,
  plate: () => <><ellipse cx="24" cy="27" rx="20" ry="10" fill="#f4f4f0" stroke="#c9cdd1" /><ellipse cx="24" cy="26" rx="12" ry="5.5" fill="#e6e8e9" /></>,
  bowl: () => <><path d="M6 20h36c0 12-8 18-18 18S6 32 6 20z" fill="#f4f4f0" stroke="#c9cdd1" /><ellipse cx="24" cy="20" rx="18" ry="4" fill="#e1e4e6" /></>,
  cup: () => <><path d="M10 14h24v18a8 8 0 0 1-8 8h-8a8 8 0 0 1-8-8z" fill="#f4f4f0" stroke="#c9cdd1" /><path d="M34 18h3a5 5 0 0 1 0 10h-3" fill="none" stroke="#c9cdd1" strokeWidth="3" /></>,
  glass: () => <><path d="M13 8h22l-3 34H16z" fill="rgba(200,230,245,0.35)" stroke="#cfe3ef" strokeWidth="1.6" /><path d="M17 12l-1 24" stroke="#fff" strokeOpacity="0.6" strokeWidth="1.5" /></>,
  silverware: () => <><path d="M14 6v14M11 6v8a3 3 0 0 0 6 0V6M14 20v22" stroke="#c9ced3" strokeWidth="2.4" fill="none" strokeLinecap="round" /><path d="M24 6c4 0 4 14 0 16v20" stroke="#c9ced3" strokeWidth="2.6" fill="none" strokeLinecap="round" /><ellipse cx="34" cy="12" rx="4" ry="6" fill="#c9ced3" /><path d="M34 18v24" stroke="#c9ced3" strokeWidth="2.6" strokeLinecap="round" /></>,
};
const phone = () => <><rect x="13" y="4" width="22" height="40" rx="4" fill="#1d2026" stroke="#5a606a" /><rect x="15.5" y="8" width="17" height="30" rx="1.5" fill="#2f7bd8" /><circle cx="24" cy="41" r="1.4" fill="#5a606a" /></>;
const key = () => <><circle cx="15" cy="17" r="9" fill="none" stroke="#d9b44a" strokeWidth="4" /><path d="M21 23l18 18M33 35l4-4M37 39l4-4" stroke="#d9b44a" strokeWidth="4" strokeLinecap="round" /></>;
const mealFood = () => <><path d="M8 20h32l-4 20H12z" fill="#f2f2ee" stroke="#c94a2e" strokeWidth="1.5" /><path d="M8 20l6-8h20l6 8" fill="#c94a2e" /><path d="M16 28h16" stroke="#c94a2e" strokeWidth="2" /></>;
const mealDrink = () => <><path d="M13 12h22l-3 32H16z" fill="#f2f2ee" stroke="#c94a2e" strokeWidth="1.5" /><rect x="11" y="9" width="26" height="4" rx="1.5" fill="#c94a2e" /><path d="M26 9l4-7" stroke="#e23b3b" strokeWidth="2.4" /><rect x="14" y="24" width="20" height="6" fill="#c94a2e" opacity="0.85" /></>;

/** The picture of a thing (an inventory item, or an empty in hand). */
export function ItemIcon({ kind }: { kind: ItemKind | TrashKind }) {
  if (isTrashKind(kind)) return <Svg>{drinkIcon(emptyBase(kind), false)}<TrashBadge /></Svg>;
  const k = kind as string;
  if (DRINKS[k]) return <Svg>{drinkIcon(k, true)}</Svg>;
  if (FRUIT[k]) return <Svg>{FRUIT[k]!()}</Svg>;
  if (k in CAN_INFO) return <Svg>{cannedFood(k as CanKind)}</Svg>;
  if (k in CANDY_INFO) return <Svg>{candy(k as CandyKind)}</Svg>;
  if (WARE[k]) return <Svg>{WARE[k]!()}</Svg>;
  if (k === "phone") return <Svg>{phone()}</Svg>;
  if (k === "key") return <Svg>{key()}</Svg>;
  if (k.startsWith("meal:")) return <Svg>{itemInfo(kind as ItemKind).use === "drink" ? mealDrink() : mealFood()}</Svg>;
  return <Svg><circle cx="24" cy="24" r="14" fill="#8d949b" /></Svg>;
}
