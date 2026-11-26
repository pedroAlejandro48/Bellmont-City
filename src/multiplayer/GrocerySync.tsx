// The grocery shared across a room: whoever runs the room's shared things (host.ts) runs the shopper walking in
// and sends it (presence `groc`) each time it starts a new part of its visit; everyone else plays the same moves
// from the same start. Each player also sends their own checkout while the clerk is bagging for them (presence
// `gco`: when the basket went down, and what's in it), so everyone sees the clerk serve everyone, and nobody
// is served while someone else is.
import { useEffect } from "react";
import type { GameState, GroceryCheckoutWire, GroceryLink, GroceryShopperWire, GroceryWire } from "@/game/state";
import type { NamedRoom } from "@/platform/realtime";
import { pickHost } from "./host";

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isItems = (v: unknown) => Array.isArray(v) && v.length <= 16 && v.every((i) => { const o = i as Record<string, unknown>; return typeof o === "object" && o !== null && typeof o["kind"] === "string" && num(o["x"]) && num(o["y"]) && num(o["z"]) && num(o["rot"]); });
const isCheckout = (v: unknown): v is GroceryCheckoutWire => { const c = v as GroceryCheckoutWire | null; return typeof c === "object" && c !== null && num(c.t0) && isItems(c.items ?? []); };
// (The database keeps no nulls or empty lists: a missing field is one of those.)
const toWire = (v: unknown): GroceryWire | null => {
  const w = v as Record<string, unknown> | null;
  if (typeof w !== "object" || w === null || !num(w["n"])) return null;
  const s = w["sh"] as Record<string, unknown> | undefined | null;
  if (s === undefined || s === null) return { n: w["n"] as number, sh: null };
  const at = s["at"], wants = s["wants"] ?? [], basket = s["basket"] ?? null, bag = s["bag"] ?? null, holding = s["holding"] ?? null;
  const ok = typeof s === "object" && num(s["id"]) && num(s["k"] ?? 0) && typeof s["fem"] === "boolean" && typeof s["stage"] === "string" && num(s["t0"]) && Array.isArray(at) && at.length === 3 && at.every(num)
    && Array.isArray(wants) && wants.every(num) && (basket === null || isItems(basket)) && (bag === null || (Array.isArray(bag) && bag.every((k) => typeof k === "string")))
    && (holding === null || typeof holding === "string");
  return ok ? { n: w["n"] as number, sh: { id: s["id"] as number, fem: s["fem"] as boolean, stage: s["stage"] as string, k: (s["k"] ?? 0) as number, t0: s["t0"] as number, at: at as [number, number, number], wants: wants as number[], basket: basket as GroceryShopperWire["basket"], bag: bag as string[] | null, holding: holding as string | null } } : null;
};

export function makeGroceryLink(channel: NamedRoom): GroceryLink {
  let seq = 0, mine = "";
  return {
    isHost: () => pickHost(channel.peers())?.sameTab ?? true,
    publish: (sh) => { seq += 1; void channel.presence({ groc: { n: seq, sh } }).catch(() => {}); },
    latest: () => {
      const h = pickHost(channel.peers());
      if (!h || h.sameTab) return null;
      const v = toWire(h.presence["groc"]);
      return v ? { ...v, from: h.peer } : null;
    },
    myCheckout: (c) => { const j = JSON.stringify(c); if (j !== mine) { mine = j; void channel.presence({ gco: c }).catch(() => {}); } },
    checkouts: () => channel.peers().flatMap((p) => (p.sameTab || !isCheckout(p.presence["gco"]) ? [] : [{ id: p.peer, t0: (p.presence["gco"] as GroceryCheckoutWire).t0, items: (p.presence["gco"] as GroceryCheckoutWire).items ?? [], ...((p.presence["gco"] as GroceryCheckoutWire).hand === true ? { hand: true } : {}) }])),
  };
}

export function GrocerySync({ state, channel }: { state: GameState; channel: NamedRoom }) {
  useEffect(() => {
    state.groceryLink = makeGroceryLink(channel);
    return () => { state.groceryLink = null; };
  }, [state, channel]);
  return null;
}
