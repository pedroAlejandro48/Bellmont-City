// Running the kitchen in play: E and Q at the sink, the counter, the stove, the bin and the table start the moves
// (kitchenMoves); their events change what's where (life.kitchen); the cooking is watched (ready, burnt) and told.
import type { AptFloor } from "./aptRoom";
import { GAME_MINUTE } from "./config";
import { handFree, handsFullMessage, holdingOther } from "./handsHeld";
import { BURNERS, dirtyHeld, freePlace, isDish, isPotLike, putAway, stoveState, type Held, type Kitchen } from "./kitchen";
import {
  atRack, cansIn, dumpInBin, fromTable, intoCupboard, kplan, kplanAt, offStove, openCupboard, pourToPlate, rackSpot, takeFromCupboard, toSink, toStove, toTable, washUp,
  type Carry, type KPlan, type KPose, type KSeg,
} from "./kitchenMoves";
import { lifeEvent } from "./lifeRuntime";
import { CAN_INFO, CAPACITY, COOK_MINUTES, canByName, isWare, mealEffect, type CanKind, type WareKind } from "./pantry";
import { toast, type GameState } from "./state";
import { fridgeOf, kitchenOf } from "./aptShare";

/** What the kitchen's things show this moment (set by the moves; read by the drawing). */
export type KView = {
  door: number; lid: number; canOpen: number; canTilt: number; potTilt: number; water: number; stream: KPose["stream"];
  /** The can in the left hand (being opened and poured), and when one was tossed into the bin. */
  can: CanKind | null; tossAt: number;
  /** Being washed (in the left hand); washed and waiting to be put away. */
  washing: WareKind | null; drying: WareKind[];
  /** Choosing a pot or pan from the open cupboard (click one: its slot). */
  choosing: boolean; picked: number | null;
  /** A meal being eaten at the table: the chair, when it started, how long. */
  eat: { chair: number; t0: number; T: number } | null;
  /** Pouring: how far it's got (the food lands bit by bit), and which burner the cans go into. */
  pourK: number; pourInto: number;
  /** Things shown in a hand for a move (washed things being put away, new ones out of the bag). */
  holdL: WareKind | null; holdR: WareKind | null;
};
export const newKView = (): KView => ({ door: 0, lid: 0, canOpen: 0, canTilt: 0, potTilt: 0, water: 0, stream: null, can: null, tossAt: -1, washing: null, drying: [], choosing: false, picked: null, eat: null, pourK: 0, pourInto: 0, holdL: null, holdR: null });

export type KCtx = { state: GameState; fl: AptFloor; now: number; lx: number; lz: number; yaw: number; world: (x: number, z: number) => [number, number]; y0: number;
  /** The places other players here are using now ("stove0", "stove1", "sink", "rack", "bin", "table:<chair>"), and
   * where the other players stand (floor frame). */
  claims?: Set<string>; others?: [number, number][] };
/** Where one stands at the stove for burner `bi`: in front of that burner (so two cooks stand side by side). */
export const burnerStand = (fl: AptFloor, bi: number): [number, number] => [fl.kitchen.ovenStand[0] + (fl.kitchen.burners[bi]![0] < fl.kitchen.ovenStand[0] ? -0.36 : 0.36), fl.kitchen.ovenStand[1]];
/** The floor as the moves see it for burner `bi` (its own standing spot). */
const flB = (fl: AptFloor, bi: number): AptFloor => ({ ...fl, kitchen: { ...fl.kitchen, ovenStand: burnerStand(fl, bi) } });
type Ctx = KCtx;
type Mv = { plan: KPlan; t0: number; prev: number; on: (ev: string) => void; pausedAt: number | null };

export class KitchenRun {
  view = newKView();
  mv: Mv | null = null;
  private told = Array.from({ length: BURNERS }, () => ({ start: -1, ready: false, burnt: false }));
  private nagged = false;
  /** The places this player's move is using (told to the others, so they don't use them too). */
  stations: string[] = [];
  private lastStand: [number, number] | null = null;

  get busy() { return this.mv !== null; }
  /** The right hand can take something: it's free, or it holds a kitchen thing that can move to a free left hand. */
  private canTakeRight(s: GameState) { return handFree(s, "right") || (!!this.k(s).hands.right && !holdingOther(s, "right") && handFree(s, "left")); }
  /** Makes the right hand free for taking something (moving its kitchen thing to the left hand). */
  private rightFree(s: GameState) { const h = this.k(s).hands; if (h.right && handFree(s, "left")) { h.left = h.right; h.right = null; } }
  private k(s: GameState): Kitchen { return kitchenOf(s); }
  private carry(s: GameState): Carry { const h = this.k(s).hands; return { left: !!h.left, right: !!h.right }; }
  private go(c: Ctx, segs: KSeg[], on: (ev: string) => void, stations: string[] = []) { this.mv = { plan: kplan(segs), t0: c.now, prev: -1, on, pausedAt: null }; this.stations = stations; c.state.keys.clear(); }

