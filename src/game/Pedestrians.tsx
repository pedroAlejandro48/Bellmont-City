import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo } from "react";
import * as THREE from "three";
import { HALF, PARK_LAMPS, SIGNAL_POLES, THROW_DISTANCE, blockIndex, circleBoxPush, floorHeight, rng, scooterFootprint, type City } from "./config";
import { bodyColor } from "@/platform/account";
import { CharacterBody, useBodyRig } from "./CharacterBody";
import { RagdollBody, type RagdollSubject } from "./Ragdoll";
import type { Accident, GameState, NpcBody } from "./state";
import { CROSS_SPEED, NPC_RADIUS, WALK_SPEED, legEnd, mayCross, nextLeg, npcGender, spawnBlock, spawnOnRing, steer, type Leg, type Obstacle } from "./pedestrians";

/** How many people are about at once (around the player). */
const NPC_COUNT = 22;
/** Further than this from the player, someone is moved to walk somewhere nearer. */
const NPC_RANGE = 170;
/** How quickly a standing person gives way when leaned into (m/s): a slow shove. */
const SHOVE = 0.8;

type Npc = {
  body: NpcBody; pos: THREE.Vector3; yaw: number; color: string;
  leg: Leg; crossing: boolean;
  mode: "walk" | "stand" | "wait"; until: number;
  speed: number; phase: number;
  accident: Accident | null;
  random: () => number;
};

const turn = (from: number, to: number, t: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * Math.min(1, t);

function place(npc: Npc, fi: number, fj: number, avoid: THREE.Vector3 | null) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const [i, j] = spawnBlock(fi, fj, npc.random);
    const at = spawnOnRing(i, j, npc.random);
    if (avoid && attempt < 11 && Math.hypot(at.x - avoid.x, at.z - avoid.z) < 45) continue;
    npc.pos.set(at.x, floorHeight(at.x, at.z), at.z);
    npc.leg = at.leg; npc.crossing = false;
    const [tx, tz] = legEnd(at.leg);
    npc.yaw = Math.atan2(tx - at.x, tz - at.z);
    return;
  }
}

/**
 * People walking the city's sidewalks (or standing about), more of them on the blocks by the avenues. They
 * cross small streets anywhere at the corners (and can be hit there), and avenues only on the zebra crossings
 * once the traffic has a red light. They are solid like players, step around whatever is in their way, can be
 * shoved slowly, and when a vehicle hits them they fall (ragdoll), get up and carry on. They never die.
 */
