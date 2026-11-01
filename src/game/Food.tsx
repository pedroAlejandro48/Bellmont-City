import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { BENCH_SEATS, BENCH_SEAT_TOP, BIN, PARK_BINS, RESTAURANTS, SIDEWALK_H, floorHeight, generateCity, timeInfo, type RestaurantKind } from "./config";
import { canConsume, consume } from "./needs";
import { CharacterBody, useBodyRig, type BodyRig } from "./CharacterBody";
import { POLES, carryElbow, handWorld, pointArm, reachArm } from "./arms";
import {
  DROP_CONTACT, DROP_TIME, EAT_SECONDS, FoodSim, isDrinkName, priceOf, GRAB_CONTACT, GRAB_TIME, PACK_SIZE, atCounter, canReach, cents, greetingLine, localFoodLink, orderTotal, placesOf, runnerPose, toldLine, viewOf,
  type FoodLink, type FoodPack, type FoodView, type Places, type Trip,
} from "./food";
import { COUNTER, TABLE, roomLayout, toLocal, toWorld, walkTime, walkTo, worldYaw, type RoomLayout } from "./restaurantRoom";
import { drawBrandIcon } from "./Restaurants";
import { canvas, tex } from "./textures";
import { dishModel } from "./dishes";
import { bodyColor } from "@/platform/account";
import type { GameState } from "./state";

/** How long after the cashier says hello the menu comes up (s). */
const MENU_DELAY = 2.2;

type Place = { key: string; kind: RestaurantKind; room: RoomLayout; places: Places; seed: number };
/** The latest view of the food and staff, and when it was taken (local ms), for working out ages now. */
type Live = { view: FoodView; at: number };
const ageNow = (live: Live, ago: number) => ago + (Date.now() - live.at) / 1000;
const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

/** Where each runner's hands are this frame (for the food it carries), by restaurant. */
type Hands = Map<string, { left: THREE.Vector3; right: THREE.Vector3; yaw: number }>;

