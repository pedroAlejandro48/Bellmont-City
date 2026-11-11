import { PantryItem } from "./PantryModels";
import { CANDIES, CANDY_INFO, isCandy } from "./pantry";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { handWorld } from "./arms";
import { canInteractScooter, floorHeight, nearestBenchSeat } from "./config";
import { InteractionPrompt } from "./InteractionPrompt";
import { ITEMS, type ItemKind } from "./inventory";
import { INV_TIME, USE_SECONDS, dropHeld, heldKind, pickUpNear, stepInventory, consumeHeld } from "./invRuntime";
import type { GameState } from "./state";

type Thing = ItemKind | "bottle" | "can";

/**
 * A white plastic bag of groceries: a soft pear-shaped body, rounder at the bottom where the shopping sits, gathered
 * up at the top into one looped handle (a flat band). It fills out with what's in it. Origin at the top of the loop
 * (where a hand holds it).
 */
const BAG_PROFILE: [number, number][] = [[0.001, -0.43], [0.06, -0.426], [0.105, -0.41], [0.137, -0.38], [0.152, -0.335], [0.15, -0.29], [0.136, -0.245], [0.114, -0.205], [0.092, -0.172], [0.074, -0.15], [0.058, -0.136], [0.03, -0.128], [0.001, -0.126]];
const bagBody = new THREE.LatheGeometry(BAG_PROFILE.map(([x, y]) => new THREE.Vector2(x, y)), 24);
const bagLoop = new THREE.TorusGeometry(0.072, 0.014, 8, 28);
export function GroceryBagModel({ items, looks }: { items: number; looks: Looks }) {
  const fill = Math.min(1, items / 8), wide = 0.86 + 0.16 * fill;
  return <group>
    {/* The body (squashed front to back like a real bag), sagging a little lower when full. */}
    <mesh material={looks.bag} geometry={bagBody} position={[0, -0.01 * fill, 0]} scale={[wide, 1 + 0.03 * fill, wide * 0.78]} castShadow />
    {/* The handle: one loop rising from the gathered top, a flat band. */}
    <mesh material={looks.bag} geometry={bagLoop} position={[0, -0.075, 0]} scale={[0.95, 1.05, 0.45]} castShadow />
  </group>;
}

/** Shared looks for the things kept in an inventory. */
export function useLooks() {
  return useMemo(() => ({
    phone: new THREE.MeshStandardMaterial({ color: "#16171c", roughness: 0.35, metalness: 0.4 }),
    screen: new THREE.MeshBasicMaterial({ color: "#3d6fd6", toneMapped: false }),
    bottle: new THREE.MeshPhysicalMaterial({ color: "#bfe3ff", roughness: 0.1, transmission: 0.6, transparent: true, opacity: 0.65, thickness: 0.02 }),
    water: new THREE.MeshStandardMaterial({ color: "#6fb6ff", transparent: true, opacity: 0.55, roughness: 0.1 }),
    // Juices (a bottle, the juice showing through), sodas and the energy drink (cans), an empty can.
    juiceOrange: new THREE.MeshStandardMaterial({ color: "#ff9a1f", roughness: 0.3, transparent: true, opacity: 0.92 }),
    juiceApple: new THREE.MeshStandardMaterial({ color: "#e8b53c", roughness: 0.3, transparent: true, opacity: 0.9 }),
    labelOrange: new THREE.MeshStandardMaterial({ color: "#ffd166", roughness: 0.6 }),
    labelApple: new THREE.MeshStandardMaterial({ color: "#8ac34a", roughness: 0.6 }),
    capOrange: new THREE.MeshStandardMaterial({ color: "#f07f12", roughness: 0.5 }),
    capApple: new THREE.MeshStandardMaterial({ color: "#3f8f2f", roughness: 0.5 }),
    cola: new THREE.MeshStandardMaterial({ color: "#c81d25", roughness: 0.3, metalness: 0.5 }),
    sodaLemon: new THREE.MeshStandardMaterial({ color: "#f2e14b", roughness: 0.3, metalness: 0.5 }),
    energyCan: new THREE.MeshStandardMaterial({ color: "#16181d", roughness: 0.3, metalness: 0.6 }),
    bandWhite: new THREE.MeshStandardMaterial({ color: "#f6f6f4", roughness: 0.4, metalness: 0.3 }),
    bandGreen: new THREE.MeshStandardMaterial({ color: "#3fa34d", roughness: 0.4, metalness: 0.3 }),
    bandVolt: new THREE.MeshStandardMaterial({ color: "#7dff3a", roughness: 0.35, emissive: new THREE.Color("#2f7a10"), emissiveIntensity: 0.4 }),
    canTop: new THREE.MeshStandardMaterial({ color: "#c9cdd2", roughness: 0.25, metalness: 0.85 }),
    cap: new THREE.MeshStandardMaterial({ color: "#1f5fbf", roughness: 0.5 }),
    label: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.6 }),
    apple: new THREE.MeshStandardMaterial({ color: "#c8202a", roughness: 0.45 }),
    stem: new THREE.MeshStandardMaterial({ color: "#5a3a1e", roughness: 0.8 }),
    leaf: new THREE.MeshStandardMaterial({ color: "#3f8f2f", roughness: 0.6 }),
    banana: new THREE.MeshStandardMaterial({ color: "#f3d23b", roughness: 0.55 }),
    orange: new THREE.MeshStandardMaterial({ color: "#f28a1a", roughness: 0.75 }),
    key: new THREE.MeshStandardMaterial({ color: "#d9b44a", roughness: 0.3, metalness: 0.85 }),
    pear: new THREE.MeshStandardMaterial({ color: "#b5c94a", roughness: 0.55 }),
    lemon: new THREE.MeshStandardMaterial({ color: "#f5e04a", roughness: 0.6 }),
    lime: new THREE.MeshStandardMaterial({ color: "#6cbf3c", roughness: 0.6 }),
    grape: new THREE.MeshStandardMaterial({ color: "#6b2d6b", roughness: 0.35 }),
    peach: new THREE.MeshStandardMaterial({ color: "#f6a57a", roughness: 0.7 }),
    bag: new THREE.MeshStandardMaterial({ color: "#f7f7f5", roughness: 0.55, transparent: true, opacity: 0.93, side: THREE.DoubleSide }),
  }), []);
}
export type Looks = ReturnType<typeof useLooks>;

