import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { useRapier } from "@react-three/rapier";
import * as THREE from "three";
import { HALF, PITCH, WORLD_HALF, rng, VEHICLE_SIZE, VEHICLE_MASS, VEHICLE_COLLISION_GROUPS, vehicleContactHurts, vehicleFootprint, THROW_DISTANCE, ACCIDENT_STOP_SECONDS, CRASH_STOP_SECONDS, TRAFFIC_SPEED, TRAFFIC_CORNER_SPEED, brakingGap, scooterBypassReady, wildernessCenter, roadForward, roadLeft, forwardDistance, roadLane, trafficSpawnClear, isTrafficRoad, type VehicleKind } from "./config";
import { intersectionAhead, makeTrafficTurn, turnSample, mayTurnAt, type TrafficTurn } from "./trafficRoutes";

import { makeText, makeGlow } from "./textures";
import { knockDown, type GameState } from "./state";
import { holdAccidentQueue, trafficTargetSpeed, type TrafficAgent } from "./trafficLogic";

type Kind = VehicleKind;
type Vehicle = TrafficAgent & {
  kind: Kind;
  color: string;
  cargo: string;
  axis: "x" | "z";
  dir: 1 | -1;
  lane: number; // fixed coordinate on the other axis
  t: number; // position along the axis
  speed: number;
  central: boolean;
  slot: number;
  nextIntersection: number;
  turn: TrafficTurn | null;
};

const PALETTE = ["#b3261e", "#1d4e89", "#f2f2f2", "#222426", "#7a7f85", "#2e6b3f", "#8a5a2b", "#5b2c6f", "#c96a1b", "#3c8dbc", "#9fa8b0"];

function useMats() {
  return useMemo(() => {
    const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3, ...extra });
    return {
      glass: std("#1b2530", { roughness: 0.1, metalness: 0.8 }),
      tire: std("#111", { roughness: 0.9, metalness: 0 }),
      rim: std("#9aa0a6", { metalness: 0.9, roughness: 0.3 }),
      chrome: std("#c7ccd1", { metalness: 1, roughness: 0.2 }),
      head: new THREE.MeshStandardMaterial({ color: "#fffbe8", emissive: "#fff2c8", emissiveIntensity: 0.2 }),
      tail: new THREE.MeshStandardMaterial({ color: "#7a0d0d", emissive: "#ff2a1a", emissiveIntensity: 0.4 }),
      busRed: std("#c8102e", { metalness: 0.2 }),
      busBlue: std("#1f3f9a", { metalness: 0.2 }),
      taxiYellow: std("#f6c216", { metalness: 0.2 }),
      sign: new THREE.MeshStandardMaterial({ map: makeText("METRO BUS", "#1f3f9a", "#ffffff", 1024, 128), roughness: 0.6 }),
      taxiSign: new THREE.MeshStandardMaterial({
        map: makeText("TAXI", "#fff6c9", "#111111", 256, 96),
        emissive: "#fff3b0",
        emissiveIntensity: 0.1,
      }),
      bodies: new Map<string, THREE.MeshStandardMaterial>(),
      body(c: string) {
        let m = this.bodies.get(c);
        if (!m) {
          m = std(c);
          this.bodies.set(c, m);
        }
        return m;
      },
    };
  }, []);
}
type Mats = ReturnType<typeof useMats>;

function Wheel({ x, z, r, mats }: { x: number; z: number; r: number; mats: Mats }) {
  return (
    <group position={[x, r, z]} rotation-x={Math.PI / 2}>
      <mesh material={mats.tire} castShadow>
        <cylinderGeometry args={[r, r, 0.3, 14]} />
      </mesh>
      <mesh material={mats.rim} position={[0, z > 0 ? 0.16 : -0.16, 0]}>
        <cylinderGeometry args={[r * 0.55, r * 0.55, 0.02, 10]} />
      </mesh>
    </group>
  );
}

function Lights({ front, back, y, z, mats }: { front: number; back: number; y: number; z: number; mats: Mats }) {
  return (
    <>
      {[z, -z].map((zz, i) => (
        <group key={i}>
          <mesh material={mats.head} position={[front, y, zz]}>
            <boxGeometry args={[0.06, 0.18, 0.35]} />
          </mesh>
          <mesh material={mats.tail} userData={{ brakeLight: true }} position={[back, y, zz]}>
            <boxGeometry args={[0.06, 0.18, 0.3]} />
          </mesh>
        </group>
      ))}

    </>
  );
}