/** The restaurants' staff and the food: ordering at the counters, the kitchen runners, and food to take away. */
export function Food({ state }: { state: GameState }) {
  const places = useMemo<Place[]>(() => generateCity(state.worldSeed, 0, 0).buildings.filter((b) => b.restaurant).map((b, i) => {
    const room = roomLayout(b);
    return { key: room.key, kind: room.kind, room, places: placesOf(room), seed: (state.worldSeed * 31 + i * 7919) | 0 };
  }), [state.worldSeed]);
  const byKey = useMemo(() => new Map(places.map((p) => [p.key, p])), [places]);
  const local = useMemo(() => localFoodLink(), []);
  const sim = useMemo(() => new FoodSim((key) => { const p = byKey.get(key); return p ? { places: p.places, room: p.room } : null; }), [byKey]);
  const live = useRef<Live>({ view: viewOf(sim, Date.now() / 1000), at: Date.now() });
  const runnerHands = useMemo<Hands>(() => new Map(), []);
  /** Where each restaurant's staff are standing (world), solid to players. */
  const staffAt = useMemo(() => new Map<string, { x: number; z: number; r: number }[]>(), []);
  /** Food this player has just put down, where (until the host shows it on the ground). */
  const dropped = useMemo(() => new Map<number, { x: number; z: number; yaw: number; until: number; y?: number }>(), []);
  /** A meal on a bench (once eaten or full, the packs are taken back up), and a trip to a bin. */
  const meal = useRef({ benchDone: false, leftTray: 0, justAte: null as null | { pack: number; item: string; left: number; until: number }, toss: null as null | { bin: { x: number; z: number }; from: [number, number]; fromYaw: number; at: number; front: [number, number]; yaw: number; items: { id: number; hand: "left" | "right" }[]; sent: Set<number> } });
  const mine = useRef({ greeted: "" as string, greetAt: 0, wasHost: true, published: "", publishedAt: 0, inside: null as string | null, sessionSeenAt: 0 });

  useFrame(() => {
    const link: FoodLink = state.foodLink ?? local;
    const me = link.me(), nowS = Date.now() / 1000, m = mine.current;
    const inter = state.interior, here = inter && inter.phase !== "leaving" ? inter.key : null;
    if (here !== m.inside) { m.inside = here; link.setInside(here); }

    // ---------- the host runs everything ----------
    if (link.isHost()) {
      if (!m.wasHost) { const last = live.current.view; sim.adopt({ ...last, sessions: new Map([...last.sessions].map(([k, s]) => [k, { ...s, ago: ageNow(live.current, s.ago) }])), trips: new Map([...last.trips].map(([k, t]) => [k, { ...t, ago: ageNow(live.current, t.ago) }])) }, nowS); }
      m.wasHost = true;
      for (const { by, req } of link.takeRequests()) sim.handle(by, req, nowS);
      const others = link.others();
      sim.step(nowS, (by, key) => (by === me ? here === key : others.get(by) === key), (by) => by === me || others.has(by));
      const snap = sim.snapshot(nowS);
      // Share it when something changed (ages aside), and now and then anyway.
      const shape = JSON.stringify([snap.s.map((s) => [s[0], s[1], s[2], s[4]]), snap.r.map((r) => [r[0], r[1], r[3], r[4]]), snap.p]);
      if (shape !== m.published || Date.now() - m.publishedAt > 3000) { m.published = shape; m.publishedAt = Date.now(); link.publish(snap); }
      live.current = { view: viewOf(sim, nowS), at: Date.now() };
    } else {
      m.wasHost = false;
      const got = link.latest();
      if (got) live.current = got;
    }
    const view = live.current.view;
    state.staffBodies = [...staffAt.values()].flat();
    if (import.meta.env["VITE_TRAFFIC_AUDIT"] === "1") (window as unknown as { __food?: unknown }).__food = { view, places: [...byKey.values()] };

    // ---------- this player at a counter ----------
    const place = here ? byKey.get(here) : undefined;
    const lp = place && inter?.phase === "inside" ? toLocal(place.room.frame, state.pos.x, state.pos.z) : null;
    const standing = !state.seat && !state.script && !state.accident && state.health > 0;
    const atIt = !!(place && lp && standing && atCounter(place.places, lp[0], lp[1]));
    const session = place ? view.sessions.get(place.key) : undefined;
    if (atIt && place) {
      const ours = session?.by === me;
      if (!session && (m.greeted !== place.key || Date.now() - m.greetAt > 2500)) {
        m.greeted = place.key; m.greetAt = Date.now();
        link.send({ type: "greet", key: place.key, text: greetingLine(place.kind, timeInfo(state.elapsed).hours) });
      }
      const greetAge = ours && session ? ageNow(live.current, session.ago) : 0;
      state.foodUi.open = !!(ours && session?.stage === "greet" && greetAge >= MENU_DELAY);
      state.foodUi.key = place.key; state.foodUi.kind = place.kind;
    } else {
      if (m.greeted) {
        // Walked away: the cashier stops talking to this player (asked again until it has).
        const key = m.greeted;
        if (view.sessions.get(key)?.by !== me) m.greeted = "";
        else if (Date.now() - m.greetAt > 500) { m.greetAt = Date.now(); link.send({ type: "bye", key }); }
      }
      state.foodUi.open = false; state.foodUi.note = null;
    }
    // An order from the menu: paid for here, then sent.
    const order = state.foodOrder;
    if (order) {
      state.foodOrder = null;
      if (place && atIt && session?.by === me) {
        const total = orderTotal(place.kind, order.names);
        if (total > state.cash + 1e-9) state.foodUi.note = "Not enough cash";
        else {
          state.cash = cents(state.cash - total);
          state.foodUi.open = false; state.foodUi.note = null;
          link.send({ type: "order", key: place.key, kind: place.kind, names: order.names, mode: order.mode, text: toldLine(order.mode) });
        }
      }
    }

    // ---------- food in hand ----------
    const held = view.packs.filter((p) => p.where === "held" && p.holder === me);
    const hands: GameState["hands"] = { left: null, right: null };
    // Just put down (Q): out of the hands here at once, before the host has said so.
    for (const [id, d] of dropped) if (Date.now() > d.until || view.packs.find((q) => q.id === id)?.where !== "held") dropped.delete(id);
    for (const p of held) if (!dropped.has(p.id)) hands[p.hand] = { id: p.id, kind: p.kind, bags: p.bags, cups: p.cups, items: p.items };
    const g = state.grab;
    if (g) {
      const t = state.simulationTime - g.at, p = view.packs.find((q) => q.id === g.pack);
      if (p?.where === "held" && p.holder === me) g.confirmed = true;
      const lost = !p || (p.where === "held" && p.holder !== me) || p.where === "runner";
      if (lost && t > 0.25) state.grab = null;
      else {
        // Once the hand has it, it is in the hand (before the host has said so).
        if (t >= GRAB_CONTACT && !hands[g.hand]) hands[g.hand] = { id: g.pack, kind: g.kind, bags: g.bags, cups: g.cups };
        if (t >= GRAB_TIME && (g.confirmed || t > 3)) state.grab = null;
      }
    }
    state.hands = hands;

    // Q: squat and put everything held down on the ground, where the hands set it.
    const onFoot = standing && !state.bench && !state.scooter.riding && !state.scooter.action;
    if (state.dropQueued) {
      state.dropQueued = false;
      if (onFoot && !state.grab && !state.drop && (hands.left || hands.right)) state.drop = { at: state.simulationTime, sent: false };
    }
    const drop = state.drop;
    if (drop) {
      const t = state.simulationTime - drop.at;
      if (!drop.sent && t >= DROP_CONTACT) {
        drop.sent = true;
        const out: { id: number; x: number; z: number; yaw: number }[] = [];
        for (const side of ["left", "right"] as const) {
          const h = hands[side], fore = state.avatar.body[side === "left" ? 9 : 11];
          if (!h || !fore) continue;
          fore.updateWorldMatrix(true, false);
          const at = handWorld(fore, new THREE.Vector3());
          out.push({ id: h.id, x: cents(at.x), z: cents(at.z), yaw: cents(state.rotY) });
          dropped.set(h.id, { x: at.x, z: at.z, yaw: state.rotY, until: Date.now() + 3000 });
        }
        if (out.length) link.send({ type: "drop", packs: out });
      }
      if (t >= DROP_TIME) state.drop = null;
    }
    // E on something lying on the ground (anyone's): squat down and pick it up.
    if (state.interactQueued && onFoot && !state.grab && !state.drop && state.interior?.phase !== "entering" && state.interior?.phase !== "leaving" && !state.script) {
      const free = (["right", "left"] as const).filter((h) => !hands[h]);
      let best: { pack: FoodPack; d: number } | null = null;
      for (const p of view.packs) {
        if (p.where !== "ground" || dropped.has(p.id)) continue;
        const d = Math.hypot(p.gx - state.pos.x, p.gz - state.pos.z);
        if (d < 1.0 && (!best || d < best.d)) best = { pack: p, d };
      }
      if (best && free.length) {
        state.interactQueued = false;
        const b = best.pack, size = PACK_SIZE[b.kind];
        const leftX = Math.cos(state.rotY), leftZ = -Math.sin(state.rotY);
        const onLeft = (b.gx - state.pos.x) * leftX + (b.gz - state.pos.z) * leftZ > 0;
        const hand = free.length === 2 ? (onLeft ? "left" : "right") : free[0]!;
        const target = new THREE.Vector3(b.gx, floorHeight(b.gx, b.gz) + size.grip, b.gz);
        state.grab = { pack: b.id, hand, at: state.simulationTime, target, kind: b.kind, bags: b.bags, cups: b.cups, confirmed: false };
        link.send({ type: "pickup", pack: b.id, hand });
      }
    }
    // E: pick up food from the counter, one thing per free hand (only what this player ordered).
    if (state.interactQueued && place && lp && standing && !state.grab && !state.drop) {
      const free = (["right", "left"] as const).filter((h) => !hands[h]);
      let best: { pack: FoodPack; d: number } | null = null;
      for (const p of view.packs) {
        if (p.key !== place.key || p.where !== "counter" || p.owner !== me) continue;
        const slot = place.places.slots[p.slot];
        if (!slot || !canReach(slot, lp[0], lp[1])) continue;
        const d = Math.hypot(slot.x - lp[0], slot.z - lp[1]);
        if (!best || d < best.d) best = { pack: p, d };
      }
      if (best && free.length) {
        state.interactQueued = false;
        const slot = place.places.slots[best.pack.slot]!;
        const [wx, wz] = toWorld(place.room.frame, slot.x, slot.z);
        const leftX = Math.cos(state.rotY), leftZ = -Math.sin(state.rotY);
        const onLeft = (wx - state.pos.x) * leftX + (wz - state.pos.z) * leftZ > 0;
        const hand = free.length === 2 ? (onLeft ? "left" : "right") : free[0]!;
        const size = PACK_SIZE[best.pack.kind];
        // Bags by the top (the folded top, or the handles); a cup by its side, toward the player.
        const target = new THREE.Vector3(wx, SIDEWALK_H + COUNTER.height + size.grip, wz);
        if (best.pack.kind === "cup") { const dx = state.pos.x - wx, dz = state.pos.z - wz, d = Math.hypot(dx, dz) || 1; target.x += dx / d * 0.05; target.z += dz / d * 0.05; }
        state.grab = { pack: best.pack.id, hand, at: state.simulationTime, target, kind: best.pack.kind, bags: best.pack.bags, cups: best.pack.cups, confirmed: false };
        link.send({ type: "grab", pack: best.pack.id, hand });
      }
    }

    // ---------- eating in, eating on a bench, and throwing empties away ----------
    const st = state.simulationTime, mm = meal.current;
    const kindOf = (p: FoodPack) => byKey.get(p.key)?.kind ?? "burger";
    const startGrab = (pk: FoodPack, target: THREE.Vector3, type: "grab" | "pickup") => {
      const free = (["right", "left"] as const).filter((h) => !hands[h]);
      if (!free.length) return false;
      state.grab = { pack: pk.id, hand: free[0]!, at: st, target, kind: pk.kind, bags: pk.bags, cups: pk.cups, confirmed: false };
      link.send({ type, pack: pk.id, hand: free[0]! });
      return true;
    };
    // The number sign for eating in: taken off the counter as soon as it is put there.
    if (place && lp && !state.grab && !state.drop && !state.put && !state.seat && !state.script) {
      const sign = view.packs.find((p) => p.key === place.key && p.kind === "sign" && p.where === "counter" && p.owner === me);
      const slot = sign ? place.places.slots[sign.slot] : undefined;
      if (sign && slot && lp[1] > slot.z && Math.hypot(slot.x - lp[0], slot.z - lp[1]) < 1.4) {
        const [wx, wz] = toWorld(place.room.frame, slot.x, slot.z);
        startGrab(sign, new THREE.Vector3(wx, SIDEWALK_H + COUNTER.height + PACK_SIZE.sign.grip, wz), "grab");
      }
    }
    // Sitting down at a table with the sign: it is stood on the table in front.
    const seat = state.seat, seatRoom = seat ? state.rooms.get(seat.room) : undefined;
    if (seat?.phase === "seated" && seatRoom && !state.put && !state.grab) {
      const hand = (["right", "left"] as const).find((h) => hands[h]?.kind === "sign");
      const table = seat.plan.table !== null ? seatRoom.items[seat.plan.table] : undefined, chair = seatRoom.items[seat.plan.chair];
      if (hand && table && chair) {
        const dx = chair.x - table.x, dz = chair.z - table.z, d = Math.hypot(dx, dz) || 1;
        const lx = table.x + dx / d * (TABLE.half - 0.16), lz = table.z + dz / d * (TABLE.half - 0.16);
        const [wx, wz] = toWorld(seatRoom.frame, lx, lz);
        state.put = { pack: hands[hand]!.id, hand, at: st, target: new THREE.Vector3(wx, SIDEWALK_H + TABLE.top + PACK_SIZE.sign.grip, wz), where: "table", yaw: state.rotY + Math.PI, sent: false };
      }
    }
    // Setting something down (on a table, or beside oneself on a bench): let go when the hand gets there.
    const put = state.put;
    if (put) {
      const t = st - put.at;
      if (!put.sent && t >= GRAB_CONTACT) {
        put.sent = true;
        const size = PACK_SIZE[hands[put.hand]?.kind ?? "bag"];
        const y = put.target.y - size.grip;
        link.send({ type: "set", pack: put.pack, where: put.where, x: cents(put.target.x), y: cents(y), z: cents(put.target.z), yaw: cents(put.yaw) });
        dropped.set(put.pack, { x: put.target.x, z: put.target.z, yaw: put.yaw, y, until: Date.now() + 3000 });
      }
      if (t >= GRAB_TIME) state.put = null;
    }
    // Eating: an item at a time, two in-game minutes each; then the nutrition, and the next.
    const eat = state.eating;
    if (eat && st - eat.at >= EAT_SECONDS) {
      const pk = view.packs.find((p) => p.id === eat.pack), price = pk ? priceOf(kindOf(pk), eat.item)?.price ?? 0 : 0;
      const after = consume(state, eat.item, price);
      state.hunger = after.hunger; state.thirst = after.thirst;
      link.send({ type: "ate", pack: eat.pack, item: eat.item });
      // Until the shared state shows it gone, that item is not started again.
      mm.justAte = { pack: eat.pack, item: eat.item, left: (pk?.items.filter((n) => n === eat.item).length ?? 1) - 1, until: Date.now() + 4000 };
      state.eating = null;
    }
    const ja = mm.justAte;
    if (ja && (Date.now() > ja.until || (view.packs.find((p) => p.id === ja.pack)?.items.filter((n) => n === ja.item).length ?? 0) <= ja.left)) mm.justAte = null;
    const nextItem = (items: string[]) => items.find((n) => !isDrinkName(n)) ?? items[0];
    const startEating = (pk: FoodPack) => {
      if (mm.justAte) return "wait";
      const item = nextItem(pk.items);
      if (!item) return "none";
      if (!canConsume(state, item)) return "full";
      state.eating = { pack: pk.id, item, at: st, drink: isDrinkName(item) };
      link.send({ type: "eat", pack: pk.id, item });
      return "eating";
    };
    // At a table: once the tray is in front, everything on it is eaten (food first, then drinks).
    const myTray = view.packs.find((p) => p.kind === "tray" && p.owner === me && p.where === "table" && !p.done);
    if (seat?.phase === "seated" && myTray && !state.eating && !state.put && Math.hypot(myTray.gx - state.pos.x, myTray.gz - state.pos.z) < 1.3) {
      if (startEating(myTray) === "full") { link.send({ type: "leave", pack: myTray.id }); state.standQueued = true; }
    }
    // Got up from the table with food left on the tray: it is cleared away (and eating stops).
    if (myTray && !seat && mm.leftTray !== myTray.id) { mm.leftTray = myTray.id; state.eating = null; link.send({ type: "leave", pack: myTray.id }); }
    // On a park bench with food to go: set it down alongside, eat it all, then take the (empty) packs back up.
    if (state.bench?.phase === "seated" && !state.put && !state.grab) {
      const seatAt = BENCH_SEATS[state.bench.seat];
      const full = (h: GameState["hands"]["left"]) => !!h && h.kind !== "sign" && h.kind !== "tray" && (h.items?.length ?? 0) > 0;
      const hand = (["right", "left"] as const).find((h) => full(hands[h]));
      if (seatAt && hand && !mm.benchDone) {
        const side = hand === "left" ? 1 : -1, lx = Math.cos(seatAt.yaw), lz = -Math.sin(seatAt.yaw), y = floorHeight(seatAt.x, seatAt.z) + BENCH_SEAT_TOP;
        const x = seatAt.x + lx * side * 0.42, z = seatAt.z + lz * side * 0.42;
        state.put = { pack: hands[hand]!.id, hand, at: st, target: new THREE.Vector3(x, y + PACK_SIZE[hands[hand]!.kind].grip, z), where: "aside", yaw: seatAt.yaw, sent: false };
      } else if (!state.eating) {
        const aside = view.packs.filter((p) => p.where === "aside" && p.holder === me && !dropped.has(p.id));
        const food = aside.find((p) => p.items.some((n) => !isDrinkName(n))) ?? aside.find((p) => p.items.length);
        const went = !mm.benchDone && food ? startEating(food) : "none";
        if (went !== "eating" && went !== "wait" && aside.length) {
          // Finished (or full): the packs are picked back up, one in each hand.
          mm.benchDone = true;
          const back = aside[0]!;
          startGrab(back, new THREE.Vector3(back.gx, back.gy + PACK_SIZE[back.kind].grip, back.gz), "pickup");
        }
      }
    }
    if (!state.bench) mm.benchDone = false;
    // E by a bin with empties: walk up to it and drop them in, one at a time.
    const empties = (["left", "right"] as const).filter((h) => { const x = hands[h]; return !!x && x.kind !== "sign" && x.kind !== "tray" && (x.items?.length ?? 0) === 0; });
    if (state.interactQueued && empties.length && !mm.toss && onFoot && !state.grab && !state.drop && !state.interior) {
      const bin = PARK_BINS.find((b) => Math.hypot(b.x - state.pos.x, b.z - state.pos.z) < 1.8);
      if (bin) {
        state.interactQueued = false;
        const dx = state.pos.x - bin.x, dz = state.pos.z - bin.z, d = Math.hypot(dx, dz) || 1;
        const front: [number, number] = [bin.x + dx / d * 0.62, bin.z + dz / d * 0.62];
        mm.toss = { bin, from: [state.pos.x, state.pos.z], fromYaw: state.rotY, at: st, front, yaw: Math.atan2(-dx, -dz), items: empties.map((h) => ({ id: hands[h]!.id, hand: h })), sent: new Set() };
      }
    }
    const toss = mm.toss;
    if (toss) {
      // Small steps up to the bin, facing it; then each hand in turn reaches out over it and lets go.
      const walk = walkTime(toss.from, toss.front), t = st - toss.at, each = 0.9;
      let x = toss.front[0], z = toss.front[1], yaw = toss.yaw, speed = 0;
      if (t < walk) { const w = walkTo(t / walk, toss.from, toss.front, toss.fromYaw, toss.yaw); x = w.at[0]; z = w.at[1]; yaw = w.yaw; speed = Math.hypot(toss.front[0] - toss.from[0], toss.front[1] - toss.from[1]) / walk; }
      const k = Math.floor((t - walk) / each), u = t - walk - k * each, item = toss.items[k];
      const over = new THREE.Vector3(toss.bin.x, floorHeight(toss.bin.x, toss.bin.z) + BIN.h + 0.14, toss.bin.z);
      const reach = item && t >= walk ? (u < 0.4 ? Math.sin(Math.PI / 2 * u / 0.4) : 1 - Math.max(0, Math.min(1, (u - 0.5) / 0.4))) : 0;
      if (item && t >= walk && u >= 0.42 && !toss.sent.has(item.id)) {
        toss.sent.add(item.id);
        link.send({ type: "trash", pack: item.id, x: cents(over.x), y: cents(over.y - 0.1), z: cents(over.z) });
        dropped.set(item.id, { x: over.x, z: over.z, yaw, y: over.y - 0.1, until: Date.now() + 3000 });
      }
      const wr = (h: "left" | "right") => (item && item.hand === h && reach > 0 ? { at: over, blend: reach, pole: "out" as const } : null);
      state.foodScript = { x, z, yaw, walk: speed, sit: 0, shuffle: 0, lean: 0.15 * reach, left: wr("left"), right: wr("right") };
      if (t >= walk + each * toss.items.length) { mm.toss = null; state.foodScript = null; }
    }
  }, -0.7);

  // Only the restaurants nearby are drawn (all four sit around the park).
  const [near, setNear] = useState<string[]>([]);
  useFrame(() => {
    const list = places.filter((p) => { const [x, z] = toWorld(p.room.frame, 0, 0); return Math.hypot(x - state.pos.x, z - state.pos.z) < 90; }).map((p) => p.key);
    if (list.join() !== near.join()) setNear(list);
  });

  return <>
    {places.filter((p) => near.includes(p.key)).map((p) => <Staffed key={p.key} place={p} state={state} live={live} hands={runnerHands} staffAt={staffAt} />)}
    <Packs state={state} live={live} byKey={byKey} runnerHands={runnerHands} dropped={dropped} />
    <EatenFood state={state} live={live} byKey={byKey} />
    <Bins />
  </>;
}

