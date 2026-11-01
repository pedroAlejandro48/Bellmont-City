import * as THREE from "three";

/** Upper arm and forearm lengths (m) and the shoulder's height above the hips' pivot. */
export const UPPER = 0.3, FORE = 0.28;

/** Which way an elbow bends while the hand reaches (in the shoulder's frame; side 1 = left arm). */
export const POLES = {
  low: (side: number) => new THREE.Vector3(side * 0.35, -0.6, -0.25),
  out: (side: number) => new THREE.Vector3(side * 0.8, -0.1, -0.3),
  back: (side: number) => new THREE.Vector3(side * 0.35, -0.25, -0.9),
};

/** Bends an arm so its hand reaches `world` (as near as it can), blended `blend` of the way from its pose. */
export function reachArm(upper: THREE.Group | null, lower: THREE.Group | null, world: THREE.Vector3, pole: THREE.Vector3, blend: number) {
  const parent = upper?.parent;
  if (!upper || !lower || !parent || blend <= 0) return;
  const restUpper = upper.quaternion.clone(), restLower = lower.quaternion.clone();
  const target = parent.worldToLocal(world.clone());
  const delta = target.clone().sub(upper.position);
  const distance = Math.min(UPPER + FORE - 0.001, Math.max(0.08, delta.length()));
  const forward = delta.normalize();
  const bend = pole.clone().addScaledVector(forward, -pole.dot(forward)).normalize();
  const along = (UPPER * UPPER - FORE * FORE + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, UPPER * UPPER - along * along));
  const elbowPoint = upper.position.clone().addScaledVector(forward, along).addScaledVector(bend, height);
  const hand = upper.position.clone().addScaledVector(forward, distance);
  upper.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), elbowPoint.clone().sub(upper.position).normalize());
  lower.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), hand.sub(elbowPoint).normalize().applyQuaternion(upper.quaternion.clone().invert()));
  if (blend < 1) { upper.quaternion.slerpQuaternions(restUpper, upper.quaternion.clone(), blend); lower.quaternion.slerpQuaternions(restLower, lower.quaternion.clone(), blend); }
}

/** How far below the shoulder a carried bag's handle rides: about waist height. */
export const CARRY_DROP = 0.43;
/**
 * Carrying something at the waist: the upper arm swings as usual (`swing`, rad), and the forearm bends forward
 * just enough to keep the hand at the same height all the while. Returns the elbow's bend (forearm x rotation).
 */
export function carryElbow(swing: number, drop = CARRY_DROP) {
  const c = Math.max(-1, Math.min(1, (drop - UPPER * Math.cos(swing)) / FORE));
  return -Math.acos(c) - swing;
}

/** Where a hand is, in the world: the end of its forearm. */
export function handWorld(fore: THREE.Object3D, out = new THREE.Vector3()) {
  return fore.localToWorld(out.set(0, -FORE, 0));
}

/**
 * Points an arm at a world point (straight, the elbow a little soft), blended `blend` of the way from its pose.
 */
export function pointArm(upper: THREE.Group | null, lower: THREE.Group | null, world: THREE.Vector3, blend: number) {
  const parent = upper?.parent;
  if (!upper || !lower || !parent || blend <= 0) return;
  const restUpper = upper.quaternion.clone(), restLower = lower.quaternion.clone();
  const dir = parent.worldToLocal(world.clone()).sub(upper.position).normalize();
  upper.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  lower.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.12);
  upper.quaternion.slerpQuaternions(restUpper, upper.quaternion.clone(), blend);
  lower.quaternion.slerpQuaternions(restLower, lower.quaternion.clone(), blend);
}
