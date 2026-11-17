import { handFree, handsFullMessage, holding } from "./handsHeld";
// The inventory in play: taking things out and putting them away (number keys), storing carried water, using
// (E: eat, drink), putting down (Q) and picking up again. Animations read `state.invAct`.
import * as THREE from "three";
import { floorHeight, timeInfo } from "./config";
import { TABLE } from "./restaurantRoom";
import { DROP_CONTACT, DROP_TIME } from "./food";
import { ITEMS, addItem, itemInfo, isItemKind, kindByName, pressSlot, removeItem, type ItemKind } from "./inventory";
import { guideDone, lifeEvent } from "./lifeRuntime";
import { canConsume, consume } from "./needs";
import { foodValue } from "./shops";
import { toast, type GameState } from "./state";

/** Eating or drinking one thing from the hand takes this long (the bites or the sip are timed within it). */
export const USE_SECONDS = 2.4;
export { DROP_CONTACT as INV_CONTACT, DROP_TIME as INV_TIME };
let nextGround = 1;
import { MAX_GROUND } from "./saves";

/** The phone counts as out while it's open; otherwise whatever slot was taken out. */
export const heldSlotOf = (state: GameState) => (state.phone.open ? 0 : state.heldSlot);
export const heldKind = (state: GameState): ItemKind | null => { const s = heldSlotOf(state); return s === null ? null : state.life.inventory[s] ?? null; };
const busy = (state: GameState) => !!state.invAct || !!state.accident || state.health <= 0 || !!state.script || !!state.bench || state.scooter.riding || !!state.scooter.action;

/** A restaurant's bottle of water in either hand (unopened), which can go in the inventory. */
function carriedWater(state: GameState) {
  for (const side of ["right", "left"] as const) { const h = state.hands[side]; if (h && h.items?.length === 1 && h.items[0] === "Bottled Water") return h; }
  return null;
}

/** A number key (slot 0..8). */
export function pressInventorySlot(state: GameState, slot: number) {
  if (state.invAct || state.health <= 0) return;
  const inv = state.life.inventory, held = heldSlotOf(state);
  const r = pressSlot(inv, held, slot);
  if (r.kind === "hide") { if (slot === 0) state.phone = { open: false, app: null, atm: false }; else state.heldSlot = null; return; }
  if (r.kind === "show") {
    if (slot === 0) { state.phone = { open: true, app: null, atm: false }; state.keys.clear(); guideDone(state, 0); return; }
    // (Swapping one inventory thing for another is fine: it goes back in the inventory.)
    if (state.heldSlot === null && !handFree(state, "right")) { const m = handsFullMessage("right"); toast(state, m.title, "warn", m.body); return; }
    state.phone = { open: false, app: null, atm: false };
    state.heldSlot = slot;
    return;
  }
  if (r.kind === "store") {
    // (Only what one eats or drinks: canned food and kitchenware stay in the bag for the kitchen.)
    const fromBag = state.groceryBag?.find((k) => k !== "phone" && (itemInfo(k).use === "eat" || itemInfo(k).use === "drink"));
    if (fromBag && state.groceryBag) {
      addItem(inv, fromBag, slot);
      state.groceryBag.splice(state.groceryBag.indexOf(fromBag), 1);
      if (!state.groceryBag.length) state.groceryBag = null;
      toast(state, `${itemInfo(fromBag).name} from the bag`, "info", `In slot ${slot + 1}.`);
      return;
    }
    // An empty (clean) pot, pan, plate, bowl, cup, glass or silverware in a hand: into the inventory. (With food in
    // it, it can't go in.)
    const kh = state.life.kitchen.hands, side = (["right", "left"] as const).find((h) => kh[h] && !kh[h]!.food && !kh[h]!.dirty);
    if (side) {
      const w = kh[side]!.ware;
      addItem(inv, w, slot); kh[side] = null;
      toast(state, `${itemInfo(w).name} stored`, "info", `In slot ${slot + 1}.`);
      return;
    }
    if ((["right", "left"] as const).some((h) => kh[h])) { toast(state, "Can't store that", "warn", "Only empty, clean kitchenware goes in the inventory."); return; }
    const water = carriedWater(state);
    if (!water) { toast(state, `Slot ${slot + 1} is empty`, "info"); return; }
    addItem(inv, "water", slot);
    // The bottle leaves the hand: in the food world it's used up (it lives in the inventory now).
    state.foodSend?.({ type: "trash", pack: water.id, x: state.pos.x, y: -5, z: state.pos.z });
    toast(state, "Bottled Water stored", "info", `In slot ${slot + 1}.`);
  }
}