function Car({ color, taxi, mats }: { color: string; taxi?: boolean; mats: Mats }) {
  const body = taxi ? mats.taxiYellow : mats.body(color);
  return (
    <group>
      <mesh material={body} position={[0, 0.68, 0]} castShadow>
        <boxGeometry args={[4.3, 0.7, 1.85]} />
      </mesh>
      <mesh material={body} position={[1.55, 0.98, 0]} castShadow>
        <boxGeometry args={[1.2, 0.12, 1.8]} />
      </mesh>
      <mesh material={mats.glass} position={[-0.25, 1.32, 0]} castShadow>
        <boxGeometry args={[2.2, 0.6, 1.66]} />
      </mesh>
      <mesh material={body} position={[-0.25, 1.65, 0]}>
        <boxGeometry args={[2.0, 0.08, 1.6]} />
      </mesh>
      <mesh material={mats.chrome} position={[2.17, 0.45, 0]}>
        <boxGeometry args={[0.08, 0.14, 1.8]} />
      </mesh>
      <mesh material={mats.chrome} position={[-2.17, 0.45, 0]}>
        <boxGeometry args={[0.08, 0.14, 1.8]} />
      </mesh>
      {taxi && (
        <>
          <mesh material={mats.taxiSign} position={[-0.25, 1.86, 0]}>
            <boxGeometry args={[0.32, 0.3, 0.9]} />
          </mesh>
          {/* checker stripe */}
          {[0.94, -0.94].map((z) => (
            <mesh key={z} position={[0, 0.7, z]}>
              <boxGeometry args={[3.6, 0.1, 0.02]} />
              <meshStandardMaterial color="#111" />
            </mesh>
          ))}
        </>
      )}
      <Lights front={2.16} back={-2.16} y={0.78} z={0.65} mats={mats} />
      {[1.35, -1.35].flatMap((x) => [0.88, -0.88].map((z) => <Wheel key={`${x}${z}`} x={x} z={z} r={0.36} mats={mats} />))}
    </group>
  );
}

function SignFace({ z, rot, mats }: { z: number; rot: number; mats: Mats }) {
  return (
    <mesh material={mats.sign} position={[0.2, 1.55, z]} rotation-y={rot}>
      <planeGeometry args={[6.4, 0.8]} />
    </mesh>
  );
}

function Bus({ mats }: { mats: Mats }) {
  return (
    <group>
      <mesh material={mats.busRed} position={[0, 1.85, 0]} castShadow>
        <boxGeometry args={[11, 2.9, 2.5]} />
      </mesh>
      <mesh material={mats.busBlue} position={[0, 0.65, 0]}>
        <boxGeometry args={[11.04, 0.4, 2.54]} />
      </mesh>
      <mesh material={mats.glass} position={[0, 2.55, 0]}>
        <boxGeometry args={[10.4, 0.95, 2.53]} />
      </mesh>
      <mesh material={mats.glass} position={[5.45, 2.0, 0]}>
        <boxGeometry args={[0.12, 1.9, 2.2]} />
      </mesh>
      <mesh material={mats.busBlue} position={[0, 3.33, 0]}>
        <boxGeometry args={[11.04, 0.12, 2.54]} />
      </mesh>
      <mesh material={mats.busBlue} position={[5.52, 3.05, 0]}>
        <boxGeometry args={[0.06, 0.3, 1.6]} />
      </mesh>
      <SignFace z={1.27} rot={0} mats={mats} />
      <SignFace z={-1.27} rot={Math.PI} mats={mats} />
      <Lights front={5.52} back={-5.52} y={0.95} z={0.95} mats={mats} />
      {[3.6, -3.4].flatMap((x) => [1.1, -1.1].map((z) => <Wheel key={`${x}${z}`} x={x} z={z} r={0.5} mats={mats} />))}
    </group>
  );
}

