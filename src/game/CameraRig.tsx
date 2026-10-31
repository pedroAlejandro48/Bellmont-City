import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import * as THREE from "three";
import type { GameState } from "./state";
import { floorHeight, recenterOrbit, cameraRecenterReady } from "./config";
import { bindMouseLook } from "./mouseLook";

export function CameraRig({ state }: { state: GameState }) {
  const { camera, gl } = useThree();
  const { world, rapier } = useRapier();
  const distance = useRef(6);
  const smoothLook = useRef({ yaw: state.camYaw, pitch: state.camPitch });
  const forwardSince = useRef<number | null>(null);
  const vectors = useMemo(() => ({ target: new THREE.Vector3(), direction: new THREE.Vector3(), up: new THREE.Vector3(), sphere: new rapier.Ball(0.22) }), [rapier]);
  useEffect(() => {
    const element = gl.domElement;
    const unbind = bindMouseLook(element, (x, y) => {
      state.lastMouseLookAt = performance.now();
      state.camYaw -= x * 0.006;
      state.camOrbit = state.camYaw - state.rotY - Math.PI;
      state.camPitch += y * 0.006;
    });
    const context = (e: Event) => e.preventDefault();
    element.addEventListener("contextmenu", context);
    return () => {
      unbind();
      element.removeEventListener("contextmenu", context);
    };
  }, [gl, state]);
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const riding = state.scooter.riding || state.scooter.action === "mount";
    const forward = state.movingForward || (riding && state.scooter.speed > 0 && (state.keys.has("KeyW") || state.keys.has("ArrowUp")));
    const now = performance.now();
    if (!forward || state.accident) forwardSince.current = null;
    else if (forwardSince.current === null) forwardSince.current = now;
    if (riding) state.camYaw = state.rotY + Math.PI + state.camOrbit;
    state.camOrbit = state.camYaw - state.rotY - Math.PI;
    const recenter = cameraRecenterReady(forwardSince.current, state.lastMouseLookAt, now);
    state.camOrbit = recenterOrbit(state.camOrbit, recenter, dt);
    if (recenter) {
      const wrappedPitch = Math.asin(Math.sin(state.camPitch));
      state.camPitch = wrappedPitch + (0.22 - wrappedPitch) * (1 - Math.exp(-3 * dt));
    }
    state.camYaw = state.rotY + Math.PI + state.camOrbit;
    const { target, direction, up, sphere } = vectors;
    target.copy(state.pos); target.y += state.bench ? 1.65 : 1.3;
    const blend = 1 - Math.exp(-18 * dt);
    smoothLook.current.yaw += Math.atan2(Math.sin(state.camYaw - smoothLook.current.yaw), Math.cos(state.camYaw - smoothLook.current.yaw)) * blend;
    smoothLook.current.pitch += (state.camPitch - smoothLook.current.pitch) * blend;
    const yaw = smoothLook.current.yaw, pitch = smoothLook.current.pitch;
    direction.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    // Sweep a sphere, not a ray: the camera's near plane also stays clear.
    const hit = world.castShape(target, { x: 0, y: 0, z: 0, w: 1 }, direction, sphere, 0, 6, true,
      undefined, undefined, undefined, undefined,
      (collider) => !(collider.shape.type === rapier.ShapeType.Cuboid && collider.halfExtents().x <= 0.25 && collider.halfExtents().z <= 0.25 && collider.halfExtents().y >= 2) && !(state.bench && collider.shape.type === rapier.ShapeType.Cuboid && Math.abs(collider.halfExtents().x - 1.3) < 0.01 && Math.abs(collider.halfExtents().z - 0.4) < 0.01) && collider.parent()?.userData !== "ragdoll" && !(state.interior && state.interior.phase !== "inside" && collider.parent()?.userData === "restaurant") && !((state.scooter.riding || state.scooter.action === "mount") && collider.parent()?.userData === "scooter"));
    const allowed = hit ? Math.max(0.08, hit.time_of_impact - 0.08) : 6;
    distance.current = allowed < distance.current ? allowed : distance.current + (allowed - distance.current) * (1 - Math.exp(-5 * dt));
    camera.position.copy(target).addScaledVector(direction, distance.current);
    // Analytic floor safety also covers freshly streamed colliders before their first physics step.
    camera.position.y = Math.max(camera.position.y, floorHeight(camera.position.x, camera.position.z) + 0.23);
    // Continuous up vector permits full vertical loops without a pole flip.
    up.set(-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch));
    camera.up.copy(up); camera.lookAt(target);
    // Test builds: a fixed camera for checking scenery up close (window.__camAt = [x, y, z, lookX, lookY, lookZ]).
    const fixed = import.meta.env["VITE_TRAFFIC_AUDIT"] === "1" ? (window as unknown as { __camAt?: number[] }).__camAt : undefined;
    if (fixed && fixed.length === 6) { camera.position.set(fixed[0]!, fixed[1]!, fixed[2]!); camera.up.set(0, 1, 0); camera.lookAt(fixed[3]!, fixed[4]!, fixed[5]!); }
  }, 0);
  return null;
}