/** E with something to eat or drink out: starts using it. True if it did. */
export function consumeHeld(state: GameState) {
  const slot = state.heldSlot, kind = slot === null ? null : state.life.inventory[slot];
  if (!kind || busy(state)) return false;
  const use = itemInfo(kind).use;
  if (use !== "eat" && use !== "drink") return false;
  const name = itemInfo(kind).name;
  // (Only the thing being eaten in hand: anything in the other hand has to be put down first.)
  if (holding(state, "left") !== null) { toast(state, "Your left hand is full", "warn", `Put it down (Q) before ${use === "drink" ? "drinking" : "eating"}.`); return true; }
  if (!canConsume(state, name)) { toast(state, use === "drink" ? "Not thirsty" : "You're full", "warn"); return true; }
  state.invAct = { kind: use, at: state.simulationTime, item: kind, target: null, done: false };
  return true;
}

/** Q with something out: put it down on the ground in front. True if it did. */
export function dropHeld(state: GameState) {
  if (busy(state)) return false;
  const kh = state.life.kitchen.hands, kSide = (["right", "left"] as const).find((h) => kh[h] && !kh[h]!.food);
  // (A pot or plate with food in it isn't put down this way.)
  if (!state.heldTrash && state.heldSlot === null && !kSide && (kh.left || kh.right)) return false;
  const kind = state.heldTrash ?? (state.heldSlot !== null ? state.life.inventory[state.heldSlot] : null) ?? (kSide ? kh[kSide]!.ware : null) ?? (state.groceryBag && !state.groceryBasket ? "groceryBag" : null);
  if (!kind) return false;
  const f = new THREE.Vector3(Math.sin(state.rotY), 0, Math.cos(state.rotY)), l = new THREE.Vector3(Math.cos(state.rotY), 0, -Math.sin(state.rotY));
  let at = state.pos.clone().addScaledVector(f, 0.36).addScaledVector(l, kind === "groceryBag" ? 0.26 : -0.24), topY: number | undefined;
  // A table within reach in front: onto it instead (its near edge, toward you).
  const table = kind !== "groceryBag" ? tableNear(state) : null;
  if (table) { at = new THREE.Vector3(table.x, state.pos.y, table.z); topY = table.y; }
  state.invAct = { kind: "drop", at: state.simulationTime, item: kind, target: at, done: false, ...(state.heldTrash || state.heldSlot !== null || !kSide ? {} : { kitchenHand: kSide }), ...(topY !== undefined ? { topY } : {}) };
  return true;
}
/** The table in front within reach (a room's tables, the apartment's dining table and desk): where on it. */
function tableNear(state: GameState): { x: number; z: number; y: number } | null {
  const room = state.interior?.phase === "inside" ? state.rooms.get(state.interior.key) : undefined;
  if (!room) return null;
  const f = room.frame, c = Math.cos(state.rotY), sn = Math.sin(state.rotY);
  let best: { x: number; z: number; y: number } | null = null, bd = 1.25;
  for (const it of room.items) {
    if (it.kind !== "table") continue;
    const wx = f.ox + it.x * f.c + it.z * f.s, wz = f.oz - it.x * f.s + it.z * f.c, dx = wx - state.pos.x, dz = wz - state.pos.z, d = Math.hypot(dx, dz);
    if (d > bd || (sn * dx + c * dz) / (d || 1) < 0.4) continue;
    // A little in from the edge nearest you.
    const k = Math.max(0, d - 0.3) / (d || 1);
    best = { x: state.pos.x + dx * k, z: state.pos.z + dz * k, y: (state.level?.y ?? floorHeight(wx, wz)) + TABLE.top }; bd = d;
  }
  return best;
}

