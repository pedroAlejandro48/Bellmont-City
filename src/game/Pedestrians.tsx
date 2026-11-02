import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { BENCH_SEATS, BENCH_SIT_SECONDS, BENCH_STAND_SECONDS, HALF, PARK_LAMPS, SIGNAL_POLES, THROW_DISTANCE, benchJoints, benchPose, blockIndex, timeInfo, circleBoxPush, floorHeight, rng, scooterFootprint, type City } from "./config";
import { bodyColor } from "@/platform/account";
import { CharacterBody, useBodyRig } from "./CharacterBody";
import { RagdollBody, type RagdollSubject } from "./Ragdoll";
import type { Accident, GameState, NpcBody } from "./state";
import { CROSS_SPEED, NPC_APPEAR_DISTANCE, boxObstacles, cornerPoint, detour, parkVisit, NPC_MAX, NPC_RADIUS, WALK_SPEED, npcTarget, legEnd, legFromPosition, type NpcLink, type NpcSnapshot, mayCross, nextLeg, npcGender, spawnBlock, spawnOnRing, steer, type Leg, type Obstacle } from "./pedestrians";

/** Further than this from the player, someone is moved to walk somewhere nearer. */
const NPC_RANGE = 170;
/** How quickly a standing person gives way when leaned into (m/s): a slow shove. */
const SHOVE = 0.8;

type ParkVisit = {
  corner: number; seat: number; stage: "in" | "bench" | "out";
  /** Where still to walk, in order. */
  points: [number, number][];
  /** When to get up. */
  until: number;
  bench: { phase: "sit" | "seated" | "stand"; startedAt: number; origin: { x: number; z: number }; originYaw: number } | null;
};

type Npc = {
  body: NpcBody; pos: THREE.Vector3; yaw: number; color: string;
  leg: Leg; crossing: boolean;
  mode: "walk" | "stand" | "wait"; until: number;
  speed: number; phase: number;
  accident: Accident | null;
  random: () => number;
  /** Out and about (the rest are kept aside until the hour brings more people out). */
  active: boolean;
  /** The corner of a vehicle or bike being walked round, if one is in the way. */
  around: [number, number] | null;
  /** Each person's own spot at a corner or kerb (a little off the exact point), so nobody aims for the same one. */
  offset: [number, number];
  /** Which way they last stepped round something (kept, so they don't dither). */
  side: 1 | -1;
  /** A visit to a park bench: walking in along the path, sitting, or walking back out to the sidewalk corner. */
  park: ParkVisit | null;
  /** How far down onto a bench they are (0 standing .. 1 sat), for the pose. */
  seated: number;
  /** In a room as a guest of the host: the seed of the knock-down already shown, and when a hit was last reported. */
  shownHit: number; hitSentAt: number;
};

