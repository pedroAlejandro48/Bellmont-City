import * as THREE from "three";
import type { PoseWire } from "./pose";

/** How far to the left of someone standing on the spawn point a new arrival appears (clear of both scooters). */
export const SPAWN_SIDE_STEP = 1.8;
const OCCUPIED = 0.9;

export type Standing = { x: number; z: number; yaw: number };

/** Where a remote player stands, from their latest pose. */
export function standingFromPose(pose: PoseWire): Standing | null {
  const [x, , z, qx, qy, qz, qw] = pose.b;
  if (x === undefined || z === undefined || qx === undefined || qy === undefined || qz === undefined || qw === undefined) return null;
  const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(qx, qy, qz, qw), "YXZ").y;
  return { x, z, yaw };
}

/**
 * Spawn point for a new arrival: the normal spawn, or, if someone is standing on it, a step to that
 * person's left (repeated while that spot is taken too). A character faces (sin yaw, cos yaw); its left
 * side is (cos yaw, -sin yaw), where its left arm is.
 */
export function spawnBeside(spawn: { x: number; z: number }, others: readonly Standing[]) {
  const at = { ...spawn };
  for (let i = 0; i < others.length + 1; i++) {
    const blocker = others.find((o) => Math.hypot(o.x - at.x, o.z - at.z) < OCCUPIED);
    if (!blocker) break;
    at.x = blocker.x + Math.cos(blocker.yaw) * SPAWN_SIDE_STEP;
    at.z = blocker.z - Math.sin(blocker.yaw) * SPAWN_SIDE_STEP;
  }
  return at;
}
