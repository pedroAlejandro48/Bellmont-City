import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { InteractionPrompt } from "./InteractionPrompt";
import { Headlight } from "./Headlight";
import * as THREE from "three";
import { canInteractScooter, scooterSide, floorHeight, headingVelocity, smoothSteer, stickDrive, scooterNextAction, scooterSpeed, scooterCanDismount, scooterTurn, SCOOTER_MOUNT_SECONDS, SCOOTER_PICKUP_SECONDS, nearestBenchSeat, scooterTipStep, SCOOTER_MASS, SCOOTER_COLLISION_PARTS, SCOOTER_COLLISION_GROUPS, bikeOutOfBoxes, fallenBikeOutOfBoxes, bikeCanPushVehicle, BIKE_PUSH_SPEED, bikeImpactCrashes, bikeTouchesCircle, footprintBlocked, scooterFootprint } from "./config";
import { crashBike, type GameState } from "./state";
import { BIKE_SHOVE_SPEED } from "./config";

/** What the model reads to draw lights and steering; a remote player's scooter passes its own copy. */
export type ScooterLook = { darkness: number; scooter: { riding: boolean; steering: number; braking: boolean } };

export function ScooterModel({ state, headlight = true, frontRef }: { state: ScooterLook; headlight?: boolean; frontRef?: (group: THREE.Group | null) => void }) {
  const tail = useRef<THREE.MeshStandardMaterial>(null);
  const front = useRef<THREE.Group | null>(null);
  const beam = useRef<THREE.SpotLight>(null);
  useFrame(() => {
    // Headlight only while ridden.
    const on = state.scooter.riding;
    if (beam.current) { beam.current.intensity = on ? 10 + state.darkness * 70 : 0; beam.current.visible = state.darkness > 0.03; }
    materials.light.emissiveIntensity = on ? 0.65 + state.darkness * 2.5 : 0; if (front.current) front.current.rotation.y = state.scooter.steering; if (tail.current) tail.current.emissiveIntensity = state.scooter.braking ? 5 : 0.65; });
  const materials = useMemo(() => ({
    paint: new THREE.MeshStandardMaterial({ color: "#27877b", metalness: 0.45, roughness: 0.3 }),
    rubber: new THREE.MeshStandardMaterial({ color: "#202622", roughness: 0.95 }),
    chrome: new THREE.MeshStandardMaterial({ color: "#bac4be", metalness: 0.85, roughness: 0.22 }),
    seat: new THREE.MeshStandardMaterial({ color: "#353d39", roughness: 0.85 }),
    light: new THREE.MeshStandardMaterial({ color: "#fff0cb", emissive: "#fff0cb", emissiveIntensity: 0.65 }),
  }), []);
  return <group>
    {[-0.65].map((z) => <group key={z} position={[0, 0.28, z]} rotation-y={Math.PI / 2}>
      <mesh material={materials.rubber} castShadow><torusGeometry args={[0.21, 0.065, 10, 24]} /></mesh>
      <mesh material={materials.chrome} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.16, 0.16, 0.12, 20]} /></mesh>
    </group>)}
    <group ref={(el) => { front.current = el; frontRef?.(el); }} position={[0, 0.28, 0.65]}><group rotation-y={Math.PI / 2}><mesh material={materials.rubber} castShadow><torusGeometry args={[0.21, 0.065, 10, 24]} /></mesh><mesh material={materials.chrome} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.16, 0.16, 0.12, 20]} /></mesh></group></group>
    <mesh material={materials.paint} position={[0, 0.47, -0.42]} scale={[0.3, 0.26, 0.5]} castShadow><sphereGeometry args={[1, 20, 12]} /></mesh>
    <mesh material={materials.paint} position={[0, 0.36, 0]} castShadow><boxGeometry args={[0.48, 0.1, 0.95]} /></mesh>
    <mesh material={materials.seat} position={[0, 0.78, -0.27]} scale={[0.29, 0.09, 0.46]} castShadow><sphereGeometry args={[1, 20, 12]} /></mesh>
    <mesh material={materials.paint} position={[0, 0.73, 0.42]} rotation-x={-0.18} scale={[0.29, 0.48, 0.1]} castShadow><sphereGeometry args={[1, 20, 12]} /></mesh>
    {[-0.1, 0.1].map((x) => <mesh key={x} material={materials.chrome} position={[x, 0.59, 0.64]} rotation-x={-0.18} castShadow><cylinderGeometry args={[0.025, 0.025, 0.67, 10]} /></mesh>)}
    <mesh material={materials.paint} position={[0, 1.1, 0.51]} scale={[0.19, 0.11, 0.15]} castShadow><sphereGeometry args={[1, 16, 12]} /></mesh>
    <mesh material={materials.light} position={[0, 1.1, 0.66]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.095, 0.095, 0.03, 18]} /></mesh>
    <mesh material={materials.chrome} position={[0, 1.1, 0.46]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.025, 0.025, 0.8, 12]} /></mesh>
    {[-0.35, 0.35].map((x) => <group key={x}>
      <mesh material={materials.rubber} position={[x, 1.1, 0.46]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.04, 0.04, 0.15, 12]} /></mesh>
      <mesh material={materials.chrome} position={[x, 1.25, 0.48]} rotation-z={x > 0 ? -0.4 : 0.4}><cylinderGeometry args={[0.012, 0.012, 0.3, 8]} /></mesh>
      <mesh material={materials.chrome} position={[x * 1.2, 1.39, 0.48]} scale={[0.1, 0.075, 0.025]}><sphereGeometry args={[1, 12, 8]} /></mesh>
    </group>)}
    <mesh material={materials.chrome} position={[0.22, 0.3, -0.48]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.06, 0.06, 0.65, 12]} /></mesh>
    <mesh position={[0, 0.6, -0.85]}><boxGeometry args={[0.19, 0.08, 0.025]} /><meshStandardMaterial color="#b93429" emissive="#b93429" ref={tail} emissiveIntensity={0.8} /></mesh>
    {headlight && <Headlight position={[0, 1.1, 0.7]} lightRef={beam} />}
  </group>;
}

