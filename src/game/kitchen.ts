// The apartment's kitchen (pure): what's kept where — pots and pans in the cupboard under the sink, plates, bowls,
// cups, jars and silverware on the counter beside it, dirty things in the sink — what's cooking on the stove, the
// meals on the table, and what's in each hand. Saved with the rest of the player's life.
import { CAN_INFO, CAPACITY, COOK_MINUTES, BURN_AFTER, cookState, isCan, isWare, type CanKind, type WareKind } from "./pantry";

/** A thing in a hand: a pot, pan, plate or bowl (with what's in it), a cup, a jar or silverware; dirty once used. */
export type Held = { ware: WareKind; food: CanKind[] | null; dirty: boolean; burnt?: boolean; silver?: boolean };
export type Kitchen = {
  cupboard: WareKind[];
  rack: WareKind[];
  sink: WareKind[];
  /** On the stove's two burners: a pot or pan each, the cans in it, and when it started cooking (game seconds;
   * null: not yet). */
  stoves: (Burner | null)[];
  /** Plates on the table: in front of which chair, with what, eaten yet, the silverware laid on it. */
  table: { chair: number; ware: "plate" | "bowl"; cans: CanKind[]; eaten: boolean; silver: boolean }[];
  hands: { left: Held | null; right: Held | null };
};
export type Burner = { ware: "pot" | "pan"; cans: CanKind[]; start: number | null };
export const BURNERS = 2;
export const newKitchen = (): Kitchen => ({ cupboard: [], rack: [], sink: [], stoves: [null, null], table: [], hands: { left: null, right: null } });
export const isPotLike = (w: WareKind): w is "pot" | "pan" => w === "pot" || w === "pan";
export const isDish = (w: WareKind): w is "plate" | "bowl" => w === "plate" || w === "bowl";

function readHeld(v: unknown): Held | null {
  if (!v || typeof v !== "object") return null;
  const h = v as Record<string, unknown>;
  if (typeof h["ware"] !== "string" || !isWare(h["ware"])) return null;
  const food = Array.isArray(h["food"]) ? (h["food"] as unknown[]).filter((c): c is CanKind => typeof c === "string" && isCan(c)).slice(0, 3) : null;
  return { ware: h["ware"], food: food && food.length ? food : null, dirty: h["dirty"] === true, ...(h["burnt"] === true ? { burnt: true } : {}), ...(h["silver"] === true ? { silver: true } : {}) };
}
/** Reads a saved kitchen defensively. */
export function readKitchen(v: unknown): Kitchen {
  const k = newKitchen();
  if (!v || typeof v !== "object") return k;
  const o = v as Record<string, unknown>;
  const wares = (x: unknown, max: number) => (Array.isArray(x) ? (x as unknown[]).filter((w): w is WareKind => typeof w === "string" && isWare(w)).slice(0, max) : []);
  k.cupboard = wares(o["cupboard"], 12).filter(isPotLike);
  k.rack = wares(o["rack"], 40).filter((w) => !isPotLike(w));
  k.sink = wares(o["sink"], 40);
  const burner = (st: Record<string, unknown> | null | undefined): Burner | null => {
    if (!st || (st["ware"] !== "pot" && st["ware"] !== "pan")) return null;
    const cans = Array.isArray(st["cans"]) ? (st["cans"] as unknown[]).filter((c): c is CanKind => typeof c === "string" && isCan(c)).slice(0, CAPACITY[st["ware"]]) : [];
    return { ware: st["ware"], cans, start: typeof st["start"] === "number" && Number.isFinite(st["start"]) ? st["start"] : null };
  };
  // (Older saves had one stove: it's the first burner.)
  if (Array.isArray(o["stoves"])) k.stoves = Array.from({ length: BURNERS }, (_, i) => burner((o["stoves"] as Record<string, unknown>[])[i]));
  else k.stoves[0] = burner(o["stove"] as Record<string, unknown> | null);
  if (Array.isArray(o["table"])) for (const t of o["table"] as Record<string, unknown>[]) {
    if (!t || typeof t["chair"] !== "number" || (t["ware"] !== "plate" && t["ware"] !== "bowl")) continue;
    const cans = Array.isArray(t["cans"]) ? (t["cans"] as unknown[]).filter((c): c is CanKind => typeof c === "string" && isCan(c)).slice(0, 3) : [];
    k.table.push({ chair: t["chair"], ware: t["ware"], cans, eaten: t["eaten"] === true, silver: t["silver"] === true });
  }
  const hands = o["hands"] as Record<string, unknown> | undefined;
  if (hands) { k.hands.left = readHeld(hands["left"]); k.hands.right = readHeld(hands["right"]); }
  return k;
}

/** Bought kitchenware put away: pots and pans in the cupboard, the rest on the counter. */
export function putAway(k: Kitchen, w: WareKind) { if (isPotLike(w)) k.cupboard.push(w); else k.rack.push(w); }

/** Game minutes since burner `i`'s pot started cooking (or null). */
export const cookedFor = (k: Kitchen, i: number, elapsed: number, gameMinute: number) => { const b = k.stoves[i]; return b?.start != null ? (elapsed - b.start) / gameMinute : null; };
/** How burner `i`'s pot is now. */
export function stoveState(k: Kitchen, i: number, elapsed: number, gameMinute: number): "empty" | "none" | "filling" | "cooking" | "ready" | "burnt" {
  const b = k.stoves[i];
  if (!b) return "none";
  const m = cookedFor(k, i, elapsed, gameMinute);
  if (m === null) return b.cans.length ? "filling" : "empty";
  return cookState(m);
}
/** How dark the food has gone (0 fresh .. 1 black): from the moment it's ready it starts to catch, black when burnt. */
export function burnLevel(minutes: number | null) {
  if (minutes === null || minutes < COOK_MINUTES) return 0;
  return Math.min(1, (minutes - COOK_MINUTES) / BURN_AFTER) ** 1.6;
}
/** The food's two colours (sauce and bits) for a mix of cans, darkened toward black by `burn`. */
export function foodColors(cans: CanKind[], burn = 0): { a: string; b: string } {
  const mix = (cs: string[]) => {
    const n = cs.length || 1;
    let r = 0, g = 0, b = 0;
    for (const c of cs) { const v = parseInt(c.slice(1), 16); r += (v >> 16) & 255; g += (v >> 8) & 255; b += v & 255; }
    return [r / n, g / n, b / n];
  };
  const dark = (rgb: number[]) => `#${rgb.map((x) => Math.round(x * (1 - burn) + 14 * burn).toString(16).padStart(2, "0")).join("")}`;
  return { a: dark(mix(cans.map((c) => CAN_INFO[c].food[0]))), b: dark(mix(cans.map((c) => CAN_INFO[c].food[1]))) };
}

/** A free hand (left first unless `prefer` says otherwise), or null. */
export function freeHand(k: Kitchen, prefer: "left" | "right" = "left"): "left" | "right" | null {
  const other = prefer === "left" ? "right" : "left";
  return !k.hands[prefer] ? prefer : !k.hands[other] ? other : null;
}
/** Everything carried that goes in the sink: dirty things, and a burnt pot only once it's emptied. */
export const dirtyHeld = (k: Kitchen) => (["left", "right"] as const).filter((h) => { const x = k.hands[h]; return !!x && x.dirty && !x.food; });
/** The free place on the table (a chair with no plate in front of it), or null. */
export function freePlace(k: Kitchen, chairs: number[]) { return chairs.find((c) => !k.table.some((t) => t.chair === c)) ?? null; }
