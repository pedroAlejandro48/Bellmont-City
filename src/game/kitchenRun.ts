// Running the kitchen in play: E and Q at the sink, the counter, the stove, the bin and the table start the moves
// (kitchenMoves); their events change what's where (life.kitchen); the cooking is watched (ready, burnt) and told.
import type { AptFloor } from "./aptRoom";
import { GAME_MINUTE } from "./config";
import { handFree, handsFullMessage, holdingOther } from "./handsHeld";
import { dirtyHeld, freePlace, isDish, isPotLike, putAway, stoveState, type Held, type Kitchen } from "./kitchen";
import {
  atRack, cansIn, dumpInBin, fromTable, intoCupboard, kplan, kplanAt, offStove, openCupboard, pourToPlate, rackSpot, takeFromCupboard, toSink, toStove, toTable, washUp,
  type Carry, type KPlan, type KPose, type KSeg,
} from "./kitchenMoves";
import { lifeEvent } from "./lifeRuntime";
import { CAN_INFO, CAPACITY, COOK_MINUTES, canByName, isWare, mealEffect, type CanKind, type WareKind } from "./pantry";
import { toast, type GameState } from "./state";

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
};
export const newKView = (): KView => ({ door: 0, lid: 0, canOpen: 0, canTilt: 0, potTilt: 0, water: 0, stream: null, can: null, tossAt: -1, washing: null, drying: [], choosing: false, picked: null, eat: null });

export type KCtx = { state: GameState; fl: AptFloor; now: number; lx: number; lz: number; yaw: number; world: (x: number, z: number) => [number, number]; y0: number };
type Ctx = KCtx;
type Mv = { plan: KPlan; t0: number; prev: number; on: (ev: string) => void; pausedAt: number | null };

export class KitchenRun {
  view = newKView();
  mv: Mv | null = null;
  private told = { start: -1, ready: false, burnt: false };
  private nagged = false;

