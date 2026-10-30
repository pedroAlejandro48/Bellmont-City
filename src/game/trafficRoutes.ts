import { WORLD_HALF, MAIN_ROAD_CENTER, nextStreet, roadLane, type RoadPath, type VehicleKind } from "./config";

/** Where a vehicle is headed after a turn: the new road, its direction, and which of its lanes (slot). */
export type TurnTarget = RoadPath & { slot: number };
export type TrafficTurn = { start: [number, number]; corner: [number, number]; end: [number, number]; next: TurnTarget; progress: number; radius: number };
export type TurnSide = "left" | "right";

/** Traffic keeps right. Heading along +x the right-hand side is +z; heading along +z it is -x. */
export function turnDir(path: { axis: "x" | "z"; dir: 1 | -1 }, side: TurnSide): 1 | -1 {
  const right: 1 | -1 = path.axis === "x" ? path.dir : (-path.dir as 1 | -1);
  return side === "right" ? right : (-right as 1 | -1);
}

/**
 * Which turns a lane may make: on a main road (two lanes each way) only the right lane (slot 1) turns
 * right and only the left lane (slot 0) turns left; a street's single lane may turn either way.
 */
export function allowedTurns(onMainRoad: boolean, slot: number): TurnSide[] {
  if (!onMainRoad) return ["left", "right"];
  return slot === 1 ? ["right"] : ["left"];
}

/**
 * Whether a turn would leave the city where there is no road: from the ring road (the street along the city's
 * edge) only inward turns exist, except onto a main road, which continues into the countryside.
 */
export function turnLeavesCity(path: RoadPath & { slot?: number }, roadCenter: number, intersection: number, side: TurnSide) {
  if (Math.abs(Math.abs(roadCenter) - WORLD_HALF) > 1 || Math.abs(intersection - MAIN_ROAD_CENTER) < 0.1) return false;
  return Math.sign(turnDir(path, side)) === Math.sign(roadCenter);
}

/**
 * The lane a turn ends in: the nearest matching lane of the new road, on its right-hand half. A right turn
 * onto a main road ends in its right lane (buses swing wider and take the lane next to it); a left turn ends
 * in its left lane; a street has one lane each way.
 */
export function arrivalSlot(side: TurnSide, ontoMainRoad: boolean, kind: VehicleKind) {
  if (!ontoMainRoad) return 0;
  return side === "right" && kind !== "bus" ? 1 : 0;
}
export function intersectionAhead(path: RoadPath, t: number) {
  return nextStreet(t, path.dir);
}
export function makeTrafficTurn(path: RoadPath, intersection: number, side: TurnSide, kind: VehicleKind = "car"): TrafficTurn {
  const nextAxis = path.axis === "x" ? "z" : "x";
  const newDir = turnDir(path, side);
  const slot = arrivalSlot(side, Math.abs(intersection - MAIN_ROAD_CENTER) < 0.1, kind);
  const lane = roadLane(nextAxis, newDir, intersection, slot);
  const radius = 9;
  const corner: [number, number] = path.axis === "x" ? [lane, path.lane] : [path.lane, lane];
  const start: [number, number] = path.axis === "x" ? [corner[0] - path.dir * radius, corner[1]] : [corner[0], corner[1] - path.dir * radius];
  const end: [number, number] = nextAxis === "x" ? [corner[0] + newDir * radius, corner[1]] : [corner[0], corner[1] + newDir * radius];
  return { start, corner, end, next: { axis: nextAxis, dir: newDir, lane, slot }, progress: 0, radius };
}
/** Quadratic centerline has tangents parallel to both roads, never sideways. */
export function turnSample(turn: TrafficTurn, progress: number) {
  const t = Math.max(0, Math.min(1, progress)), u = 1 - t;
  const x = u * u * turn.start[0] + 2 * u * t * turn.corner[0] + t * t * turn.end[0];
  const z = u * u * turn.start[1] + 2 * u * t * turn.corner[1] + t * t * turn.end[1];
  const dx = 2 * (u * (turn.corner[0] - turn.start[0]) + t * (turn.end[0] - turn.corner[0]));
  const dz = 2 * (u * (turn.corner[1] - turn.start[1]) + t * (turn.end[1] - turn.corner[1]));
  return { x, z, yaw: Math.atan2(-dz, dx), derivative: Math.hypot(dx, dz) };
}
export function mayTurnAt(intersection: number, cross: number) {
  return Math.abs(intersection) <= WORLD_HALF && Math.abs(cross) <= WORLD_HALF + 6;
}
/** The curve parameter (0..1) of the point on `turn` nearest to (x, z), searched just ahead of `from`. */
export function progressOnTurn(turn: TrafficTurn, x: number, z: number, from: number) {
  let best = from, bestDistance = Infinity;
  for (let u = Math.max(0, from - 0.02); u <= Math.min(1, from + 0.35) + 1e-9; u += 0.01) {
    const p = turnSample(turn, Math.min(1, u));
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bestDistance) { bestDistance = d; best = Math.min(1, u); }
  }
  return Math.max(from, best);
}

/** The point `distance` metres further along the turn from parameter `from` (past its end, along the new road). */
export function pointAlongTurn(turn: TrafficTurn, from: number, distance: number) {
  // March along the curve in small fixed steps (a turn is ~20 m long), accumulating arc length.
  let u = from, left = distance, prev = turnSample(turn, from);
  while (u < 1 && left > 0) {
    const nu = Math.min(1, u + 0.02), next = turnSample(turn, nu);
    const segment = Math.hypot(next.x - prev.x, next.z - prev.z);
    if (segment >= left) {
      const f = segment > 0 ? left / segment : 0;
      return { x: prev.x + (next.x - prev.x) * f, z: prev.z + (next.z - prev.z) * f };
    }
    left -= segment; u = nu; prev = next;
  }
  // Beyond the curve: continue straight down the new lane.
  const next = turn.next;
  return next.axis === "x" ? { x: prev.x + next.dir * left, z: prev.z } : { x: prev.x, z: prev.z + next.dir * left };
}
