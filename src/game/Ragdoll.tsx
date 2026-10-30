import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import * as THREE from "three";
import { floorHeight, GET_UP_SECONDS, KNOCKDOWN_SECONDS, rng } from "./config";
import { FOURS_END, getUpPose, STAND_FORWARD, type Joint } from "./getUpPose";

// Segment endpoints per ragdoll part for the stand-up animation (null = point part).
const SEGMENTS: ([Joint, Joint] | null)[] = [null, null, null, ["hipL", "kneeL"], ["kneeL", "footL"], ["hipR", "kneeR"], ["kneeR", "footR"], ["shL", "elL"], ["elL", "handL"], ["shR", "elR"], ["elR", "handR"]];
const UP = new THREE.Vector3(0, 1, 0);
import type { Accident, GameState } from "./state";

// Body centers and anatomical joint anchors match the animated character.
const PARTS = [
  { p: [0, 0.95, 0], len: 0.26, mass: 12, sideways: true },
  { p: [0, 1.23, 0], len: 0.56, mass: 24 },
  { p: [0, 1.75, 0], len: 0, mass: 5 },
  { p: [0.13, 0.72, 0], len: 0.46, mass: 8 },
  { p: [0.13, 0.26, 0], len: 0.46, mass: 4 },
  { p: [-0.13, 0.72, 0], len: 0.46, mass: 8 },
  { p: [-0.13, 0.26, 0], len: 0.46, mass: 4 },
  { p: [0.2, 1.35, 0], len: 0.3, mass: 3 },
  { p: [0.2, 1.06, 0], len: 0.28, mass: 2 },
  { p: [-0.2, 1.35, 0], len: 0.3, mass: 3 },
  { p: [-0.2, 1.06, 0], len: 0.28, mass: 2 },
] as const;
const LINKS: [number, number, [number, number, number]][] = [
  [0, 1, [0, 0.95, 0]], [1, 2, [0, 1.59, 0]],
  [0, 3, [0.13, 0.95, 0]], [3, 4, [0.13, 0.49, 0]],
  [0, 5, [-0.13, 0.95, 0]], [5, 6, [-0.13, 0.49, 0]],
  [1, 7, [0.2, 1.5, 0]], [7, 8, [0.2, 1.2, 0]],
  [1, 9, [-0.2, 1.5, 0]], [9, 10, [-0.2, 1.2, 0]],
];

/** Whoever a ragdoll belongs to: the player, or an NPC. */
export type RagdollSubject = {
  accident: () => Accident | null;
  /** Where they are (followed while down, set when back on their feet). */
  pos: THREE.Vector3;
  yaw: () => number;
  time: () => number;
  /** False keeps them down (the player, dead). */
  canRise: () => boolean;
  /** Back on their feet, facing `yaw`. */
  stoodUp: (accident: Accident, yaw: number) => void;
};

/** The player's ragdoll. */
export function Ragdoll({ state }: { state: GameState }) {
  const subject = useMemo<RagdollSubject>(() => ({
    accident: () => state.accident,
    pos: state.pos,
    yaw: () => state.rotY,
    time: () => state.simulationTime,
    canRise: () => state.health > 0,
    stoodUp: (accident, yaw) => {
      state.rotY = yaw;
      state.incidents.forEach((incident) => { if (incident.vehicleId === accident.vehicleId) incident.stoodUpAt = state.simulationTime; });
      state.accident = null; state.keys.clear(); state.jumpQueued = false;
    },
  }), [state]);
  const onMeshes = useMemo(() => (meshes: THREE.Group[]) => { state.avatar.ragdoll = meshes; }, [state]);
  return <RagdollBody subject={subject} color={state.bodyColor} onMeshes={onMeshes} />;
}

/**
 * A character's ragdoll: while they are knocked down, their body is a set of jointed physics parts thrown by
 * the hit; then it gets up (hands and knees, then standing) and hands back to the character.
 */
