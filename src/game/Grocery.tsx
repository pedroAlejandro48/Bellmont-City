import { handFree, handsFullMessage, holding as heldIn } from "./handsHeld";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { POLES, handWorld, reachArm } from "./arms";
import { CharacterBody, useBodyRig, type BodyRig } from "./CharacterBody";
import { SIDEWALK_H, timeInfo, type City } from "./config";
import { OPENER_PASS } from "./doors";
import {
  BASKET_MAX, GROCERY_PRICE, checkoutLength, checkoutSpots, clerkAt, landingSpot, payPlan, pickItem, pileSpot, planAt, returnBasket,
  sources, takeBasket, walkSeg, walkRoute, setGroceryObstacles, plan as makePlan, type GPose, type Plan, type Source,
} from "./groceryRun";
import { InteractionPrompt } from "./InteractionPrompt";
import { ITEMS, addItem, freeSlots, type ItemKind } from "./inventory";
import { isCandy } from "./pantry";
import { GroceryBagModel, ItemModel, useLooks, type Looks } from "./InventoryWorld";
import { lifeEvent } from "./lifeRuntime";
import { spend } from "./life";
import { ENTER, LEAVE, enterLead, enterPose, leaveLead, leavePose, nearDoorInside, toLocal, toWorld, worldYaw, type Reach } from "./restaurantRoom";
import { toast, type GameState, type Script } from "./state";
import { venueLayout, type VenueLayout } from "./venueRoom";
import { bodyColor } from "@/platform/account";

type InBasket = { kind: ItemKind; x: number; y: number; z: number; rot: number };
type Checkout = { who: "player" | number; t0: number; items: InBasket[] };
const money = (n: number) => `$${n.toFixed(2)}`;

/** The red plastic shopping basket (origin at the middle of its handles, where it's held; floor 0.24 below). */
function Basket({ looks, items }: { looks: Looks & { basket: THREE.Material }; items: InBasket[] }) {
  return <group>
    <group position={[0, -0.26, 0]}>
      <mesh position={[0, 0.01, 0]} material={looks.basket} castShadow>{<boxGeometry args={[0.42, 0.02, 0.28]} />}</mesh>
      {[-1, 1].map((s) => <mesh key={s} position={[s * 0.21, 0.09, 0]} material={looks.basket}><boxGeometry args={[0.015, 0.17, 0.28]} /></mesh>)}
      {[-1, 1].map((s) => <mesh key={s} position={[0, 0.09, s * 0.14]} material={looks.basket}><boxGeometry args={[0.42, 0.17, 0.015]} /></mesh>)}
      {items.map((it, i) => <group key={i} position={[it.x, 0.02 + it.y, it.z]} rotation-y={it.rot}><ItemModel kind={it.kind} looks={looks} /></group>)}
    </group>
    {/* The two handles, up together where the hand holds them. */}
    {[-1, 1].map((s) => <mesh key={s} position={[0, -0.12, s * 0.02]} rotation-x={s * 0.25} material={looks.basket}><torusGeometry args={[0.13, 0.009, 6, 16, Math.PI]} /></mesh>)}
  </group>;
}

/** Poses someone walking in (a shopper) from a move's pose: legs stepping with the motion, a squat, reaching hands. */
function poseBody(rig: BodyRig, pose: GPose & { sit?: number }, world: (x: number, z: number) => [number, number], yawOf: (y: number) => number, look: { phase: number; last: [number, number] | null }, dt: number) {
  const root = rig.root.current, hips = rig.hips.current;
  if (!root || !hips) return;
  const [wx, wz] = world(pose.x, pose.z);
  const speed = look.last ? Math.hypot(wx - look.last[0], wz - look.last[1]) / Math.max(dt, 1e-3) : 0;
  look.last = [wx, wz];
  look.phase += dt * Math.min(speed, 2) * 4.2;
  const mv = Math.min(1, speed / 0.8), sw = Math.sin(look.phase), cr = pose.crouch;
  root.position.set(wx, SIDEWALK_H, wz); root.rotation.y = yawOf(pose.yaw);
  hips.position.y = 0.95 - 0.42 * cr - Math.abs(Math.cos(look.phase)) * 0.03 * mv;
  rig.thighL.current?.rotation.set(sw * 0.5 * mv - 1.3 * cr, 0, 0.12); rig.thighR.current?.rotation.set(-sw * 0.5 * mv - 1.3 * cr, 0, -0.12);
  rig.shinL.current?.rotation.set((0.1 + Math.max(0, -sw) * 0.7) * mv + 2.0 * cr, 0, 0); rig.shinR.current?.rotation.set((0.1 + Math.max(0, sw) * 0.7) * mv + 2.0 * cr, 0, 0);
  rig.torso.current?.rotation.set(Math.max(pose.lean, 0.55 * cr), 0, 0);
  rig.head.current?.rotation.set(-pose.lean * 0.4, 0, 0);
  rig.armL.current?.rotation.set(-sw * 0.4 * mv, 0, 0.12); rig.armR.current?.rotation.set(sw * 0.4 * mv, 0, -0.12);
  rig.foreL.current?.rotation.set(-0.2, 0, 0); rig.foreR.current?.rotation.set(-0.2, 0, 0);
  root.updateMatrixWorld(true);
  const reach = (r: Reach | null, side: 1 | -1) => {
    if (!r) return;
    const [ax, az] = world(r.at[0], r.at[2]);
    const at = new THREE.Vector3(ax, SIDEWALK_H + r.at[1], az);
    if (side === 1) reachArm(rig.armL.current, rig.foreL.current, at, POLES[r.pole](1), r.blend);
    else reachArm(rig.armR.current, rig.foreR.current, at, POLES[r.pole](-1), r.blend);
  };
  reach(pose.left, 1); reach(pose.right, -1);
}

