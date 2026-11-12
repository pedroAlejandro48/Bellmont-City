import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { AptFloor } from "./aptRoom";
import { handWorld } from "./arms";
import { GAME_MINUTE } from "./config";
import { burnLevel, cookedFor, foodColors, isDish, isPotLike, stoveState, type Held } from "./kitchen";
import { cupboardSlot, rackSpot } from "./kitchenMoves";
import type { KView } from "./kitchenRun";
import { CAN_INFO, CAPACITY, type CanKind, type WareKind } from "./pantry";
import { CanModel, FoodFill, WareModel } from "./PantryModels";
import { toLocal } from "./restaurantRoom";
import type { GameState } from "./state";

type V3 = [number, number, number];
const PUFFS = 6;
const smoothstep = (x: number) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };
/** A fork, a knife or a spoon (origin at the grip, pointing +z out of the hand). */
function Utensil({ kind, m }: { kind: "fork" | "knife" | "spoon"; m: { steel: THREE.Material } }) {
  return <group>
    <mesh position={[0, 0, 0.03]} material={m.steel}><boxGeometry args={[0.012, 0.004, 0.11]} /></mesh>
    {kind === "fork" && [-1, -0.33, 0.33, 1].map((x) => <mesh key={x} position={[x * 0.006, 0, 0.1]} material={m.steel}><boxGeometry args={[0.0022, 0.003, 0.035]} /></mesh>)}
    {kind === "knife" && <mesh position={[0.002, 0, 0.11]} material={m.steel}><boxGeometry args={[0.016, 0.002, 0.07]} /></mesh>}
    {kind === "spoon" && <mesh position={[0, 0.004, 0.1]} scale={[1, 0.35, 1.35]} material={m.steel}><sphereGeometry args={[0.016, 12, 8]} /></mesh>}
  </group>;
}
/**
 * The kitchen's things in your own apartment (floor frame): the cupboard's doors and the pots and pans in it (to
 * click while choosing), what's on the counter, the dirty things in the sink, the pot on the stove (steaming as it
 * cooks, smoking as it burns), the plates on the table, the bin's lid, the tap's water, what's pouring, and what's
 * in each hand.
 */