  /** Each frame (own apartment, on its floor): the move's pose (or null), its events acted on. */
  step(c: Ctx): KPose | null {
    const s = c.state, m = this.mv;
    if (!m) return null;
    // Paused at the open cupboard while a pot or pan is chosen.
    if (m.pausedAt !== null) {
      const r = kplanAt(m.plan, m.pausedAt, m.pausedAt);
      if (this.view.picked !== null) { const i = this.view.picked; this.view.picked = null; this.view.choosing = false; s.uiLock = null; s.camLock = null; this.afterPick(c, i); return this.step(c); }
      if (s.uiLock !== "cupboard") { this.view.choosing = false; s.camLock = null; this.shutCupboard(c); return this.step(c); }
      this.apply(r.pose);
      return r.pose;
    }
    const t = c.now - m.t0, r = kplanAt(m.plan, t, m.prev);
    m.prev = t;
    for (const ev of r.events) { m.on(ev); if (this.mv !== m) break; }
    if (this.mv !== m) return this.mv ? this.step(c) : (this.apply(r.pose), r.pose);
    this.apply(r.pose);
    if (ev(r.events, "choose")) { m.pausedAt = t; this.cupboardOpened(c); return r.pose; }
    if (r.done) { this.mv = null; this.stations = []; this.view.stream = null; this.view.pourK = 0; this.view.holdL = null; this.view.holdR = null; }
    return r.pose;
  }
  private apply(p: KPose) {
    const v = this.view;
    v.door = p.door ?? (this.view.choosing ? 1 : v.door * 0.8);
    v.lid = p.lid ?? 0; v.canOpen = p.canOpen ?? 0; v.canTilt = p.canTilt ?? 0; v.potTilt = p.potTilt ?? 0; v.water = p.water ?? 0; v.stream = p.stream ?? null;
    v.pourK = p.pourK ?? 0; v.holdL = p.holdL ?? null; v.holdR = p.holdR ?? null;
  }

  /** The cooking watched, wherever the player is: told when it's ready, and when it burns. */
  watch(s: GameState) {
    const k = this.k(s);
    k.stoves.forEach((st, i) => {
      if (!st || st.start === null) return;
      const told = this.told[i]!;
      if (told.start !== st.start) Object.assign(told, { start: st.start, ready: false, burnt: false });
      const now = stoveState(k, i, s.elapsed, GAME_MINUTE), what = st.cans.map((c) => CAN_INFO[c].name).join(" and ");
      if (now === "ready" && !told.ready) { told.ready = true; toast(s, "Your food is ready", "info", `${what}: take it off the stove within 10 minutes or it burns.`); }
      if (now === "burnt" && !told.burnt) { told.burnt = true; told.ready = true; toast(s, "Your food burned!", "warn", `${what} is ruined: throw it in the bin.`); }
    });
  }