// ---------- the staff ----------

const UNIFORM: Record<RestaurantKind, { apron: string; hat: string }> = {
  burger: { apron: "#e53935", hat: "#e53935" },
  pizza: { apron: "#2e7d4f", hat: "#ffffff" },
  cafe: { apron: "#4a3221", hat: "#2e5d43" },
  fine: { apron: "#1d1d1d", hat: "#ffffff" },
};

/** The thing each place's staff wear on their head (red caps at the burger place, and so on), and an apron. */
function dressUp(rig: BodyRig, kind: RestaurantKind) {
  const head = rig.head.current, torso = rig.torso.current;
  if (!head || !torso) return () => {};
  const u = UNIFORM[kind], mat = (c: string, r = 0.7) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const hat = new THREE.Group(), apron = new THREE.Group();
  const add = (g: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]) => {
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(...pos); mesh.rotation.set(...rot); mesh.scale.set(...scale); mesh.castShadow = true; g.add(mesh); return mesh;
  };
  if (kind === "burger") {
    // A red baseball cap: crown and a peak out front.
    const red = mat(u.hat, 0.6);
    add(hat, new THREE.SphereGeometry(0.15, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), red, [0, 0.025, 0], [0, 0, 0], [1, 0.8, 1]);
    add(hat, new THREE.CylinderGeometry(0.1, 0.1, 0.012, 20, 1, false, -Math.PI / 2, Math.PI), red, [0, 0.03, 0.12], [0.12, 0, 0], [1, 1, 0.9]);
    add(hat, new THREE.SphereGeometry(0.018, 8, 6), mat("#ffcc00"), [0, 0.145, 0]);
  } else if (kind === "pizza") {
    // A white chef's hat: a band and a puffed top.
    const white = mat(u.hat, 0.85);
    add(hat, new THREE.CylinderGeometry(0.135, 0.14, 0.09, 20), white, [0, 0.1, 0]);
    add(hat, new THREE.SphereGeometry(0.165, 20, 12), white, [0, 0.2, 0], [0, 0, 0], [1, 0.62, 1]);
  } else if (kind === "cafe") {
    // A knitted beanie with a turned-up cuff.
    const knit = mat(u.hat, 0.95);
    add(hat, new THREE.SphereGeometry(0.152, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), knit, [0, 0.02, 0], [0, 0, 0], [1, 0.95, 1]);
    add(hat, new THREE.TorusGeometry(0.148, 0.02, 8, 24), knit, [0, 0.03, 0], [Math.PI / 2, 0, 0]);
  } else {
    // A white headband (hachimaki) with the red sun at the front.
    add(hat, new THREE.TorusGeometry(0.143, 0.022, 8, 28), mat(u.hat, 0.8), [0, 0.05, 0], [Math.PI / 2, 0, 0], [1, 1, 1.3]);
    add(hat, new THREE.CircleGeometry(0.025, 16), mat("#c62828"), [0, 0.05, 0.168]);
  }
  add(apron, new THREE.BoxGeometry(0.27, 0.42, 0.012), mat(u.apron, 0.85), [0, 0.13, 0.163]);
  head.add(hat); torso.add(apron);
  return () => { head.remove(hat); torso.remove(apron); hat.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); apron.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); };
}