export function Scooter({ state }: { state: GameState }) {
  const { world, rapier } = useRapier();
  const root = useRef<THREE.Group>(null);
  const front = useRef<THREE.Group | null>(null);
  useEffect(() => {
    state.avatar.scooter = [root.current, front.current].filter((g): g is THREE.Group => g !== null);
    return () => { state.avatar.scooter = []; };
  }, [state]);

  const bodyRef = useRef<ReturnType<typeof world.createRigidBody> | null>(null);
  const turnRate = useRef(0), lean = useRef(0);
  useEffect(() => {
    const bike = state.scooter;
    const body = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(bike.pos.x, bike.pos.y, bike.pos.z));
    body.userData = "scooter";
    for (const part of SCOOTER_COLLISION_PARTS) world.createCollider(rapier.ColliderDesc.cuboid(part.half[0], part.half[1], part.half[2]).setTranslation(part.center[0], part.center[1], part.center[2]).setFriction(0.85).setMass(SCOOTER_MASS / SCOOTER_COLLISION_PARTS.length).setCollisionGroups(SCOOTER_COLLISION_GROUPS), body);
    bodyRef.current = body;
    return () => { try { if (body.isValid()) world.removeRigidBody(body); } catch { /* Physics owner already disposed its world. */ } bodyRef.current = null; };
  }, [world, rapier, state]);
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05), bike = state.scooter, now = state.simulationTime;
    const nearby = canInteractScooter([state.pos.x, state.pos.z], [bike.pos.x, bike.pos.z], bike.yaw, bike.fallen, bike.fallSide);
    // One shared E sign for every available action (pickup, mount, and stopped dismount).
    bike.promptVisible = !state.bench && !state.doorPrompt && !state.interior && (bike.fallen || bike.riding || !nearestBenchSeat(state.pos.x, state.pos.z, state.seatOccupants)) && !bike.action && !state.accident && state.health > 0 && (bike.riding ? scooterCanDismount(bike.speed) : nearby);
    if (bike.interactQueued) {
      bike.interactQueued = false;
      if (!state.accident && state.health > 0 && !bike.action && (nearby || bike.riding) && (!bike.riding || scooterCanDismount(bike.speed))) {
        bike.action = scooterNextAction(bike.fallen, bike.riding); bike.actionAt = now;
        bike.actionOrigin.copy(state.pos); bike.actionSide = bike.riding ? -1 : scooterSide([state.pos.x, state.pos.z], [bike.pos.x, bike.pos.z], bike.yaw); state.keys.clear(); state.jumpQueued = false;
      }
    }
    if (bike.action) {
      const duration = bike.action === "pickup" ? SCOOTER_PICKUP_SECONDS : SCOOTER_MOUNT_SECONDS;
      if (now - bike.actionAt >= duration) {
        if (bike.action === "pickup") { bike.fallen = false; bike.fallenAt = null; bike.throwRemaining = 0; bike.throwVelocity.set(0, 0, 0); }
        else if (bike.action === "mount") { bike.riding = true; state.pos.copy(bike.pos); state.rotY = bike.yaw; }
        else { bike.riding = false; bike.speed = 0; state.pos.copy(bike.pos).add(new THREE.Vector3(-0.75, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), bike.yaw)); }
        bike.action = null;
      }
    }
    if (bike.riding && !bike.action && !state.accident && state.health > 0) {
      // Keys, or the on-screen joystick at any angle (analog throttle and steering, see stickDrive).
      const keyLeft = state.keys.has("KeyA") || state.keys.has("ArrowLeft"), keyRight = state.keys.has("KeyD") || state.keys.has("ArrowRight");
      const keyForward = state.keys.has("KeyW") || state.keys.has("ArrowUp"), keyReverse = state.keys.has("KeyS") || state.keys.has("ArrowDown");
      const keysUsed = keyLeft || keyRight || keyForward || keyReverse;
      const drive = keysUsed ? null : stickDrive(state.stick);
      const forward = drive ? drive.forward : keyForward, reverse = drive ? drive.reverse : keyReverse;
      const steerInput = drive ? drive.steer : Number(keyLeft) - Number(keyRight);
      const previousSpeed = bike.speed;
      bike.speed = scooterSpeed(bike.speed, forward, reverse, dt, drive ? drive.throttle : 1);
      bike.braking = Math.abs(bike.speed) < Math.abs(previousSpeed) - 0.001 || forward && reverse;
      turnRate.current = smoothSteer(turnRate.current, steerInput, dt);
      bike.steering += (steerInput * 0.5 - bike.steering) * (1 - Math.exp(-8 * dt));
      bike.yaw = scooterTurn(bike.yaw, turnRate.current, bike.speed, dt);
      // What the bike runs into: above 20 mph anything (vehicles, people, bikes, buildings, trees, lamps)
      // makes it crash; slower, cars and taxis are shoved slowly, and everything else just stops it.
      const [hx, hz] = headingVelocity(bike.yaw, 1);
      const impactSpeed = bike.speed, fast = bikeImpactCrashes(impactSpeed);
      const probeX = bike.pos.x + hx * Math.sign(bike.speed) * 0.08, probeZ = bike.pos.z + hz * Math.sign(bike.speed) * 0.08;
      const crash = (id: string | null = null) => {
        const direction: [number, number] = [hx * Math.sign(impactSpeed), hz * Math.sign(impactSpeed)];
        if (crashBike(state, direction, impactSpeed, Math.floor(Math.random() * 1e8)) && id) {
          state.impacts.push({ kind: "player", id, direction, speed: Math.abs(impactSpeed) });
        }
      };
      const person = bike.speed !== 0 ? state.others.find((o) => bikeTouchesCircle(probeX, probeZ, bike.yaw, o)) : undefined;
      if (person) {
        if (fast) crash(person.id ?? null); else bike.speed = 0;
      }
      // NPCs, the same: above 20 mph rider and NPC both go down; slower, the bike just stops against them.
      const npc = bike.speed !== 0 ? state.npcs.find((n) => !n.down && bikeTouchesCircle(probeX, probeZ, bike.yaw, { x: n.x, z: n.z, r: 0.35 })) : undefined;
      if (npc) {
        if (fast) {
          const direction: [number, number] = [hx * Math.sign(impactSpeed), hz * Math.sign(impactSpeed)];
          if (!npc.hit) npc.hit = { direction };
          crash();
        } else bike.speed = 0;
      }
      const bikes = [...state.otherBikes, ...state.parkedBikes];
      const bikeHit = bike.speed !== 0 ? bikeOutOfBoxes(probeX, probeZ, bike.yaw, bikes.map((b) => b.box)).hit : -1;
      const otherBike = bikes[bikeHit];
      if (otherBike) {
        if (fast) {
          // Knocked over away from the side it was hit on.
          const side = scooterSide([bike.pos.x, bike.pos.z], [otherBike.box.x, otherBike.box.z], otherBike.box.yaw);
          state.impacts.push({ kind: "bike", id: otherBike.id, side: side === 1 ? -1 : 1 });
          crash();
        } else {
          // Slower, it is a physical thing: the bike shoves it along at walking pace (whoever controls it moves it).
          bike.speed = Math.sign(bike.speed) * Math.min(Math.abs(bike.speed), BIKE_SHOVE_SPEED);
          state.bikePushes.set(otherBike.id, [hx * bike.speed, hz * bike.speed]);
        }
      }
      const ahead = bikeOutOfBoxes(probeX, probeZ, bike.yaw, state.vehicles.map((v) => v.box));
      const touched = ahead.hit >= 0 ? state.vehicles[ahead.hit] : undefined;
      if (touched && bike.speed !== 0 && fast) crash();
      else if (touched && bike.speed !== 0) {
        if (bikeCanPushVehicle(touched.kind)) {
          bike.speed = Math.sign(bike.speed) * Math.min(Math.abs(bike.speed), BIKE_PUSH_SPEED);
          state.vehiclePushes.set(touched.index, [hx * bike.speed, hz * bike.speed]);
        } else bike.speed = 0;
      }
      const [vx, vz] = headingVelocity(bike.yaw, bike.speed);
      const next = bike.pos.clone().add(new THREE.Vector3(vx * dt, 0, vz * dt));
      const blocked = world.intersectionWithShape({ x: next.x, y: next.y + 0.55, z: next.z }, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), bike.yaw), new rapier.Cuboid(0.26, 0.35, 0.8), undefined, undefined, undefined, bodyRef.current ?? undefined,
        (collider) => { const owner = collider.parent(); return owner?.userData !== "ragdoll" && owner?.userData !== "vehicle" && owner?.userData !== "scooter" && (collider.shape.type !== rapier.ShapeType.Cuboid || collider.halfExtents().y > 0.2 && collider.halfExtents().y < 100); });
      if (blocked && fast && bike.riding) crash();
      else if (blocked) bike.speed = 0;
      else bike.pos.copy(next);
      bike.pos.y = floorHeight(bike.pos.x, bike.pos.z);
      if (bike.riding) { state.pos.copy(bike.pos); state.rotY = bike.yaw; }
    }
    // A slow vehicle rolling into the bike (ridden or not) shoves it aside; fast ones crash it in Traffic.
    if (!bike.action && bike.throwRemaining <= 0 && !bike.fallen) {
      const out = bikeOutOfBoxes(bike.pos.x, bike.pos.z, bike.yaw, state.vehicles.map((v) => v.box));
      if (out.dx || out.dz) { bike.pos.x += out.dx; bike.pos.z += out.dz; if (bike.riding) state.pos.copy(bike.pos); }
    }
    if (!bike.fallen) bike.pushVelocity.set(0, 0, 0);
    if (!bike.fallen && !bike.riding && !bike.action && (bike.tip || bike.tipVel)) {
      const r = scooterTipStep(bike.tip, bike.tipVel, dt);
      bike.tip = r.angle; bike.tipVel = r.vel;
      if (r.fallen) { bike.fallen = true; bike.fallSide = r.fallen; bike.fallenAt = now; bike.tip = 0; bike.tipVel = 0; }
      else if (Math.abs(bike.tip) < 1e-4 && Math.abs(bike.tipVel) < 1e-3) { bike.tip = 0; bike.tipVel = 0; }
    } else if (bike.riding || bike.fallen) { bike.tip = 0; bike.tipVel = 0; }
    if (!bike.riding && !bike.action && bike.throwRemaining <= 0) {
      bike.braking = false;
      const next = bike.pos.clone().addScaledVector(bike.pushVelocity, dt);
      // A pushed bike (lying down or standing) stops against walls, trees, lamps, vehicles, people and other bikes.
      const box = scooterFootprint(next.x, next.z, bike.yaw, bike.fallen, bike.fallSide);
      const moving = bike.pushVelocity.lengthSq() > 1e-8;
      const blocked = moving && (world.intersectionWithShape({ x: box.x, y: next.y + 0.5, z: box.z }, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), bike.yaw), new rapier.Cuboid(box.hx, 0.35, box.hz), undefined, undefined, undefined, bodyRef.current ?? undefined,
        (c) => c.parent()?.userData !== "ragdoll" && (c.shape.type !== rapier.ShapeType.Cuboid || c.halfExtents().y > 0.2))
        || footprintBlocked(box, state.others, [...state.vehicles.map((v) => v.box), ...state.otherBikes.map((b) => b.box), ...state.parkedBikes.map((b) => b.box)]));
      if (!blocked) bike.pos.copy(next); else bike.pushVelocity.set(0, 0, 0);
      bike.pos.y = floorHeight(bike.pos.x, bike.pos.z); bike.pushVelocity.multiplyScalar(Math.exp(-7 * dt));
    }
    if (bike.fallen && bike.throwRemaining > 0) {
      bike.throwRemaining = Math.max(0, bike.throwRemaining - dt);
      bike.throwVelocity.y -= 9.81 * dt;
      const next = bike.pos.clone().addScaledVector(bike.throwVelocity, dt);
      const blocked = world.intersectionWithShape({ x: next.x, y: next.y + 0.3, z: next.z }, new THREE.Quaternion(), new rapier.Ball(0.65), undefined, undefined, undefined, bodyRef.current ?? undefined,
        (c) => c.parent()?.userData !== "ragdoll" && c.parent()?.userData !== "vehicle" && (c.shape.type !== rapier.ShapeType.Cuboid || c.halfExtents().y > 0.2));
      if (!blocked) bike.pos.copy(next); else { bike.throwVelocity.x *= -0.15; bike.throwVelocity.z *= -0.15; }
      const floor = floorHeight(bike.pos.x, bike.pos.z);
      if (bike.pos.y < floor) { bike.pos.y = floor; bike.throwVelocity.y = Math.abs(bike.throwVelocity.y) * 0.12; bike.throwVelocity.x *= Math.exp(-5 * dt); bike.throwVelocity.z *= Math.exp(-5 * dt); }
    }
    // Lying down (thrown in a crash, or tipped over), its whole footprint stays clear of every vehicle, the one that
    // hit it included: never under one, always somewhere it can be reached and picked up.
    if (bike.fallen && bike.action !== "pickup") {
      const out = fallenBikeOutOfBoxes(bike.pos.x, bike.pos.z, bike.yaw, bike.fallSide, state.vehicles.map((v) => v.box));
      if (out.dx || out.dz) {
        bike.pos.x += out.dx; bike.pos.z += out.dz; bike.pos.y = Math.max(bike.pos.y, floorHeight(bike.pos.x, bike.pos.z));
        // Flying into it: the sideways part of the throw stops against it.
        const n = Math.hypot(out.dx, out.dz), nx = out.dx / n, nz = out.dz / n, into = bike.throwVelocity.x * nx + bike.throwVelocity.z * nz;
        if (into < 0) { bike.throwVelocity.x -= into * nx; bike.throwVelocity.z -= into * nz; }
        bike.pushVelocity.set(0, 0, 0);
      }
    }
    const actionProgress = bike.action === "pickup" ? Math.min(1, (now - bike.actionAt) / SCOOTER_PICKUP_SECONDS) : 0;
    const lift = Math.max(0, Math.min(1, (actionProgress - 0.3) / 0.5));
    // Bike stays down while he bends to it, then rises as he straightens.
    const desiredLean = bike.fallen ? (1 - lift * lift * (3 - 2 * lift)) * -Math.PI / 2 * bike.fallSide : bike.riding ? -turnRate.current * bike.speed * 0.014 : -0.08 - bike.tip;
    lean.current += (desiredLean - lean.current) * (1 - Math.exp(-9 * dt));
    bike.lean = lean.current;
    if (root.current) { root.current.visible = bike.id !== null; root.current.position.copy(bike.pos); root.current.position.y += 0.3 * Math.abs(lean.current) / (Math.PI / 2); root.current.rotation.set(0, bike.yaw, lean.current); }
    const body = bodyRef.current;
    if (body) {
      body.setNextKinematicTranslation({ x: bike.pos.x, y: bike.pos.y + 0.3 * Math.abs(lean.current) / (Math.PI / 2), z: bike.pos.z });
      body.setNextKinematicRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, bike.yaw, lean.current, "YXZ")));
    }
  });
  return <>
    <group ref={root}><ScooterModel state={state} frontRef={(el) => { front.current = el; }} /></group>
    <InteractionPrompt sample={() => ({ visible: state.scooter.promptVisible, x: state.scooter.pos.x, y: state.scooter.pos.y + 1.8, z: state.scooter.pos.z, time: state.simulationTime })} />
  </>;
}