  /** Sat at the table: with the plate in front and silverware in hand, eating; when done the silverware is laid on
   * the plate. */
  seated(c: Ctx) {
    const s = c.state, k = this.k(s), seat = s.seat;
    if (!seat || seat.room !== c.fl.key) { this.nagged = false; return; }
    const v = this.view;
    if (v.eat) {
      if (seat.phase !== "seated") { v.eat = null; s.meal = null; return; }
      if (c.now - v.eat.t0 >= v.eat.T) {
        const plate = k.table.find((t) => t.chair === v.eat!.chair);
        if (plate) {
          const g = mealEffect(plate.cans.length);
          s.hunger = Math.min(100, s.hunger + g.hunger); s.thirst = Math.min(100, s.thirst + g.thirst); s.energy = Math.min(100, s.energy + g.energy);
          plate.eaten = true; plate.silver = true;
          lifeEvent(s, "eat", 1);
          toast(s, "That was good", "info", `A home-cooked meal: +${Math.round(g.hunger)}% hunger.`);
        }
        const h = (["right", "left"] as const).find((x) => k.hands[x]?.ware === "silverware");
        if (h) k.hands[h] = null;
        v.eat = null; s.meal = null;
      }
      return;
    }
    if (seat.phase !== "seated") return;
    const plate = k.table.find((t) => t.chair === seat.plan.chair && !t.eaten);
    if (!plate) return;
    // Only the silverware in hand: anything else has to be put down before eating.
    const other = (["right", "left"] as const).some((x) => (k.hands[x] && k.hands[x]!.ware !== "silverware") || holdingOther(s, x));
    if (other) { if (!this.nagged) { this.nagged = true; toast(s, "Your hands are full", "warn", "Put down what you're holding (Q) before eating — keep only the silverware."); } return; }
    const silver = (["right", "left"] as const).some((x) => k.hands[x]?.ware === "silverware" && !k.hands[x]?.dirty);
    if (!silver) { if (!this.nagged) { this.nagged = true; toast(s, "You need silverware", "info", "Get up and take a fork from the counter by the sink."); } return; }
    // Fork in the right hand.
    if (k.hands.right?.ware !== "silverware") { const l = k.hands.left; k.hands.left = k.hands.right; k.hands.right = l; }
    v.eat = { chair: seat.plan.chair, t0: c.now, T: 4 + 2.5 * plate.cans.length };
    // The knife rests by the plate in the left hand (no knife for soup: that hand rests on the table there).
    const pl = c.fl.kitchen.places.find((x) => x.chair === seat.plan.chair), ch = c.fl.items[seat.plan.chair];
    let left: [number, number, number] | undefined;
    if (pl && ch) {
      const [fx, fz] = ch.f, lx2 = fz, lz2 = -fx, [wx, wz] = c.world(pl.at[0] - fx * 0.12 + lx2 * 0.11, pl.at[2] - fz * 0.12 + lz2 * 0.11);
      left = [wx, c.y0 + pl.at[1] + 0.05, wz];
    }
    s.meal = { at: c.now, T: v.eat.T, bites: Math.max(3, Math.round(v.eat.T / 2.2)), ...(left ? { left } : {}) };
  }

  /** Q: pour, take dirty things to the sink, a full plate to the table, clear the table, put a thing back. */
  q(c: Ctx): boolean {
    const s = c.state, k = this.k(s), h = k.hands, carry = this.carry(s), from: [number, number] = [c.lx, c.lz];
    const food = (x: Held | null) => !!x && isPotLike(x.ware) && !!x.food;
    const emptyDish = (x: Held | null) => !!x && isDish(x.ware) && !x.food && !x.dirty;
    // The pot in one hand, an empty plate in the other: pour it out.
    const potHand = food(h.right) ? "right" : food(h.left) ? "left" : null;
    if (potHand) {
      const pot = h[potHand]!, other = potHand === "right" ? "left" : "right";
      if (pot.burnt) { toast(s, "It's burnt", "warn", "Throw it in the bin by the oven (E there)."); return true; }
      if (!emptyDish(h[other])) { toast(s, "Get a plate first", "info", "Plates and bowls are on the counter beside the sink (E there)."); return true; }
      // (Pot in the right hand, plate in the left.)
      if (potHand === "left") { h.left = h.right; h.right = pot; }
      this.go(c, pourToPlate(c.lx, c.lz, c.yaw), (e) => {
        if (e !== "poured") return;
        h.left = { ware: h.left!.ware, food: pot.food, dirty: false };
        h.right = { ware: pot.ware, food: null, dirty: true };
      });
      return true;
    }
    // Dirty things in hand: to the sink.
    const dirty = dirtyHeld(k);
    if (dirty.length) {
      this.go(c, toSink(c.fl, from, c.yaw, carry), (e) => { if (e === "inSink") for (const x of dirty) { const it = h[x]!; k.sink.push(it.ware); if (it.silver) k.sink.push("silverware"); h[x] = null; } }, ["sink"]);
      return true;
    }
    // A full plate: to the table, in front of a free chair.
    const plateHand = (["left", "right"] as const).find((x) => !!h[x] && isDish(h[x]!.ware) && !!h[x]!.food);
    if (plateHand) {
      // The place you're facing (whether someone's sitting there or not), else the first free one.
      const places = c.fl.kitchen.places, faced = this.facedPlace(c), chair = faced?.chair ?? freePlace(k, places.filter((p) => !c.claims?.has(`table:${p.chair}`)).map((p) => p.chair));
      if (chair === null) { toast(s, "No room on the table", "info"); return true; }
      const place = places.find((p) => p.chair === chair)!;
      if (plateHand === "right") { const l = h.left; h.left = h.right; h.right = l; }
      this.go(c, toTable(place, from, c.yaw, { left: true, right: !!h.right }), (e) => {
        if (e !== "down" || !h.left) return;
        k.table.push({ chair, ware: h.left.ware as "plate" | "bowl", cans: h.left.food ?? [], eaten: false, silver: false });
        h.left = null;
      }, [`table:${chair}`]);
      return true;
    }
    // By the table with free hands: clear a finished plate.
    if (handFree(s, "left") && handFree(s, "right")) {
      const place = c.fl.kitchen.places.find((p) => Math.hypot(c.lx - p.stand[0], c.lz - p.stand[1]) < 1.3 && k.table.some((t) => t.chair === p.chair && t.eaten));
      if (place) {
        const t = k.table.find((x) => x.chair === place.chair)!;
        this.go(c, fromTable(place, from, c.yaw), (e) => {
          if (e !== "up") return;
          k.table = k.table.filter((x) => x !== t);
          h.left = { ware: t.ware, food: null, dirty: true, silver: t.silver };
        }, [`table:${place.chair}`]);
        return true;
      }
    }
    // By the counter with something clean from it: put it back.
    const [rx, rz] = c.fl.kitchen.rackStand;
    const back = (["right", "left"] as const).find((x) => !!h[x] && !h[x]!.dirty && !h[x]!.food && !isPotLike(h[x]!.ware));
    if (back && Math.hypot(c.lx - rx, c.lz - rz) < 1.0) {
      const w = h[back]!.ware;
      this.go(c, atRack(c.fl, from, c.yaw, rackSpot(c.fl, w), back, "put", carry), (e) => { if (e === "put") { k.rack.push(w); h[back] = null; } }, ["rack"]);
      return true;
    }
    return false;
  }