function Worker({ rigRef, color, kind }: { rigRef: (rig: BodyRig) => void; color: string; kind: RestaurantKind }) {
  const rig = useBodyRig();
  useEffect(() => { rigRef(rig); return dressUp(rig, kind); }, [rig, kind, rigRef]);
  return <CharacterBody rig={rig} color={color} />;
}

/** Stands a worker's body: legs stepping by `phase` when moving, a little breathing otherwise. */
function poseBody(rig: BodyRig, phase: number, moving: number, time: number, lean = 0) {
  const s = Math.sin(phase), c = Math.cos(phase), legA = 0.5 * moving, kneeA = 0.65 * moving;
  rig.thighL.current?.rotation.set(-s * legA, 0, 0);
  rig.thighR.current?.rotation.set(s * legA, 0, 0);
  rig.shinL.current?.rotation.set(0.08 + kneeA * Math.max(0, c), 0, 0);
  rig.shinR.current?.rotation.set(0.08 + kneeA * Math.max(0, -c), 0, 0);
  rig.armL.current?.rotation.set(s * 0.4 * moving, 0, 0.12);
  rig.armR.current?.rotation.set(-s * 0.4 * moving, 0, -0.12);
  rig.foreL.current?.rotation.set(-0.15, 0, 0);
  rig.foreR.current?.rotation.set(-0.15, 0, 0);
  const breathe = Math.sin(time * 2) * 0.012 * (1 - moving);
  if (rig.hips.current) rig.hips.current.position.y = 0.95 - Math.abs(c) * 0.035 * moving + breathe;
  rig.torso.current?.rotation.set(0.05 * moving + lean, 0, 0);
  rig.head.current?.rotation.set(-lean * 0.6, 0, 0);
}

