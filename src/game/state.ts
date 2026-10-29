import * as THREE from "three";
import { healthAfterImpact, type SaveData, type SolidBox, type VehicleKind, type RoadPath, GET_UP_SECONDS, KNOCKDOWN_SECONDS, floorHeight, BENCH_SEATS } from "./config";

export type Accident = {
  phase: "down" | "rising";
  startedAt: number;
  riseStartedAt: number | null;
  vehicleId: number | null;
  direction: [number, number];
  launchSpeed: number;
  seed: number;
};
export type RoadIncident = { vehicleId: number; path: RoadPath; origin: [number, number]; startedAt: number; passed: boolean; stoodUpAt: number | null; scooterCrash?: boolean };

export type ScooterState = {
  /** Which bike this player controls: "own" in their city, a room bike's id in a room, null for none. */
  id: string | null;
  pos: THREE.Vector3; yaw: number; fallen: boolean; riding: boolean; speed: number;
  action: "mount" | "pickup" | "dismount" | null; actionAt: number; actionOrigin: THREE.Vector3;
  actionSide: 1 | -1; fallenAt: number | null; interactQueued: boolean; promptVisible: boolean;
  braking: boolean; pushVelocity: THREE.Vector3; lean: number; steering: number; throwVelocity: THREE.Vector3; throwRemaining: number;
  /** Which local side the fallen bike lies toward: 1 = +x (default), -1 = -x. */
  fallSide: 1 | -1;
  /** Upright tilt (rad, + toward local +x) and its angular velocity while parked. */
  tip: number; tipVel: number;
};

/** Scene objects whose transforms describe how this player looks right now (streamed to room peers). */
export type AvatarRig = { body: THREE.Object3D[]; ragdoll: THREE.Object3D[]; scooter: THREE.Object3D[] };
/** Another player's body on the ground plane, for bumping. */
export type OtherBody = { x: number; z: number; r: number };

/** A traffic vehicle's footprint this frame, for walking and riding into it. */
export type VehicleSolid = { index: number; kind: VehicleKind; box: SolidBox; speed: number };

export type GameState = {
  health: number;
  deathStartedAt: number | null;
  lastImpactAt: number;
  elapsed: number;
  pos: THREE.Vector3;
  rotY: number;
  camYaw: number;
  camPitch: number;
  camOrbit: number;
  lastMouseLookAt: number;
  movingForward: boolean;
  worldSeed: number;
  darkness: number;
  keys: Set<string>;
  jumpQueued: boolean;
  simulationTime: number;
  accident: Accident | null;
  incidents: RoadIncident[];
  scooter: ScooterState;
  bench: { seat: number; phase: "sit" | "seated" | "stand"; startedAt: number; origin: THREE.Vector3; originYaw: number } | null;
  seatOccupants: Map<number, string>;
  interactQueued: boolean;
  avatar: AvatarRig;
  others: OtherBody[];
  /** Other players' parked scooters: solid, but only their owners can move them. */
  otherBikes: SolidBox[];
  /** Parked room bikes nobody controls: solid until someone walks up and takes one. */
  parkedBikes: SolidBox[];
  vehicles: VehicleSolid[];
  /** Bike shoves on vehicles this frame, by vehicle index: a world-space velocity Traffic applies. */
  vehiclePushes: Map<number, [number, number]>;
};

export function createState(save: SaveData): GameState {
  return {
    health: Math.max(0, Math.min(100, save.health ?? 100)),
    deathStartedAt: save.health === 0 ? performance.now() : null,
    lastImpactAt: -Infinity,
    elapsed: save.elapsed,
    pos: new THREE.Vector3(...save.pos),
    rotY: save.rotY,
    camYaw: save.camYaw,
    camOrbit: save.camYaw - save.rotY - Math.PI,
    camPitch: save.camPitch ?? 0.22,
    lastMouseLookAt: performance.now(),
    movingForward: false,
    worldSeed: save.worldSeed ?? 1337,
    darkness: 0,
    keys: new Set(),
    jumpQueued: false,
    simulationTime: 0,
    accident: save.accident ? { phase: save.accident.phase, startedAt: -(KNOCKDOWN_SECONDS - save.accident.remaining), riseStartedAt: save.accident.phase === "rising" ? -(GET_UP_SECONDS - save.accident.remaining) : null, vehicleId: null, direction: save.accident.direction, launchSpeed: 0, seed: save.accident.seed } : null,
    incidents: [],
    interactQueued: false,
    avatar: { body: [], ragdoll: [], scooter: [] },
    others: [],
    otherBikes: [],
    parkedBikes: [],
    vehicles: [],
    vehiclePushes: new Map(),
    seatOccupants: new Map(save.benchSeat != null && BENCH_SEATS[save.benchSeat] ? [[save.benchSeat, "player"]] : []),
    bench: save.benchSeat != null && BENCH_SEATS[save.benchSeat] ? { seat: save.benchSeat, phase: "seated", startedAt: 0, origin: new THREE.Vector3(...save.pos), originYaw: save.rotY } : null,
    scooter: {
      id: "own",
      pos: save.scooter ? new THREE.Vector3(...save.scooter.pos) : new THREE.Vector3(save.pos[0] + 0.75, floorHeight(save.pos[0] + 0.75, save.pos[2]), save.pos[2]),
      yaw: save.scooter?.yaw ?? save.rotY, fallen: save.scooter?.fallen ?? false,
      riding: (save.scooter?.riding ?? false) && !save.scooter?.fallen && !save.accident,
      speed: 0, action: null, actionAt: 0, actionOrigin: new THREE.Vector3(...save.pos), actionSide: 1,
      fallenAt: save.scooter?.fallen ? 0 : null, interactQueued: false, promptVisible: false,
      braking: false, pushVelocity: new THREE.Vector3(), lean: 0, steering: 0, throwVelocity: new THREE.Vector3(), throwRemaining: 0, fallSide: 1, tip: 0, tipVel: 0,
    },
  };
}