function Truck({ color, cargo, mats }: { color: string; cargo: string; mats: Mats }) {
  const cab = mats.body(color);
  return (
    <group>
      <mesh material={cab} position={[3.3, 1.5, 0]} castShadow>
        <boxGeometry args={[2.0, 2.2, 2.3]} />
      </mesh>
      <mesh material={mats.glass} position={[4.31, 1.95, 0]}>
        <boxGeometry args={[0.04, 0.9, 2.0]} />
      </mesh>
      <mesh material={mats.body(cargo)} position={[-1.0, 2.0, 0]} castShadow>
        <boxGeometry args={[6.2, 2.9, 2.45]} />
      </mesh>
      <mesh material={mats.tire} position={[0.3, 0.55, 0]}>
        <boxGeometry args={[8.4, 0.3, 1.6]} />
      </mesh>
      <mesh material={mats.chrome} position={[4.35, 0.75, 0]}>
        <boxGeometry args={[0.1, 0.4, 2.2]} />
      </mesh>
      <Lights front={4.33} back={-4.12} y={0.95} z={0.9} mats={mats} />
      {[3.4, -2.2, -3.4].flatMap((x) => [1.0, -1.0].map((z) => <Wheel key={`${x}${z}`} x={x} z={z} r={0.48} mats={mats} />))}
    </group>
  );
}

