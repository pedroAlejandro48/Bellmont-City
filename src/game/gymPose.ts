// Puts the character rig in a gym exercise's pose (gym.ts poseAt): every joint set outright, the hands on the bar
// where the exercise has one. Called by Player last, so nothing else moves the body meanwhile.
import * as THREE from "three";
import { reachArm } from "./arms";
import type { BodyRig } from "./CharacterBody";
import type { Joints } from "./gym";

const at = new THREE.Vector3(), pole = new THREE.Vector3();

export function applyJoints(rig: BodyRig, j: Joints) {
  const root = rig.root.current, hips = rig.hips.current;
  if (!root || !hips) return;
  root.position.y += j.rootY; root.rotation.x = j.rootTilt; root.rotation.z = 0;
  hips.position.y = j.hipsY; hips.rotation.set(j.hipsX, 0, 0);
  rig.torso.current?.rotation.set(...j.torso);
  rig.head.current?.rotation.set(...j.head);
  rig.thighL.current?.rotation.set(j.thighL[0], 0, j.thighL[1]); rig.thighR.current?.rotation.set(j.thighR[0], 0, j.thighR[1]);
  rig.shinL.current?.rotation.set(j.shinL[0], 0, j.shinL[1]); rig.shinR.current?.rotation.set(j.shinR[0], 0, j.shinR[1]);
  rig.armL.current?.rotation.set(j.armL[0], 0, j.armL[1]); rig.armR.current?.rotation.set(j.armR[0], 0, j.armR[1]);
  rig.foreL.current?.rotation.set(j.foreL, 0, 0); rig.foreR.current?.rotation.set(j.foreR, 0, 0);
  if (j.grips) {
    root.updateMatrixWorld(true);
    // (Grips are fixed in the world — the bar doesn't rise with the body: from the root's spot on the floor, turned
    // with it, not lifted or tilted.)
    const g = j.grips, yaw = root.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw), base = root.position;
    const world = (p: [number, number, number]) => at.set(base.x + p[0] * c + p[2] * s, base.y - j.rootY + p[1], base.z - p[0] * s + p[2] * c);
    reachArm(rig.armL.current, rig.foreL.current, world(g.left), pole.set(...g.poleL), 1);
    reachArm(rig.armR.current, rig.foreR.current, world(g.right), pole.set(...g.poleR), 1);
  }
}
