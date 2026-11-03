import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, ShoppingBag, UtensilsCrossed } from "lucide-react";
import { RESTAURANTS, type RestaurantKind } from "@/game/config";
import { menuOf, money, orderTotal, type Mode } from "@/game/food";
import type { GameState } from "@/game/state";

/**
 * The menu at a restaurant counter: it slides up a moment after the cashier says hello. "+" adds an item to the
 * order below, with the running total; Done brings up Take out or Eat here, and choosing one pays.
 */
export function OrderMenu({ state }: { state: GameState }) {
  const [ui, setUi] = useState<{ open: boolean; kind: RestaurantKind | null; key: string | null; note: string | null; cash: number }>({ open: false, kind: null, key: null, note: null, cash: state.cash });
  const [names, setNames] = useState<string[]>([]);
  const [choosing, setChoosing] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => {
      const f = state.foodUi;
      setUi((old) => (old.open === f.open && old.kind === f.kind && old.key === f.key && old.note === f.note && old.cash === state.cash ? old : { open: f.open, kind: f.kind, key: f.key, note: f.note, cash: state.cash }));
    }, 100);
    return () => window.clearInterval(id);
  }, [state]);
  // A fresh order each time the menu comes up.
  useEffect(() => { if (ui.open) { setNames([]); setChoosing(false); } }, [ui.open, ui.key]);

  const kind = ui.kind;
  const sections = useMemo(() => (kind ? menuOf(kind) : []), [kind]);
  const total = kind ? orderTotal(kind, names) : 0;
  const lines = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
    return [...counts];
  }, [names]);
  const short = total > ui.cash + 1e-9;
  const remove = (name: string) => setNames((list) => { const i = list.lastIndexOf(name); return i < 0 ? list : [...list.slice(0, i), ...list.slice(i + 1)]; });
  const place = (mode: Mode) => { if (!names.length || short) return; state.foodOrder = { names, mode }; setChoosing(false); };

  return (
    <div className={`order-menu hud-panel pointer-events-auto ${ui.open && kind ? "open" : ""}`} aria-hidden={!ui.open} aria-label="Menu">
      {kind && <>
        <div className="order-head border-b border-white/10 px-4 pb-2 pt-3">
          <p className="font-display text-lg leading-tight">{RESTAURANTS[kind].name}</p>
          <p className="text-[11px] text-muted-foreground">Tap + to add to your order</p>
        </div>
        <div className="order-menu-list px-2 py-2">
          {sections.map((s) => (
            <div key={s.title} className="mb-2">
              <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{s.title}</p>
              {s.items.map((it) => (
                <div key={it.name} className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-white/5">
                  <button type="button" className="order-plus" aria-label={`Add ${it.name}`} onClick={() => { setNames((list) => [...list, it.name]); setChoosing(false); }}><Plus size={14} strokeWidth={3} /></button>
                  <span className="min-w-0 flex-1 truncate text-sm">{it.name}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">{money(it.price)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="order-summary border-t border-white/10 px-4 py-2">
          <p className="pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Your order</p>
          {lines.length === 0 ? <p className="text-xs text-muted-foreground">Nothing yet.</p> : (
            <ul className="order-lines space-y-0.5">
              {lines.map(([name, count]) => (
                <li key={name} className="flex items-center gap-2 text-sm">
                  <button type="button" className="order-minus" aria-label={`Remove one ${name}`} onClick={() => { remove(name); setChoosing(false); }}><Minus size={12} strokeWidth={3} /></button>
                  <span className="min-w-0 flex-1 truncate">{count > 1 ? `${count} × ` : ""}{name}</span>
                  <span className="tabular-nums">{money(orderTotal(kind, Array(count).fill(name)))}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-1.5 flex justify-between border-t border-white/10 pt-1.5 text-sm font-bold"><span>Total</span><span className="tabular-nums">{money(total)}</span></div>
        </div>
        <div className="order-foot relative flex items-center justify-end gap-3 px-4 pb-3 pt-1">
          {(short || ui.note) && names.length > 0 && <span className="mr-auto text-xs text-accent">Not enough cash</span>}
          <span className="font-display text-lg tabular-nums">{money(total)}</span>
          <div className="relative">
            <div className={`order-choices ${choosing ? "open" : ""}`} aria-hidden={!choosing}>
              <button type="button" className="order-choice" onClick={() => place("togo")} tabIndex={choosing ? 0 : -1}><ShoppingBag size={16} /> Take out</button>
              <button type="button" className="order-choice" onClick={() => place("here")} tabIndex={choosing ? 0 : -1}><UtensilsCrossed size={16} /> Eat here</button>
            </div>
            <button type="button" className="order-done" disabled={!names.length || short} onClick={() => setChoosing((c) => !c)}>Done</button>
          </div>
        </div>
      </>}
    </div>
  );
}