/** A restaurant's cashier (with the speech bubble) and kitchen runner. */
const Staffed = memo(function Staffed({ place, state, live, hands, staffAt }: { place: Place; state: GameState; live: React.RefObject<Live>; hands: Hands; staffAt: Map<string, { x: number; z: number; r: number }[]> }) {
  const { room, places: P, kind, key } = place;
  const f = room.frame;
  const colors = useMemo(() => { const r = (n: number) => ((Math.sin(place.seed * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1; return [bodyColor(r(1) < 0.5 ? "female" : "male"), bodyColor(r(2) < 0.5 ? "female" : "male")] as const; }, [place.seed]);
  const cashier = useRef<BodyRig | null>(null), runner = useRef<BodyRig | null>(null);
  const setCashier = useMemo(() => (r: BodyRig) => { cashier.current = r; }, []);
  const setRunner = useMemo(() => (r: BodyRig) => { runner.current = r; }, []);
  const walk = useRef({ phase: 0, x: 0, z: 0 });
  const bubble = useRef<THREE.Group>(null);
  const [said, setSaid] = useState<{ text: string; shown: boolean }>({ text: "", shown: false });
  const v = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), look: new THREE.Vector3() }), []);
  useEffect(() => () => { staffAt.delete(key); }, [staffAt, key]);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05), now = state.simulationTime, L = live.current;
    if (!L) return;
    const view = L.view, session = view.sessions.get(key);
    // ---- cashier: behind the register, facing the customers ----
    const c = cashier.current;
    if (c?.root.current) {
      const [x, z] = toWorld(f, P.cashier.x, P.cashier.z);
      c.root.current.position.set(x, SIDEWALK_H, z);
      c.root.current.rotation.set(0, worldYaw(f, P.cashier.yaw), 0);
      poseBody(c, 0, 0, now + place.seed);
      if (session) {
        const age = ageNow(L, session.ago);
        // Talking: a little nod while speaking.
        const talk = age < 3 ? Math.sin(age * 9) * 0.05 * (1 - smooth((age - 2.4) / 0.6)) : 0;
        c.head.current?.rotation.set(talk, 0, 0);
        if (session.stage === "told") {
          // Pointing (right arm) where to wait: the pick-up spot by the register, or the tables.
          const target = session.mode === "togo" ? P.slots[0] ?? P.register : P.tables;
          const [tx, tz] = toWorld(f, target.x, target.z);
          v.a.set(tx, SIDEWALK_H + (session.mode === "togo" ? COUNTER.height + 0.15 : 1.0), tz);
          const blend = smooth((age - 0.35) / 0.55) * (1 - smooth((age - 2.9) / 0.7));
          c.root.current.updateMatrixWorld(true);
          pointArm(c.armR.current, c.foreR.current, v.a, blend);
        }
      }
    }
    // ---- runner: the kitchen, out to the counter with food or to take it back ----
    const r = runner.current, trip = view.trips.get(key);
    if (r?.root.current) {
      const t = trip ? ageNow(L, trip.ago) : 0;
      const tripPlain: Trip | null = trip ? { task: trip.task, slots: trip.slots } : null;
      const pose = runnerPose(P, room, tripPlain, t);
      const [x, z] = toWorld(f, pose.x, pose.z);
      const w = walk.current;
      w.phase += dt * pose.speed * 4.2;
      r.root.current.position.set(x, SIDEWALK_H, z);
      r.root.current.rotation.set(0, worldYaw(f, pose.yaw), 0);
      const moving = Math.min(1, pose.speed / 1.3);
      poseBody(r, w.phase, moving, now + place.seed * 0.7, 0.3 * pose.reach);
      if (pose.carrying) {
        // Food in both hands at the waist, forearms bent, arms swinging a little.
        const s = Math.sin(w.phase) * 0.25 * moving;
        r.armL.current?.rotation.set(s, 0, 0.22); r.foreL.current?.rotation.set(carryElbow(s), 0, 0);
        r.armR.current?.rotation.set(-s, 0, -0.22); r.foreR.current?.rotation.set(carryElbow(-s), 0, 0);
      }
      if (pose.reach > 0 && trip?.to) {
        // At a table: the right hand takes the number sign (or a hand clears the tray), and the left sets the tray
        // down where the sign stood.
        r.root.current.updateMatrixWorld(true);
        const target = trip.packs.map((id) => view.packs.find((p) => p.id === id)).find((p) => p && (p.where === "table" || p.where === "runner"));
        const [tx, tz] = toWorld(f, trip.to[0], trip.to[1]);
        v.b.set(target?.where === "table" ? target.gx : tx, (target?.where === "table" ? target.gy : SIDEWALK_H + TABLE.top) + 0.08, target?.where === "table" ? target.gz : tz);
        if (trip.task === "serve") { reachArm(r.armR.current, r.foreR.current, v.b, POLES.low(-1), Math.min(1, pose.reach * 1.2)); reachArm(r.armL.current, r.foreL.current, v.b.clone().add(new THREE.Vector3(0, -0.06, 0)), POLES.low(1), pose.reach); }
        else { reachArm(r.armL.current, r.foreL.current, v.b, POLES.low(1), pose.reach); reachArm(r.armR.current, r.foreR.current, v.b, POLES.low(-1), pose.reach); }
      } else if (pose.reach > 0 && trip) {
        // Reaching over the counter to set the food down (or take it up), each hand to its own spot.
        r.root.current.updateMatrixWorld(true);
        const sorted = [...trip.slots].sort((a, b) => (P.slots[b]?.x ?? 0) - (P.slots[a]?.x ?? 0));
        const kinds = trip.packs.map((id) => view.packs.find((p) => p.id === id)?.kind ?? "bag");
        // The runner faces +z, so its left hand is on the +x side: it takes the spot furthest that way.
        sorted.forEach((slot, i) => {
          const s = P.slots[slot]; if (!s) return;
          const [sx, sz] = toWorld(f, s.x, s.z);
          v.b.set(sx, SIDEWALK_H + COUNTER.height + PACK_SIZE[kinds[trip.slots.indexOf(slot)] ?? "bag"].grip, sz);
          if (i === 0) reachArm(r.armL.current, r.foreL.current, v.b, POLES.low(1), pose.reach);
          else reachArm(r.armR.current, r.foreR.current, v.b, POLES.low(-1), pose.reach);
        });
      }
      r.root.current.updateMatrixWorld(true);
      const entry = hands.get(key) ?? { left: new THREE.Vector3(), right: new THREE.Vector3(), yaw: 0 };
      if (r.foreL.current) handWorld(r.foreL.current, entry.left);
      if (r.foreR.current) handWorld(r.foreR.current, entry.right);
      entry.yaw = worldYaw(f, pose.yaw);
      hands.set(key, entry);
      // Both of them are solid: nobody walks through the cashier or the runner.
      const [cx, cz] = toWorld(f, P.cashier.x, P.cashier.z);
      staffAt.set(key, [{ x: cx, z: cz, r: 0.3 }, { x, z, r: 0.3 }]);
    }
    // ---- the speech bubble over the cashier, for anyone in the restaurant ----
    const show = !!session && state.interior?.key === key && state.interior.phase === "inside";
    const text = session?.text ?? "";
    if (show !== said.shown || (show && text !== said.text)) setSaid({ text: show ? text : said.text, shown: show });
    if (bubble.current) {
      const [x, z] = toWorld(f, P.cashier.x, P.cashier.z);
      bubble.current.position.set(x, SIDEWALK_H + 2.28, z);
    }
  });

  return <>
    <Worker rigRef={setCashier} color={colors[0]} kind={kind} />
    <Worker rigRef={setRunner} color={colors[1]} kind={kind} />
    <group ref={bubble}>
      <Html center distanceFactor={5.5} zIndexRange={[8, 0]} pointerEvents="none">
        <div className={`speech-bubble ${said.shown ? "shown" : ""}`} role="status" aria-live="polite">{said.text}</div>
      </Html>
    </group>
  </>;
});