const turn = (from: number, to: number, t: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * Math.min(1, t);

/** Where nobody is: further than this from any player. */
const outOfSight = (x: number, z: number, players: readonly { x: number; z: number }[]) => players.every((p) => Math.hypot(x - p.x, z - p.z) >= NPC_APPEAR_DISTANCE);

/** Puts someone on a sidewalk near block (fi, fj), at least a block from every player in `away`. False if no spot. */
/** Off the bench and out of the park (giving the seat back), e.g. when moved elsewhere or knocked down. */
function leavePark(npc: Npc, seats: Map<number, string>) {
  if (npc.park && seats.get(npc.park.seat) === `npc:${npc.body.id}`) seats.delete(npc.park.seat);
  npc.park = null; npc.seated = 0;
}

function place(npc: Npc, fi: number, fj: number, away: readonly { x: number; z: number }[], seats: Map<number, string>) {
  leavePark(npc, seats);
  for (let attempt = 0; attempt < 30; attempt++) {
    const [i, j] = spawnBlock(fi, fj, npc.random);
    const at = spawnOnRing(i, j, npc.random);
    if (!outOfSight(at.x, at.z, away)) continue;
    npc.pos.set(at.x, floorHeight(at.x, at.z), at.z);
    npc.leg = at.leg; npc.crossing = false;
    const [tx, tz] = legEnd(at.leg);
    npc.yaw = Math.atan2(tx - at.x, tz - at.z);
    return true;
  }
  return false;
}
/** Kept aside: nowhere near anything, and ignored by everyone. */
function putAway(npc: Npc, seats: Map<number, string>) {
  leavePark(npc, seats);
  npc.active = false; npc.accident = null; npc.speed = 0;
  Object.assign(npc.body, { x: 1e6, z: 1e6, down: true, moving: false, hit: null });
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
    const target = npcTarget(timeInfo(state.elapsed).hours);
    for (let id = 0; id < NPC_MAX; id++) {
      const random = rng(state.worldSeed ^ (id * 7919 + 13));
      const npc: Npc = {
        body: { id, x: 0, z: 0, down: false, moving: false, hit: null }, pos: new THREE.Vector3(), yaw: 0,
        color: bodyColor(npcGender(state.worldSeed, id)), leg: { kind: "ring", i: 0, j: 0, from: 0, to: 1 }, crossing: false,
        mode: random() < 0.75 ? "walk" : "stand", until: 2 + random() * 20, speed: 0, phase: random() * 6, accident: null, random, shownHit: -1, hitSentAt: -Infinity, active: true, around: null, side: 1, park: null, seated: 0, offset: (() => { const a = random() * Math.PI * 2, d = 0.25 + random() * 0.55; return [Math.cos(a) * d, Math.sin(a) * d] as [number, number]; })(),
      };
      // At the start everyone the hour calls for is already about (anywhere); the rest are kept aside.
      place(npc, fi, fj, [], state.seatOccupants);
      if (id >= target) putAway(npc, state.seatOccupants);
      list.push(npc);
    }
    return list;
  }, [state]);
  // Test builds: the NPCs' full state for browser checks.
  useEffect(() => { if (import.meta.env["VITE_TRAFFIC_AUDIT"] === "1") (window as unknown as { __npcs?: Npc[] }).__npcs = npcs; }, [npcs]);
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

  const role = useRef<"solo" | "host" | "guest">("solo");
  const lastSnapshot = useRef<{ snapshot: NpcSnapshot; at: number } | null>(null);
  const publishTimer = useRef(0);
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05), now = state.simulationTime, p = state.pos;
    const playerOnFoot = !state.scooter.riding && !state.interior && !state.accident;
    const link = state.npcLink;
    const nextRole = !link ? "solo" : link.isHost() ? "host" : "guest";
    if (nextRole === "host" && role.current === "guest") {
      // Taking over running the NPCs: carry on from where they were seen, each toward the corner ahead.
      for (const npc of npcs) { npc.leg = legFromPosition(npc.pos.x, npc.pos.z, npc.yaw); npc.crossing = false; }
    }
    role.current = nextRole;
    if (link && nextRole === "guest") { followHost(link, now, dt); return; }
    // Everyone in the room counts: NPCs are kept near (and spawned around) all the players.
    const players = [{ x: p.x, z: p.z }, ...state.others];
    const anchor = players[Math.floor(Math.random() * players.length)] ?? p;
    const fi = blockIndex(anchor.x), fj = blockIndex(anchor.z);
    if (link) for (const hit of link.takeHits()) { const n = npcs[hit.id]; if (n && n.active && !n.accident) n.body.hit = { direction: hit.direction }; }
    // Busier by day, quieter at night: one at a time, people come out or go home, always a block from everyone.
    const target = npcTarget(timeInfo(state.elapsed).hours);
    const out = npcs.filter((n) => n.active).length;
    if (out < target) {
      const n = npcs.find((m) => !m.active);
      if (n && place(n, Math.max(-HALF, Math.min(HALF, fi)), Math.max(-HALF, Math.min(HALF, fj)), players, state.seatOccupants)) { n.active = true; n.mode = "walk"; n.body.down = false; }
    } else if (out > target) {
      const n = npcs.find((m) => m.active && !m.accident && outOfSight(m.pos.x, m.pos.z, players));
      if (n) putAway(n, state.seatOccupants);
    }
    const bike = state.scooter;
    const bikeBox = scooterFootprint(bike.pos.x, bike.pos.z, bike.yaw, bike.fallen, bike.fallSide);
    for (const npc of npcs) {
      const b = npc.body;
      if (!npc.active) continue;
      // Hit by a vehicle: down they go.
      if (b.hit && !npc.accident) {
        if (npc.park) { leavePark(npc, state.seatOccupants); npc.leg = legFromPosition(npc.pos.x, npc.pos.z, npc.yaw); }
        npc.accident = { phase: "down", startedAt: now, riseStartedAt: null, vehicleId: null, direction: b.hit.direction, launchSpeed: THROW_DISTANCE * 1.75, seed: Math.floor(npc.random() * 1e8) };
        npc.mode = "walk"; npc.speed = 0;
      }
      b.hit = null;
      if (npc.accident) { b.x = npc.pos.x; b.z = npc.pos.z; b.down = true; b.moving = false; continue; }
      b.down = false;
      // Too far away: someone else, somewhere nearer.
      if (players.every((o) => Math.hypot(npc.pos.x - o.x, npc.pos.z - o.z) > NPC_RANGE)) place(npc, Math.max(-HALF, Math.min(HALF, fi)), Math.max(-HALF, Math.min(HALF, fj)), players, state.seatOccupants);

      const visit = npc.park;
      if (visit?.stage === "bench" && visit.bench) {
        // On the bench: sit down, sit a while, stand up (the same movement as a player's), then walk back out.
        const seat = BENCH_SEATS[visit.seat]!, sitting = visit.bench;
        // Getting up takes a little longer than a player's tap of E, so it reads as getting up (and is seen over the network).
        const t = Math.min(1, (now - sitting.startedAt) / (sitting.phase === "stand" ? BENCH_STAND_SECONDS * 2.4 : BENCH_SIT_SECONDS * 1.6));
        const pose = benchPose(seat, sitting.phase, t, sitting.origin, sitting.originYaw);
        npc.pos.set(pose.x, floorHeight(pose.x, pose.z), pose.z); npc.yaw = pose.yaw; npc.seated = pose.seated; npc.speed = 0;
        if (sitting.phase === "sit" && t >= 1) sitting.phase = "seated";
        if (sitting.phase === "seated" && now > visit.until) { sitting.phase = "stand"; sitting.startedAt = now; }
        if (sitting.phase === "stand" && t >= 1) {
          if (state.seatOccupants.get(visit.seat) === `npc:${b.id}`) state.seatOccupants.delete(visit.seat);
          const route = parkVisit(visit.corner);
          visit.stage = "out"; visit.bench = null; npc.seated = 0;
          visit.points = [route.beside, route.entry, cornerPoint(0, 0, visit.corner)];
        }
        b.x = npc.pos.x; b.z = npc.pos.z; b.moving = false;
        continue;
      }
      // Now and then switch between walking and standing (never in the middle of a road, nor on the way to a bench).
      if (now > npc.until && !npc.crossing && !visit) {
        npc.mode = npc.mode === "walk" && npc.random() < 0.45 ? "stand" : "walk";
        npc.until = now + (npc.mode === "walk" ? 6 + npc.random() * 40 : 3 + npc.random() * 18);
      }
      const mine = (q: [number, number]): [number, number] => [q[0] + npc.offset[0], q[1] + npc.offset[1]];
      // Someone else already standing at a spot: close by it counts as there (rather than pressing into them).
      const taken = (q: [number, number]) => npcs.some((o) => o !== npc && o.active && !o.accident && Math.hypot(o.pos.x - q[0], o.pos.z - q[1]) < 1);
      let target = mine(legEnd(npc.leg));
      if (visit) {
        // Walking the park path, in to a bench or back out.
        npc.mode = "walk";
        let next = visit.points[0];
        if (next && Math.hypot(next[0] - npc.pos.x, next[1] - npc.pos.z) < (visit.points.length === 1 && visit.stage === "in" ? 0.3 : 0.6)) { visit.points.shift(); next = visit.points[0]; }
        if (!next && visit.stage === "in") {
          // At the bench: take the seat if it is still free (or the other one on this bench), else head back.
          const route = parkVisit(visit.corner);
          const free = [visit.seat, ...route.seats.map((q) => q.id)].find((id) => !state.seatOccupants.has(id));
          if (free !== undefined && Math.hypot(route.front(BENCH_SEATS[free]!)[0] - npc.pos.x, route.front(BENCH_SEATS[free]!)[1] - npc.pos.z) < 1.2) {
            state.seatOccupants.set(free, `npc:${b.id}`);
            visit.seat = free; visit.stage = "bench";
            visit.bench = { phase: "sit", startedAt: now, origin: { x: npc.pos.x, z: npc.pos.z }, originYaw: npc.yaw };
            continue;
          }
          visit.stage = "out"; visit.points = [route.beside, route.entry, cornerPoint(0, 0, visit.corner)];
          next = visit.points[0];
        }
        if (!next) {
          // Back on the sidewalk: on round the park.
          npc.park = null;
          npc.leg = { kind: "ring", i: 0, j: 0, from: visit.corner, to: (visit.corner + (npc.random() < 0.5 ? 1 : 3)) % 4 };
          target = mine(legEnd(npc.leg));
        } else target = next;
      } else if (npc.leg.kind === "cross" && !npc.crossing) {
        // At the kerb: go once it is safe to start (avenues: on red for the traffic, with time to get over).
        const kerb = mine(npc.leg.from);
        const atKerb = Math.hypot(kerb[0] - npc.pos.x, kerb[1] - npc.pos.z) < (taken(kerb) ? 1.6 : 0.8);
        if (atKerb && mayCross(npc.leg, state.elapsed)) npc.crossing = true;
        else if (atKerb) { npc.mode = "wait"; target = kerb; }
        else target = kerb;
      }
      if (npc.mode === "wait" && (npc.crossing || npc.leg.kind !== "cross")) npc.mode = "walk";
      // Reached the end of this stretch: choose the next.
      if (!npc.park && Math.hypot(target[0] - npc.pos.x, target[1] - npc.pos.z) < (taken(target) ? 1.6 : 0.45) && (npc.leg.kind === "ring" || npc.crossing)) {
        // At a corner of the park's sidewalk: often, down the path to its bench (if a seat is free).
        if (npc.leg.kind === "ring" && npc.leg.i === 0 && npc.leg.j === 0 && npc.random() < 0.45) {
          const route = parkVisit(npc.leg.to);
          const seat = route.seats.find((q) => !state.seatOccupants.has(q.id));
          if (seat) {
            npc.park = { corner: npc.leg.to, seat: seat.id, stage: "in", points: [route.entry, route.beside, route.front(seat)], until: now + 15 + npc.random() * 75, bench: null };
            continue;
          }
        }
        if (npc.leg.kind === "ring") npc.leg = nextLeg(npc.leg.i, npc.leg.j, npc.leg.to, npc.leg.from, npc.random);
        else {
          const [i, j] = npc.leg.toBlock, from = npc.leg.toCorner;
          npc.leg = { kind: "ring", i, j, from, to: (from + (npc.random() < 0.5 ? 1 : 3)) % 4 };
        }
        npc.crossing = false;
        target = mine(npc.leg.kind === "cross" ? npc.leg.from : legEnd(npc.leg));
      }

      // Things in the way: fixed props nearby, the bike, other people (players and NPCs) and vehicles.
      const near: Obstacle[] = [];
      const x = npc.pos.x, z = npc.pos.z;
      for (const o of fixed) if (Math.abs(o.x - x) < 3 && Math.abs(o.z - z) < 3) near.push(o);
      // Bikes (ours, standing or ridden, and everyone else's) and vehicles: kept clear along their whole length.
      if (Math.abs(bike.pos.x - x) < 5 && Math.abs(bike.pos.z - z) < 5) near.push(...boxObstacles(bikeBox));
      for (const ob of [...state.otherBikes, ...state.parkedBikes]) if (Math.abs(ob.box.x - x) < 5 && Math.abs(ob.box.z - z) < 5) near.push(...boxObstacles(ob.box));
      const people = [...(playerOnFoot ? [{ x: p.x, z: p.z, r: 0.35 }] : []), ...state.others];
      for (const o of people) near.push({ x: o.x, z: o.z, r: o.r });
      for (const other of npcs) if (other !== npc && other.active && !other.accident && Math.abs(other.pos.x - x) < 3 && Math.abs(other.pos.z - z) < 3) near.push({ x: other.pos.x, z: other.pos.z, r: NPC_RADIUS });
      for (const v of state.vehicles) if (Math.abs(v.box.x - x) < 10 && Math.abs(v.box.z - z) < 10) near.push(...boxObstacles(v.box));

      const walking = npc.mode === "walk";
      const pace = walking ? (npc.crossing && npc.leg.kind === "cross" && npc.leg.avenue ? CROSS_SPEED : WALK_SPEED) : 0;
      npc.speed += (pace - npc.speed) * (1 - Math.exp(-5 * dt));
      if (npc.speed > 0.02) {
        // A vehicle or bike standing in the way, however long: head for its nearer end and round it.
        const boxes = [bikeBox, ...state.otherBikes.map((o) => o.box), ...state.parkedBikes.map((o) => o.box), ...state.vehicles.map((v) => v.box)]
          .filter((bx) => Math.abs(bx.x - x) < 20 && Math.abs(bx.z - z) < 20);
        npc.around = detour(x, z, target, boxes, npc.around);
        const [dx, dz, side] = steer(x, z, npc.around ?? target, near, npc.side);
        npc.side = side;
        npc.pos.x += dx * npc.speed * dt; npc.pos.z += dz * npc.speed * dt;
        npc.yaw = turn(npc.yaw, Math.atan2(dx, dz), 10 * dt);
      } else if (npc.mode === "wait" && npc.leg.kind === "cross") {
        // Waiting at the kerb, facing across.
        npc.yaw = turn(npc.yaw, Math.atan2(npc.leg.to[0] - x, npc.leg.to[1] - z), 4 * dt);
      }

      // The same solid bodies as players: props, vehicles and bikes push them out; leaning into one moves it slowly.
      for (const o of near) {
        if (o.r > 0.9 || people.some((q) => q.x === o.x && q.z === o.z)) continue;
        const ddx = npc.pos.x - o.x, ddz = npc.pos.z - o.z, d = Math.hypot(ddx, ddz), min = NPC_RADIUS + o.r;
        if (d < min && d > 1e-5) { npc.pos.x = o.x + ddx / d * min; npc.pos.z = o.z + ddz / d * min; }
      }
      for (const v of state.vehicles) { const [vx, vz] = circleBoxPush(npc.pos.x, npc.pos.z, NPC_RADIUS, v.box); npc.pos.x += vx; npc.pos.z += vz; }
      for (const box of [bikeBox, ...state.otherBikes.map((o) => o.box), ...state.parkedBikes.map((o) => o.box)]) { const [bx, bz] = circleBoxPush(npc.pos.x, npc.pos.z, NPC_RADIUS, box); npc.pos.x += bx; npc.pos.z += bz; }
      for (const q of people) {
        // Players are solid to them (each keeps out of NPCs); someone leaned into gives way slowly.
        const ddx = npc.pos.x - q.x, ddz = npc.pos.z - q.z, d = Math.hypot(ddx, ddz), min = NPC_RADIUS + q.r + 0.01;
        if (d < min && d > 1e-5) { const step = Math.min(min - d, SHOVE * dt); npc.pos.x += ddx / d * step; npc.pos.z += ddz / d * step; }
      }
      npc.pos.y = floorHeight(npc.pos.x, npc.pos.z);
      npc.phase += dt * npc.speed * 4.2;
      b.x = npc.pos.x; b.z = npc.pos.z; b.moving = npc.speed > 0.2;
    }
    // Hosting a room: tell everyone where the NPCs are, ten times a second.
    publishTimer.current -= dt;
    if (link && publishTimer.current <= 0) {
      publishTimer.current = 0.1;
      link.publish({ list: npcs.map((n) => {
        const a = n.accident, r = (v: number) => Math.round(v * 100) / 100;
        return [n.body.id, r(n.pos.x), r(n.pos.z), r(n.yaw), r(n.speed), n.mode === "walk" ? 0 : n.mode === "stand" ? 1 : 2, a ? r(now - a.startedAt) : -1, a ? r(a.direction[0]) : 0, a ? r(a.direction[1]) : 0, a ? a.seed : 0, n.active ? 1 : 0, r(n.seated), n.park?.stage === "bench" ? n.park.seat : -1];
      }) });
    }
  });

  /** As a guest in a room: show the host's NPCs (smoothly), knock them down when the host does, report our hits. */
  function followHost(link: NpcLink, now: number, dt: number) {
    const snapshot = link.latest();
    if (snapshot && snapshot !== lastSnapshot.current?.snapshot) lastSnapshot.current = { snapshot, at: now };
    const seen = lastSnapshot.current;
    for (const npc of npcs) {
      const b = npc.body;
      if (b.hit) {
        // Our traffic hit them: the host decides (and we see it in the next snapshot).
        if (now - npc.hitSentAt > 1.5) { link.sendHit(b.id, b.hit.direction); npc.hitSentAt = now; }
        b.hit = null;
      }
      const row = seen?.snapshot.list.find((r) => r[0] === b.id);
      // Kept aside by the host: kept aside here too.
      if (row && row[10] === 0) { if (npc.active) putAway(npc, state.seatOccupants); continue; }
      if (row && !npc.active) { npc.active = true; npc.body.down = false; npc.pos.set(row[1] ?? 0, 0, row[2] ?? 0); }
      if (!npc.active) continue;
      if (row) {
        const [, x = 0, z = 0, yaw = 0, speed = 0, mode = 0, downFor = -1, dx = 0, dz = 0, seed = 0] = row;
        if (downFor >= 0 && !npc.accident && seed !== npc.shownHit) {
          npc.shownHit = seed;
          npc.pos.set(x, floorHeight(x, z), z); npc.yaw = yaw;
          npc.accident = { phase: "down", startedAt: now - downFor - (now - seen!.at), riseStartedAt: null, vehicleId: null, direction: [dx, dz], launchSpeed: THROW_DISTANCE * 1.75, seed };
        }
        if (!npc.accident) {
          // Where the host has them now, allowing for the snapshot's age.
          const age = Math.min(0.5, now - seen!.at);
          const tx = x + Math.sin(yaw) * speed * age, tz = z + Math.cos(yaw) * speed * age;
          const far = Math.hypot(tx - npc.pos.x, tz - npc.pos.z) > 6;
          const k = far ? 1 : 1 - Math.exp(-8 * dt);
          npc.pos.x += (tx - npc.pos.x) * k; npc.pos.z += (tz - npc.pos.z) * k;
          npc.pos.y = floorHeight(npc.pos.x, npc.pos.z);
          npc.yaw = far ? yaw : turn(npc.yaw, yaw, 10 * dt);
          npc.speed = speed; npc.mode = mode === 0 ? "walk" : mode === 1 ? "stand" : "wait";
          // Sitting on a bench (the seat is kept from this player too).
          // Eased, so sitting down and getting up stay smooth between the host's updates.
          npc.seated += ((row[11] ?? 0) - npc.seated) * (1 - Math.exp(-14 * dt));
          const seat = row[12] ?? -1, mine = `npc:${b.id}`;
          for (const [id, who] of state.seatOccupants) if (who === mine && id !== seat) state.seatOccupants.delete(id);
          if (seat >= 0 && !state.seatOccupants.has(seat)) state.seatOccupants.set(seat, mine);
          npc.phase += dt * speed * 4.2;
        }
      }
      b.x = npc.pos.x; b.z = npc.pos.z; b.down = npc.accident !== null; b.moving = !npc.accident && npc.speed > 0.2;
    }
  }

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
    root.visible = npc.active && !npc.accident;
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
    if (npc.seated > 0) {
      // On a bench: exactly the player's sitting pose.
      const j = benchJoints(npc.seated);
      rig.thighL.current?.rotation.set(j.hip, 0, 0.13);
      rig.thighR.current?.rotation.set(j.hip, 0, -0.13);
      rig.shinL.current?.rotation.set(j.knee, 0, 0); rig.shinR.current?.rotation.set(j.knee, 0, 0);
      rig.armL.current?.rotation.set(j.shoulder, 0, 0.12 * (1 - j.hands) - 0.1 * j.hands);
      rig.armR.current?.rotation.set(j.shoulder, 0, -0.12 * (1 - j.hands) + 0.1 * j.hands);
      rig.foreL.current?.rotation.set(j.elbow, 0, 0); rig.foreR.current?.rotation.set(j.elbow, 0, 0);
      if (rig.hips.current) rig.hips.current.position.y = 0.95 + j.riderOffset;
      rig.torso.current?.rotation.set(j.lean, 0, 0);
      rig.head.current?.rotation.set(-j.lean * 0.5, 0, 0);
    } else rig.head.current?.rotation.set(0, 0, 0);
  });
  return <>
    <CharacterBody rig={rig} color={npc.color} />
    <RagdollBody subject={subject} color={npc.color} />
  </>;
});
