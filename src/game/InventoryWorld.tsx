import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { handWorld } from "./arms";
import { canInteractScooter, floorHeight, nearestBenchSeat } from "./config";
import { InteractionPrompt } from "./InteractionPrompt";
import { ITEMS, type ItemKind } from "./inventory";
import { INV_TIME, USE_SECONDS, dropHeld, heldKind, pickUpNear, stepInventory, consumeHeld } from "./invRuntime";
import type { GameState } from "./state";

type Thing = ItemKind | "bottle";

/** Shared looks for the things kept in an inventory. */
function useLooks() {
  return useMemo(() => ({
    phone: new THREE.MeshStandardMaterial({ color: "#16171c", roughness: 0.35, metalness: 0.4 }),
    screen: new THREE.MeshBasicMaterial({ color: "#3d6fd6", toneMapped: false }),
    bottle: new THREE.MeshPhysicalMaterial({ color: "#bfe3ff", roughness: 0.1, transmission: 0.6, transparent: true, opacity: 0.65, thickness: 0.02 }),
    water: new THREE.MeshStandardMaterial({ color: "#6fb6ff", transparent: true, opacity: 0.55, roughness: 0.1 }),
    cap: new THREE.MeshStandardMaterial({ color: "#1f5fbf", roughness: 0.5 }),
    label: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.6 }),
    apple: new THREE.MeshStandardMaterial({ color: "#c8202a", roughness: 0.45 }),
    stem: new THREE.MeshStandardMaterial({ color: "#5a3a1e", roughness: 0.8 }),
    leaf: new THREE.MeshStandardMaterial({ color: "#3f8f2f", roughness: 0.6 }),
    banana: new THREE.MeshStandardMaterial({ color: "#f3d23b", roughness: 0.55 }),
    orange: new THREE.MeshStandardMaterial({ color: "#f28a1a", roughness: 0.75 }),
    key: new THREE.MeshStandardMaterial({ color: "#d9b44a", roughness: 0.3, metalness: 0.85 }),
  }), []);
}
type Looks = ReturnType<typeof useLooks>;

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
    case "apple": return <group>
      <mesh material={looks.apple} position={[0, 0.04, 0]} scale={[1, 0.92, 1]}><sphereGeometry args={[0.042, 16, 12]} /></mesh>
      <mesh material={looks.stem} position={[0, 0.083, 0]} rotation-z={0.25}><cylinderGeometry args={[0.003, 0.003, 0.022, 5]} /></mesh>
      <mesh material={looks.leaf} position={[0.012, 0.086, 0]} rotation-z={-0.9} scale={[1, 0.4, 0.6]}><sphereGeometry args={[0.012, 8, 6]} /></mesh>
    </group>;
    case "banana": return <group rotation-z={Math.PI / 2}>
      <mesh material={looks.banana} position={[0.07, 0, 0]} rotation-z={Math.PI / 2}><torusGeometry args={[0.07, 0.018, 8, 16, Math.PI * 0.7]} /></mesh>
      <mesh material={looks.stem} position={[0.07 + 0.07 * Math.cos(Math.PI * 0.7 + Math.PI / 2), 0.07 * Math.sin(Math.PI * 0.7 + Math.PI / 2), 0]}><sphereGeometry args={[0.009, 6, 6]} /></mesh>
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
  const kinds = useMemo(() => ["phone", "water", "bottle", "apple", "banana", "orange", "key"] as Thing[], []);
  const parts = useRef<Map<Thing, THREE.Group>>(new Map());
  const ground = useRef<THREE.Group>(null);
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), q: new THREE.Quaternion(), e: new THREE.Euler() }), []);

  // Before the food's own Q and E (which would take the press otherwise).
  useFrame(() => {
    if (state.dropQueued && (state.heldTrash || state.heldSlot !== null)) { if (dropHeld(state)) state.dropQueued = false; }
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
        tmp.e.set(tipX, state.rotY, 0, "YXZ");
        g.quaternion.setFromEuler(tmp.e);
        // A bottle is held round its middle; fruit and keys sit in the palm.
        if (kind === "water" || kind === "bottle") g.position.y -= 0.07;
        if (kind === "phone") g.position.y += 0.05;
      }
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
          c.position.set(it.x, floorHeight(it.x, it.z), it.z);
          c.rotation.set(it.kind === "bottle" || it.kind === "water" ? Math.PI / 2 : 0, it.yaw, 0, "YXZ");
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
    <group ref={ground}>
      {Array.from({ length: 40 }, (_, i) => <group key={i} visible={false}>
        {kinds.filter((k) => k !== "phone").map((k) => <group key={k} userData={{ kind: k }} visible={false}><ItemModel kind={k} looks={looks} empty={k === "bottle"} /></group>)}
      </group>)}
    </group>
    <InteractionPrompt sample={() => {
      if (state.invAct || state.scooter.riding || state.accident) return { visible: false, x: 0, y: 0, z: 0, time: 0 };
      let best: GameState["groundItems"][number] | null = null, bd = 1.0;
      for (const g of state.groundItems) { const d = Math.hypot(g.x - state.pos.x, g.z - state.pos.z); if (d < bd) { bd = d; best = g; } }
      if (!best) return { visible: false, x: 0, y: 0, z: 0, time: 0 };
      return { visible: true, x: best.x, y: floorHeight(best.x, best.z) + 0.45, z: best.z, time: state.simulationTime, label: `E  ${best.kind === "bottle" ? "EMPTY BOTTLE" : ITEMS[best.kind].name.toUpperCase()}` };
    }} />
  </>;
}