// ---------- the food itself ----------

/** Paper, plastic and card for the packs, and each place's printed bag. */
function usePackLooks() {
  return useMemo(() => {
    const m = (color: string, roughness = 0.85, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
    const brand = Object.fromEntries((Object.keys(RESTAURANTS) as RestaurantKind[]).map((kind) => {
      const [c, g] = canvas(256, 256);
      g.fillStyle = "#c8a27a"; g.fillRect(0, 0, 256, 256);
      // The place's emblem and name printed on the side.
      g.fillStyle = "rgba(255,255,255,0.88)"; g.beginPath(); g.arc(128, 104, 74, 0, Math.PI * 2); g.fill();
      drawBrandIcon(kind, g, 128, 108, 92);
      g.fillStyle = "#3b2a1e"; g.textAlign = "center"; g.textBaseline = "middle";
      const name = RESTAURANTS[kind].name;
      let size = 30; g.font = `800 ${size}px Manrope, Arial, sans-serif`;
      while (g.measureText(name).width > 230 && size > 12) { size -= 1; g.font = `800 ${size}px Manrope, Arial, sans-serif`; }
      g.fillText(name, 128, 212);
      const map = tex(c);
      return [kind, new THREE.MeshStandardMaterial({ map, roughness: 0.85 })];
    })) as Record<RestaurantKind, THREE.MeshStandardMaterial>;
    const cupColor: Record<RestaurantKind, string> = { cafe: "#f3ece0", pizza: "#ffffff", fine: "#f4efe6", burger: "#ffffff" };
    const sleeve: Record<RestaurantKind, string> = { cafe: "#6b4a2f", pizza: "#2e7d4f", fine: "#b71c1c", burger: "#e53935" };
    return {
      kraft: m("#c8a27a"), kraftDark: m("#a8835c"), lid: m("#f8f8f6", 0.35), sticker: Object.fromEntries(Object.entries(sleeve).map(([k, c]) => [k, m(c, 0.6)])) as Record<RestaurantKind, THREE.MeshStandardMaterial>,
      cup: Object.fromEntries(Object.entries(cupColor).map(([k, c]) => [k, m(c, 0.5)])) as Record<RestaurantKind, THREE.MeshStandardMaterial>,
      tray: m("#9e9585", 0.95), handle: m("#b48e66", 0.9), brand,
      bottlePlastic: new THREE.MeshStandardMaterial({ color: "#dff1ff", roughness: 0.08, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false }),
      water: new THREE.MeshStandardMaterial({ color: "#9fd3f5", roughness: 0.05, transparent: true, opacity: 0.45, depthWrite: false }),
      bottleLabel: m("#1e78c8", 0.5), bottleCap: m("#1565c0", 0.4),
      signBase: m("#2b2b2b", 0.4), signCard: m("#fafafa", 0.35),
      trayTop: { cafe: m("#6b4a2f", 0.6), pizza: m("#2e7d4f", 0.6), fine: m("#1d1d1d", 0.4), burger: m("#c62828", 0.5) } as Record<RestaurantKind, THREE.MeshStandardMaterial>,
      number: (() => {
        const cache = new Map<number, THREE.MeshStandardMaterial>();
        return (n: number) => {
          let mt = cache.get(n);
          if (!mt) {
            const [c, g] = canvas(128, 128);
            g.fillStyle = "#fafafa"; g.fillRect(0, 0, 128, 128);
            g.fillStyle = "#1d1d1d"; g.textAlign = "center"; g.textBaseline = "middle"; g.font = "800 84px Manrope, Arial, sans-serif"; g.fillText(String(n), 64, 70);
            mt = new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.5 }); cache.set(n, mt);
          }
          return mt;
        };
      })(),
      geo: {
        box: new THREE.BoxGeometry(1, 1, 1),
        cup: new THREE.CylinderGeometry(0.046, 0.036, 0.15, 20),
        sleeve: new THREE.CylinderGeometry(0.0445, 0.04, 0.06, 20),
        lidRim: new THREE.CylinderGeometry(0.05, 0.05, 0.012, 24),
        lidDome: new THREE.CylinderGeometry(0.036, 0.046, 0.014, 24),
        lidTab: new THREE.BoxGeometry(0.022, 0.006, 0.016),
        handle: new THREE.TorusGeometry(0.075, 0.009, 6, 16, Math.PI),
        plane: new THREE.PlaneGeometry(1, 1),
        bottleBody: new THREE.CylinderGeometry(0.034, 0.034, 0.15, 20),
        bottleWater: new THREE.CylinderGeometry(0.031, 0.031, 0.118, 20),
        bottleLabel: new THREE.CylinderGeometry(0.0352, 0.0352, 0.05, 20, 1, true),
        bottleShoulder: new THREE.CylinderGeometry(0.014, 0.034, 0.045, 20),
        bottleNeck: new THREE.CylinderGeometry(0.0135, 0.0135, 0.022, 12),
        bottleCap: new THREE.CylinderGeometry(0.0155, 0.0155, 0.016, 12),
      },
    };
  }, []);
}
type Looks = ReturnType<typeof usePackLooks>;

/** A to-go cup: tapered, a printed sleeve, and a snap-on lid with a raised sip lip. Its base at the origin. */
function cupModel(looks: Looks, kind: RestaurantKind) {
  const g = new THREE.Group(), G = looks.geo;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number, extra?: (m: THREE.Mesh) => void) => { const mesh = new THREE.Mesh(geo, mat); mesh.position.y = y; mesh.castShadow = true; extra?.(mesh); g.add(mesh); return mesh; };
  add(G.cup, looks.cup[kind], 0.075);
  add(G.sleeve, looks.sticker[kind], 0.07);
  add(G.lidRim, looks.lid, 0.154);
  add(G.lidDome, looks.lid, 0.166);
  add(G.lidTab, looks.lid, 0.175, (m) => { m.position.z = 0.03; });
  return g;
}

