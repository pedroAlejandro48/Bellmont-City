import * as THREE from "three";
import { healthAfterImpact, type SaveData, type RoadPath, GET_UP_SECONDS, KNOCKDOWN_SECONDS, floorHeight, BENCH_SEATS } from "./config";

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
  pos: THREE.Vector3; yaw: number; fallen: boolean; riding: boolean; speed: number;
  action: "mount" | "pickup" | "dismount" | null; actionAt: number; actionOrigin: THREE.Vector3;
  actionSide: 1 | -1; fallenAt: number | null; interactQueued: boolean; promptVisible: boolean;
  braking: boolean; pushVelocity: THREE.Vector3; lean: number; steering: number; throwVelocity: THREE.Vector3; throwRemaining: number;
  /** Which local side the fallen bike lies toward: 1 = +x (default), -1 = -x. */
  fallSide: 1 | -1;
  /** Upright tilt (rad, + toward local +x) and its angular velocity while parked. */
  tip: number; tipVel: number;
};

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
    seatOccupants: new Map(save.benchSeat != null && BENCH_SEATS[save.benchSeat] ? [[save.benchSeat, "player"]] : []),
    bench: save.benchSeat != null && BENCH_SEATS[save.benchSeat] ? { seat: save.benchSeat, phase: "seated", startedAt: 0, origin: new THREE.Vector3(...save.pos), originYaw: save.rotY } : null,
    scooter: {
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