export function Pedestrians({ state, city }: { state: GameState; city: City }) {
  const npcs = useMemo<Npc[]>(() => {
    const list: Npc[] = [];
    const fi = blockIndex(state.pos.x), fj = blockIndex(state.pos.z);
    for (let id = 0; id < NPC_COUNT; id++) {
      const random = rng(state.worldSeed ^ (id * 7919 + 13));
      const npc: Npc = {
        body: { id, x: 0, z: 0, down: false, moving: false, hit: null }, pos: new THREE.Vector3(), yaw: 0,
        color: bodyColor(npcGender(state.worldSeed, id)), leg: { kind: "ring", i: 0, j: 0, from: 0, to: 1 }, crossing: false,
        mode: random() < 0.75 ? "walk" : "stand", until: 2 + random() * 20, speed: 0, phase: random() * 6, accident: null, random,
      };
      place(npc, fi, fj, null);
      list.push(npc);
    }
    return list;
  }, [state]);
  useEffect(() => {
    state.npcs = npcs.map((n) => n.body);
    return () => { state.npcs = []; };
  }, [state, npcs]);

  // Fixed things to walk around: sidewalk trees, lamp posts, signal poles, the park's lamps.
  const fixed = useMemo<Obstacle[]>(() => [
    ...city.trees.filter((t) => t.sidewalk).map((t) => ({ x: t.x, z: t.z, r: 0.3 })),
    ...city.lamps.map((l) => ({ x: l.x, z: l.z, r: 0.15 })),
    ...SIGNAL_POLES.map((s) => ({ x: s.x, z: s.z, r: 0.15 })),
    ...PARK_LAMPS.map((l) => ({ x: l.x, z: l.z, r: 0.12 })),
  ], [city]);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05), now = state.simulationTime, p = state.pos;
    const playerOnFoot = !state.scooter.riding && !state.interior && !state.accident;
    const fi = blockIndex(p.x), fj = blockIndex(p.z);
    const bike = state.scooter;
    const bikeBox = scooterFootprint(bike.pos.x, bike.pos.z, bike.yaw, bike.fallen, bike.fallSide);
    for (const npc of npcs) {
      const b = npc.body;
      // Hit by a vehicle: down they go.
      if (b.hit && !npc.accident) {
        npc.accident = { phase: "down", startedAt: now, riseStartedAt: null, vehicleId: null, direction: b.hit.direction, launchSpeed: THROW_DISTANCE * 1.75, seed: Math.floor(npc.random() * 1e8) };
        npc.mode = "walk"; npc.speed = 0;
      }
      b.hit = null;
      if (npc.accident) { b.x = npc.pos.x; b.z = npc.pos.z; b.down = true; b.moving = false; continue; }
      b.down = false;
      // Too far away: someone else, somewhere nearer.
      if (Math.hypot(npc.pos.x - p.x, npc.pos.z - p.z) > NPC_RANGE) place(npc, Math.max(-HALF, Math.min(HALF, fi)), Math.max(-HALF, Math.min(HALF, fj)), p);

      // Now and then switch between walking and standing (never in the middle of a road).
      if (now > npc.until && !npc.crossing) {
        npc.mode = npc.mode === "walk" && npc.random() < 0.45 ? "stand" : "walk";
        npc.until = now + (npc.mode === "walk" ? 6 + npc.random() * 40 : 3 + npc.random() * 18);
      }
      let target = legEnd(npc.leg);
      if (npc.leg.kind === "cross" && !npc.crossing) {
        // At the kerb: go once it is safe to start (avenues: on red for the traffic, with time to get over).
        const atKerb = Math.hypot(npc.leg.from[0] - npc.pos.x, npc.leg.from[1] - npc.pos.z) < 0.8;
        if (atKerb && mayCross(npc.leg, state.elapsed)) npc.crossing = true;
        else if (atKerb) { npc.mode = "wait"; target = npc.leg.from; }
        else target = npc.leg.from;
      }
      if (npc.mode === "wait" && (npc.crossing || npc.leg.kind !== "cross")) npc.mode = "walk";
      // Reached the end of this stretch: choose the next.
      if (Math.hypot(target[0] - npc.pos.x, target[1] - npc.pos.z) < 0.45 && (npc.leg.kind === "ring" || npc.crossing)) {
        if (npc.leg.kind === "ring") npc.leg = nextLeg(npc.leg.i, npc.leg.j, npc.leg.to, npc.leg.from, npc.random);
        else {
          const [i, j] = npc.leg.toBlock, from = npc.leg.toCorner;
          npc.leg = { kind: "ring", i, j, from, to: (from + (npc.random() < 0.5 ? 1 : 3)) % 4 };
        }
        npc.crossing = false;
        target = npc.leg.kind === "cross" ? npc.leg.from : legEnd(npc.leg);
      }

      // Things in the way: fixed props nearby, the bike, other people (players and NPCs) and vehicles.
      const near: Obstacle[] = [];
      const x = npc.pos.x, z = npc.pos.z;
      for (const o of fixed) if (Math.abs(o.x - x) < 3 && Math.abs(o.z - z) < 3) near.push(o);
      if (Math.abs(bike.pos.x - x) < 4 && Math.abs(bike.pos.z - z) < 4 && !bike.riding) near.push({ x: bike.pos.x, z: bike.pos.z, r: 0.95 });
      for (const ob of [...state.otherBikes, ...state.parkedBikes]) if (Math.abs(ob.box.x - x) < 4 && Math.abs(ob.box.z - z) < 4) near.push({ x: ob.box.x, z: ob.box.z, r: 0.95 });
      if (playerOnFoot) near.push({ x: p.x, z: p.z, r: 0.35 });
      for (const o of state.others) near.push({ x: o.x, z: o.z, r: o.r });
      for (const other of npcs) if (other !== npc && !other.accident && Math.abs(other.pos.x - x) < 3 && Math.abs(other.pos.z - z) < 3) near.push({ x: other.pos.x, z: other.pos.z, r: NPC_RADIUS });
      for (const v of state.vehicles) if (Math.abs(v.box.x - x) < 8 && Math.abs(v.box.z - z) < 8) near.push({ x: v.box.x, z: v.box.z, r: Math.max(v.box.hx, v.box.hz) * 0.7 });

      const walking = npc.mode === "walk";
      const pace = walking ? (npc.crossing && npc.leg.kind === "cross" && npc.leg.avenue ? CROSS_SPEED : WALK_SPEED) : 0;
      npc.speed += (pace - npc.speed) * (1 - Math.exp(-5 * dt));
      if (npc.speed > 0.02) {
        const [dx, dz] = steer(x, z, target, near);
        npc.pos.x += dx * npc.speed * dt; npc.pos.z += dz * npc.speed * dt;
        npc.yaw = turn(npc.yaw, Math.atan2(dx, dz), 10 * dt);
      } else if (npc.mode === "wait" && npc.leg.kind === "cross") {
        // Waiting at the kerb, facing across.
        npc.yaw = turn(npc.yaw, Math.atan2(npc.leg.to[0] - x, npc.leg.to[1] - z), 4 * dt);
      }

      // The same solid bodies as players: props, vehicles and bikes push them out; leaning into one moves it slowly.
      for (const o of near) {
        if (o.r > 0.9 || (o.x === p.x && o.z === p.z)) continue;
        const ddx = npc.pos.x - o.x, ddz = npc.pos.z - o.z, d = Math.hypot(ddx, ddz), min = NPC_RADIUS + o.r;
        if (d < min && d > 1e-5) { npc.pos.x = o.x + ddx / d * min; npc.pos.z = o.z + ddz / d * min; }
      }
      for (const v of state.vehicles) { const [vx, vz] = circleBoxPush(npc.pos.x, npc.pos.z, NPC_RADIUS, v.box); npc.pos.x += vx; npc.pos.z += vz; }
      for (const box of [bikeBox, ...state.otherBikes.map((o) => o.box), ...state.parkedBikes.map((o) => o.box)]) { const [bx, bz] = circleBoxPush(npc.pos.x, npc.pos.z, NPC_RADIUS, box); npc.pos.x += bx; npc.pos.z += bz; }
      if (playerOnFoot) {
        // The player is solid to them (Player keeps out of NPCs); someone leaned into gives way slowly.
        const ddx = npc.pos.x - p.x, ddz = npc.pos.z - p.z, d = Math.hypot(ddx, ddz), min = NPC_RADIUS + 0.35 + 0.01;
        if (d < min && d > 1e-5) { const step = Math.min(min - d, SHOVE * dt); npc.pos.x += ddx / d * step; npc.pos.z += ddz / d * step; }
      }
      npc.pos.y = floorHeight(npc.pos.x, npc.pos.z);
      npc.phase += dt * npc.speed * 4.2;
      b.x = npc.pos.x; b.z = npc.pos.z; b.moving = npc.speed > 0.2;
    }
  });

  return <>{npcs.map((npc) => <NpcView key={npc.body.id} npc={npc} state={state} />)}</>;
}