  /** With a full plate in hand: the free place at the table you're facing (within a few steps), if any. */
  private facedPlace(c: Ctx) {
    const k = this.k(c.state);
    let best: (typeof c.fl.kitchen.places)[number] | null = null, ba = 0.6;
    for (const p of c.fl.kitchen.places) {
      if (k.table.some((t) => t.chair === p.chair) || c.claims?.has(`table:${p.chair}`)) continue;
      const dx = p.at[0] - c.lx, dz = p.at[2] - c.lz, d = Math.hypot(dx, dz);
      if (d > 2.8) continue;
      const a = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - c.yaw), Math.cos(Math.atan2(dx, dz) - c.yaw)));
      if (a < ba) { ba = a; best = p; }
    }
    return best;
  }
  /** E at one of the kitchen's places: what it does there, and where its prompt shows. (Nobody stands where someone
   * else is standing: with another player on the spot it would use, it waits.) */
  prompt(c: Ctx): { at: [number, number, number]; label: string; act: (() => void) | null } | null {
    this.lastStand = null;
    const r = this.prompt0(c), st = this.lastStand as [number, number] | null;
    if (r?.act && st && (c.others ?? []).some((o) => Math.hypot(o[0] - st[0], o[1] - st[1]) < 0.5 && Math.hypot(o[0] - c.lx, o[1] - c.lz) > 0.05)) return { at: r.at, label: "SOMEONE'S STANDING THERE", act: null };
    return r;
  }
  private prompt0(c: Ctx): { at: [number, number, number]; label: string; act: (() => void) | null } | null {
    const s = c.state, k = this.k(s), h = k.hands, fl = c.fl, K = fl.kitchen, from: [number, number] = [c.lx, c.lz], carry = this.carry(s);
    // A full plate in hand, facing a place at the table: Q puts it down there.
    if ((["left", "right"] as const).some((x) => !!h[x] && isDish(h[x]!.ware) && !!h[x]!.food)) {
      const p = this.facedPlace(c);
      if (p) return { at: [p.at[0], p.at[1] + 0.35, p.at[2]], label: "Q  PUT THE PLATE HERE", act: null };
    }
    // Near enough, and facing it (E works only on the thing you look at).
    const sees = (t: readonly number[]) => { const dx = t[0]! - c.lx, dz = t[2]! - c.lz, d = Math.hypot(dx, dz); return d < 0.25 || (Math.sin(c.yaw) * dx + Math.cos(c.yaw) * dz) / d >= Math.cos(1.05); };
    const near = (p: [number, number], r = 0.85, at?: readonly number[]) => Math.hypot(c.lx - p[0], c.lz - p[1]) < r && (!at || sees(at));
    const states = k.stoves.map((_, i) => stoveState(k, i, s.elapsed, GAME_MINUTE));
    // ---- the bin ----
    const claimed = (st2: string) => !!c.claims?.has(st2);
    if (near(K.trashStand, 0.8, K.trash) && !claimed("bin")) {
      this.lastStand = K.trashStand;
      const burnt = (["right", "left"] as const).find((x) => h[x]?.burnt && h[x]?.food);
      if (burnt) return { at: [K.trash[0], 1.05, K.trash[2]], label: "E  THROW THE BURNT FOOD AWAY", act: () => {
        if (burnt === "left") { const r = h.right; h.right = h.left; h.left = r; }
        this.go(c, dumpInBin(fl, from, c.yaw, this.carry(s)), (e) => { if (e === "dumped" && h.right) h.right = { ware: h.right.ware, food: null, dirty: true }; }, ["bin"]);
      } };
    }
    // ---- the stove (two burners) ----
    // (Standing nearer the sink, it's the sink that E is for.)
    const dTo = (q: [number, number]) => Math.hypot(c.lx - q[0], c.lz - q[1]);
    if (near(K.ovenStand, 0.85, K.burners[0]!.map((v, i) => (v + K.burners[1]![i]!) / 2)) && dTo(K.ovenStand) <= dTo(K.sinkStand) + 0.05) {
      const mid = K.burners.reduce((a2, b2) => [a2[0] + b2[0] / K.burners.length, 0, a2[2] + b2[2] / K.burners.length], [0, 0, 0] as [number, number, number]);
      const at: [number, number, number] = [mid[0], 1.25, mid[2]];
      // One person at the stove at a time (both burners).
      if ([0, 1].some((i) => claimed(`stove${i}`))) return { at, label: "SOMEONE'S AT THE STOVE", act: null };
      // Something done: take it off (the burnt one first, so it stops smoking).
      // (A burner someone else is at is theirs for now: the other one is yours.)
      const mineB = (i: number) => !claimed(`stove${i}`), firstB = (what: string) => states.findIndex((st2, i) => st2 === what && mineB(i));
      const done = firstB("burnt") >= 0 ? firstB("burnt") : firstB("ready");
      if (done >= 0) {
        if (!this.canTakeRight(s)) return { at, label: "YOUR HANDS ARE FULL", act: null };
        const burntNow = states[done] === "burnt";
        this.lastStand = burnerStand(fl, done);
        return { at, label: burntNow ? "E  TAKE IT OFF (BURNT)" : "E  TAKE IT OFF THE STOVE", act: () => {
          this.rightFree(s);
          this.go(c, offStove(flB(fl, done), from, c.yaw, this.carry(s), done), (e) => {
            const b2 = k.stoves[done];
            if (e !== "lift" || !b2) return;
            const burnt = stoveState(k, done, s.elapsed, GAME_MINUTE) === "burnt";
            h.right = { ware: b2.ware, food: b2.cans, dirty: false, ...(burnt ? { burnt: true } : {}) };
            k.stoves[done] = null;
          }, [`stove${done}`]);
        } };
      }
      // A clean pot or pan in hand and a free burner: on it goes.
      const holdingPot = (["right", "left"] as const).find((x) => !!h[x] && isPotLike(h[x]!.ware) && !h[x]!.dirty && !h[x]!.food);
      const free = firstB("none");
      if (holdingPot && free >= 0) this.lastStand = burnerStand(fl, free);
      if (holdingPot && free >= 0) return { at, label: `E  PUT THE ${h[holdingPot]!.ware.toUpperCase()} ON THE STOVE`, act: () => {
        if (holdingPot === "left") { const r = h.right; h.right = h.left; h.left = r; }
        this.go(c, toStove(flB(fl, free), from, c.yaw, this.carry(s), free), (e) => { if (e === "onStove" && h.right) { k.stoves[free] = { ware: h.right.ware as "pot" | "pan", cans: [], start: null }; h.right = null; } }, [`stove${free}`]);
      } };
      // An empty pot or pan on a burner: cook in it.
      const empty = firstB("empty");
      if (empty >= 0) this.lastStand = burnerStand(fl, empty);
      const cooking = states.map((st2, i) => (st2 === "cooking" ? Math.ceil(COOK_MINUTES - (s.elapsed - k.stoves[i]!.start!) / GAME_MINUTE) : null)).filter((x): x is number => x !== null);
      const cookingLabel = cooking.length ? `COOKING · ${cooking.map((m2) => `${m2} MIN`).join(" / ")} LEFT` : null;
      if (empty >= 0) {
        const cans = fridgeOf(s).filter((n) => canByName(n));
        if (!cans.length) return { at, label: cookingLabel ?? "NO CANNED FOOD IN THE FRIDGE", act: null };
        if (!handFree(s, "left") || !handFree(s, "right")) return { at, label: "FREE YOUR HANDS TO COOK", act: null };
        return { at, label: `E  COOK IN THE ${k.stoves[empty]!.ware.toUpperCase()} (UP TO ${CAPACITY[k.stoves[empty]!.ware]} CANS)${cookingLabel ? ` · ${cookingLabel}` : ""}`, act: () => { s.uiLock = "cook"; s.kitchenAsk = { burner: empty }; s.keys.clear(); } };
      }
      if (cookingLabel) return { at, label: cookingLabel, act: null };
    }
    // ---- the sink ----
    if (near(K.sinkStand, 0.75, K.basin)) {
      const at: [number, number, number] = [K.basin[0], 1.3, K.basin[2]];
      // One at a time at the sink (whoever's washing up does all of it).
      if (claimed("sink")) return { at, label: "SOMEONE'S AT THE SINK", act: null };
      this.lastStand = K.sinkStand;
      const dirty = dirtyHeld(k), n = k.sink.length + dirty.reduce((a, x) => a + (h[x]!.silver ? 2 : 1), 0);
      if (n > 0) return { at, label: `E  WASH UP (${n})`, act: () => this.washAll(c) };
      // New pots and pans from the shop go in the cupboard here (plates and the rest go on the counter, beside it).
      const bagPots = (s.groceryBag ?? []).filter((w): w is WareKind => isWare(w) && isPotLike(w));
      if (bagPots.length) return handFree(s, "right") ? { at, label: `E  PUT AWAY THE NEW ${bagPots.length > 1 ? "POTS AND PANS" : bagPots[0]!.toUpperCase()}`, act: () => this.putAwayBag(c, bagPots) } : { at, label: "YOUR RIGHT HAND IS FULL", act: null };
      const cleanPot = (["right", "left"] as const).find((x) => !!h[x] && isPotLike(h[x]!.ware) && !h[x]!.dirty && !h[x]!.food);
      if (cleanPot) return { at, label: "E  PUT IT IN THE CUPBOARD", act: () => {
        if (cleanPot === "left") { const r = h.right; h.right = h.left; h.left = r; }
        this.go(c, intoCupboard(fl, from, c.yaw, k.cupboard.length, 1, this.carry(s)), (e) => { if (e === "in" && h.right) { k.cupboard.push(h.right.ware); h.right = null; } }, ["sink"]);
      } };
      if (k.cupboard.length) {
        if (!this.canTakeRight(s)) return { at, label: "YOUR HANDS ARE FULL", act: null };
        return { at, label: "E  POTS AND PANS", act: () => {
          this.rightFree(s);
          this.go(c, openCupboard(fl, from, c.yaw, this.carry(s)), () => {}, ["sink"]);
        } };
      }
      return { at, label: "NO POTS OR PANS YET", act: null };
    }
    // ---- the counter beside the sink ----
    if (near(K.rackStand, 0.7, K.rack)) {
      const at: [number, number, number] = [K.rack[0], 1.25, K.rack[2]];
      if (claimed("rack")) return { at, label: "SOMEONE'S AT THE COUNTER", act: null };
      this.lastStand = K.rackStand;
      // New plates, bowls, cups, glasses and silverware from the shop: with none here yet, E puts them away; with
      // some, the counter's panel (the same E) has a button for it beside taking one.
      const bagRack = (s.groceryBag ?? []).filter((w): w is WareKind => isWare(w) && !isPotLike(w));
      if (!k.rack.length && bagRack.length) return handFree(s, "right") ? { at, label: "E  PUT AWAY THE NEW PLATES AND CUPS", act: () => this.putAwayBag(c, bagRack) } : { at, label: "YOUR RIGHT HAND IS FULL", act: null };
      if (!k.rack.length) return { at, label: "NO PLATES OR CUPS YET", act: null };
      if (!handFree(s, "left") && !handFree(s, "right")) return { at, label: "YOUR HANDS ARE FULL", act: null };
      return { at, label: `E  PLATE · CUP · GLASS · SILVERWARE${bagRack.length ? " · PUT AWAY" : ""}`, act: () => { s.uiLock = "rack"; s.kitchenAsk = null; s.keys.clear(); } };
    }
    void carry;
    return null;
  }

  /** What a panel asked for (a thing from the counter, cans to cook). */
  answer(c: Ctx) {
    const s = c.state, ask = s.kitchenAsk, k = this.k(s), h = k.hands, from: [number, number] = [c.lx, c.lz];
    if (!ask || this.mv) return;
    s.kitchenAsk = null;
    if (ask.stow) {
      const bagRack = (s.groceryBag ?? []).filter((w): w is WareKind => isWare(w) && !isPotLike(w));
      if (!handFree(s, "right")) { const m = handsFullMessage("right"); toast(s, m.title, "warn", m.body); return; }
      if (bagRack.length) this.putAwayBag(c, bagRack);
      return;
    }
    if (ask.rack) {
      const w = ask.rack, pref = w === "silverware" ? "right" : "left", other = pref === "left" ? "right" : "left";
      const hand = handFree(s, pref) ? pref : handFree(s, other) ? other : null;
      if (!hand) { const m = handsFullMessage(); toast(s, m.title, "warn", m.body); return; }
      if (!k.rack.includes(w)) return;
      this.go(c, atRack(c.fl, from, c.yaw, rackSpot(c.fl, w), hand, "take", this.carry(s)), (e) => { if (e === "take") { k.rack.splice(k.rack.indexOf(w), 1); h[hand] = { ware: w, food: null, dirty: false }; } }, ["rack"]);
    }
    const bi = ask.burner ?? 0, burner = k.stoves[bi];
    if (ask.cans && ask.cans.length && burner && burner.start === null) {
      const cans = ask.cans.slice(0, CAPACITY[burner.ware]);
      // Out of the fridge.
      for (const cn of cans) { const fr = fridgeOf(s), i = fr.indexOf(CAN_INFO[cn].name); if (i >= 0) fr.splice(i, 1); }
      this.view.pourInto = bi;
      this.go(c, cansIn(flB(c.fl, bi), cans.length, bi), (e) => {
        const [what, i] = e.split(":");
        if (what === "show") { this.view.can = cans[Number(i)]!; }
        if (what === "canIn" && k.stoves[bi]) k.stoves[bi]!.cans.push(cans[Number(i)]!);
        if (what === "toss") { this.view.can = null; this.view.tossAt = c.state.simulationTime; }
        if (what === "cook" && k.stoves[bi]) { k.stoves[bi]!.start = c.state.elapsed; toast(s, "Cooking", "info", `Ready in ${COOK_MINUTES} minutes.`); }
      }, [`stove${bi}`]);
    }
  }

  /** The doors are open: the camera comes down in front of them, looking in, and a pot or pan is clicked. */
  private cupboardOpened(c: Ctx) {
    this.view.choosing = true; this.view.picked = null;
    c.state.uiLock = "cupboard";
    // Right in front of the open doors, low (between them and the crouching body), looking in.
    // Fixed (no easing), close to the open doors at the height of the shelf, so all of it shows.
    // On a narrow (upright) screen the view widens and steps back until the cupboard's whole width fits across it.
    const cb = c.fl.kitchen.cupboard, aspect = typeof window !== "undefined" ? window.innerWidth / Math.max(1, window.innerHeight) : 16 / 9;
    const { back, fov } = cupboardView(aspect);
    const [px, pz] = c.world(cb.x, cb.z + 0.28 - back), [ax, az] = c.world(cb.x, cb.z + 0.32);
    c.state.camLock = { pos: [px, c.y0 + 0.4 + Math.max(0, back - 0.58) * 0.25, pz], at: [ax, c.y0 + 0.22, az], snap: true, fov, by: "cupboard" };
  }
  private afterPick(c: Ctx, i: number) {
    const s = c.state, k = this.k(s), h = k.hands;
    const w = k.cupboard[i];
    if (!w) { this.shutCupboard(c); return; }
    const segs = takeFromCupboard(c.fl, i);
    const free = k.stoves.findIndex((b2, i2) => !b2 && !c.claims?.has(`stove${i2}`));
    const end = segs[segs.length - 1]!.pose(1);
    const all = free >= 0 ? [...segs, ...toStove(flB(c.fl, free), [end.x, end.z], end.yaw, { left: !!h.left, right: true }, free)] : segs;
    this.go(c, all, (e) => {
      if (e === "took") { k.cupboard.splice(k.cupboard.indexOf(w), 1); h.right = { ware: w, food: null, dirty: false }; }
      if (e === "onStove" && h.right && free >= 0) { k.stoves[free] = { ware: h.right.ware as "pot" | "pan", cans: [], start: null }; h.right = null; }
    }, ["sink", ...(free >= 0 ? [`stove${free}`] : [])]);
  }
  private shutCupboard(c: Ctx) {
    const segs = intoCupboard(c.fl, [c.lx, c.lz], c.yaw, 0, 0, this.carry(c.state)).slice(-2);
    this.go(c, segs, () => {}, ["sink"]);
  }
  /** Washing up: what's carried into the sink, each thing washed, then put away (counter, cupboard). */
  private washAll(c: Ctx) {
    const s = c.state, k = this.k(s), h = k.hands, fl = c.fl, from: [number, number] = [c.lx, c.lz];
    const dirty = dirtyHeld(k);
    const segs: KSeg[] = [];
    if (dirty.length) segs.push(...toSink(fl, from, c.yaw, this.carry(s)));
    const list = [...k.sink, ...dirty.flatMap((x) => (h[x]!.silver ? [h[x]!.ware, "silverware" as WareKind] : [h[x]!.ware]))];
    segs.push(...washUp(fl, list.length));
    const toRack = list.filter((w) => !isPotLike(w)), toCup = list.filter(isPotLike);
    if (toRack.length) segs.push(...atRack(fl, fl.kitchen.sinkStand, 0, rackSpot(fl, toRack[0]!), "left", "racked", { left: false, right: false }, toRack[0]!));
    if (toCup.length) segs.push(...intoCupboard(fl, toRack.length ? fl.kitchen.rackStand : fl.kitchen.sinkStand, 0, k.cupboard.length, toCup.length, { left: false, right: false }, toCup));
    let cupIn = 0;
    this.go(c, segs, (e) => {
      const [what, i] = e.split(":");
      if (e === "inSink") for (const x of dirty) { const it = h[x]!; k.sink.push(it.ware); if (it.silver) k.sink.push("silverware"); h[x] = null; }
      if (what === "wash") { const w = list[Number(i)]!; const j = k.sink.indexOf(w); if (j >= 0) k.sink.splice(j, 1); this.view.washing = w; }
      if (what === "washed") { this.view.drying.push(this.view.washing!); this.view.washing = null; }
      if (e === "racked") { for (const w of toRack) { putAway(k, w); const j = this.view.drying.indexOf(w); if (j >= 0) this.view.drying.splice(j, 1); } }
      if (e === "in") { const w = toCup[cupIn++]; if (w) { putAway(k, w); const j = this.view.drying.indexOf(w); if (j >= 0) this.view.drying.splice(j, 1); } }
    }, ["sink", "rack"]);
  }
  /** New kitchenware from the shop: pots and pans into the cupboard, the rest onto the counter. */
  private putAwayBag(c: Ctx, wares: WareKind[]) {
    const s = c.state, k = this.k(s), fl = c.fl, from: [number, number] = [c.lx, c.lz];
    const pots = wares.filter(isPotLike), rest = wares.filter((w) => !isPotLike(w));
    const take = (w: WareKind) => { const b = s.groceryBag; if (!b) return; const i = b.indexOf(w); if (i >= 0) b.splice(i, 1); if (!b.length) s.groceryBag = null; };
    const segs: KSeg[] = [];
    if (pots.length) segs.push(...intoCupboard(fl, from, c.yaw, k.cupboard.length, pots.length, { left: true, right: false }, pots));
    if (rest.length) segs.push(...atRack(fl, pots.length ? fl.kitchen.sinkStand : from, pots.length ? 0 : c.yaw, rackSpot(fl, rest[0]!), "right", "racked", { left: true, right: false }, rest[0]!));
    let n = 0;
    this.go(c, segs, (e) => {
      if (e === "in") { const w = pots[n++]; if (w) { take(w); k.cupboard.push(w); } }
      if (e === "racked") for (const w of rest) { take(w); k.rack.push(w); }
    }, ["sink", "rack"]);
  }
}
const ev = (list: string[], name: string) => list.includes(name);
/**
 * The cupboard close-up for a screen `aspect` wide: how far back from the pots (m) and the vertical field of view, so
 * its whole width (with a margin, ~0.9 m) fits across. Wide screens: 0.58 m and 75°; upright phones widen the view
 * up to 100° and then step back.
 */
export function cupboardView(aspect: number): { back: number; fov: number } {
  const half = 0.45, back0 = 0.58, maxFov = 100;
  const need = (back: number) => 2 * Math.atan(Math.tan(Math.atan(half / back)) / aspect) * 180 / Math.PI;
  let fov = Math.max(75, need(back0));
  if (fov <= maxFov) return { back: back0, fov };
  fov = maxFov;
  return { back: half / (Math.tan(maxFov / 2 * Math.PI / 180) * aspect), fov };
}