type Shopper = {
  id: number; color: string; stage: "approach" | "enter" | "take" | "pick" | "queue" | "pay" | "return" | "leave" | "away";
  plan: Plan | null; t0: number; prev: number; pose: GPose; basket: InBasket[] | null; bag: ItemKind[] | null; wants: Source[]; holding: ItemKind | null;
  side: 1 | -1; look: { phase: number; last: [number, number] | null };
};

/**
 * The grocery in play: E at the pile by the door takes a basket (nothing can be picked without one); E at a crate (or the water shelf) picks
 * one into it; E at the register pays — the basket goes on the belt, the clerk bags everything and hands the bag
 * over while the player takes the empty basket back; E at the door puts the basket back on the pile on the way out.
 * Now and then a shopper comes in and does the same.
 */
export function Grocery({ state, city }: { state: GameState; city: City }) {
  const b = useMemo(() => city.buildings.find((x) => x.venue === "grocery"), [city]);
  if (!b) return null;
  return <GroceryStore state={state} layout={venueLayout(b)} />;
}

function GroceryStore({ state, layout }: { state: GameState; layout: VenueLayout }) {
  const looks0 = useLooks();
  const looks = useMemo(() => Object.assign(looks0, { basket: new THREE.MeshStandardMaterial({ color: "#d62f3a", roughness: 0.55 }) }), [looks0]);
  const f = layout.frame;
  const world = (x: number, z: number) => toWorld(f, x, z);
  const yawOf = (y: number) => worldYaw(f, y);
  const pile = useMemo(() => layout.fixtures.find((x) => x.type === "baskets")!, [layout]);
  const srcs = useMemo(() => sources(layout), [layout]);
  // Everyone's walks here go round the shelves, crates and counter.
  useMemo(() => setGroceryObstacles(layout.solids, layout.bounds), [layout]);
  const spots = useMemo(() => checkoutSpots(layout), [layout]);
  const clerk = useBodyRig();

  // ---- the player's own run ----
  const run = useRef<{ plan: Plan | null; kind: string; t0: number; prev: number; src: Source | null; holding: ItemKind | null; exitAfter: boolean }>({ plan: null, kind: "", t0: 0, prev: -1, src: null, holding: null, exitAfter: false });
  const items = useRef<InBasket[]>([]);
  const falling = useRef<{ kind: ItemKind; from: THREE.Vector3; spot: InBasket; t0: number } | null>(null);
  const checkout = useRef<Checkout | null>(null);
  const shopper = useRef<Shopper | null>(null);
  const nextShopper = useRef(20 + Math.random() * 25);
  const [, rerender] = useState(0);
  const ownScript = useRef(false), served = useRef(false);
  const bump = () => rerender((k) => k + 1);

  const basketG = useRef<THREE.Group>(null), heldItemG = useRef<THREE.Group>(null), fallG = useRef<THREE.Group>(null);
  const counterBag = useRef<THREE.Group>(null), clerkItem = useRef<THREE.Group>(null);
  const shopperRig = useBodyRig();
  const shopperBasket = useRef<THREE.Group>(null), shopperBag = useRef<THREE.Group>(null), shopperItem = useRef<THREE.Group>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const promptRef = useRef<{ visible: boolean; x: number; y: number; z: number; label?: string | undefined }>({ visible: false, x: 0, y: 0, z: 0 });

  const local = () => toLocal(f, state.pos.x, state.pos.z);
  const inside = () => state.interior?.phase === "inside" && state.interior.key === layout.key;
  const start = (p: Plan, kind: string, extra: Partial<typeof run.current> = {}) => {
    run.current = { plan: p, kind, t0: state.simulationTime, prev: -1, src: null, holding: null, exitAfter: false, ...extra };
    state.keys.clear();
  };
  const fromHere = (): [[number, number], number] => [local(), state.rotY - f.rot];
  const at3 = (r: [number, number, number]) => { const [x, z] = world(r[0], r[2]); return new THREE.Vector3(x, SIDEWALK_H + r[1], z); };

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1), now = state.simulationTime, me = run.current;
    const there = inside();
    // Out of the store with a basket somehow (no way out but the door, which takes it back): it's gone.
    if (!there && state.groceryBasket && !me.plan && state.interior?.key !== layout.key) { state.groceryBasket = null; items.current = []; bump(); }

    // ---- this player's move this frame ----
    let script: Script | null = null;
    if (me.plan) {
      const t = now - me.t0, r = planAt(me.plan, t, me.prev);
      me.prev = t;
      for (const ev of r.events) {
        if (ev === "basket") { state.groceryBasket = []; items.current = []; bump(); }
        if (ev === "take" && me.src) me.holding = me.src.kind;
        if (ev === "drop" && me.holding) {
          const fore = state.avatar.body[9];
          const from = fore ? handWorld(fore, new THREE.Vector3()) : state.pos.clone();
          const spot = { kind: me.holding, ...landingSpot(items.current, Math.random), rot: Math.random() * Math.PI * 2 };
          falling.current = { kind: me.holding, from, spot, t0: now };
          me.holding = null;
        }
        if (ev === "basketDown" && me.kind === "pay") { checkout.current = { who: "player", t0: now, items: [...items.current] }; }
        if (ev === "bag" && me.kind === "pay") {
          // Candy goes straight into the inventory (there was room for it when it was picked); the rest in the bag.
          const rest: ItemKind[] = [];
          for (const it of items.current) { if (isCandy(it.kind) && addItem(state.life.inventory, it.kind) > 0) continue; rest.push(it.kind); }
          if (rest.length) state.groceryBag = [...(state.groceryBag ?? []), ...rest];
          const sweets = items.current.length - rest.length;
          if (sweets) toast(state, `${sweets} cand${sweets > 1 ? "ies" : "y"} in your inventory`, "info");
        }
        if (ev === "basketUp" && me.kind === "pay") { items.current = []; state.groceryBasket = []; bump(); }
        if (ev === "basketDown" && me.kind === "return") { state.groceryBasket = null; items.current = []; bump(); }
      }
      const p = r.pose, [wx, wz] = world(p.x, p.z);
      const reach = (h: Reach | null) => (h ? { at: at3(h.at), blend: h.blend, pole: h.pole } : null);
      script = { x: wx, z: wz, yaw: yawOf(p.yaw), walk: 0, sit: 0, shuffle: 0, lean: p.lean, left: reach(p.left), right: reach(p.right), crouch: p.crouch };
      if (r.done) {
        const wasReturn = me.kind === "return", wasToDoor = me.kind === "toDoor";
        me.plan = null; script = null;
        state.pos.x = wx; state.pos.z = wz; state.rotY = yawOf(p.yaw);
        // Basket back on the pile: walk on to the door (one smooth walk), and out through it.
        if (wasReturn) start(makePlan([walkSeg([p.x, p.z], p.yaw, [0, -0.9], 0, { basket: false, bag: !!state.groceryBag })]), "toDoor");
        if (wasToDoor) state.interactQueued = true;
        // Just paid, still at the till: the register's panel waits until they step away and back.
        if (me.kind === "pay") served.current = true;
      }
    }
    // The walk legs follow how far the scripted body moved.
    if (script) {
      const prev = state.foodScript;
      script.walk = prev ? Math.hypot(script.x - prev.x, script.z - prev.z) / Math.max(dt, 1e-3) : 0;
    }
    // This store's move drives the body; once it ends, the body is the player's again.
    if (script) { state.foodScript = script; ownScript.current = true; }
    else if (ownScript.current) { state.foodScript = null; ownScript.current = false; }

    // ---- E in the store ----
    const p = promptRef.current; p.visible = false; p.label = undefined;
    if (there && !me.plan && !state.accident && state.health > 0) {
      const [lx, lz] = local(), yaw = state.rotY - f.rot;
      // No basket yet: E at the pile by the door takes one (nothing can be picked without one).
      if (!state.groceryBasket) {
        const ps = pileSpot(pile);
        if (Math.hypot(lx - ps.stand[0], lz - ps.stand[1]) < 1.3) {
          const [x, z] = world(pile.x, pile.z); Object.assign(p, { visible: true, x, y: SIDEWALK_H + 1.0, z, label: "E  TAKE A BASKET" });
          if (state.interactQueued) {
            state.interactQueued = false;
            // The basket goes in the right hand: it has to be free.
            if (!handFree(state, "right")) { const m = handsFullMessage("right"); toast(state, m.title, "warn", m.body); }
            else start(takeBasket([lx, lz], yaw, pile, !!state.groceryBag), "take");
          }
        } else {
          const src = srcs.find((sr) => Math.hypot(lx - sr.stand[0], lz - sr.stand[1]) < 1.25);
          if (src) { const [x, z] = world(src.take[0], src.take[2]); Object.assign(p, { visible: true, x, y: SIDEWALK_H + src.take[1] + 0.45, z, label: "TAKE A BASKET FIRST" }); }
        }
      } else {
        const n = items.current.length, svc = layout.service, atTill = Math.hypot(lx - svc.x, lz - svc.z) < 0.75;
        const src = srcs.map((s) => ({ s, d: Math.hypot(lx - s.stand[0], lz - s.stand[1]) })).filter((x) => x.d < 1.25).sort((a, c) => a.d - c.d)[0]?.s;
        const total = items.current.reduce((a, it) => a + (GROCERY_PRICE[it.kind] ?? 1), 0);
        let action: (() => void) | null = null;
        if (nearDoorInside(lx, lz)) {
          [p.x, p.z] = world(0, -0.45); p.y = SIDEWALK_H + 2.05; p.visible = true; p.label = n ? "E  LEAVE (PUT ITEMS BACK)" : "E  LEAVE";
          action = () => { if (n) toast(state, "You put everything back", "info"); items.current = []; state.groceryBasket = []; start(returnBasket([lx, lz], yaw, pile, !!state.groceryBag), "return"); };
        } else if (atTill && n > 0) {
          [p.x, p.z] = world(spots.basket[0], spots.basket[2]); p.y = SIDEWALK_H + 1.5; p.visible = true; p.label = `E  PAY ${money(total)}`;
          action = () => {
            if (checkout.current) { toast(state, "Wait a moment", "info", "The cashier is serving someone."); return; }
            // The bag is handed over into the left hand (or more go in the bag already held there).
            if (!state.groceryBag && !handFree(state, "left")) { const m = handsFullMessage("left"); toast(state, m.title, "warn", m.body); return; }
            const day = timeInfo(state.elapsed).day, paid = spend(state.life, state.cash, total, day, "Fresh Market");
            if (!paid.ok) { toast(state, "Not enough money", "warn", `Your groceries come to ${money(total)}.`); return; }
            state.cash = paid.cash;
            toast(state, `Paid ${money(total)}`, "money", `${n} item${n > 1 ? "s" : ""} at Fresh Market.`);
            start(withWalk(payPlan([svc.x, svc.z], svc.yaw, layout, n), [lx, lz], yaw, [svc.x, svc.z], svc.yaw), "pay");
          };
        } else if (src && n < BASKET_MAX && isCandy(src.kind) && items.current.filter((i) => isCandy(i.kind)).length >= freeSlots(state.life.inventory)) {
          // Candy goes into the inventory once paid for: no more than there's room for.
          const [x, z] = world(src.take[0], src.take[2]); Object.assign(p, { visible: true, x, y: SIDEWALK_H + src.take[1] + 0.45, z, label: "NO ROOM IN YOUR INVENTORY" });
        } else if (src && n < BASKET_MAX) {
          const [x, z] = world(src.take[0], src.take[2]);
          Object.assign(p, { visible: true, x, y: SIDEWALK_H + src.take[1] + 0.45, z, label: `E  ${ITEMS[src.kind].name.toUpperCase()} ${money(GROCERY_PRICE[src.kind] ?? 1)}` });
          // (The left hand takes it off the shelf: it must be free, or carrying the grocery bag.)
          action = () => { if (heldIn(state, "left") && !state.groceryBag) { const m = handsFullMessage("left"); toast(state, m.title, "warn", m.body); return; } start(pickItem([lx, lz], yaw, src, !!state.groceryBag), "pick", { src }); };
        } else if (src && n >= BASKET_MAX) { const [x, z] = world(src.take[0], src.take[2]); Object.assign(p, { visible: true, x, y: SIDEWALK_H + src.take[1] + 0.45, z, label: "BASKET FULL" }); }
        if (state.interactQueued && action) { state.interactQueued = false; action(); }
        // At the till with an empty basket: the register's panel (the clerk job), once until stepping away.
        const d = Math.hypot(lx - svc.x, lz - svc.z);
        if (d < 0.7 && n === 0 && !served.current && !state.shop && !run.current.plan) { served.current = true; state.shop = "grocery"; state.keys.clear(); }
        if (d > 1.3) served.current = false;
      }
    }
    if (there && me.plan && state.interactQueued) state.interactQueued = false;

    // ---- a falling thing lands in the basket ----
    const fall = falling.current, fg = fallG.current, bg = basketG.current;
    if (fall && fg && bg) {
      const k = Math.min(1, (now - fall.t0) / 0.24);
      bg.updateMatrixWorld(true);
      const to = new THREE.Vector3(fall.spot.x, -0.24 + fall.spot.y, fall.spot.z).applyMatrix4(bg.matrixWorld);
      fg.visible = true; fg.position.lerpVectors(fall.from, to, k); fg.position.y += Math.sin(Math.PI * k) * 0.04 * (1 - k);
      if (k >= 1) { items.current = [...items.current, fall.spot]; state.groceryBasket = items.current.map((i) => i.kind); falling.current = null; fg.visible = false; bump(); }
    } else if (fg) fg.visible = false;

    // ---- the player's basket: in the right hand, or on the belt while paying ----
    const co = checkout.current;
    if (bg) {
      const onBelt = co?.who === "player" && me.kind === "pay" && me.plan !== null && now - me.t0 < me.plan.total - 0.75;
      bg.visible = !!state.groceryBasket && !state.home;
      if (onBelt) { bg.position.copy(at3([spots.basket[0], spots.basket[1] + 0.27, spots.basket[2]])); bg.rotation.set(0, yawOf(layout.service.yaw), 0); }
      else {
        const fore = state.avatar.body[11];
        if (fore) { fore.updateWorldMatrix(true, false); handWorld(fore, bg.position); bg.rotation.set(0, state.rotY + Math.PI / 2, 0); }
      }
    }
    // The thing in the left hand on its way to the basket.
    const hi = heldItemG.current;
    if (hi) {
      const fore = state.avatar.body[9];
      hi.visible = !!me.holding && !!fore;
      if (hi.visible && fore) { fore.updateWorldMatrix(true, false); handWorld(fore, hi.position); hi.position.y -= 0.03; hi.children.forEach((c) => { c.visible = c.userData["kind"] === me.holding; }); }
    }

    // ---- a shopper now and then (only while the player is about) ----
    const near = Math.hypot(state.pos.x - f.ox, state.pos.z - f.oz) < 60;
    let sh = shopper.current;
    if (!sh && near) {
      nextShopper.current -= dt;
      if (nextShopper.current <= 0) {
        nextShopper.current = 50 + Math.random() * 60;
        const side = Math.random() < 0.5 ? 1 : -1, picks = [...srcs].sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 3));
        const from: [number, number] = [side * 9, 2.6], to: [number, number] = [0.55, 2.3];
        sh = shopper.current = { id: Math.floor(Math.random() * 1e6), color: bodyColor(Math.random() < 0.5 ? "female" : "male"), stage: "approach", plan: makePlan([walkSeg(from, -side * Math.PI / 2, to, Math.PI, { basket: false, bag: false })]), t0: now, prev: -1, pose: { x: from[0], z: from[1], yaw: 0, crouch: 0, lean: 0, left: null, right: null }, basket: null, bag: null, wants: picks, holding: null, side, look: { phase: 0, last: null } };
        bump();
      }
    }
    if (sh) {
      const t = now - sh.t0;
      const next = (stage: Shopper["stage"], pl: Plan | null) => { sh!.stage = stage; sh!.plan = pl; sh!.t0 = now; sh!.prev = -1; };
      const wall = performance.now() / 1000;
      if (sh.stage === "enter") {
        const from: [number, number] = [0.55, 2.3], total = ENTER.done + enterLead(from);
        const pose = enterPose(Math.min(t, total), from, Math.PI);
        sh.pose = { x: pose.x, z: pose.z, yaw: pose.yaw, crouch: 0, lean: pose.lean, left: pose.left, right: pose.right };
        if (t >= total) next("take", takeBasket([sh.pose.x, sh.pose.z], sh.pose.yaw, pile, false));
      } else if (sh.stage === "leave") {
        const from: [number, number] = [0, -1.25], total = LEAVE.done + leaveLead(from);
        const pose = leavePose(Math.min(t, total), from, 0);
        sh.pose = { x: pose.x, z: pose.z, yaw: pose.yaw, crouch: 0, lean: pose.lean, left: sh.bag ? sh.pose.left : pose.left, right: pose.right };
        if (t >= total) next("away", makePlan([walkSeg([sh.pose.x, sh.pose.z], sh.pose.yaw, [-sh.side * 10, 2.6], -sh.side * Math.PI / 2, { basket: false, bag: true })]));
      } else if (sh.stage === "queue") {
        // Waiting a step back from the register until it's free.
        if (!sh.plan && !checkout.current && !(me.kind === "pay" && me.plan)) {
          const n = sh.basket?.length ?? 0, svc = layout.service;
          next("pay", withWalk(payPlan([svc.x, svc.z], svc.yaw, layout, n), [sh.pose.x, sh.pose.z], sh.pose.yaw, [svc.x, svc.z], svc.yaw));
        }
      } else if (sh.plan) {
        // Someone in the way (the player, inside): wait for them to pass rather than walk through them.
        if (there && !me.plan) {
          const [px, pz] = local(), ahead = planAt(sh.plan, t + 0.35).pose, dNow = Math.hypot(sh.pose.x - px, sh.pose.z - pz), dAhead = Math.hypot(ahead.x - px, ahead.z - pz);
          if (dAhead < 0.75 && dAhead < dNow - 0.01) { sh.t0 += dt; }
        }
        const r = planAt(sh.plan, now - sh.t0, sh.prev);
        sh.prev = now - sh.t0; sh.pose = r.pose;
        for (const ev of r.events) {
          if (ev === "basket") sh.basket = [];
          if (ev === "take") sh.holding = sh.wants[0]?.kind ?? null;
          if (ev === "drop" && sh.holding && sh.basket) { sh.basket.push({ kind: sh.holding, ...landingSpot(sh.basket, Math.random), rot: Math.random() * 6 }); sh.holding = null; bump(); }
          if (ev === "basketDown" && sh.stage === "pay") checkout.current = { who: sh.id, t0: now, items: [...(sh.basket ?? [])] };
          if (ev === "bag" && sh.stage === "pay") sh.bag = (sh.basket ?? []).map((i) => i.kind);
          if (ev === "basketUp" && sh.stage === "pay") { sh.basket = []; bump(); }
          if (ev === "basketDown" && sh.stage === "return") { sh.basket = null; bump(); }
        }
        if (r.done) {
          const here: [number, number] = [sh.pose.x, sh.pose.z];
          if (sh.stage === "approach") {
            // At the door: it opens for them (everyone sees it swing) and in they go.
            const from: [number, number] = [0.55, 2.3], lead = enterLead(from);
            state.extraDoorUses = [...state.extraDoorUses.filter((u) => wall - u.start < 30), { key: layout.key, leaf: "right", mode: "open", start: wall, lead, pass: lead + OPENER_PASS.right }];
            next("enter", null);
          } else if (sh.stage === "take" || sh.stage === "pick") {
            if (sh.stage === "pick") sh.wants.shift();
            const want = sh.wants[0];
            if (want) next("pick", pickItem(here, sh.pose.yaw, want, false));
            else { const q: [number, number] = [layout.service.x - 0.2, layout.service.z - 1.1]; next("queue", null); sh.plan = makePlan(walkRoute(here, sh.pose.yaw, q, layout.service.yaw, { basket: true, bag: false })); sh.stage = "queue"; }
          } else if (sh.stage === "pay") next("return", returnBasket(here, sh.pose.yaw, pile, true));
          else if (sh.stage === "return") {
            const from: [number, number] = [0, -1.25], lead = leaveLead(from);
            state.extraDoorUses = [...state.extraDoorUses.filter((u) => wall - u.start < 30), { key: layout.key, leaf: "left", mode: "open", start: wall, lead, pass: lead + OPENER_PASS.left }];
            next("leave", null);
          } else if (sh.stage === "away") { shopper.current = null; sh = null; bump(); }
        }
      }
      // While queuing the walk to the queue spot plays first.
      if (sh?.stage === "queue" && sh.plan) {
        const r = planAt(sh.plan, now - sh.t0, sh.prev); sh.prev = now - sh.t0; sh.pose = r.pose;
        if (r.done) sh.plan = null;
      }
      if (sh) {
        // The bag rides in the left hand once they have it.
        if (sh.bag && sh.stage !== "pay") sh.pose = { ...sh.pose, left: { at: [0, 0, 0], blend: 0, pole: "out" } };
        poseBody(shopperRig, sh.pose, world, yawOf, sh.look, dt);
        if (sh.bag && sh.stage !== "pay") { rigBag(shopperRig); }
      }
    }
    const shopperNow = shopper.current;
    // The shopper's basket, bag and the thing in hand follow their hands.
    placeAtHand(shopperBasket.current, shopperRig.foreR.current, !!shopperNow?.basket && !(checkout.current?.who === shopperNow?.id && shopperNow?.stage === "pay" && shopperNow.plan !== null && now - shopperNow.t0 < shopperNow.plan.total - 0.75), shopperNow ? yawOf(shopperNow.pose.yaw) + Math.PI / 2 : 0);
    if (shopperNow?.basket && checkout.current?.who === shopperNow.id && shopperBasket.current && shopperNow.stage === "pay" && shopperNow.plan && now - shopperNow.t0 < shopperNow.plan.total - 0.75) {
      shopperBasket.current.visible = true; shopperBasket.current.position.copy(at3([spots.basket[0], spots.basket[1] + 0.27, spots.basket[2]])); shopperBasket.current.rotation.set(0, yawOf(layout.service.yaw), 0);
    }
    placeAtHand(shopperBag.current, shopperRig.foreL.current, !!shopperNow?.bag, shopperNow ? yawOf(shopperNow.pose.yaw) : 0);
    placeAtHand(shopperItem.current, shopperRig.foreL.current, !!shopperNow?.holding, 0);
    if (shopperItem.current && shopperNow?.holding) shopperItem.current.children.forEach((c) => { c.visible = c.userData["kind"] === shopperNow.holding; });

    // The shopper and the clerk are solid to the player (walking into them leans on them).
    if (there) {
      const extra: { x: number; z: number; r: number }[] = [];
      const shNow = shopper.current;
      if (shNow && shNow.stage !== "approach" && shNow.stage !== "away") { const [wx, wz] = world(shNow.pose.x, shNow.pose.z); extra.push({ x: wx, z: wz, r: 0.3 }); }
      const [cx0, cz0] = world(layout.staff.x, layout.staff.z); extra.push({ x: cx0, z: cz0, r: 0.3 });
      state.staffBodies = [...state.staffBodies, ...extra];
    }
    // ---- the clerk: idle at the register, or bagging ----
    const s = layout.staff, root = clerk.root.current;
    if (root && clerk.hips.current) {
      const [cx, cz] = world(s.x, s.z);
      root.position.set(cx, SIDEWALK_H, cz); root.rotation.y = yawOf(s.yaw);
      clerk.hips.current.position.y = 0.95 + Math.sin(now * 1.6) * 0.005;
      clerk.armL.current?.rotation.set(-0.3, 0, 0.12); clerk.foreL.current?.rotation.set(-0.9, 0, 0);
      clerk.armR.current?.rotation.set(-0.3, 0, -0.12); clerk.foreR.current?.rotation.set(-0.9, 0, 0);
      clerk.head.current?.rotation.set(0.1, Math.sin(now * 0.3) * 0.25, 0);
      root.updateMatrixWorld(true);
    }
    const c = checkout.current;
    let bagged = 0, bagInHand = false, holding: number | null = null;
    if (c) {
      const t = now - c.t0, n = c.items.length;
      const basketAt = (i: number): [number, number, number] => { const it = c.items[i]!; const cos = Math.cos(layout.service.yaw), sin = Math.sin(layout.service.yaw); return [spots.basket[0] + it.x * cos + it.z * sin, spots.basket[1] + 0.03 + it.y, spots.basket[2] - it.x * sin + it.z * cos]; };
      const cl = clerkAt(t, n, basketAt, layout);
      bagged = cl.bagged; bagInHand = cl.holding === "bag"; holding = typeof cl.holding === "number" ? cl.holding : null;
      if (cl.reach && root) { clerk.head.current?.rotation.set(0.35, 0, 0); reachArm(clerk.armR.current, clerk.foreR.current, at3(cl.reach.at), POLES[cl.reach.pole](-1), cl.reach.blend); }
      if (t > checkoutLength(n)) { checkout.current = null; bump(); }
    }
    // Things leave the basket as the clerk takes them; the bag on the counter fills; it goes over with the clerk's hand.
    const cb = counterBag.current;
    if (cb) {
      cb.visible = !!c && !bagInHand && !(c && now - c.t0 > checkoutLength(c.items.length) - 0.6);
      cb.position.copy(at3([spots.bag[0], spots.bag[1] + 0.4, spots.bag[2]])); cb.rotation.set(0, yawOf(layout.service.yaw), 0);
      cb.userData["n"] = bagged;
    }
    if (bagInHand && clerk.foreR.current && cb) { cb.visible = true; clerk.foreR.current.updateWorldMatrix(true, false); handWorld(clerk.foreR.current, cb.position); }
    const ci = clerkItem.current;
    if (ci) {
      ci.visible = holding !== null && !!c;
      if (ci.visible && c && clerk.foreR.current) { clerk.foreR.current.updateWorldMatrix(true, false); handWorld(clerk.foreR.current, ci.position); ci.children.forEach((g) => { g.visible = g.userData["kind"] === c.items[holding!]?.kind; }); }
    }
    if (c && c.items.length !== (c as Checkout & { shown?: number }).shown) { (c as Checkout & { shown?: number }).shown = c.items.length; }
    // (Redrawn as each thing leaves the basket, so they go one by one.)
    const cv = checkoutView.current;
    if (cv.who !== (c?.who ?? null) || cv.bagged !== bagged || cv.holding !== holding) { checkoutView.current = { who: c?.who ?? null, bagged, holding }; bump(); }
    if (import.meta.env["VITE_TRAFFIC_AUDIT"] === "1") Object.assign(window, { __grocery: { checkout: c ? { who: c.who, t: now - c.t0, n: c.items.length } : null, view: checkoutView.current, shopper: shopper.current ? { stage: shopper.current.stage, basket: shopper.current.basket?.length ?? null, bag: shopper.current.bag?.length ?? null } : null, nextShopper: nextShopper.current } });
  }, -0.65);

  const checkoutView = useRef<{ who: "player" | number | null; bagged: number; holding: number | null }>({ who: null, bagged: 0, holding: null });
  const kinds = Object.keys(GROCERY_PRICE) as ItemKind[];
  const sh = shopper.current;
  const view = checkoutView.current;
  // What still shows in each basket while it's on the belt: only what the clerk hasn't taken yet.
  const visibleItems = (who: "player" | number, list: InBasket[]) => (view.who === who ? list.filter((_, i) => i >= view.bagged && i !== view.holding) : list);
  const pileCount = 6 - (state.groceryBasket ? 1 : 0) - (sh?.basket ? 1 : 0);
  const pileTop = pileSpot(pile);
  return <group>
    {/* The pile of baskets by the door (one fewer for each in use). */}
    {Array.from({ length: Math.max(0, pileCount) }, (_, k) => { const [x, z] = world(pile.x, pile.z); return <group key={k} position={[x, SIDEWALK_H + 0.27 + k * 0.07, z]} rotation-y={yawOf(0) + Math.PI / 2}><Basket looks={looks} items={[]} /></group>; })}
    <group ref={basketG} visible={false}><Basket looks={looks} items={visibleItems("player", items.current)} /></group>
    <group ref={heldItemG} visible={false}>{kinds.map((k) => <group key={k} userData={{ kind: k }} visible={false}><ItemModel kind={k} looks={looks} /></group>)}</group>
    <group ref={fallG} visible={false}>{falling.current && <ItemModel kind={falling.current.kind} looks={looks} />}</group>
    <group ref={counterBag} visible={false}><GroceryBagModel items={view.bagged} looks={looks} /></group>
    <group ref={clerkItem} visible={false}>{kinds.map((k) => <group key={k} userData={{ kind: k }} visible={false}><ItemModel kind={k} looks={looks} /></group>)}</group>
    <CharacterBody rig={clerk} color="#2e9d5b" />
    {sh && <>
      <CharacterBody rig={shopperRig} color={sh.color} />
      <group ref={shopperBasket} visible={false}><Basket looks={looks} items={sh.basket ? visibleItems(sh.id, sh.basket) : []} /></group>
      <group ref={shopperBag} visible={false}><GroceryBagModel items={sh.bag?.length ?? 0} looks={looks} /></group>
      <group ref={shopperItem} visible={false}>{kinds.map((k) => <group key={k} userData={{ kind: k }} visible={false}><ItemModel kind={k} looks={looks} /></group>)}</group>
    </>}
    <InteractionPrompt sample={() => ({ ...promptRef.current, time: state.simulationTime })} />
    {void pileTop}
  </group>;
}

/** A move that starts with a few steps from where someone is to where the move begins. */
function withWalk(p: Plan, from: [number, number], fromYaw: number, to: [number, number], toYaw: number): Plan {
  if (Math.hypot(to[0] - from[0], to[1] - from[1]) < 0.05) return p;
  return makePlan([...walkRoute(from, fromYaw, to, toYaw, { basket: true, bag: false }), ...p.segs]);
}

/** Keeps a thing at a hand (or hides it). */
function placeAtHand(g: THREE.Group | null, fore: THREE.Group | null, show: boolean, yaw: number) {
  if (!g) return;
  g.visible = show && !!fore;
  if (!g.visible || !fore) return;
  fore.updateWorldMatrix(true, false);
  handWorld(fore, g.position);
  g.rotation.set(0, yaw, 0);
}
/** A shopper's left arm carrying a bag: hanging, the elbow a little bent. */
function rigBag(rig: BodyRig) {
  rig.armL.current?.rotation.set(-0.15, 0, 0.18);
  rig.foreL.current?.rotation.set(-0.35, 0, 0);
}
void lifeEvent;
