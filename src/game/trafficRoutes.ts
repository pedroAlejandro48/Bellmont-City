import { PITCH, WORLD_HALF, MAIN_ROAD_CENTER, roadLane, type RoadPath } from "./config";

export type TrafficTurn = { start: [number, number]; corner: [number, number]; end: [number, number]; next: RoadPath; progress: number; radius: number };
export function intersectionAhead(path: RoadPath, t: number) {
  const cell = (t - PITCH / 2) / PITCH;
  return (path.dir === 1 ? Math.floor(cell) + 1 : Math.ceil(cell) - 1) * PITCH + PITCH / 2;
}
export function makeTrafficTurn(path: RoadPath, intersection: number, newDir: 1 | -1, slot = 0): TrafficTurn {
  const nextAxis = path.axis === "x" ? "z" : "x";
  const lane = roadLane(nextAxis, newDir, intersection, Math.abs(intersection - MAIN_ROAD_CENTER) < 0.1 ? slot : 0);
  const radius = 9;
  const corner: [number, number] = path.axis === "x" ? [lane, path.lane] : [path.lane, lane];
  const start: [number, number] = path.axis === "x" ? [corner[0] - path.dir * radius, corner[1]] : [corner[0], corner[1] - path.dir * radius];
  const end: [number, number] = nextAxis === "x" ? [corner[0] + newDir * radius, corner[1]] : [corner[0], corner[1] + newDir * radius];
  return { start, corner, end, next: { axis: nextAxis, dir: newDir, lane }, progress: 0, radius };
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