export function Traffic({ state }: { state: GameState }) {
  const { world, rapier } = useRapier();
  const mats = useMats();
  const vehicles = useMemo<Vehicle[]>(() => {
    const r = rng(state.worldSeed + 42);
    const list: Vehicle[] = [];
    for (let i = 0; i < 64; i++) {
      const roll = r();
      const kind: Kind = roll < 0.5 ? "car" : roll < 0.72 ? "taxi" : roll < 0.84 ? "bus" : "truck";
      const outside = Math.max(Math.abs(state.pos.x), Math.abs(state.pos.z)) > WORLD_HALF;
      const axis = outside ? (Math.abs(state.pos.x) > Math.abs(state.pos.z) ? "x" : "z") : i % 2 === 0 ? "x" : "z";
      const cross = axis === "x" ? state.pos.z : state.pos.x;
      const k = Math.max(-HALF - 1, Math.min(HALF, Math.round((cross - PITCH / 2) / PITCH) + Math.floor(r() * 7) - 3));
      const central = i < 32 || outside || k === 0;
      const s = central ? PITCH / 2 : k * PITCH + PITCH / 2;
      const dir = Math.floor(i / 2) % 2 === 0 ? 1 : -1;
      const slot = central ? Math.floor(i / 4) % 2 : 0;
      // right-hand traffic
      const lane = roadLane(axis, dir, s, slot);
      let t = (axis === "x" ? state.pos.x : state.pos.z) + (r() * 2 - 1) * 260;
      let x = 0, z = 0;
      for (let attempt = 0; attempt < 160; attempt++) {
        if (attempt) t = (axis === "x" ? state.pos.x : state.pos.z) + (r() * 2 - 1) * 320;
        if (!central) t = Math.max(-WORLD_HALF + 14, Math.min(WORLD_HALF - 14, t));
        const crossLane = central && Math.abs(t) > WORLD_HALF ? wildernessCenter(axis, t, state.worldSeed) + lane - PITCH / 2 : lane;
        x = axis === "x" ? t : crossLane; z = axis === "z" ? t : crossLane;
        if (isTrafficRoad(x, z, state.worldSeed) && trafficSpawnClear(x, z, VEHICLE_SIZE[kind][0], list)) break;
      }
      if (!isTrafficRoad(x, z, state.worldSeed) || !trafficSpawnClear(x, z, VEHICLE_SIZE[kind][0], list)) continue;
      const base = TRAFFIC_SPEED;
      list.push({
        id: list.length, x, z, vx: 0, vz: 0, heldBy: null, crashUntil: 0, brake: false,
        kind,
        central,
        color: PALETTE[Math.floor(r() * PALETTE.length)] ?? PALETTE[0] ?? "#b3261e",
        cargo: r() < 0.5 ? "#eeeeee" : (PALETTE[Math.floor(r() * PALETTE.length)] ?? "#eeeeee"),
        axis,
        dir,
        lane,
        slot, nextIntersection: intersectionAhead({ axis, dir, lane }, t), turn: null,
        t,
        speed: base,
      });
    }
    return list;
  }, [state]);
  const refs = useRef<(THREE.Group | null)[]>([]);
  const beams = useRef<(THREE.SpotLight | null)[]>([]);
  const beamMat = useMemo(() => new THREE.MeshBasicMaterial({ map: makeGlow(), color: "#fff0cd", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }), []);
  const beamTargets = useMemo(() => Array.from({ length: 6 }, () => new THREE.Object3D()), []);
  const beamTimer = useRef(0);
  const beamIndices = useRef<number[]>([]);
  const contacts = useRef(new Set<number>());
  const bodies = useRef<ReturnType<typeof world.createRigidBody>[]>([]);
  const colliders = useRef<ReturnType<typeof world.createCollider>[]>([]);
  const brakeMats = useRef<THREE.MeshStandardMaterial[]>([]);
  const crashContacts = useRef(new Set<string>());
  const nextContacts = useRef(new Set<string>());
  const colliderIndices = useRef(new Map<number, number>());
  const steeringScratch = useMemo(() => ({ euler: new THREE.Euler(), quaternion: new THREE.Quaternion() }), []);
  const bikeWait = useRef(new Map<number, number>());
  const boxes = useMemo(() => ({ player: new THREE.Box3(), vehicle: new THREE.Box3() }), []);

  useEffect(() => {
    vehicles.forEach((v, i) => {
      const [fx, fz] = roadForward(v); v.vx = fx * v.speed; v.vz = fz * v.speed;
      const yaw = v.axis === "x" ? (v.dir === 1 ? 0 : Math.PI) : v.dir === 1 ? -Math.PI / 2 : Math.PI / 2;
      const body = world.createRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(v.x, VEHICLE_SIZE[v.kind][1] / 2, v.z).setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)).setCcdEnabled(true));
      body.userData = "vehicle";
      body.setEnabledTranslations(true, false, true, false); body.setEnabledRotations(false, true, false, false);
      const [length, height, width] = VEHICLE_SIZE[v.kind];
      const collider = world.createCollider(rapier.ColliderDesc.cuboid(length / 2, height / 2 - 0.12, width / 2).setMass(VEHICLE_MASS[v.kind]).setRestitution(0.12).setFriction(0.7).setCollisionGroups(VEHICLE_COLLISION_GROUPS), body);
      body.setLinvel({ x: v.vx, y: 0, z: v.vz }, true);
      bodies.current.push(body); colliders.current.push(collider);
      colliderIndices.current.set(collider.handle, i);
      const tail = mats.tail.clone(); brakeMats.current.push(tail);
      refs.current[i]?.traverse((object) => { if (object instanceof THREE.Mesh && object.userData['brakeLight']) object.material = tail; });
    });
    return () => {
      bodies.current.forEach((body) => { try { if (body.isValid()) world.removeRigidBody(body); } catch { /* Physics owner may already have disposed its world. */ } });
      brakeMats.current.forEach((mat) => mat.dispose());
      bodies.current = []; colliders.current = []; brakeMats.current = [];
      colliderIndices.current.clear();
    };
  }, [world, rapier, vehicles, mats]);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    state.simulationTime += raw;
    const now = state.simulationTime;
    const d = state.darkness;
    mats.head.emissiveIntensity = 1.2 + d * 2;
    beamMat.opacity = d * 0.5;
    mats.tail.emissiveIntensity = 0.4 + d * 2;
    mats.taxiSign.emissiveIntensity = 0.1 + d * 1.2;
    const span = 700;
    const p = state.pos;
    boxes.player.min.set(p.x - 0.35, p.y, p.z - 0.35);
    boxes.player.max.set(p.x + 0.35, p.y + 1.95, p.z + 0.35);
    // A bike shoving a car moves it slowly; Traffic only ever receives pushes for cars and taxis.
    for (const [i, [px, pz]] of state.vehiclePushes) {
      const body = bodies.current[i];
      if (!body) continue;
      const at = body.translation();
      body.setTranslation({ x: at.x + px * dt, y: at.y, z: at.z + pz * dt }, true);
    }
    state.vehiclePushes.clear();
    const solids = state.vehicles;
    solids.length = 0;
    vehicles.forEach((v, i) => {
      const body = bodies.current[i];
      if (!body) return;
      const position = body.translation(); const velocity = body.linvel();
      v.x = position.x; v.z = position.z; v.vx = velocity.x; v.vz = velocity.z;
      const q = body.rotation();
      const yaw = steeringScratch.euler.setFromQuaternion(steeringScratch.quaternion.set(q.x, q.y, q.z, q.w), "YXZ").y;
      solids.push({ index: i, kind: v.kind, box: vehicleFootprint(v.x, v.z, yaw, v.kind), speed: Math.hypot(v.vx, v.vz) });
    });
    const nextCrashContacts = nextContacts.current;
    nextCrashContacts.clear();
    colliders.current.forEach((collider, i) => {
      world.contactPairsWith(collider, (other) => {
        const j = colliderIndices.current.get(other.handle);
        if (j === undefined || j <= i) return;
        const key = `${i}:${j}`; nextCrashContacts.add(key);
        if (crashContacts.current.has(key)) return;
        const a = vehicles[i]; const b = vehicles[j];
        if (!a || !b) return;
        // Rapier resolves the momentum with collider masses; do not overwrite it.
        a.crashUntil = now + CRASH_STOP_SECONDS; b.crashUntil = now + CRASH_STOP_SECONDS;
      });
    });
    nextContacts.current = crashContacts.current;
    crashContacts.current = nextCrashContacts;
    beamTimer.current -= dt;
    if (beamTimer.current <= 0) {
      beamTimer.current = 0.5;
      beamIndices.current = vehicles.map((v, i) => ({ i, d: Math.hypot(v.x - p.x, v.z - p.z) })).sort((a, b) => a.d - b.d).slice(0, 6).map((v) => v.i);
    }
    beamIndices.current.forEach((index, slot) => {
      const v = vehicles[index], body = bodies.current[index], light = beams.current[slot], target = beamTargets[slot];
      if (!v || !body || !light || !target) return;
      const q = body.rotation(); const yaw = steeringScratch.euler.setFromQuaternion(steeringScratch.quaternion.set(q.x, q.y, q.z, q.w), "YXZ").y;
      const dx = Math.cos(yaw), dz = -Math.sin(yaw), reach = VEHICLE_SIZE[v.kind][0] / 2 + 0.1;
      light.position.set(v.x + dx * reach, v.kind === "car" || v.kind === "taxi" ? 0.78 : 0.95, v.z + dz * reach);
      target.position.set(v.x + dx * (reach + 12), 0, v.z + dz * (reach + 12)); target.updateMatrixWorld();
      light.intensity = 100;
    });
    vehicles.forEach((v, i) => {
      const body = bodies.current[i];
      if (!body) return;
      let previous = v.t;
      v.t = v.axis === "x" ? v.x : v.z;
      const activeIncident = state.incidents.some((incident) => incident.vehicleId === v.id && incident.stoodUpAt === null);
      // Local traffic pool recycles outside visibility, not at a world boundary.
      if (Math.hypot(v.x - p.x, v.z - p.z) > 340 && v.crashUntil < now && !activeIncident) {
        const outside = Math.max(Math.abs(p.x), Math.abs(p.z)) > WORLD_HALF;
        if (outside) {
          v.axis = Math.abs(p.x) > Math.abs(p.z) ? "x" : "z"; v.central = true;
        }
        const cross = v.axis === "x" ? p.z : p.x;
        const k = Math.max(-HALF - 1, Math.min(HALF, Math.round((cross - PITCH / 2) / PITCH) + (i % 5) - 2));
        const center = v.central ? PITCH / 2 : k * PITCH + PITCH / 2;
        const laneBase = roadLane(v.axis, v.dir, center, v.slot);
        const random = rng(state.worldSeed ^ i * 71 ^ Math.floor(now));
        for (let attempt = 0; attempt < 100; attempt++) {
          let t = (v.axis === "x" ? p.x : p.z) - v.dir * (250 + random() * 70);
          if (!v.central) t = Math.max(-WORLD_HALF + 14, Math.min(WORLD_HALF - 14, t));
          const lane = v.central && Math.abs(t) > WORLD_HALF ? wildernessCenter(v.axis, t, state.worldSeed) + laneBase - PITCH / 2 : laneBase;
          const x = v.axis === "x" ? t : lane, z = v.axis === "z" ? t : lane;
          if (!isTrafficRoad(x, z, state.worldSeed) || !trafficSpawnClear(x, z, VEHICLE_SIZE[v.kind][0], vehicles.filter((other) => other !== v))) continue;
          v.t = t; v.x = x; v.z = z; v.lane = laneBase; v.turn = null; v.nextIntersection = intersectionAhead(v, t);
          const angle = v.axis === "x" ? (v.dir === 1 ? 0 : Math.PI) : v.dir === 1 ? -Math.PI / 2 : Math.PI / 2;
          body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle), true);
          body.setTranslation({ x, y: VEHICLE_SIZE[v.kind][1] / 2, z }, true); break;
        }
      }
      if (!v.turn && !activeIncident && now > v.crashUntil) {
        const distance = (v.nextIntersection - v.t) * v.dir;
        if (distance < 18 && distance > -2 && mayTurnAt(v.nextIntersection, v.lane)) {
          const random = rng(state.worldSeed ^ v.id * 827 ^ Math.round(v.nextIntersection) ^ (v.axis === "x" ? 33 : 71));
          const edge = Math.abs(v.nextIntersection) >= WORLD_HALF - 1;
          if ((!v.central && edge) || random() < 0.34) {
            const nextDir: 1 | -1 = edge ? (v.lane > PITCH / 2 ? -1 : 1) : random() < 0.5 ? 1 : -1;
            v.turn = makeTrafficTurn(v, v.nextIntersection, nextDir, v.slot);
          } else v.nextIntersection += v.dir * PITCH;
        } else if (distance <= -2) v.nextIntersection = intersectionAhead(v, v.t);
      }
      const g = refs.current[i];
      if (!g) return;
      g.position.set(v.x, 0, v.z);
      const yaw = v.axis === "x" ? (v.dir === 1 ? 0 : Math.PI) : v.dir === 1 ? -Math.PI / 2 : Math.PI / 2;
      const child = g.children[0]; if (child) child.quaternion.copy(body.rotation());
      const [length, height, width] = VEHICLE_SIZE[v.kind];
      // Sweep the moving box across this frame; never sweep across a world wrap.
      const start = Math.abs(v.t - previous) > span / 2 ? v.t : previous;
      const lo = Math.min(start, v.t) - length / 2;
      const hi = Math.max(start, v.t) + length / 2;
      if (v.axis === "x") {
        boxes.vehicle.min.set(lo, 0, v.z - width / 2);
        boxes.vehicle.max.set(hi, height, v.z + width / 2);
      } else {
        boxes.vehicle.min.set(v.x - width / 2, 0, lo);
        boxes.vehicle.max.set(v.x + width / 2, height, hi);
      }
      const ridingContact = state.scooter.riding && Math.hypot(v.x - state.scooter.pos.x, v.z - state.scooter.pos.z) < length / 2 + 0.85;
      // Only a vehicle going faster than 10 mph causes an accident; slower contact just pushes (Player/Scooter).
      if (!state.accident && vehicleContactHurts(Math.hypot(v.vx, v.vz)) && (boxes.player.intersectsBox(boxes.vehicle) || ridingContact && Math.abs((v.axis === "x" ? state.scooter.pos.z - v.z : state.scooter.pos.x - v.x)) < width / 2 + 0.3)) {
        if (!contacts.current.has(i)) {
          const direction = roadForward(v);
          const success = knockDown(state, i, v, [v.x, v.z], direction, THROW_DISTANCE * 1.75, Math.floor(Math.random() * 1e8));
          if (success) {
            // Move the contact to the bumper so the falling body cannot start inside the vehicle.
            const reach = length / 2 + 0.65;
            state.pos.x = v.x + direction[0] * reach; state.pos.z = v.z + direction[1] * reach;
            body.setLinvel({ x: 0, y: 0, z: 0 }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            v.vx = 0; v.vz = 0;
            const incident = state.incidents[state.incidents.length - 1];
            if (incident) holdAccidentQueue(vehicles, v, incident);
          }
        }
        contacts.current.add(i);
      } else contacts.current.delete(i);

      const bike = state.scooter;
      const bikePosition: [number, number] = [bike.pos.x, bike.pos.z];
      const bikeAhead = forwardDistance(v, [v.x, v.z], bikePosition);
      const bikeCross = v.axis === "x" ? bike.pos.z : bike.pos.x;
      const vehicleCross = v.axis === "x" ? v.z : v.x;
      const bikeInLane = Math.abs(bikeCross - vehicleCross) < width / 2 + 0.65;
      const bikeObstacle = !bike.riding && (bikeInLane || bikeWait.current.has(i)) && bikeAhead > -length / 2 - 2 && bikeAhead < brakingGap(Math.hypot(v.vx, v.vz)) + 30;
      if (bikeObstacle && !bikeWait.current.has(i)) bikeWait.current.set(i, now);
      if (bike.riding || (!bikeObstacle && (!bike.fallen || bikeAhead < -length / 2 - 2))) bikeWait.current.delete(i);
      const bikeOccupied = bike.riding || bike.action !== null || (bike.fallen && (state.accident !== null || Math.hypot(state.pos.x - bike.pos.x, state.pos.z - bike.pos.z) < 2.5));
      let targetSpeed = trafficTargetSpeed(v, vehicles, state.incidents, now);
      let targetLane = v.central && Math.abs(v.t) > WORLD_HALF
        ? wildernessCenter(v.axis, v.t + v.dir * 10, state.worldSeed) + v.lane - PITCH / 2
        : v.lane;
      const wait = bikeWait.current.get(i);
      if (bikeObstacle && wait !== undefined) {
        if (bikeOccupied || (bike.fallen && !scooterBypassReady(wait, now)) || Math.hypot(state.pos.x - bike.pos.x, state.pos.z - bike.pos.z) < 1.6 && state.accident) targetSpeed = 0;
        else {
          const [lx, lz] = roadLeft(v);
          targetLane = bikeCross + (v.axis === "x" ? lz : lx) * (width / 2 + 1.25);
          targetSpeed = Math.min(targetSpeed, 3.5);
          // Too close to swerve forward around it: wait instead of pivoting in place.
          if (Math.abs(vehicleCross - bikeCross) < width / 2 + 0.9 && bikeAhead > 0 && bikeAhead < length / 2 + 2) targetSpeed = 0;
          const [fx, fz] = roadForward(v);
          const blockedPass = vehicles.some((other) => other.id !== i && Math.abs(forwardDistance(v, [v.x, v.z], [other.x, other.z])) < length + 4 && Math.abs((v.axis === "x" ? other.z : other.x) - targetLane) < width / 2 + VEHICLE_SIZE[other.kind][2] / 2 + 0.5);
          if (blockedPass) { targetSpeed = 0; targetLane = vehicleCross; }
        }
      }
      // A ridden/occupied bike is part of traffic: follow it like a leader, never bypass it.
      const riderInLane = Math.abs((v.axis === "x" ? state.pos.z : state.pos.x) - vehicleCross) < width / 2 + 0.9;
      if (bikeOccupied && (bikeInLane || riderInLane) && bikeAhead > -length / 2) {
        const [rfx, rfz] = roadForward(v);
        const bikeSpeed = bike.riding ? Math.max(0, Math.sin(bike.yaw) * rfx * bike.speed + Math.cos(bike.yaw) * rfz * bike.speed) : 0;
        const gap = bikeAhead - length / 2 - 1;
        if (gap < brakingGap(Math.hypot(v.vx, v.vz)) + 4) targetSpeed = Math.min(targetSpeed, gap < 2.5 ? 0 : bikeSpeed + Math.max(0, gap - 2.5) * 0.5);
      }
      const incident = state.incidents.find((item) => item.vehicleId === i && !item.passed && !item.scooterCrash);
      if (incident) {
        if (now - incident.startedAt < (incident.scooterCrash ? 15 : ACCIDENT_STOP_SECONDS)) targetSpeed = 0;
        else {
          const bodyAhead = forwardDistance(v, [v.x, v.z], [state.pos.x, state.pos.z]);
          const [lx, lz] = roadLeft(v);
          const crossBody = v.axis === "x" ? state.pos.z : state.pos.x;
          const side = v.axis === "x" ? lz : lx;
          const offset = width / 2 + 1.5;
          targetLane = crossBody + side * offset;
          targetSpeed = Math.min(targetSpeed, 3.2);
          // First make lateral clearance while stopped, then creep past the body.
          const cross = v.axis === "x" ? v.z : v.x;
          if (bodyAhead > -length / 2 - 2 && Math.abs(cross - crossBody) < offset - 0.25) targetSpeed = 0;
          if (bodyAhead < -length / 2 - 2) { incident.passed = true; targetLane = v.lane; }
        }
      }
      const [fx, fz] = roadForward(v);
      if (v.turn) targetSpeed = Math.min(targetSpeed, TRAFFIC_CORNER_SPEED);
      const currentSpeed = v.turn ? Math.hypot(v.vx, v.vz) : v.vx * fx + v.vz * fz;
      v.brake = targetSpeed < currentSpeed - 0.25 || targetSpeed < 0.1 || now < v.crashUntil;
      const tail = brakeMats.current[i]; if (tail) tail.emissiveIntensity = v.brake ? 5 : 0.35 + d * 0.8;
      if (incident && now - incident.startedAt < (incident.scooterCrash ? 15 : ACCIDENT_STOP_SECONDS)) {
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      } else if (now < v.crashUntil) {
        // Let the crash impulse settle before applying the stopped-vehicle brake.
        const age = CRASH_STOP_SECONDS - (v.crashUntil - now);
        if (age > 0.35) { const decay = Math.exp(-7 * dt); body.setLinvel({ x: v.vx * decay, y: 0, z: v.vz * decay }, true); body.setAngvel({ x: 0, y: body.angvel().y * decay, z: 0 }, true); }
      } else {
        const interpolated = currentSpeed + (targetSpeed - currentSpeed) * (1 - Math.exp(-(v.brake ? 9 : 1.8) * dt));
        const speed = targetSpeed === 0 && Math.abs(interpolated) < 0.1 ? 0 : interpolated;
        const cross = v.axis === "x" ? v.z : v.x;
        // Lateral motion only while rolling forward, so lane changes arc like real steering.
        const lateralCap = Math.min(4, Math.max(0, speed) * 0.3);
        const crossSpeed = Math.max(-lateralCap, Math.min(lateralCap, (targetLane - cross) * 1.2));
        const q = body.rotation(); const actualYaw = steeringScratch.euler.setFromQuaternion(steeringScratch.quaternion.set(q.x, q.y, q.z, q.w), "YXZ").y;
        let steerYaw = yaw + Math.atan2(-crossSpeed * v.dir * (v.axis === "x" ? 1 : -1), Math.max(1, speed));
        const turn = v.turn;
        if (turn) {
          const startDistance = Math.hypot(v.x - turn.start[0], v.z - turn.start[1]);
          const reached = turn.progress > 0 || startDistance < 1.2 || (v.t - (v.axis === "x" ? turn.start[0] : turn.start[1])) * v.dir > 0;
          if (reached) {
            const sample = turnSample(turn, turn.progress);
            turn.progress = Math.min(1, turn.progress + Math.max(0, speed) * dt / Math.max(1, sample.derivative));
            const ahead = turnSample(turn, Math.min(1, turn.progress + 0.12));
            steerYaw = Math.atan2(-(ahead.z - v.z), ahead.x - v.x);
            if (turn.progress >= 1 && Math.hypot(v.x - turn.end[0], v.z - turn.end[1]) < 1.5) {
              v.axis = turn.next.axis; v.dir = turn.next.dir; v.lane = turn.next.lane;
              v.central = Math.abs(v.lane - PITCH / 2) < 5;
              v.t = v.axis === "x" ? v.x : v.z; v.turn = null; v.nextIntersection = intersectionAhead(v, v.t);
            }
          }
        }
        const diff = Math.atan2(Math.sin(steerYaw - actualYaw), Math.cos(steerYaw - actualYaw));
        const angularCap = Math.max(0, speed) / 4;
        body.setAngvel({ x: 0, y: Math.max(-angularCap, Math.min(angularCap, diff * 3)), z: 0 }, true);
        body.setLinvel({ x: Math.cos(actualYaw) * speed, y: 0, z: -Math.sin(actualYaw) * speed }, true);
      }
    });
  });

  return (
    <>
      {beamTargets.map((target, i) => <group key={`beam${i}`}><primitive object={target} /><spotLight ref={(light) => { beams.current[i] = light; }} target={target} color="#fff0cd" intensity={100} distance={42} angle={0.52} penumbra={0.6} decay={1.4} /></group>)}
      {vehicles.map((v, i) => {
        const rot = v.axis === "x" ? (v.dir === 1 ? 0 : Math.PI) : v.dir === 1 ? -Math.PI / 2 : Math.PI / 2;
        return (
          <group
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
          >
            <group rotation-y={rot}>
              {v.kind === "car" && <Car color={v.color} mats={mats} />}
              {v.kind === "taxi" && <Car color={v.color} taxi mats={mats} />}
              {v.kind === "bus" && <Bus mats={mats} />}
              {v.kind === "truck" && <Truck color={v.color} cargo={v.cargo} mats={mats} />}
              {/* Cheap headlight pool on the road so every vehicle lights its path at night, not only the nearest few. */}
              <mesh material={beamMat} position={[VEHICLE_SIZE[v.kind][0] / 2 + 5, 0.04, 0]} rotation-x={-Math.PI / 2} scale={[11, 5, 1]}><planeGeometry args={[1, 1]} /></mesh>
            </group>
          </group>
        );
      })}
    </>
  );
}