/** A bottle of water: clear plastic with water inside, a printed label, a narrowing neck and a blue cap. */
function bottleModel(looks: Looks) {
  const g = new THREE.Group(), add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; g.add(m); return m; };
  add(looks.geo.bottleBody, looks.bottlePlastic, 0.075);
  add(looks.geo.bottleWater, looks.water, 0.06);
  add(looks.geo.bottleLabel, looks.bottleLabel, 0.08);
  add(looks.geo.bottleShoulder, looks.bottlePlastic, 0.172);
  add(looks.geo.bottleNeck, looks.bottlePlastic, 0.205);
  add(looks.geo.bottleCap, looks.bottleCap, 0.222);
  return g;
}

/** Builds a pack's model with its base at the origin and its front (the printed side) toward +z. */
function packModel(looks: Looks, p: FoodPack, kind: RestaurantKind) {
  const g = new THREE.Group(), G = looks.geo;
  const box = (mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => { const mesh = new THREE.Mesh(G.box, mat); mesh.scale.set(w, h, d); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh; };
  if (p.kind === "bag") {
    const s = PACK_SIZE.bag;
    box(looks.kraft, s.w, s.h - 0.05, s.d, 0, (s.h - 0.05) / 2, 0);
    // The top folded over twice, and the place's sticker sealing it.
    box(looks.kraftDark, s.w - 0.01, 0.05, s.d * 0.32, 0, s.h - 0.025, 0);
    box(looks.sticker[kind], 0.06, 0.04, 0.003, 0, s.h - 0.06, s.d / 2 + 0.002);
  } else if (p.kind === "cup") {
    g.add(p.items[0] === "Bottled Water" ? bottleModel(looks) : cupModel(looks, kind));
  } else if (p.kind === "sign") {
    // A white plastic table number: a little upright card on a base, the number big on both sides.
    box(looks.signBase, 0.09, 0.012, 0.06, 0, 0.006, 0);
    box(looks.signCard, 0.085, 0.12, 0.006, 0, 0.072, 0);
    for (const side of [1, -1]) { const face = new THREE.Mesh(G.plane, looks.number(p.sign)); face.scale.set(0.08, 0.08, 1); face.position.set(0, 0.075, side * 0.0035); face.rotation.y = side === 1 ? 0 : Math.PI; g.add(face); }
  } else if (p.kind === "tray") {
    // A tray with the order on it (what is left of it), laid out in rows.
    box(looks.trayTop[kind], PACK_SIZE.tray.w, 0.016, PACK_SIZE.tray.d, 0, 0.008, 0);
    const rest = [...p.items];
    if (p.eating) { const i = rest.indexOf(p.eating.item); if (i >= 0) rest.splice(i, 1); }
    rest.slice(0, 6).forEach((name, i) => {
      const d = dishModel(name), cols = Math.min(3, rest.length), col = i % 3, row = Math.floor(i / 3);
      d.scale.setScalar(rest.length > 3 ? 0.62 : 0.78);
      d.position.set((col - (cols - 1) / 2) * 0.15, 0.016, (row - 0.5 * (rest.length > 3 ? 1 : 0)) * 0.15);
      g.add(d);
    });
  } else {
    const s = PACK_SIZE.big;
    box(looks.kraft, s.w, s.h, s.d, 0, s.h / 2, 0);
    // The printed side faces whoever it is for.
    const print = new THREE.Mesh(G.plane, looks.brand[kind]); print.scale.set(0.28, 0.28, 1); print.position.set(0, s.h * 0.5, s.d / 2 + 0.002); g.add(print);
    // Two twisted-paper handles over the top.
    for (const z of [-0.06, 0.06]) { const h = new THREE.Mesh(G.handle, looks.handle); h.position.set(0, s.h, z); h.scale.set(1.1, 1.45, 1); g.add(h); }
    // Inside: the cups in their holder, lids peeking over the top; the small bags beside them.
    if (p.cups > 0) {
      const tray = box(looks.tray, 0.2, 0.05, 0.2 * 0 + s.d - 0.03, -0.08, s.h - 0.2, 0);
      tray.castShadow = false;
      [[-0.045, -0.045], [0.045, -0.045], [-0.045, 0.045], [0.045, 0.045]].slice(0, Math.min(4, p.cups)).forEach(([cx, cz]) => {
        const cup = cupModel(looks, kind); cup.position.set(-0.08 + cx!, s.h - 0.175, cz! * 0.85); g.add(cup);
      });
    }
    for (let i = 0; i < p.bags; i++) box(looks.kraftDark, 0.1, 0.04, s.d - 0.05, p.cups ? 0.1 : -0.12 + i * 0.12, s.h - 0.01 - i * 0.004, 0);
  }
  return g;
}

const PackObject = memo(function PackObject({ looks, pack, kind, objects }: { looks: Looks; pack: FoodPack; kind: RestaurantKind; objects: Map<number, THREE.Group> }) {
  const model = useMemo(() => packModel(looks, pack, kind), [looks, pack.kind, pack.bags, pack.cups, kind, pack.items.join("|"), pack.eating?.item, pack.sign]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { objects.set(pack.id, model); return () => { objects.delete(pack.id); }; }, [objects, pack.id, model]);
  return <primitive object={model} />;
});

/** Every pack of food: on a counter, in a runner's hands, or in a player's hand (always upright). */
function Packs({ state, live, byKey, runnerHands, dropped }: { state: GameState; live: React.RefObject<Live>; byKey: Map<string, Place>; runnerHands: Hands; dropped: Map<number, { x: number; z: number; yaw: number; y?: number }> }) {
  const looks = usePackLooks();
  const objects = useMemo(() => new Map<number, THREE.Group>(), []);
  const [list, setList] = useState<FoodPack[]>([]);
  const at = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const L = live.current; if (!L) return;
    const view = L.view, me = (state.foodLink ?? null)?.me() ?? "me";
    const shown = view.packs.filter((p) => p.where !== "kitchen" && p.where !== "gone");
    const key = (p: FoodPack) => `${p.id}:${p.kind}:${p.bags}:${p.cups}:${p.items.join("|")}:${p.eating?.item ?? ""}`;
    const sig = shown.map(key).join();
    if (sig !== list.map(key).join()) setList(shown);
    for (const p of shown) {
      const obj = objects.get(p.id), place = byKey.get(p.key);
      if (!obj || !place) continue;
      const f = place.room.frame, size = PACK_SIZE[p.kind];
      obj.visible = true;
      const grab = state.grab;
      const inMyHand = (p.where === "held" && p.holder === me && !dropped.has(p.id)) || (grab?.pack === p.id && state.simulationTime - grab.at >= GRAB_CONTACT);
      const set = p.where === "ground" || p.where === "table" || p.where === "aside" || p.where === "trash";
      const down = dropped.get(p.id) ?? (set ? { x: p.gx, z: p.gz, yaw: p.gyaw, y: p.where === "ground" ? undefined : p.gy } : null);
      if (p.where === "trash" || (down && dropped.has(p.id) && view.packs.find((q) => q.id === p.id)?.where === "held" && (down.y ?? 0) > floorHeight(down.x, down.z) + 0.5 && PARK_BINS.some((b) => Math.hypot(b.x - down.x, b.z - down.z) < 0.3))) {
        // Dropped into a bin: it falls to the bottom, out of sight.
        const age = p.where === "trash" ? -p.at + (Date.now() - L.at) / 1000 : 0;
        const top = down?.y ?? p.gy, bottom = floorHeight(p.gx, p.gz) + 0.05;
        obj.position.set(down?.x ?? p.gx, Math.max(bottom, top - 4.9 * age * age), down?.z ?? p.gz);
        obj.visible = age < 0.55;
      } else if (down && !inMyHand) {
        // Set down (on the ground, a table or a bench), upright, where it was put.
        obj.position.set(down.x, down.y ?? floorHeight(down.x, down.z), down.z);
        obj.rotation.set(0, down.yaw, 0);
      } else if (inMyHand || p.where === "held") {
        const hand = inMyHand && grab?.pack === p.id ? grab.hand : p.hand;
        let fore: THREE.Object3D | null | undefined, yaw = 0;
        if (inMyHand) { fore = state.avatar.body[hand === "left" ? 9 : 11]; yaw = state.rotY; }
        else { const rig = state.remoteRigs.get(p.holder); fore = hand === "left" ? rig?.foreL.current : rig?.foreR.current; yaw = rig?.root.current?.rotation.y ?? 0; }
        if (!fore) { obj.visible = false; continue; }
        fore.updateWorldMatrix(true, false);
        handWorld(fore, at);
        // Hanging from the hand (a cup held by its side, just in front of the palm), always upright.
        if (p.kind === "cup") at.addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), 0.045);
        obj.position.set(at.x, at.y - size.grip, at.z);
        obj.rotation.set(0, yaw + (p.kind === "big" ? Math.PI / 2 * (hand === "left" ? 1 : -1) : 0), 0);
      } else if (p.where === "runner") {
        const trip = view.trips.get(p.key), h = runnerHands.get(p.key);
        if (!trip || !h) { obj.visible = false; continue; }
        // Same hands as the runner reaches with: the pack for the spot furthest toward +x in the left.
        const P = place.places, slotX = (id: number) => P.slots[trip.slots[trip.packs.indexOf(id)] ?? 0]?.x ?? 0;
        const order = [...trip.packs].sort((a, b) => slotX(b) - slotX(a));
        // At tables: the tray on the left hand, the number sign taken back in the right.
        const left = trip.to ? p.kind === "tray" : order.indexOf(p.id) === 0;
        const hp = left ? h.left : h.right;
        obj.position.set(hp.x, hp.y - size.grip, hp.z);
        obj.rotation.set(0, h.yaw, 0);
      } else {
        const slot = place.places.slots[p.slot];
        if (!slot) { obj.visible = false; continue; }
        const [x, z] = toWorld(f, slot.x, slot.z);
        obj.position.set(x, SIDEWALK_H + COUNTER.height, z);
        obj.rotation.set(0, worldYaw(f, 0), 0);
      }
    }
  });
  return <>{list.map((p) => <PackObject key={p.id} looks={looks} pack={p} kind={byKey.get(p.key)?.kind ?? "burger"} objects={objects} />)}</>;
}