  get busy() { return this.mv !== null; }
  /** The right hand can take something: it's free, or it holds a kitchen thing that can move to a free left hand. */
  private canTakeRight(s: GameState) { return handFree(s, "right") || (!!this.k(s).hands.right && !holdingOther(s, "right") && handFree(s, "left")); }
  /** Makes the right hand free for taking something (moving its kitchen thing to the left hand). */
  private rightFree(s: GameState) { const h = this.k(s).hands; if (h.right && handFree(s, "left")) { h.left = h.right; h.right = null; } }
  private k(s: GameState): Kitchen { return s.life.kitchen; }
  private carry(s: GameState): Carry { const h = this.k(s).hands; return { left: !!h.left, right: !!h.right }; }
  private go(c: Ctx, segs: KSeg[], on: (ev: string) => void) { this.mv = { plan: kplan(segs), t0: c.now, prev: -1, on, pausedAt: null }; c.state.keys.clear(); }

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
    if (r.done) { this.mv = null; this.view.stream = null; }
    return r.pose;
  }
  private apply(p: KPose) {
    const v = this.view;
    v.door = p.door ?? (this.view.choosing ? 1 : v.door * 0.8);
    v.lid = p.lid ?? 0; v.canOpen = p.canOpen ?? 0; v.canTilt = p.canTilt ?? 0; v.potTilt = p.potTilt ?? 0; v.water = p.water ?? 0; v.stream = p.stream ?? null;
  }

  /** The cooking watched, wherever the player is: told when it's ready, and when it burns. */
  watch(s: GameState) {
    const k = this.k(s), st = k.stove;
    if (!st || st.start === null) return;
    if (this.told.start !== st.start) this.told = { start: st.start, ready: false, burnt: false };
    const now = stoveState(k, s.elapsed, GAME_MINUTE);
    if (now === "ready" && !this.told.ready) { this.told.ready = true; toast(s, "Your food is ready", "info", "Take it off the stove within 10 minutes or it burns."); }
    if (now === "burnt" && !this.told.burnt) { this.told.burnt = true; this.told.ready = true; toast(s, "Your food burned!", "warn", "It's ruined: throw it in the bin."); }
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
    const silver = (["right", "left"] as const).some((x) => k.hands[x]?.ware === "silverware" && !k.hands[x]?.dirty);
    if (!silver) { if (!this.nagged) { this.nagged = true; toast(s, "You need silverware", "info", "Get up and take a fork from the counter by the sink."); } return; }
    // Fork in the right hand.
    if (k.hands.right?.ware !== "silverware") { const l = k.hands.left; k.hands.left = k.hands.right; k.hands.right = l; }
    v.eat = { chair: seat.plan.chair, t0: c.now, T: 4 + 2.5 * plate.cans.length };
    s.meal = { at: c.now, T: v.eat.T };
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
      this.go(c, toSink(c.fl, from, c.yaw, carry), (e) => { if (e === "inSink") for (const x of dirty) { const it = h[x]!; k.sink.push(it.ware); if (it.silver) k.sink.push("silverware"); h[x] = null; } });
      return true;
    }
    // A full plate: to the table, in front of a free chair.
    const plateHand = (["left", "right"] as const).find((x) => !!h[x] && isDish(h[x]!.ware) && !!h[x]!.food);
    if (plateHand) {
      const places = c.fl.kitchen.places, chair = freePlace(k, places.map((p) => p.chair));
      if (chair === null) { toast(s, "No room on the table", "info"); return true; }
      const place = places.find((p) => p.chair === chair)!;
      if (plateHand === "right") { const l = h.left; h.left = h.right; h.right = l; }
      this.go(c, toTable(place, from, c.yaw, { left: true, right: !!h.right }), (e) => {
        if (e !== "down" || !h.left) return;
        k.table.push({ chair, ware: h.left.ware as "plate" | "bowl", cans: h.left.food ?? [], eaten: false, silver: false });
        h.left = null;
      });
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
        });
        return true;
      }
    }
    // By the counter with something clean from it: put it back.
    const [rx, rz] = c.fl.kitchen.rackStand;
    const back = (["right", "left"] as const).find((x) => !!h[x] && !h[x]!.dirty && !h[x]!.food && !isPotLike(h[x]!.ware));
    if (back && Math.hypot(c.lx - rx, c.lz - rz) < 1.0) {
      const w = h[back]!.ware;
      this.go(c, atRack(c.fl, from, c.yaw, rackSpot(c.fl, w), back, "put", carry), (e) => { if (e === "put") { k.rack.push(w); h[back] = null; } });
      return true;
    }
    return false;
  }

  /** E at one of the kitchen's places: what it does there, and where its prompt shows. */
  prompt(c: Ctx): { at: [number, number, number]; label: string; act: (() => void) | null } | null {
    const s = c.state, k = this.k(s), h = k.hands, fl = c.fl, K = fl.kitchen, from: [number, number] = [c.lx, c.lz], carry = this.carry(s);
    const near = (p: [number, number], r = 0.85) => Math.hypot(c.lx - p[0], c.lz - p[1]) < r;
    const st = stoveState(k, s.elapsed, GAME_MINUTE);
    // ---- the bin ----
    if (near(K.trashStand, 0.8)) {
      const burnt = (["right", "left"] as const).find((x) => h[x]?.burnt && h[x]?.food);
      if (burnt) return { at: [K.trash[0], 1.05, K.trash[2]], label: "E  THROW THE BURNT FOOD AWAY", act: () => {
        if (burnt === "left") { const r = h.right; h.right = h.left; h.left = r; }
        this.go(c, dumpInBin(fl, from, c.yaw, this.carry(s)), (e) => { if (e === "dumped" && h.right) h.right = { ware: h.right.ware, food: null, dirty: true }; });
      } };
    }
    // ---- the stove ----
    if (near(K.ovenStand)) {
      const at: [number, number, number] = [K.burner[0], 1.25, K.burner[2]];
      const holdingPot = (["right", "left"] as const).find((x) => !!h[x] && isPotLike(h[x]!.ware) && !h[x]!.dirty && !h[x]!.food);
      if (st === "none" && holdingPot) return { at, label: `E  PUT THE ${h[holdingPot]!.ware.toUpperCase()} ON THE STOVE`, act: () => {
        if (holdingPot === "left") { const r = h.right; h.right = h.left; h.left = r; }
        this.go(c, toStove(fl, from, c.yaw, this.carry(s)), (e) => { if (e === "onStove" && h.right) { k.stove = { ware: h.right.ware as "pot" | "pan", cans: [], start: null }; h.right = null; } });
      } };
      if (st === "empty") {
        const cans = s.life.fridge.filter((n) => canByName(n));
        if (!cans.length) return { at, label: "NO CANNED FOOD IN THE FRIDGE", act: null };
        if (!handFree(s, "left") || !handFree(s, "right")) return { at, label: "FREE YOUR HANDS TO COOK", act: null };
        return { at, label: `E  COOK (UP TO ${CAPACITY[k.stove!.ware]} CANS)`, act: () => { s.uiLock = "cook"; s.kitchenAsk = null; s.keys.clear(); } };
      }
      if (st === "cooking") { const left = Math.ceil(COOK_MINUTES - (s.elapsed - k.stove!.start!) / GAME_MINUTE); return { at, label: `COOKING · ${left} MIN LEFT`, act: null }; }
      if (st === "ready" || st === "burnt") {
        if (!this.canTakeRight(s)) return { at, label: "YOUR HANDS ARE FULL", act: null };
        return { at, label: st === "burnt" ? "E  TAKE IT OFF (BURNT)" : "E  TAKE IT OFF THE STOVE", act: () => {
          this.rightFree(s);
          this.go(c, offStove(fl, from, c.yaw, this.carry(s)), (e) => {
            if (e !== "lift" || !k.stove) return;
            const burnt = stoveState(k, s.elapsed, GAME_MINUTE) === "burnt";
            h.right = { ware: k.stove.ware, food: k.stove.cans, dirty: false, ...(burnt ? { burnt: true } : {}) };
            k.stove = null;
          });
        } };
      }
    }
    // ---- the sink ----
    if (near(K.sinkStand, 0.75)) {
      const at: [number, number, number] = [K.basin[0], 1.3, K.basin[2]];
      const dirty = dirtyHeld(k), n = k.sink.length + dirty.reduce((a, x) => a + (h[x]!.silver ? 2 : 1), 0);
      if (n > 0) return { at, label: `E  WASH UP (${n})`, act: () => this.washAll(c) };
      const bagWares = (s.groceryBag ?? []).filter(isWare);
      if (bagWares.length) return handFree(s, "right") ? { at, label: "E  PUT AWAY THE KITCHENWARE", act: () => this.putAwayBag(c, bagWares) } : { at, label: "YOUR RIGHT HAND IS FULL", act: null };
      const cleanPot = (["right", "left"] as const).find((x) => !!h[x] && isPotLike(h[x]!.ware) && !h[x]!.dirty && !h[x]!.food);
      if (cleanPot) return { at, label: "E  PUT IT IN THE CUPBOARD", act: () => {
        if (cleanPot === "left") { const r = h.right; h.right = h.left; h.left = r; }
        this.go(c, intoCupboard(fl, from, c.yaw, k.cupboard.length, 1, this.carry(s)), (e) => { if (e === "in" && h.right) { k.cupboard.push(h.right.ware); h.right = null; } });
      } };
      if (k.cupboard.length) {
        if (!this.canTakeRight(s)) return { at, label: "YOUR HANDS ARE FULL", act: null };
        return { at, label: "E  POTS AND PANS", act: () => {
          this.rightFree(s);
          this.go(c, openCupboard(fl, from, c.yaw, this.carry(s)), () => {});
        } };
      }
      return { at, label: "NO POTS OR PANS YET", act: null };
    }
    // ---- the counter beside the sink ----
    if (near(K.rackStand, 0.7)) {
      const at: [number, number, number] = [K.rack[0], 1.25, K.rack[2]];
      if (!k.rack.length) return { at, label: "NO PLATES OR CUPS YET", act: null };
      if (!handFree(s, "left") && !handFree(s, "right")) return { at, label: "YOUR HANDS ARE FULL", act: null };
      return { at, label: "E  PLATE · CUP · SILVERWARE", act: () => { s.uiLock = "rack"; s.kitchenAsk = null; s.keys.clear(); } };
    }
    void carry;
    return null;
  }

  /** What a panel asked for (a thing from the counter, cans to cook). */
  answer(c: Ctx) {
    const s = c.state, ask = s.kitchenAsk, k = this.k(s), h = k.hands, from: [number, number] = [c.lx, c.lz];
    if (!ask || this.mv) return;
    s.kitchenAsk = null;
    if (ask.rack) {
      const w = ask.rack, pref = w === "silverware" ? "right" : "left", other = pref === "left" ? "right" : "left";
      const hand = handFree(s, pref) ? pref : handFree(s, other) ? other : null;
      if (!hand) { const m = handsFullMessage(); toast(s, m.title, "warn", m.body); return; }
      if (!k.rack.includes(w)) return;
      this.go(c, atRack(c.fl, from, c.yaw, rackSpot(c.fl, w), hand, "take", this.carry(s)), (e) => { if (e === "take") { k.rack.splice(k.rack.indexOf(w), 1); h[hand] = { ware: w, food: null, dirty: false }; } });
    }
    if (ask.cans && ask.cans.length && k.stove && k.stove.start === null) {
      const cans = ask.cans.slice(0, CAPACITY[k.stove.ware]);
      // Out of the fridge.
      for (const cn of cans) { const i = s.life.fridge.indexOf(CAN_INFO[cn].name); if (i >= 0) s.life.fridge.splice(i, 1); }
      this.go(c, cansIn(c.fl, cans.length), (e) => {
        const [what, i] = e.split(":");
        if (what === "show") { this.view.can = cans[Number(i)]!; }
        if (what === "canIn" && k.stove) k.stove.cans.push(cans[Number(i)]!);
        if (what === "toss") { this.view.can = null; this.view.tossAt = c.state.simulationTime; }
        if (what === "cook" && k.stove) { k.stove.start = c.state.elapsed; toast(s, "Cooking", "info", `Ready in ${COOK_MINUTES} minutes.`); }
      });
    }
  }

  /** The doors are open: the camera comes down in front of them, looking in, and a pot or pan is clicked. */
  private cupboardOpened(c: Ctx) {
    this.view.choosing = true; this.view.picked = null;
    c.state.uiLock = "cupboard";
    // Right in front of the open doors, low (between them and the crouching body), looking in.
    const cb = c.fl.kitchen.cupboard, [px, pz] = c.world(cb.x + 0.03, cb.z - 0.42), [ax, az] = c.world(cb.x, cb.z + 0.3);
    c.state.camLock = { pos: [px, c.y0 + 0.5, pz], at: [ax, c.y0 + 0.24, az] };
  }
  private afterPick(c: Ctx, i: number) {
    const s = c.state, k = this.k(s), h = k.hands;
    const w = k.cupboard[i];
    if (!w) { this.shutCupboard(c); return; }
    const segs = takeFromCupboard(c.fl, i);
    const toStoveToo = !k.stove;
    const end = segs[segs.length - 1]!.pose(1);
    const all = toStoveToo ? [...segs, ...toStove(c.fl, [end.x, end.z], end.yaw, { left: !!h.left, right: true })] : segs;
    this.go(c, all, (e) => {
      if (e === "took") { k.cupboard.splice(k.cupboard.indexOf(w), 1); h.right = { ware: w, food: null, dirty: false }; }
      if (e === "onStove" && h.right) { k.stove = { ware: h.right.ware as "pot" | "pan", cans: [], start: null }; h.right = null; }
    });
  }
  private shutCupboard(c: Ctx) {
    const segs = intoCupboard(c.fl, [c.lx, c.lz], c.yaw, 0, 0, this.carry(c.state)).slice(-2);
    this.go(c, segs, () => {});
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
    if (toRack.length) segs.push(...atRack(fl, fl.kitchen.sinkStand, 0, rackSpot(fl, toRack[0]!), "left", "racked", { left: false, right: false }));
    if (toCup.length) segs.push(...intoCupboard(fl, toRack.length ? fl.kitchen.rackStand : fl.kitchen.sinkStand, 0, k.cupboard.length, toCup.length, { left: false, right: false }));
    let cupIn = 0;
    this.go(c, segs, (e) => {
      const [what, i] = e.split(":");
      if (e === "inSink") for (const x of dirty) { const it = h[x]!; k.sink.push(it.ware); if (it.silver) k.sink.push("silverware"); h[x] = null; }
      if (what === "wash") { const w = list[Number(i)]!; const j = k.sink.indexOf(w); if (j >= 0) k.sink.splice(j, 1); this.view.washing = w; }
      if (what === "washed") { this.view.drying.push(this.view.washing!); this.view.washing = null; }
      if (e === "racked") { for (const w of toRack) { putAway(k, w); const j = this.view.drying.indexOf(w); if (j >= 0) this.view.drying.splice(j, 1); } }
      if (e === "in") { const w = toCup[cupIn++]; if (w) { putAway(k, w); const j = this.view.drying.indexOf(w); if (j >= 0) this.view.drying.splice(j, 1); } }
    });
  }
  /** New kitchenware from the shop: pots and pans into the cupboard, the rest onto the counter. */
  private putAwayBag(c: Ctx, wares: WareKind[]) {
    const s = c.state, k = this.k(s), fl = c.fl, from: [number, number] = [c.lx, c.lz];
    const pots = wares.filter(isPotLike), rest = wares.filter((w) => !isPotLike(w));
    const take = (w: WareKind) => { const b = s.groceryBag; if (!b) return; const i = b.indexOf(w); if (i >= 0) b.splice(i, 1); if (!b.length) s.groceryBag = null; };
    const segs: KSeg[] = [];
    if (pots.length) segs.push(...intoCupboard(fl, from, c.yaw, k.cupboard.length, pots.length, { left: true, right: false }));
    if (rest.length) segs.push(...atRack(fl, pots.length ? fl.kitchen.sinkStand : from, pots.length ? 0 : c.yaw, rackSpot(fl, rest[0]!), "right", "racked", { left: true, right: false }));
    let n = 0;
    this.go(c, segs, (e) => {
      if (e === "in") { const w = pots[n++]; if (w) { take(w); k.cupboard.push(w); } }
      if (e === "racked") for (const w of rest) { take(w); k.rack.push(w); }
    });
  }
}
const ev = (list: string[], name: string) => list.includes(name);