/** One NPC: the same body as a player's (posed for walking or standing), and its ragdoll for when it is hit. */
const NpcView = memo(function NpcView({ npc, state }: { npc: Npc; state: GameState }) {
  const rig = useBodyRig();
  const subject = useMemo<RagdollSubject>(() => ({
    accident: () => npc.accident,
    pos: npc.pos,
    yaw: () => npc.yaw,
    time: () => state.simulationTime,
    canRise: () => true,
    // Back up, and on along the way they were going.
    stoodUp: (_accident, yaw) => { npc.accident = null; npc.yaw = yaw; npc.mode = "walk"; },
  }), [npc, state]);
  useFrame(() => {
    const root = rig.root.current;
    if (!root) return;
    root.visible = !npc.accident;
    if (npc.accident) return;
    root.position.copy(npc.pos); root.rotation.set(0, npc.yaw, 0);
    // Walking: the same stride as the player's walk; standing: a slight breath.
    const mv = Math.min(1, npc.speed / WALK_SPEED), s = Math.sin(npc.phase), c = Math.cos(npc.phase);
    const legA = 0.5 * mv, kneeA = 0.65 * mv;
    rig.thighL.current?.rotation.set(-s * legA, 0, 0.13);
    rig.thighR.current?.rotation.set(s * legA, 0, -0.13);
    rig.shinL.current?.rotation.set(0.08 + kneeA * Math.max(0, c), 0, 0);
    rig.shinR.current?.rotation.set(0.08 + kneeA * Math.max(0, -c), 0, 0);
    rig.armL.current?.rotation.set(s * 0.4 * mv, 0, 0.12);
    rig.armR.current?.rotation.set(-s * 0.4 * mv, 0, -0.12);
    rig.foreL.current?.rotation.set(-0.15, 0, 0);
    rig.foreR.current?.rotation.set(-0.15, 0, 0);
    const breathe = Math.sin(state.simulationTime * 2 + npc.body.id) * 0.012 * (1 - mv);
    if (rig.hips.current) rig.hips.current.position.y = 0.95 - Math.abs(c) * 0.035 * mv + breathe;
    rig.torso.current?.rotation.set(0.05 * mv, 0, 0);
  });
  return <>
    <CharacterBody rig={rig} color={npc.color} />
    <RagdollBody subject={subject} color={npc.color} />
  </>;
});