/** Whatever someone is eating or drinking right now, in their right hand (a bite smaller every few seconds). */
export function EatenFood({ state, live, byKey }: { state: GameState; live: React.RefObject<Live>; byKey: Map<string, Place> }) {
  const holder = useRef<THREE.Group>(null);
  const models = useRef(new Map<string, THREE.Group>());
  const at = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const L = live.current, g = holder.current;
    if (!L || !g) return;
    const me = state.foodLink?.me() ?? "me", seen = new Set<string>();
    for (const p of L.view.packs) {
      if (!p.eating) continue;
      const eater = p.kind === "tray" ? p.owner : p.holder;
      const key = `${p.id}:${p.eating.item}`;
      seen.add(key);
      let model = models.current.get(key);
      if (!model) { model = dishModel(p.eating.item); models.current.set(key, model); g.add(model); }
      const fore = eater === me ? state.avatar.body[11] : state.remoteRigs.get(eater)?.foreR.current;
      const yaw = eater === me ? state.rotY : state.remoteRigs.get(eater)?.root.current?.rotation.y ?? 0;
      if (!fore) { model.visible = false; continue; }
      void byKey;
      fore.updateWorldMatrix(true, false); handWorld(fore, at);
      const age = (eater === me && state.eating?.pack === p.id ? state.simulationTime - state.eating.at : -p.eating.at + (Date.now() - L.at) / 1000);
      const k = Math.max(0, Math.min(1, age / EAT_SECONDS)), drink = isDrinkName(p.eating.item);
      model.visible = true;
      model.position.set(at.x + Math.sin(yaw) * 0.04, at.y - (drink ? 0.09 : 0.03), at.z + Math.cos(yaw) * 0.04);
      // A drink tips up a little as it is sipped; food gets smaller bite by bite.
      const tip = drink ? Math.min(1, Math.max(0, (age - 0.5) / 0.6)) * (1 - Math.max(0, Math.min(1, (age - (EAT_SECONDS - 0.6)) / 0.6))) : 0;
      model.rotation.set(-0.55 * tip, yaw, 0, "YXZ");
      model.scale.setScalar(drink ? 1 : 1 - 0.55 * Math.floor(k * 3) / 3);
    }
    for (const [key, model] of models.current) if (!seen.has(key)) { g.remove(model); models.current.delete(key); }
  });
  return <group ref={holder} />;
}

/** The park's bins: black, round, open at the top, dark inside. */
export function Bins() {
  const parts = useMemo(() => ({
    outer: new THREE.MeshStandardMaterial({ color: "#1b1d1f", roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide }),
    inside: new THREE.MeshStandardMaterial({ color: "#050505", roughness: 1, side: THREE.BackSide }),
    rim: new THREE.MeshStandardMaterial({ color: "#2a2d30", roughness: 0.4, metalness: 0.5 }),
  }), []);
  return <>{PARK_BINS.map((b, i) => (
    <group key={i} position={[b.x, floorHeight(b.x, b.z), b.z]}>
      <mesh material={parts.outer} position-y={BIN.h / 2} castShadow receiveShadow><cylinderGeometry args={[BIN.r, BIN.r * 0.9, BIN.h, 28, 1, true]} /></mesh>
      <mesh material={parts.inside} position-y={BIN.h / 2 + 0.01}><cylinderGeometry args={[BIN.r - 0.012, BIN.r * 0.9 - 0.012, BIN.h - 0.02, 28, 1, true]} /></mesh>
      <mesh material={parts.inside} position-y={0.04} rotation-x={-Math.PI / 2}><circleGeometry args={[BIN.r * 0.9 - 0.01, 28]} /></mesh>
      <mesh material={parts.rim} position-y={BIN.h} rotation-x={Math.PI / 2}><torusGeometry args={[BIN.r, 0.014, 8, 32]} /></mesh>
    </group>
  ))}</>;
}
