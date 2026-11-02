import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import * as THREE from "three";
import type { GameState } from "./state";
import { floorHeight, recenterOrbit, cameraRecenterReady, SIDEWALK_H } from "./config";
import { CEILING, toLocal } from "./restaurantRoom";

/** Closest third-person distance (closer than that is first person), and furthest. */
const MIN_DISTANCE = 1.15, MAX_DISTANCE = 9;
/** First person: how far down the view can look (from the chest down). */
const FP_DOWN = 1.4;
import { bindMouseLook } from "./mouseLook";

export function CameraRig({ state }: { state: GameState }) {
  const { camera, gl } = useThree();
  const { world, rapier } = useRapier();
  const distance = useRef(6);
  const smoothLook = useRef({ yaw: state.camYaw, pitch: state.camPitch });
  const forwardSince = useRef<number | null>(null);
  /** Going through a restaurant door: which side of its wall the camera has come through to (it stays there). */
  const doorSide = useRef<{ key: string; side: "in" | "out" } | null>(null);
  const vectors = useMemo(() => ({ target: new THREE.Vector3(), direction: new THREE.Vector3(), up: new THREE.Vector3(), sphere: new rapier.Ball(0.22) }), [rapier]);
  useEffect(() => {
    const element = gl.domElement;
    /** Fingers on the view, for pinching to zoom (two at once), and the pinch's spread when it last zoomed. */
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { spread: number; out: number } | null = null;
    const unbind = bindMouseLook(element, (x, y) => {
      if (pinch) return;
      state.lastMouseLookAt = performance.now();
      state.camYaw -= x * 0.006;
      state.camOrbit = state.camYaw - state.rotY - Math.PI;
      state.camPitch += y * 0.006;
      // First person: looking down only as far as the chest down, and up to the sky.
      if (state.firstPerson) state.camPitch = Math.max(-1.25, Math.min(FP_DOWN, state.camPitch));
    }, () => state.firstPerson, (count) => {
      // Fingers turning the view: while any is down the camera doesn't swing behind; it may two seconds after.
      if (count === 0 && state.touchLook.fingers > 0) state.touchLook.releasedAt = performance.now();
      state.touchLook.fingers = count;
    });
    /**
     * Zooming by `factor` (> 1 further out): right in, it becomes first person, looking out from just in front of
     * the face; out of first person when `leave` (a clear move outward). `lock`: ask for pointer lock going in.
     */
    const zoom = (factor: number, leave: boolean, lock: boolean) => {
      if (state.firstPerson) {
        if (leave) { state.firstPerson = false; state.camDistance = 1.6; if (element.ownerDocument.pointerLockElement === element) element.ownerDocument.exitPointerLock(); }
        return;
      }
      state.camDistance = Math.min(MAX_DISTANCE, state.camDistance * factor);
      if (state.camDistance < MIN_DISTANCE) {
        state.firstPerson = true; state.camDistance = MIN_DISTANCE; state.camPitch = Math.max(-1.25, Math.min(FP_DOWN, -0.05));
        // Lock the pointer so turning never runs out at the edge of the screen (browsers may insist on a click first).
        if (lock) { try { void Promise.resolve(element.requestPointerLock()).catch(() => {}); } catch { /* a click will lock it */ } }
      }
    };
    // The wheel (or two fingers on a touchpad) brings the camera closer (up) or further (down).
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      zoom(Math.exp(delta * 0.0016), delta > 4, true);
    };
    // Two fingers on a touchscreen: spreading them zooms in, pinching them together zooms out.
    const spreadOf = () => { const [a, b] = [...touches.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
    const touchDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) pinch = { spread: spreadOf(), out: 1 };
    };
    const touchMove = (e: PointerEvent) => {
      const t = touches.get(e.pointerId);
      if (!t) return;
      t.x = e.clientX; t.y = e.clientY;
      if (!pinch || touches.size !== 2) return;
      const spread = spreadOf();
      if (spread < 10 || pinch.spread < 10) { pinch.spread = spread; return; }
      const factor = pinch.spread / spread;
      // In first person, a clear pinch together (not a wobble) steps back out.
      pinch.out *= factor;
      zoom(factor, pinch.out > 1.2, false);
      pinch.spread = spread;
      if (pinch.out > 1.2 || pinch.out < 0.8) pinch.out = 1;
    };
    const touchUp = (e: PointerEvent) => {
      if (!touches.delete(e.pointerId)) return;
      if (touches.size < 2) pinch = null;
    };
    element.addEventListener("pointerdown", touchDown);
    element.ownerDocument.addEventListener("pointermove", touchMove);
    element.ownerDocument.addEventListener("pointerup", touchUp);
    element.ownerDocument.addEventListener("pointercancel", touchUp);
    element.addEventListener("wheel", wheel, { passive: false });
    const context = (e: Event) => e.preventDefault();
    element.addEventListener("contextmenu", context);
    return () => {
      unbind();
      element.removeEventListener("contextmenu", context);
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("pointerdown", touchDown);
      element.ownerDocument.removeEventListener("pointermove", touchMove);
      element.ownerDocument.removeEventListener("pointerup", touchUp);
      element.ownerDocument.removeEventListener("pointercancel", touchUp);
    };
  }, [gl, state]);
  /**
   * First person: the camera just in front of the face, following the head as it moves (walking, sitting, riding,
   * going through doors), looking where the mouse points. On foot the body turns with the view; otherwise the
   * view can turn about as far as a head can.
   */
  const fpVec = useMemo(() => ({ head: new THREE.Vector3(), look: new THREE.Vector3() }), []);
  const firstPerson = (dt: number) => {
    const head = state.avatar.body[3];
    if (!head) return false;
    const onFoot = !state.script && !state.bench && !state.scooter.riding && !state.scooter.action && !state.accident && state.health > 0;
    const forward = state.rotY;
    let lookYaw = state.camYaw + Math.PI;
    const onBike = state.scooter.riding || state.scooter.action === "mount";
    if (onFoot) state.rotY = forward + Math.atan2(Math.sin(lookYaw - forward), Math.cos(lookYaw - forward)) * (1 - Math.exp(-14 * dt));
    else if (onBike) {
      // Riding: the view turns with the bike, facing the way it goes. A look aside (mouse, or a finger on the
      // screen) is kept while looking, then eases back to the front.
      const now = performance.now(), tl = state.touchLook;
      const looking = now - state.lastMouseLookAt < 1000 || tl.fingers > 0 || now - tl.releasedAt < 2000;
      let off = Math.atan2(Math.sin(state.camOrbit), Math.cos(state.camOrbit));
      if (!looking) off *= Math.exp(-3 * dt);
      off = Math.max(-1.55, Math.min(1.55, off));
      state.camYaw = forward + Math.PI + off; lookYaw = state.camYaw + Math.PI;
    } else {
      const off = Math.atan2(Math.sin(lookYaw - forward), Math.cos(lookYaw - forward)), max = 1.55;
      if (Math.abs(off) > max) { lookYaw = forward + Math.sign(off) * max; state.camYaw = lookYaw - Math.PI; }
    }
    state.camOrbit = state.camYaw - state.rotY - Math.PI;
    const pitch = Math.max(-1.25, Math.min(FP_DOWN, state.camPitch));
    state.camPitch = pitch;
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(fpVec.head);
    // Just in front of the eyes, whichever way the head faces.
    const body = state.rotY;
    camera.position.set(fpVec.head.x + Math.sin(body) * 0.2, fpVec.head.y + 0.03, fpVec.head.z + Math.cos(body) * 0.2);
    fpVec.look.set(Math.sin(lookYaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(lookYaw) * Math.cos(pitch)).add(camera.position);
    camera.up.set(0, 1, 0); camera.lookAt(fpVec.look);
    return true;
  };
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    gl.domElement.style.cursor = state.firstPerson ? "none" : "";
    if (state.firstPerson && firstPerson(dt)) return;
    const riding = state.scooter.riding || state.scooter.action === "mount";
    const forward = state.movingForward || (riding && state.scooter.speed > 0 && (state.keys.has("KeyW") || state.keys.has("ArrowUp") || state.stick !== null));
    const now = performance.now();
    if (!forward || state.accident) forwardSince.current = null;
    else if (forwardSince.current === null) forwardSince.current = now;
    if (riding) state.camYaw = state.rotY + Math.PI + state.camOrbit;
    state.camOrbit = state.camYaw - state.rotY - Math.PI;
    // On a touchscreen, pushing the joystick's top half brings the camera round behind straight away, unless a
    // finger is turning the view (then two seconds after it lets go).
    const tl = state.touchLook;
    const recenter = state.stick
      ? forwardSince.current !== null && now - forwardSince.current > 150 && tl.fingers === 0 && now - tl.releasedAt > 2000
      : cameraRecenterReady(forwardSince.current, state.lastMouseLookAt, now);
    if (state.stick && recenter) {
      // The joystick: the camera eases round behind gently, as much as the push is forward, so a diagonal push
      // makes a smooth curve rather than the view spinning after the character.
      const st = state.stick, ahead = Math.max(0, st.y) / (Math.hypot(st.x, st.y) || 1);
      state.camOrbit = Math.atan2(Math.sin(state.camOrbit), Math.cos(state.camOrbit)) * Math.exp(-1.3 * ahead * ahead * dt);
    } else state.camOrbit = recenterOrbit(state.camOrbit, recenter, dt);
    if (recenter) {
      const wrappedPitch = Math.asin(Math.sin(state.camPitch));
      state.camPitch = wrappedPitch + (0.22 - wrappedPitch) * (1 - Math.exp(-3 * dt));
    }
    // Going through a restaurant door, the view eases round behind the character and follows close behind it.
    const inter = state.interior, passing = inter !== null && inter.phase !== "inside";
    if (passing) {
      // The short way round to behind the character.
      state.camOrbit = Math.atan2(Math.sin(state.camOrbit), Math.cos(state.camOrbit)) * Math.exp(-3 * dt);
      state.camPitch += (0.16 - state.camPitch) * (1 - Math.exp(-3 * dt));
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
    const hit = world.castShape(target, { x: 0, y: 0, z: 0, w: 1 }, direction, sphere, 0, state.camDistance, true,
      undefined, undefined, undefined, undefined,
      (collider) => !(collider.shape.type === rapier.ShapeType.Cuboid && collider.halfExtents().x <= 0.25 && collider.halfExtents().z <= 0.25 && collider.halfExtents().y >= 2) && !(state.bench && collider.shape.type === rapier.ShapeType.Cuboid && Math.abs(collider.halfExtents().x - 1.3) < 0.01 && Math.abs(collider.halfExtents().z - 0.4) < 0.01) && collider.parent()?.userData !== "ragdoll" && !(state.interior && state.interior.phase !== "inside" && collider.parent()?.userData === "restaurant") && !((state.scooter.riding || state.scooter.action === "mount") && collider.parent()?.userData === "scooter"));
    let allowed = hit ? Math.max(0.08, hit.time_of_impact - 0.08) : state.camDistance;
    const room = inter ? state.rooms.get(inter.key) : undefined;
    if (!inter || !room) doorSide.current = null;
    else {
      const f = room.frame;
      // Close behind while going through the doorway (it eases in, not a jump); coming out, close enough to be
      // outside, clear of the door swinging shut, once the character has stopped on the sidewalk.
      const close = inter.phase === "leaving" ? 1.45 : 1.7;
      if (passing && distance.current > close) distance.current += (close - distance.current) * (1 - Math.exp(-4 * dt));
      if (passing) allowed = Math.min(allowed, Math.max(close, distance.current));
      // Once the camera has followed the character through the doorway it stays on that side of the wall: inside
      // going in (and while inside), outside coming out. Until then it keeps off the shop front.
      const [cx, cz] = toLocal(f, target.x + direction.x * distance.current, target.z + direction.z * distance.current);
      const [tx, tz] = toLocal(f, target.x, target.z);
      const b = room.bounds;
      if (inter.phase === "leaving") {
        if (cz > 0.35) doorSide.current = { key: inter.key, side: "out" };
        else if (doorSide.current?.side === "out") doorSide.current = null;
      } else if (inter.phase === "inside" || (cz < -0.35 && tz < -0.2 && cx > b.minX && cx < b.maxX)) doorSide.current = { key: inter.key, side: "in" };
      const side = doorSide.current?.key === inter.key ? doorSide.current.side : null;
      const keepIn = side === "in" && (inter.phase !== "leaving" || tz < -0.4);
      const keepOut = side === "out" || (!keepIn && tz > 0.25 && inter.phase !== "leaving");
      if (keepIn || keepOut) {
        // The view direction in the room's frame.
        const [ex, ez] = toLocal(f, target.x + direction.x, target.z + direction.z);
        const dx = ex - tx, dz = ez - tz, dy = direction.y;
        const m = 0.25;
        let reach = Infinity;
        const wall = (from: number, d: number, lo: number, hi: number) => { if (d > 1e-6) reach = Math.min(reach, (hi - from) / d); else if (d < -1e-6) reach = Math.min(reach, (lo - from) / d); };
        if (keepIn) {
          wall(tx, dx, b.minX + m, b.maxX - m); wall(tz, dz, b.minZ + m, b.maxZ - m);
          wall(target.y, dy, SIDEWALK_H + 0.2, SIDEWALK_H + CEILING - m);
        } else if (dz < -1e-6) reach = Math.min(reach, (0.3 - tz) / dz);
        allowed = Math.min(allowed, Math.max(0.08, reach));
      }
    }
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