/** One thing, modelled at life size with its origin where a hand holds it (or where it rests on the ground). */
export function ItemModel({ kind, looks, empty = false }: { kind: Thing; looks: Looks; empty?: boolean }) {
  switch (kind) {
    case "phone": return <group>
      <mesh material={looks.phone}><boxGeometry args={[0.072, 0.15, 0.009]} /></mesh>
      <mesh material={looks.screen} position={[0, 0.004, 0.0048]}><planeGeometry args={[0.064, 0.13]} /></mesh>
    </group>;
    case "water": case "bottle": return <group>
      <mesh material={looks.bottle} position={[0, 0.06, 0]}><cylinderGeometry args={[0.032, 0.032, 0.17, 14]} /></mesh>
      <mesh material={looks.bottle} position={[0, 0.165, 0]}><cylinderGeometry args={[0.013, 0.032, 0.04, 14]} /></mesh>
      <mesh material={looks.cap} position={[0, 0.192, 0]}><cylinderGeometry args={[0.014, 0.014, 0.018, 10]} /></mesh>
      <mesh material={looks.label} position={[0, 0.06, 0]}><cylinderGeometry args={[0.0335, 0.0335, 0.06, 14, 1, true]} /></mesh>
      {!empty && kind === "water" && <mesh material={looks.water} position={[0, 0.045, 0]}><cylinderGeometry args={[0.029, 0.029, 0.13, 12]} /></mesh>}
    </group>;
    case "orangeJuice": case "appleJuice": {
      const o = kind === "orangeJuice";
      return <group>
        <mesh material={looks.bottle} position={[0, 0.06, 0]}><cylinderGeometry args={[0.032, 0.032, 0.17, 14]} /></mesh>
        <mesh material={looks.bottle} position={[0, 0.165, 0]}><cylinderGeometry args={[0.015, 0.032, 0.04, 14]} /></mesh>
        <mesh material={o ? looks.capOrange : looks.capApple} position={[0, 0.192, 0]}><cylinderGeometry args={[0.017, 0.017, 0.02, 10]} /></mesh>
        <mesh material={o ? looks.juiceOrange : looks.juiceApple} position={[0, 0.055, 0]}><cylinderGeometry args={[0.029, 0.029, 0.15, 12]} /></mesh>
        <mesh material={o ? looks.labelOrange : looks.labelApple} position={[0, 0.06, 0]}><cylinderGeometry args={[0.0335, 0.0335, 0.07, 14, 1, true]} /></mesh>
        <mesh material={o ? looks.orange : looks.apple} position={[0, 0.06, 0.034]}><sphereGeometry args={[0.012, 8, 6]} /></mesh>
      </group>;
    }
    case "cola": case "lemonSoda": case "energy": case "can": {
      const body = kind === "cola" ? looks.cola : kind === "lemonSoda" ? looks.sodaLemon : kind === "energy" ? looks.energyCan : looks.canTop;
      const band = kind === "cola" ? looks.bandWhite : kind === "lemonSoda" ? looks.bandGreen : kind === "energy" ? looks.bandVolt : looks.canTop;
      return <group>
        <mesh material={body} position={[0, 0.06, 0]}><cylinderGeometry args={[0.033, 0.033, 0.11, 16]} /></mesh>
        <mesh material={band} position={[0, 0.055, 0]}><cylinderGeometry args={[0.0336, 0.0336, kind === "energy" ? 0.018 : 0.03, 16, 1, true]} /></mesh>
        <mesh material={looks.canTop} position={[0, 0.12, 0]}><cylinderGeometry args={[0.027, 0.033, 0.012, 16]} /></mesh>
        <mesh material={looks.canTop} position={[0, 0.0, 0]}><cylinderGeometry args={[0.033, 0.028, 0.01, 16]} /></mesh>
      </group>;
    }
    case "apple": return <group>
      <mesh material={looks.apple} position={[0, 0.04, 0]} scale={[1, 0.92, 1]}><sphereGeometry args={[0.042, 16, 12]} /></mesh>
      <mesh material={looks.stem} position={[0, 0.083, 0]} rotation-z={0.25}><cylinderGeometry args={[0.003, 0.003, 0.022, 5]} /></mesh>
      <mesh material={looks.leaf} position={[0.012, 0.086, 0]} rotation-z={-0.9} scale={[1, 0.4, 0.6]}><sphereGeometry args={[0.012, 8, 6]} /></mesh>
    </group>;
    case "banana": return <group rotation-z={Math.PI / 2}>
      <mesh material={looks.banana} position={[0.07, 0, 0]} rotation-z={Math.PI / 2}><torusGeometry args={[0.07, 0.018, 8, 16, Math.PI * 0.7]} /></mesh>
      <mesh material={looks.stem} position={[0.07 + 0.07 * Math.cos(Math.PI * 0.7 + Math.PI / 2), 0.07 * Math.sin(Math.PI * 0.7 + Math.PI / 2), 0]}><sphereGeometry args={[0.009, 6, 6]} /></mesh>
    </group>;
    case "pear": return <group>
      <mesh material={looks.pear} position={[0, 0.035, 0]}><sphereGeometry args={[0.04, 14, 10]} /></mesh>
      <mesh material={looks.pear} position={[0, 0.08, 0]}><sphereGeometry args={[0.026, 12, 8]} /></mesh>
      <mesh material={looks.stem} position={[0, 0.112, 0]} rotation-z={0.3}><cylinderGeometry args={[0.003, 0.003, 0.02, 5]} /></mesh>
    </group>;
    case "lemon": case "lime": return <group>
      <mesh material={kind === "lemon" ? looks.lemon : looks.lime} position={[0, 0.03, 0]} rotation-z={Math.PI / 2} scale={[1.25, 0.9, 0.9]}><sphereGeometry args={[0.032, 14, 10]} /></mesh>
    </group>;
    case "grape": return <group>
      {[[0, 0.1, 0], [-0.018, 0.08, 0.01], [0.018, 0.08, -0.008], [0, 0.075, 0.02], [-0.01, 0.055, -0.012], [0.012, 0.052, 0.01], [0, 0.032, 0]].map(([x, y, z], i) => <mesh key={i} material={looks.grape} position={[x!, y!, z!]}><sphereGeometry args={[0.014, 8, 6]} /></mesh>)}
      <mesh material={looks.stem} position={[0, 0.118, 0]}><cylinderGeometry args={[0.002, 0.002, 0.02, 4]} /></mesh>
    </group>;
    case "peach": return <group>
      <mesh material={looks.peach} position={[0, 0.038, 0]}><sphereGeometry args={[0.04, 14, 10]} /></mesh>
    </group>;
    case "orange": return <group>
      <mesh material={looks.orange} position={[0, 0.04, 0]}><icosahedronGeometry args={[0.04, 2]} /></mesh>
      <mesh material={looks.leaf} position={[0, 0.079, 0]}><sphereGeometry args={[0.006, 6, 6]} /></mesh>
    </group>;
    case "key": return <group rotation-z={Math.PI / 2}>
      <mesh material={looks.key}><torusGeometry args={[0.016, 0.005, 8, 16]} /></mesh>
      <mesh material={looks.key} position={[0.045, 0, 0]}><boxGeometry args={[0.06, 0.008, 0.004]} /></mesh>
      <mesh material={looks.key} position={[0.068, -0.007, 0]}><boxGeometry args={[0.008, 0.012, 0.004]} /></mesh>
    </group>;
    default: return <PantryItem kind={kind} />;
  }
}