/** E near something lying on the ground: squat and pick it up (into the inventory, or trash into the hand). */
export function pickUpNear(state: GameState) {
  if (busy(state)) return false;
  let best: GameState["groundItems"][number] | null = null, bd = 1.0;
  for (const g of state.groundItems) { const d = Math.hypot(g.x - state.pos.x, g.z - state.pos.z) + Math.max(0, Math.abs((g.y ?? 0) - (state.level?.y ?? 0)) - 1.0) * 10; if (d < bd) { bd = d; best = g; } }
  if (!best) return false;
  // Can't take it (hand or inventory full): the press is left for something else (eating what's in the hand).
  const trash = best.kind === "bottle" || best.kind === "can";
  const blocked = best.kind === "groceryBag" ? !handFree(state, "left") : trash ? !handFree(state, "right") : !state.life.inventory.some((x, i) => i > 0 && x === null);
  if (blocked) {
    if (state.heldSlot === null) { toast(state, best.kind === "groceryBag" ? "Your left hand is full" : trash ? "Your right hand is full" : "Your inventory is full", "warn"); return true; }
    return false;
  }
  state.invAct = { kind: "pickup", at: state.simulationTime, item: best.kind, target: new THREE.Vector3(best.x, state.pos.y, best.z), done: false, ground: best.id };
  return true;
}

/** Each frame: the effect of what's being done lands at the right moment, and ends it. */
export function stepInventory(state: GameState) {
  const a = state.invAct;
  if (!a) return;
  const t = state.simulationTime - a.at;
  if (a.kind === "eat" || a.kind === "drink") {
    if (!a.done && t >= USE_SECONDS * 0.85) {
      a.done = true;
      const kind = a.item as ItemKind, name = itemInfo(kind).name;
      const after = consume(state, name, itemInfo(kind).value ?? foodValue(name));
      state.hunger = after.hunger; state.thirst = after.thirst; state.energy = after.energy; state.health = after.health;
      if (state.heldSlot !== null) removeItem(state.life.inventory, state.heldSlot);
      state.heldSlot = null;
      // The bottle is empty now: trash in the hand, to put down (Q).
      if (a.kind === "drink" && itemInfo(kind).trash) state.heldTrash = itemInfo(kind).trash!;
      lifeEvent(state, "eat", 1);
    }
    if (t >= USE_SECONDS) state.invAct = null;
    return;
  }
  if (a.kind === "drop") {
    if (!a.done && t >= DROP_CONTACT && a.target) {
      a.done = true;
      const contents = a.item === "groceryBag" ? state.groceryBag ?? [] : undefined;
      state.groundItems.push({ id: Math.max(nextGround++, ...state.groundItems.map((g) => g.id + 1)), kind: a.item, x: a.target.x, z: a.target.z, ...(a.topY !== undefined ? { y: a.topY } : state.level ? { y: state.level.y } : {}), yaw: state.rotY, at: state.simulationTime, ...(contents ? { contents } : {}) });
      if (a.kitchenHand) state.life.kitchen.hands[a.kitchenHand] = null;
      else if (a.item === "bottle" || a.item === "can") state.heldTrash = null;
      else if (a.item === "groceryBag") state.groceryBag = null;
      else if (state.heldSlot !== null) { removeItem(state.life.inventory, state.heldSlot); state.heldSlot = null; }
      // Things put down stay where they are, for good (only past MAX_GROUND does the oldest go).
      if (state.groundItems.length > MAX_GROUND) state.groundItems.shift();
    }
  } else if (a.kind === "pickup") {
    if (!a.done && t >= DROP_CONTACT) {
      a.done = true;
      const g = state.groundItems.find((x) => x.id === a.ground);
      if (g) {
        state.groundItems = state.groundItems.filter((x) => x !== g);
        if (g.kind === "bottle" || g.kind === "can") state.heldTrash = g.kind;
        else if (g.kind === "groceryBag") state.groceryBag = g.contents ?? [];
        else { const slot = addItem(state.life.inventory, g.kind); if (slot > 0) toast(state, `${itemInfo(g.kind).name} → slot ${slot + 1}`, "info"); }
      }
    }
  }
  if (t >= DROP_TIME) state.invAct = null;
}

/** Buying something that keeps (fruit, water) puts it in the inventory: false when there's no room. */
export function giveItem(state: GameState, kind: ItemKind) {
  const slot = addItem(state.life.inventory, kind);
  if (slot < 0) { toast(state, "Your inventory is full", "warn"); return false; }
  toast(state, `${itemInfo(kind).name} → slot ${slot + 1}`, "money");
  void timeInfo;
  return true;
}