export function KitchenThings({ fl, state, view, m }: { fl: AptFloor; state: GameState; view: KView; m: { white: THREE.Material; steel: THREE.Material; s: (c: string, r?: number, mt?: number) => THREE.MeshStandardMaterial } }) {
  const K = fl.kitchen, cb = K.cupboard, k = state.life.kitchen;
  // What's where only changes now and then: redrawn when it does.
  const [, rerender] = useState(0);
  const sig = useRef("");
  const mats = useMemo(() => ({
    door: m.s("#f4f2ee", 0.45), inside: m.s("#d9d3c8", 0.85), grime: m.s("#7a5a3a", 0.8), glow: new THREE.MeshStandardMaterial({ color: "#3a0d06", emissive: new THREE.Color("#ff4a1a"), emissiveIntensity: 0, roughness: 0.6 }),
    water: new THREE.MeshStandardMaterial({ color: "#a9d8ff", transparent: true, opacity: 0.55, roughness: 0.05, emissive: new THREE.Color("#3a7ab0"), emissiveIntensity: 0.25 }),
    steam: new THREE.MeshStandardMaterial({ color: "#ffffff", transparent: true, opacity: 0.25, depthWrite: false, roughness: 1 }),
    smoke: new THREE.MeshStandardMaterial({ color: "#2a2a2a", transparent: true, opacity: 0.4, depthWrite: false, roughness: 1 }),
    sauce: new THREE.MeshStandardMaterial({ color: "#c4552a", roughness: 0.25 }), chunk: new THREE.MeshStandardMaterial({ color: "#e07a3a", roughness: 0.6 }),
    hover: new THREE.MeshStandardMaterial({ color: "#ffb547", transparent: true, opacity: 0.35, depthWrite: false }),
  }), [m]);
  useEffect(() => () => { for (const x of Object.values(mats)) x.dispose(); }, [mats]);
  const doorL = useRef<THREE.Group>(null), doorR = useRef<THREE.Group>(null), lid = useRef<THREE.Group>(null), tap = useRef<THREE.Mesh>(null);
  const puffs = useRef<(THREE.Mesh | null)[]>([]), stream = useRef<THREE.Mesh>(null), chunks = useRef<(THREE.Mesh | null)[]>([]), toss = useRef<THREE.Group>(null);
  const handL = useRef<THREE.Group>(null), handR = useRef<THREE.Group>(null), canG = useRef<THREE.Group>(null), canInner = useRef<THREE.Group>(null), potInner = useRef<THREE.Group>(null);
  const glows = useRef<(THREE.Mesh | null)[]>([]), splash = useRef<THREE.Mesh>(null), bite = useRef<THREE.Mesh>(null), utensil = useRef<THREE.Group>(null);
  const [hover, setHover] = useState<number | null>(null);
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), q: new THREE.Quaternion() }), []);
  const local = (w: THREE.Vector3): V3 => { const [x, z] = toLocal(fl.frame, w.x, w.z); return [x, w.y - fl.y, z]; };
  const handAt = (i: 9 | 11, out: THREE.Vector3) => { const fore = state.avatar.body[i]; if (!fore) return null; fore.updateWorldMatrix(true, false); handWorld(fore, out); return out; };

  useFrame(() => {
    const t = state.simulationTime;
    const s = `${k.cupboard.join()}|${k.rack.join()}|${k.sink.join()}|${k.stoves.map((b) => (b ? `${b.ware}${b.cans.join()}${b.start}` : "-")).join()}|${k.table.map((x) => `${x.chair}${x.cans.join()}${x.eaten}${x.silver}`).join()}|${JSON.stringify(k.hands)}|${view.drying.join()}|${view.washing}|${view.can}|${view.choosing}|${view.eat?.t0}|${k.stoves.map((_, i) => `${stoveState(k, i, state.elapsed, GAME_MINUTE)}${Math.round(burnLevel(cookedFor(k, i, state.elapsed, GAME_MINUTE)) * 20)}`).join()}|${view.holdL}|${view.holdR}|${view.stream}|${Math.round(view.pourK * 12)}|${view.eat ? Math.round((state.simulationTime - view.eat.t0) * 3) : ""}`;
    if (s !== sig.current) { sig.current = s; rerender((n) => n + 1); }
    // The doors, the lid, the tap.
    if (doorL.current) doorL.current.rotation.y = view.door * 1.6;
    if (doorR.current) doorR.current.rotation.y = -view.door * 1.6;
    if (lid.current) lid.current.rotation.x = view.lid * 1.35;
    if (tap.current) { tap.current.visible = view.water > 0.02; tap.current.scale.set(1, Math.max(0.01, view.water), 1); }
    // The burner glows under a pot that's cooking; steam rises, or smoke when it's burning.
    K.burners.forEach((B0, bi) => {
      const st = stoveState(k, bi, state.elapsed, GAME_MINUTE), on = st === "cooking" || st === "ready" || st === "burnt";
      const g = glows.current[bi]; if (g) (g.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 1.4 + 0.2 * Math.sin(t * 3 + bi) : 0;
      const burn = burnLevel(cookedFor(k, bi, state.elapsed, GAME_MINUTE));
      for (let j = 0; j < PUFFS; j++) {
        const p = puffs.current[bi * PUFFS + j];
        if (!p) continue;
        p.visible = on;
        if (!on) continue;
        const ph = (t * 0.35 + j / PUFFS + bi * 0.37) % 1;
        p.position.set(B0[0] + Math.sin(j * 2.1 + t) * 0.04, B0[1] + 0.18 + ph * 0.55, B0[2] + Math.cos(j * 1.7 + t) * 0.04);
        p.scale.setScalar((0.03 + ph * 0.07) / 0.05);
        p.material = burn > 0.6 ? mats.smoke : mats.steam;
        (p.material as THREE.MeshStandardMaterial).opacity = (burn > 0.6 ? 0.45 : 0.22) * (1 - ph);
      }
    });
    // Something pouring: a curved stream of sauce with bits in it, from the lip of the can or the pot (falling as
    // it goes) to where it lands.
    const kind = view.stream;
    let from: THREE.Vector3 | null = null, to: THREE.Vector3 | null = null, cols: [string, string] = ["#c4552a", "#e07a3a"];
    if (kind === "can" && canInner.current) {
      canInner.current.updateWorldMatrix(true, false);
      from = canInner.current.localToWorld(tmp.a.set(0, 0.105, 0.036));
      const B0 = K.burners[view.pourInto] ?? K.burners[0]!, b2 = k.stoves[view.pourInto];
      const lvl = b2 ? (b2.cans.length + view.pourK) / CAPACITY[b2.ware] : 0.3;
      to = toWorld3(fl, new THREE.Vector3(B0[0], B0[1] + (b2?.ware === "pan" ? 0.012 + 0.035 * lvl : 0.018 + 0.11 * lvl), B0[2]));
      if (view.can) cols = CAN_INFO[view.can].food;
    } else if ((kind === "pot" || kind === "burnt") && potInner.current) {
      const pot = k.hands.right, pan = pot?.ware === "pan";
      potInner.current.updateWorldMatrix(true, false);
      from = potInner.current.localToWorld(tmp.a.set(pan ? -0.13 : -0.11, pan ? 0.05 : 0.148, 0));
      if (kind === "pot") { to = handAt(9, tmp.b); if (to) to.y += 0.03 + 0.012 * view.pourK; if (pot?.food) { const c = foodColors(pot.food); cols = [c.a, c.b]; } }
      else { to = toWorld3(fl, new THREE.Vector3(K.trash[0], 0.42, K.trash[2])); cols = ["#151210", "#2a1d14"]; }
    }
    const sm = stream.current;
    if (sm) {
      sm.visible = !!(from && to);
      if (from && to) {
        const a = new THREE.Vector3(...local(from)), b = new THREE.Vector3(...local(to));
        // It leaves the lip moving outward, then falls: a curve bowed out past the lip.
        const out = new THREE.Vector3(b.x - a.x, 0, b.z - a.z); const ol = out.length() || 1; out.multiplyScalar(Math.min(0.09, ol * 0.6) / ol);
        const c1 = a.clone().add(out).add(new THREE.Vector3(0, 0.015, 0));
        const curve = new THREE.QuadraticBezierCurve3(a, c1, b);
        sm.geometry.dispose();
        sm.geometry = new THREE.TubeGeometry(curve, 18, kind === "can" ? 0.008 : 0.011, 7, false);
        mats.sauce.color.set(cols[0]); mats.chunk.color.set(cols[1]);
        chunks.current.forEach((c, i) => { if (!c) return; const ph = (t * 1.9 + i / chunks.current.length) % 1; c.visible = true; const q = curve.getPoint(ph); c.position.set(q.x + Math.sin(i * 3 + t * 9) * 0.004, q.y, q.z + Math.cos(i * 2 + t * 7) * 0.004); });
        // Where it lands, a little splash.
        if (splash.current) { splash.current.visible = true; splash.current.position.copy(b); const w2 = 1 + 0.25 * Math.sin(t * 20); splash.current.scale.set(w2, 1, w2); }
      } else { chunks.current.forEach((c) => { if (c) c.visible = false; }); if (splash.current) splash.current.visible = false; }
    }
    // An empty can flying into the bin.
    const tg = toss.current;
    if (tg) {
      const d = t - view.tossAt, on2 = view.tossAt >= 0 && d < 0.5;
      tg.visible = on2;
      if (on2) {
        const s0: V3 = [K.ovenStand[0] - 0.3, 1.05, K.ovenStand[1] + 0.3], s1: V3 = [K.trash[0], 0.55, K.trash[2]], q = d / 0.5;
        tg.position.set(s0[0] + (s1[0] - s0[0]) * q, s0[1] + (s1[1] - s0[1]) * q + Math.sin(Math.PI * q) * 0.25, s0[2] + (s1[2] - s0[2]) * q);
        tg.rotation.set(q * 8, 0, q * 5);
      }
      if (lid.current && on2) lid.current.rotation.x = Math.max(lid.current.rotation.x, 1.2 * Math.sin(Math.PI * Math.min(1, d / 0.5 + 0.2)));
    }
    // What's in each hand.
    const yaw = state.rotY - fl.frame.rot;
    for (const [g, i] of [[handL.current, 9], [handR.current, 11]] as const) {
      if (!g) continue;
      const w = handAt(i, tmp.a);
      if (!w || state.uiLock === "cupboard") { g.visible = false; continue; }
      g.visible = true;
      const p = local(w); g.position.set(p[0], p[1], p[2]);
      g.rotation.set(0, yaw, 0, "YXZ");
      if (i === 11) g.rotation.z = -view.potTilt;
    }
    if (canG.current) { canG.current.visible = !!view.can; canG.current.rotation.set(view.canTilt, 0, 0); }
    // Eating: a bit of the food on the fork (or spoon) on its way up, gone once it's at the mouth.
    if (bite.current) {
      const e = view.eat, meal = state.meal;
      bite.current.visible = false;
      // (Loaded once it's back down at the plate, up to the mouth with it, gone inside — and back down empty.)
      if (e && meal) { const T = e.T, per = T / (meal.bites ?? 3), u = ((t - e.t0) % per) / per; bite.current.visible = (t - e.t0) < T - 0.3 && u > 0.04 && u < 0.4; }
    }
    // The fork (or spoon) points where it's going: down at the plate, and up into the mouth as it comes up.
    const ut = utensil.current, hr = handR.current, headObj = state.avatar.body[3];
    if (ut && hr && headObj && view.eat && state.meal) {
      const e = view.eat, per = e.T / (state.meal.bites ?? 3), u = ((t - e.t0) % per) / per;
      const up = u < 0.35 ? smoothstep(u / 0.35) : u < 0.6 ? 1 : 1 - smoothstep((u - 0.6) / 0.4);
      headObj.updateWorldMatrix(true, false);
      const mouth = headObj.localToWorld(tmp.a.set(0, -0.06, 0.1));
      const pl = K.places.find((x) => x.chair === e.chair), plate = pl ? toWorld3(fl, new THREE.Vector3(pl.at[0], pl.at[1] + 0.03, pl.at[2])) : mouth.clone();
      hr.updateWorldMatrix(true, false);
      const from = hr.getWorldPosition(tmp.b);
      const dir = plate.sub(from).normalize().lerp(mouth.sub(from).normalize(), up).normalize();
      const qWorld = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      ut.quaternion.copy(hr.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(qWorld));
    }
  });

  const dirtyPlate = (key: string | number, at: V3, w: WareKind) => <group key={key} position={at}><WareModel kind={w} />{(w === "plate" || w === "bowl") && <mesh position={[0.02, w === "plate" ? 0.018 : 0.03, 0.01]} rotation-x={-Math.PI / 2} material={mats.grime}><circleGeometry args={[0.045, 12]} /></mesh>}</group>;
  const eatingNow = view.eat && state.meal ? view.eat : null;
  const mealCans = eatingNow ? k.table.find((x) => x.chair === eatingNow.chair)?.cans ?? [] : [];
  const soup = mealCans.some((c) => c === "chickenSoup" || c === "beefSoup");
  const held = (h0: Held | null, side: "left" | "right") => {
    if (side === "left" && view.washing) return <group position={[0, -0.03, 0.06]}><WareModel kind={view.washing} /></group>;
    // Eating: only the fork (or a spoon, for soup) in the right hand, the knife in the left.
    if (eatingNow) {
      // (Held bigger than life while eating, so they read.)
      if (side === "right") return <group ref={utensil} scale={1.7}><Utensil kind={soup ? "spoon" : "fork"} m={m} />{<mesh ref={bite} position={[0, soup ? 0.006 : 0.004, soup ? 0.1 : 0.115]} material={mats.chunk}><sphereGeometry args={[0.011, 8, 6]} /></mesh>}</group>;
      return soup ? null : <group rotation-x={-0.6} scale={1.7}><Utensil kind="knife" m={m} /></group>;
    }
    const shown = side === "left" ? view.holdL : view.holdR;
    const h: Held | null = h0 ?? (shown ? { ware: shown, food: null, dirty: false } : null);
    if (!h) return null;
    // Pouring out (into a plate, or the bin): the pot empties as the plate fills.
    const pouring = view.stream === "pot" || view.stream === "burnt" || (view.pourK > 0 && view.pourK < 1);
    const lvl0 = h.food ? h.food.length / (isPotLike(h.ware) ? CAPACITY[h.ware] : 3) : 0;
    const food = h.food ? { ...foodColors(h.food, h.burnt ? 1 : 0), level: isPotLike(h.ware) && pouring ? lvl0 * (1 - view.pourK) : lvl0 } : null;
    const potFood = k.hands.right?.food, filling = side === "left" && !h.food && isDish(h.ware) && view.stream === "pot" && potFood ? { ...foodColors(potFood), level: Math.max(0.02, view.pourK) * potFood.length / 3 } : null;
    // A pot or pan hangs from its handle (the body off toward the middle); a plate is held level; the rest upright.
    if (h.ware === "pot") return <group position={[0.14, -0.118, 0]}><group ref={side === "right" ? potInner : null} rotation-y={Math.PI}><WareModel kind="pot" food={food && food.level > 0.01 ? food : null} /></group></group>;
    if (h.ware === "pan") return <group position={[0.33, -0.07, 0]}><group ref={side === "right" ? potInner : null} rotation-y={Math.PI}><WareModel kind="pan" food={food && food.level > 0.01 ? food : null} /></group></group>;
    if (h.ware === "plate" || h.ware === "bowl") return <group position={[side === "left" ? 0.04 : -0.04, -0.02, 0.07]}><WareModel kind={h.ware} food={food ?? filling} />{h.dirty && !h.food && <mesh position={[0, 0.019, 0]} rotation-x={-Math.PI / 2} material={mats.grime}><circleGeometry args={[0.045, 12]} /></mesh>}{h.silver && <group position={[0, 0.02, 0]}><WareModel kind="silverware" /></group>}</group>;
    if (h.ware === "silverware") return <group rotation-x={-1.1} position={[0, -0.01, 0.02]}><WareModel kind="silverware" /></group>;
    return <group position={[0, -0.05, 0.02]}><WareModel kind={h.ware} /></group>;
  };
  const places = K.places;
  const eatK = view.eat ? Math.min(1, (state.simulationTime - view.eat.t0) / view.eat.T) : 0;
  const B = (a: V3) => <boxGeometry args={a} />;
  return <group>
    {/* The cupboard's doors: hinged at its sides, handles by the middle. */}
    <group ref={doorL} position={[cb.x - cb.w / 2, 0.08, cb.z]}>
      <mesh position={[cb.w / 4, 0.38, -0.01]} material={mats.door} castShadow>{B([cb.w / 2 - 0.006, 0.76, 0.02])}</mesh>
      <mesh position={[cb.w / 2 - 0.05, 0.62, -0.03]} material={m.steel}>{B([0.012, 0.12, 0.02])}</mesh>
    </group>
    <group ref={doorR} position={[cb.x + cb.w / 2, 0.08, cb.z]}>
      <mesh position={[-cb.w / 4, 0.38, -0.01]} material={mats.door} castShadow>{B([cb.w / 2 - 0.006, 0.76, 0.02])}</mesh>
      <mesh position={[-cb.w / 2 + 0.05, 0.62, -0.03]} material={m.steel}>{B([0.012, 0.12, 0.02])}</mesh>
    </group>
    {/* In the cupboard: the pots and pans (click one while choosing). */}
    {k.cupboard.map((w, i) => {
      const at = cupboardSlot(fl, i);
      return <group key={`cb${i}`} position={at}
        onClick={(e) => { if (!view.choosing) return; e.stopPropagation(); view.picked = i; document.body.style.cursor = ""; }}
        onPointerOver={(e) => { if (!view.choosing) return; e.stopPropagation(); setHover(i); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { if (hover === i) setHover(null); document.body.style.cursor = ""; }}>
        <group rotation-y={Math.PI / 2}><WareModel kind={w} /></group>
        {view.choosing && hover === i && <mesh position={[0, 0.07, 0]} material={mats.hover}><sphereGeometry args={[0.15, 14, 10]} /></mesh>}
      </group>;
    })}
    {/* On the counter: plates and bowls stacked, cups and glasses in a row, the silverware in a pot. */}
    {(["plate", "bowl", "cup", "glass", "silverware"] as const).map((w) => {
      const n = k.rack.filter((x) => x === w).length + view.drying.filter((x) => x === w).length - (view.holdL === w ? 1 : 0) - (view.holdR === w ? 1 : 0), at = rackSpot(fl, w);
      if (n <= 0) return null;
      if (!n) return null;
      if (w === "plate" || w === "bowl") return Array.from({ length: n }, (_, j) => <group key={`${w}${j}`} position={[at[0], at[1] + j * (w === "plate" ? 0.017 : 0.045), at[2]]}><WareModel kind={w} /></group>);
      if (w === "silverware") return <group key={w} position={at}>
        <mesh position={[0, 0.06, 0]} material={m.steel}><cylinderGeometry args={[0.04, 0.035, 0.12, 14, 1, true]} /></mesh>
        {Array.from({ length: Math.min(6, n * 3) }, (_, j) => <mesh key={j} position={[Math.cos(j * 2.1) * 0.015, 0.13, Math.sin(j * 2.1) * 0.015]} rotation-z={Math.cos(j) * 0.2} material={m.steel}><boxGeometry args={[0.008, 0.08, 0.004]} /></mesh>)}
      </group>;
      return Array.from({ length: n }, (_, j) => <group key={`${w}${j}`} position={[at[0] - j * 0.09, at[1], at[2]]}><WareModel kind={w} /></group>);
    })}
    {/* Dirty things in the sink. */}
    {k.sink.map((w, i) => dirtyPlate(`s${i}`, [K.basin[0] - 0.12 + (i % 3) * 0.12, K.basin[1] - 0.1 + Math.floor(i / 3) * 0.03, K.basin[2] + ((i % 2) - 0.5) * 0.08], w))}
    {/* The stove: two burners (glowing while they cook) and what's on each; as cans are poured in it fills bit by bit. */}
    {K.burners.map((B0, bi) => {
      const b2 = k.stoves[bi], burn = burnLevel(cookedFor(k, bi, state.elapsed, GAME_MINUTE));
      const pouringIn = view.stream === "can" && view.pourInto === bi && view.can ? view.can : null;
      const cans = b2 ? (pouringIn ? [...b2.cans, pouringIn] : b2.cans) : [];
      const lvl = b2 ? (b2.cans.length + (pouringIn ? view.pourK : 0)) / CAPACITY[b2.ware] : 0;
      return <group key={`b${bi}`}>
        <mesh ref={(r) => { glows.current[bi] = r; }} position={[B0[0], B0[1] - 0.012, B0[2]]} rotation-x={-Math.PI / 2}><ringGeometry args={[0.04, 0.085, 22]} /><meshStandardMaterial color="#3a0d06" emissive="#ff4a1a" emissiveIntensity={0} roughness={0.6} /></mesh>
        {b2 && <group position={B0}><WareModel kind={b2.ware} food={cans.length && lvl > 0.01 ? { ...foodColors(cans, burn), level: lvl } : null} /></group>}
      </group>;
    })}
    {Array.from({ length: PUFFS * K.burners.length }, (_, i) => <mesh key={`p${i}`} ref={(r) => { puffs.current[i] = r; }} visible={false} material={mats.steam}><sphereGeometry args={[0.05, 8, 6]} /></mesh>)}
    {/* The table: plates with their meals (going as they're eaten), the silverware laid on them after. */}
    {k.table.map((t, i) => {
      const pl = places.find((p) => p.chair === t.chair);
      if (!pl) return null;
      const eating = view.eat?.chair === t.chair, level = t.eaten ? 0 : eating ? 1 - eatK : 1;
      return <group key={`t${i}`} position={pl.at}>
        <WareModel kind={t.ware} food={level > 0.02 ? { ...foodColors(t.cans), level } : null} />
        {t.eaten && <mesh position={[0.02, 0.018, 0.01]} rotation-x={-Math.PI / 2} material={mats.grime}><circleGeometry args={[0.05, 12]} /></mesh>}
        {t.silver && <group position={[0, 0.02, 0]} rotation-y={0.6}><WareModel kind="silverware" /></group>}
      </group>;
    })}
    {/* The bin's lid, hinged at the back. */}
    <group ref={lid} position={[K.trash[0], 0.61, K.trash[2] + 0.165]}>
      <mesh position={[0, 0.008, -0.165]} material={m.s("#dde1e5", 0.28, 0.42)} castShadow><cylinderGeometry args={[0.168, 0.168, 0.016, 28]} /></mesh>
    </group>
    {/* The tap's water, from the spout into the basin. */}
    <mesh ref={tap} visible={false} position={[K.basin[0], (K.basin[1] + 1.1) / 2 - 0.02, K.basin[2] + 0.06]} material={mats.water}><cylinderGeometry args={[0.009, 0.012, 1.1 - K.basin[1], 10, 1, true]} /></mesh>
    {/* Pouring: the stream and the bits in it. */}
    <mesh ref={stream} visible={false} material={mats.sauce}><bufferGeometry /></mesh>
    <mesh ref={splash} visible={false} material={mats.sauce}><sphereGeometry args={[0.02, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
    {Array.from({ length: 6 }, (_, i) => <mesh key={`c${i}`} ref={(r) => { chunks.current[i] = r; }} visible={false} material={mats.chunk}><sphereGeometry args={[0.009 + (i % 3) * 0.003, 6, 5]} /></mesh>)}
    {/* An empty can on its way into the bin. */}
    <group ref={toss} visible={false}><CanModel kind={"tuna" as CanKind} open={1} /></group>
    {/* In the hands. */}
    <group ref={handL}>
      {held(k.hands.left, "left")}
      <group ref={canG} position={[0, -0.05, 0.03]}><group ref={canInner}>{view.can && <CanModel kind={view.can} open={view.canOpen} />}</group></group>
    </group>
    <group ref={handR}>{held(k.hands.right, "right")}</group>
  </group>;
}
/** A point in the floor's frame (height above its floor) to the world. */
function toWorld3(fl: AptFloor, p: THREE.Vector3) {
  const f = fl.frame, x = f.ox + p.x * f.c + p.z * f.s, z = f.oz - p.x * f.s + p.z * f.c;
  return new THREE.Vector3(x, fl.y + p.y, z);
}