export function RagdollBody({ subject, color, onMeshes }: { subject: RagdollSubject; color: string; onMeshes?: (meshes: THREE.Group[]) => void }) {
  const { world, rapier } = useRapier();
  const bodies = useRef<ReturnType<typeof world.createRigidBody>[]>([]);
  const joints = useRef<ReturnType<typeof world.createImpulseJoint>[]>([]);
  const meshes = useRef<(THREE.Group | null)[]>([]);
  const active = useRef<Accident | null>(null);
  const resting = useRef<{ p: THREE.Vector3; q: THREE.Quaternion }[]>([]);
  const standOrigin = useRef(new THREE.Vector3());
  const riseYaw = useRef(0);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.72 }), [color]);
  const rotation = useMemo(() => new THREE.Quaternion(), []);
  const temp = useMemo(() => new THREE.Vector3(), []);

  const dispose = () => {
    for (const joint of joints.current) { try { if (joint.isValid()) world.removeImpulseJoint(joint, true); } catch { /* Parent world already disposed. */ } }
    for (const body of bodies.current) { try { if (body.isValid()) world.removeRigidBody(body); } catch { /* Parent world already disposed. */ } }
    joints.current = []; bodies.current = [];
  };
  useEffect(() => () => { dispose(); mat.dispose(); }, [world]);

  useFrame(() => {
    const accident = subject.accident();
    if (!accident) {
      if (active.current) dispose();
      active.current = null;
      meshes.current.forEach((mesh) => { if (mesh) mesh.visible = false; });
      return;
    }
    if (active.current !== accident) {
      dispose(); active.current = accident;
      const random = rng(accident.seed);
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), subject.yaw());
      bodies.current = PARTS.map((part, i) => {
        temp.set(part.p[0], part.p[1], part.p[2]).applyQuaternion(rotation).add(subject.pos);
        const body = world.createRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(temp.x, temp.y, temp.z).setRotation(rotation).setLinearDamping(1.1).setAngularDamping(1.8).setAdditionalSolverIterations(8).setCcdEnabled(true));
        body.userData = "ragdoll";
        const radius = i === 0 ? 0.115 : i === 1 ? 0.16 : i >= 7 ? 0.06 : 0.075;
        const shape = i === 2 ? rapier.ColliderDesc.ball(0.14) : rapier.ColliderDesc.capsule(Math.max(0.01, part.len / 2 - radius), radius);
        if ('sideways' in part) shape.setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 });
        world.createCollider(shape.setMass(part.mass).setFriction(1.3).setRestitution(0.08), body);
        const flying = accident.launchSpeed > 0;
        // Limbs fling outward in every direction while the core carries the impact.
        const limb = i >= 3;
        const outward = limb && flying ? new THREE.Vector3(Math.sign(part.p[0]) * (2.2 + random() * 1.4), i >= 7 ? 1.6 + random() * 1.2 : (random() - 0.5) * 1.5, (random() - 0.5) * 2.4).applyQuaternion(rotation) : new THREE.Vector3();
        body.setLinvel({ x: accident.direction[0] * accident.launchSpeed + outward.x, y: (flying ? 3 + random() * 0.6 : 0) + outward.y, z: accident.direction[1] * accident.launchSpeed + outward.z }, true);
        body.setAngvel({ x: (random() - 0.5) * (limb ? 9 : 5) + accident.direction[1] * 2, y: (random() - 0.5) * 1.2, z: (random() - 0.5) * (limb ? 9 : 5) - accident.direction[0] * 2 }, true);
        if (limb) body.setAngularDamping(0.9);
        return body;
      });
      for (const [a, b, anchor] of LINKS) {
        const pa = PARTS[a]; const pb = PARTS[b]; const ba = bodies.current[a]; const bb = bodies.current[b];
        if (!pa || !pb || !ba || !bb) continue;
        const aa = { x: anchor[0] - pa.p[0], y: anchor[1] - pa.p[1], z: 0 };
        const ab = { x: anchor[0] - pb.p[0], y: anchor[1] - pb.p[1], z: 0 };
        // Anatomical hinges prevent knees/elbows bending sideways or backwards.
        // Hips and shoulders are ball sockets so limbs can splay any direction; knees, elbows and spine stay hinged.
        const socket = b === 3 || b === 5 || b === 7 || b === 9;
        let descriptor;
        if (socket) descriptor = rapier.JointData.spherical(aa, ab);
        else {
          descriptor = rapier.JointData.revolute(aa, ab, { x: 1, y: 0, z: 0 });
          descriptor.limitsEnabled = true;
          descriptor.limits = b === 1 ? [-0.25, 0.25] : b === 2 ? [-0.35, 0.35] : b === 4 || b === 6 ? [0, 1.8] : [-1.9, 0];
        }
        const joint = world.createImpulseJoint(descriptor, ba, bb, true);
        joint.setContactsEnabled(false); joints.current.push(joint);
      }
      resting.current = [];
    }
    const now = subject.time();
    const pelvis = bodies.current[0];
    if (!pelvis) return;
    const position = pelvis.translation();
    if (accident.phase === "down") {
      subject.pos.set(position.x, floorHeight(position.x, position.z), position.z);
      if (subject.canRise() && now - accident.startedAt >= KNOCKDOWN_SECONDS) {
        accident.phase = "rising"; accident.riseStartedAt = now;
      }
    }
    if (accident.phase === "rising" && resting.current.length === 0) {
      // Face the way the head lies, so he pushes up onto hands and knees toward it.
      const head = bodies.current[2]?.translation() ?? position;
      riseYaw.current = Math.atan2(head.x - position.x, head.z - position.z);
      standOrigin.current.set(position.x, floorHeight(position.x, position.z), position.z);
      resting.current = bodies.current.map((body) => { body.sleep(); const p = body.translation(); const q = body.rotation(); return { p: new THREE.Vector3(p.x, p.y, p.z), q: new THREE.Quaternion(q.x, q.y, q.z, q.w) }; });
    }
    const progress = accident.phase === "rising" ? Math.min(1, (now - (accident.riseStartedAt ?? now)) / GET_UP_SECONDS) : 0;
    const facing = rotation.setFromAxisAngle(UP, riseYaw.current);
    const pose = getUpPose(progress);
    const world3 = (v: readonly number[]) => new THREE.Vector3(v[0], v[1], v[2]).applyQuaternion(facing).add(standOrigin.current);
    const toFours = Math.min(1, progress / FOURS_END); const blend = toFours * toFours * (3 - 2 * toFours);
    bodies.current.forEach((body, i) => {
      const mesh = meshes.current[i];
      if (!mesh) return;
      mesh.visible = true;
      const p = body.translation(); const q = body.rotation();
      mesh.position.set(p.x, p.y, p.z); mesh.quaternion.set(q.x, q.y, q.z, q.w);
      const rest = resting.current[i];
      if (!rest || accident.phase !== "rising") return;
      const seg = SEGMENTS[i];
      let center: THREE.Vector3; let orient: THREE.Quaternion;
      if (i === 0) { center = world3([(pose.hipL[0] + pose.hipR[0]) / 2, (pose.hipL[1] + pose.hipR[1]) / 2, (pose.hipL[2] + pose.hipR[2]) / 2]); orient = facing.clone(); }
      else if (i === 2) { center = world3(pose.head); orient = facing.clone(); }
      else {
        const hip = [(pose.hipL[0] + pose.hipR[0]) / 2, (pose.hipL[1] + pose.hipR[1]) / 2, (pose.hipL[2] + pose.hipR[2]) / 2];
        const a = i === 1 ? world3(hip) : world3(seg ? pose[seg[0]] : pose.neck); const b = i === 1 ? world3(pose.neck) : world3(seg ? pose[seg[1]] : pose.neck);
        center = a.clone().add(b).multiplyScalar(0.5);
        orient = new THREE.Quaternion().setFromUnitVectors(UP, a.sub(b).normalize());
      }
      mesh.position.lerpVectors(rest.p, center, blend);
      mesh.quaternion.copy(rest.q).slerp(orient, blend);
    });
    if (progress >= 1) {
      subject.pos.copy(standOrigin.current).add(new THREE.Vector3(0, 0, STAND_FORWARD).applyQuaternion(facing));
      subject.stoodUp(accident, riseYaw.current);
    }
  });
  useEffect(() => {
    onMeshes?.(meshes.current.filter((m): m is THREE.Group => m !== null));
    return () => onMeshes?.([]);
  }, [onMeshes]);
  return <RagdollMeshes mat={mat} groupRef={(i, el) => { meshes.current[i] = el; }} />;
}

/** The ragdoll's part meshes, each group placed at its part's world transform (hidden until shown). */
export function RagdollMeshes({ mat, groupRef }: { mat: THREE.Material; groupRef: (index: number, group: THREE.Group | null) => void }) {
  return <>{PARTS.map((part, i) => <group key={i} ref={(el) => groupRef(i, el)} visible={false}>
    <mesh visible={i !== 0} material={mat} castShadow receiveShadow rotation-z={'sideways' in part ? Math.PI / 2 : 0}>
      {i === 2 ? <sphereGeometry args={[0.14, 20, 14]} /> : <capsuleGeometry args={[i === 0 ? 0.115 : i === 1 ? 0.16 : i >= 7 ? 0.06 : 0.075, Math.max(0.01, part.len - (i === 1 ? 0.22 : i === 0 ? 0.08 : 0.03)), 6, 12]} />}
    </mesh>
  </group>)}</>;
}

export const RAGDOLL_PART_COUNT = PARTS.length;