/**
 * The inventory in the world: Q and E for what's in the hand and on the ground, the thing held in the right hand
 * (it follows the hand: carried at the waist, lifted to the mouth to eat or drink, held up when the phone is open),
 * and things lying on the ground.
 */
export function InventoryWorld({ state }: { state: GameState }) {
  const looks = useLooks();
  const held = useRef<THREE.Group>(null);
  const shown = useRef<Thing | null>(null);
  const kinds = useMemo(() => ["phone", "water", "bottle", "can", "orangeJuice", "appleJuice", "cola", "lemonSoda", "energy", "apple", "banana", "orange", "pear", "lemon", "lime", "grape", "peach", "key", ...CANDIES] as Thing[], []);
  const parts = useRef<Map<Thing, THREE.Group>>(new Map());
  const ground = useRef<THREE.Group>(null);
  const bagHeld = useRef<THREE.Group>(null), bagCount = useRef(-1);
  const [, rerender] = useState(0);
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), q: new THREE.Quaternion(), e: new THREE.Euler() }), []);

  // Before the food's own Q and E (which would take the press otherwise).
  useFrame(() => {
    // (With kitchen things in hand, Q is the kitchen's: pour, to the sink, to the table.)
    const kh = state.life.kitchen.hands, kitchenHolds = !!(kh.left || kh.right) && !!state.level;
    if (state.dropQueued && !kitchenHolds && (state.heldTrash || state.heldSlot !== null || (state.groceryBag && !state.groceryBasket))) { if (dropHeld(state)) state.dropQueued = false; }
    if (state.interactQueued && !state.scooter.riding && pickUpNear(state)) state.interactQueued = false;
    stepInventory(state);
  }, -0.8);
  // After the places' E (doors, ATMs, shops), before benches and the bike: E eats or drinks what's in the hand
  // when nothing else nearby wants it.
  useFrame(() => {
    if (!state.interactQueued || state.heldSlot === null || state.doorPrompt) return;
    const seat = nearestBenchSeat(state.pos.x, state.pos.z, state.seatOccupants);
    const bike = canInteractScooter([state.pos.x, state.pos.z], [state.scooter.pos.x, state.scooter.pos.z], state.scooter.yaw, state.scooter.fallen, state.scooter.fallSide);
    if (seat || bike) return;
    if (consumeHeld(state)) state.interactQueued = false;
  }, -0.55);

  useFrame(() => {
    // What the right hand shows: the thing out, or trash, or (while picking up) nothing until it's in hand.
    const act = state.invAct;
    let kind: Thing | null = state.heldTrash ?? heldKind(state);
    if (act?.kind === "pickup" && act.done && act.item === "bottle") kind = "bottle";
    const fore = state.avatar.body[11];
    const g = held.current;
    if (g) {
      const visible = !!kind && !!fore && !state.home && !state.accident && state.health > 0;
      g.visible = visible;
      if (visible && fore) {
        if (shown.current !== kind) { shown.current = kind; parts.current.forEach((p, k) => { p.visible = k === kind; }); }
        fore.updateWorldMatrix(true, false);
        handWorld(fore, g.position);
        // Upright and facing the way the body faces; the phone tips back toward the face; a drink tips to the
        // mouth while sipping.
        let tipX = 0;
        if (kind === "phone") tipX = -0.55;
        if (act && act.kind === "drink") { const t = (state.simulationTime - act.at) / USE_SECONDS; tipX = Math.sin(Math.min(1, Math.max(0, (t - 0.2) / 0.6)) * Math.PI) * 1.6; }
        // The phone's screen faces the character (turned round); the key points forward, out of the hand.
        let turn = 0;
        if (kind === "phone") turn = Math.PI;
        if (kind === "key") tipX = Math.PI / 2;
        tmp.e.set(tipX, state.rotY + turn, 0, "YXZ");
        g.quaternion.setFromEuler(tmp.e);
        g.scale.setScalar(kind === "key" ? 1.7 : 1);
        // The key's ring between the fingers, its blade out in front of the hand (not floating away from it).
        if (kind === "key") { g.position.x += Math.sin(state.rotY) * 0.035; g.position.z += Math.cos(state.rotY) * 0.035; g.position.y -= 0.01; }
        // A bottle is held round its middle; fruit and keys sit in the palm.
        if (kind === "water" || kind === "bottle" || kind === "orangeJuice" || kind === "appleJuice") g.position.y -= 0.07;
        if (kind === "cola" || kind === "lemonSoda" || kind === "energy" || kind === "can") g.position.y -= 0.05;
        if (kind === "phone") g.position.y += 0.05;
        // Candy: held up in the fingers, the wrapper toward the face (a bar stands on its end).
        if (kind && isCandy(kind)) { g.position.y -= 0.03; if (CANDY_INFO[kind].shape !== "pop" && CANDY_INFO[kind].shape !== "bag") { tmp.e.set(-Math.PI / 2 + 0.35, state.rotY, 0, "YXZ"); g.quaternion.setFromEuler(tmp.e); } }
      }
    }
    // A bag of groceries in the left hand (held by its handles).
    const bg = bagHeld.current, foreL = state.avatar.body[9];
    if (bg) {
      const bagAct = act && act.item === "groceryBag" && (act.kind === "drop" ? act.done : !act.done);
      const show = !!state.groceryBag && !!foreL && !state.home && !state.accident && state.health > 0 && !bagAct;
      bg.visible = show;
      if (show && foreL) { foreL.updateWorldMatrix(true, false); handWorld(foreL, bg.position); bg.rotation.set(0, state.rotY, 0); }
      const n = state.groceryBag?.length ?? 0;
      if (n !== bagCount.current) { bagCount.current = n; rerender((k) => k + 1); }
    }
    // Things on the ground: shown where they lie (rebuilt only when the list changes).
    const gr = ground.current;
    if (gr) {
      const items = state.groundItems;
      if (gr.userData["count"] !== items.length || gr.userData["first"] !== items[0]?.id) {
        gr.userData["count"] = items.length; gr.userData["first"] = items[0]?.id;
        gr.children.forEach((c, i) => {
          const it = items[i];
          c.visible = !!it;
          if (!it) return;
          c.position.set(it.x, (it.y ?? floorHeight(it.x, it.z)) + (it.kind === "groceryBag" ? 0.4 : 0), it.z);
          c.rotation.set(["bottle", "water", "can", "orangeJuice", "appleJuice", "cola", "lemonSoda", "energy"].includes(it.kind) ? Math.PI / 2 : 0, it.yaw, 0, "YXZ");
          (c.children as THREE.Group[]).forEach((m) => { m.visible = m.userData["kind"] === it.kind; });
        });
      }
    }
    // While picking something up, it disappears from the ground at the moment the hand gets there.
    if (act?.kind === "pickup" && act.done && gr) gr.userData["count"] = -1;
    void INV_TIME;
  });

  return <>
    <group ref={held} visible={false}>
      {kinds.map((k) => <group key={k} ref={(el) => { if (el) parts.current.set(k, el); }} visible={false}><ItemModel kind={k} looks={looks} empty={k === "bottle"} /></group>)}
    </group>
    <group ref={bagHeld} visible={false}><GroceryBagModel items={bagCount.current < 0 ? 0 : bagCount.current} looks={looks} /></group>
    <group ref={ground}>
      {Array.from({ length: 40 }, (_, i) => <group key={i} visible={false}>
        {kinds.filter((k) => k !== "phone").map((k) => <group key={k} userData={{ kind: k }} visible={false}><ItemModel kind={k} looks={looks} empty={k === "bottle"} /></group>)}
        <group userData={{ kind: "groceryBag" }} visible={false}><GroceryBagModel items={6} looks={looks} /></group>
      </group>)}
    </group>
    <InteractionPrompt sample={() => {
      if (state.invAct || state.scooter.riding || state.accident) return { visible: false, x: 0, y: 0, z: 0, time: 0 };
      let best: GameState["groundItems"][number] | null = null, bd = 1.0;
      for (const g of state.groundItems) { const d = Math.hypot(g.x - state.pos.x, g.z - state.pos.z); if (d < bd) { bd = d; best = g; } }
      if (!best) return { visible: false, x: 0, y: 0, z: 0, time: 0 };
      return { visible: true, x: best.x, y: (best.y ?? floorHeight(best.x, best.z)) + 0.45, z: best.z, time: state.simulationTime, label: `E  ${best.kind === "bottle" ? "EMPTY BOTTLE" : best.kind === "can" ? "EMPTY CAN" : best.kind === "groceryBag" ? "GROCERIES" : ITEMS[best.kind].name.toUpperCase()}` };
    }} />
  </>;
}