export function toSave(s: GameState): SaveData {
  return {
    health: s.health,
    elapsed: s.elapsed,
    pos: [s.pos.x, s.pos.y, s.pos.z],
    rotY: s.rotY,
    camYaw: s.camYaw,
    camPitch: s.camPitch,
    worldSeed: s.worldSeed,
    benchSeat: s.bench?.phase === "stand" ? null : s.bench?.seat ?? null,
    scooter: { pos: [s.scooter.pos.x, s.scooter.pos.y, s.scooter.pos.z], yaw: s.scooter.yaw, fallen: s.scooter.fallen, riding: s.scooter.riding },
    ...(s.accident ? { accident: { phase: s.accident.phase, remaining: Math.max(0, s.accident.phase === "rising" ? GET_UP_SECONDS - (s.simulationTime - (s.accident.riseStartedAt ?? 0)) : KNOCKDOWN_SECONDS - (s.simulationTime - s.accident.startedAt)), direction: s.accident.direction, seed: s.accident.seed } } : { accident: null }),
  };
}

export function knockDown(state: GameState, vehicleId: number, path: RoadPath, position: [number, number], direction: [number, number], launchSpeed: number, seed: number) {
  if (state.accident || !hitByVehicle(state, performance.now())) return false;
  state.keys.clear(); state.jumpQueued = false;
  if (state.bench) state.seatOccupants.delete(state.bench.seat); state.bench = null;
  state.accident = { phase: "down", startedAt: state.simulationTime, riseStartedAt: null, vehicleId, direction, launchSpeed, seed };
  state.incidents.push({ vehicleId, path: { ...path }, origin: position, startedAt: state.simulationTime, passed: false, stoodUpAt: null });
  if (state.scooter.riding || state.scooter.action === "mount") {
    state.scooter.riding = false; state.scooter.action = null; state.scooter.fallen = true;
    state.scooter.fallenAt = state.simulationTime; state.scooter.speed = 0;
    state.scooter.throwVelocity.set(direction[0] * launchSpeed, 3.2, direction[1] * launchSpeed);
    state.scooter.throwRemaining = 1.6;
    const incident = state.incidents[state.incidents.length - 1];
    if (incident) incident.scooterCrash = true;
  }
  return true;
}

export function hitByVehicle(state: GameState, now: number) {
  if (state.health === 0 || now - state.lastImpactAt < 1000) return false;
  state.health = healthAfterImpact(state.health);
  state.lastImpactAt = now;
  if (state.health === 0) {
    state.deathStartedAt = now;
    state.keys.clear();
    state.jumpQueued = false;
  }
  return true;
}

/** Where a bike nobody here controls is parked in this player's simulation: far away, so nothing touches it. */
const NO_BIKE = 100_000;

/** Lets go of the controlled bike (a room bike becomes someone else's to take). */
export function dropScooter(state: GameState) {
  const bike = state.scooter;
  Object.assign(bike, { id: null, riding: false, action: null, speed: 0, fallen: false, fallenAt: null, tip: 0, tipVel: 0, throwRemaining: 0, lean: 0, steering: 0, braking: false, promptVisible: false });
  bike.pos.set(NO_BIKE, 0, NO_BIKE);
  bike.pushVelocity.set(0, 0, 0); bike.throwVelocity.set(0, 0, 0);
}

/** Takes control of a parked bike. */
export function takeScooter(state: GameState, id: string, at: { pos: [number, number, number]; yaw: number; fallen: boolean; fallSide: 1 | -1 }) {
  dropScooter(state);
  const bike = state.scooter;
  bike.id = id;
  bike.pos.set(...at.pos);
  bike.yaw = at.yaw; bike.fallen = at.fallen; bike.fallSide = at.fallSide;
  bike.fallenAt = at.fallen ? state.simulationTime - 60 : null;
}
