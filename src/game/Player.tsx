import { skillLevel } from "./life";
import { USE_SECONDS } from "./invRuntime";
import { useCharacterColor } from "./characterColor";
import { ATMS } from "./places";
import { useFrame } from "@react-three/fiber";
import { POLES, carryElbow, reachArm } from "./arms";
import { DROP_TIME, EAT_SECONDS, GRAB_TIME, PACK_SIZE, dropReach, grabReach } from "./food";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { SIGNAL_POLES, benchJoints, benchPose, floorHeight, cameraRelativeVelocity, SCOOTER_MOUNT_SECONDS, SCOOTER_PICKUP_SECONDS, type City, PARK_SOLIDS, circleBoxPush, bikePushShare, scooterFootprint, scooterSide, SCOOTER_TIP, BENCH_SEATS, BENCH_SIT_SECONDS, BENCH_STAND_SECONDS, benchStandHeight, BENCH_SEAT_TOP, BENCH_BACK_TOP, BENCH_BACKRESTS, FALLEN_BIKE_TOP, fallenBikeStandHeight, PARK_BINS, BIN } from "./config";
import { groundAt } from "./state";
import type { GameState } from "./state";
import { BODY_PARTS, CharacterBody, useBodyRig } from "./CharacterBody";
import { bumpOthers } from "@/multiplayer/bump";
import { CHAIR, stepPerson, toLocal, toWorld } from "./restaurantRoom";
/** Hip height (above the floor) sat on a bed's edge, and lying on it. */
export const BED_SIT_HIPS = 0.62, BED_LIE_HIPS = 0.71;

// feel constants
const WALK = 2.2;
const RUN = 6.2;
const ACCEL = 12;
const GRAVITY = 22;
const JUMP_V = 7.2;
const RADIUS = 0.35;

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

type Colliders = { boxes: { minX: number; maxX: number; minZ: number; maxZ: number; key: string }[]; circles: { x: number; z: number; r: number }[] };

function resolve(p: THREE.Vector3, c: Colliders, skip: string | null = null) {
  for (const b of c.boxes) {
    if (b.key === skip) continue;
    const nx = Math.max(b.minX, Math.min(p.x, b.maxX));
    const nz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
    const dx = p.x - nx;
    const dz = p.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= RADIUS * RADIUS) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      p.x = nx + (dx / d) * RADIUS;
      p.z = nz + (dz / d) * RADIUS;
    } else {
      const opts = [p.x - b.minX, b.maxX - p.x, p.z - b.minZ, b.maxZ - p.z];
      const i = opts.indexOf(Math.min(...opts));
      if (i === 0) p.x = b.minX - RADIUS;
      else if (i === 1) p.x = b.maxX + RADIUS;
      else if (i === 2) p.z = b.minZ - RADIUS;
      else p.z = b.maxZ + RADIUS;
    }
  }
  for (const o of c.circles) {
    const dx = p.x - o.x;
    const dz = p.z - o.z;
    const min = RADIUS + o.r;
    const d2 = dx * dx + dz * dz;
    if (d2 < min * min && d2 > 1e-8) {
      const d = Math.sqrt(d2);
      p.x = o.x + (dx / d) * min;
      p.z = o.z + (dz / d) * min;
    }
  }
}

const turnTo = (from: number, to: number, t: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * t;
const smoothstep = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
/**
 * Walking up to a spot, `k` (0..1) of the way: turn to face the way to go, step there, then turn to `endYaw`.
 * A short shuffle (under half a metre) is stepped without turning away.
 */
function stepYaw(k: number, fromYaw: number, from: THREE.Vector3, to: THREE.Vector3, endYaw: number) {
  const dx = to.x - from.x, dz = to.z - from.z;
  if (Math.hypot(dx, dz) < 0.5) return turnTo(fromYaw, endYaw, smoothstep(k / 0.8));
  const heading = Math.atan2(dx, dz);
  return k < 0.25 ? turnTo(fromYaw, heading, smoothstep(k / 0.25)) : k > 0.72 ? turnTo(heading, endYaw, smoothstep((k - 0.72) / 0.28)) : heading;
}

export function Player({ state, city }: { state: GameState; city: City }) {
  const color = useCharacterColor(state);
  const colliders = useMemo<Colliders>(
    () => ({
      boxes: city.buildings.map((b) => ({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, key: `${b.x}:${b.z}` })),
      circles: [
        ...city.trees.map((t) => ({ x: t.x, z: t.z, r: 0.25 })),
        ...city.lamps.map((l) => ({ x: l.x, z: l.z, r: 0.15 })),
        ...SIGNAL_POLES.map((l) => ({ x: l.x, z: l.z, r: 0.15 })),
        ...PARK_BINS.map((b) => ({ x: b.x, z: b.z, r: BIN.r })),
        ...ATMS.map((a) => ({ x: a.x, z: a.z, r: 0.45 })),
      ],
    }),
    [city],
  );

  const rig = useBodyRig();
  const { root, hips, torso, head, thighL, thighR, shinL, shinR, armL, armR, foreL, foreR } = rig;
  // Peers in a room see this player through these groups' transforms.
  useEffect(() => {
    state.avatar.body = BODY_PARTS.map((part) => rig[part].current).filter((g): g is THREE.Group => g !== null);
    return () => { state.avatar.body = []; };
  }, [state, rig]);

  const sim = useRef({
    vel: new THREE.Vector3(),
    vy: 0,
    grounded: true,
    phase: 0,
    runBlend: 0,
    moveBlend: 0,
    airBlend: 0,
    bikeContact: false,
    airStyle: 0, // 1 if the jump started while running/walking
    camPos: new THREE.Vector3(),
    camInit: false,
    turnRate: 0,
    reverseBlend: 0,
    /** Which bike action is playing (and the facing it started from), so its approach can step from there. */
    actionKey: "",
    actionYaw: 0,
  });

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const s = sim.current;
    const k = state.keys;
    const p = state.pos;

    const fwdKey = k.has("KeyW") || k.has("ArrowUp");
    const back = k.has("KeyS") || k.has("ArrowDown");
    const left = k.has("KeyA") || k.has("ArrowLeft");
    const right = k.has("KeyD") || k.has("ArrowRight");
    const shift = k.has("ShiftLeft") || k.has("ShiftRight");
    // The on-screen joystick: how far it is pushed sets the pace; right to the edge, running.
    // (Not while a panel holds you still: the fridge open, the closet, the elevator's buttons…)
    const stick = state.uiLock ? null : state.stick, stickPush = stick ? Math.min(1, Math.hypot(stick.x, stick.y)) : 0;

    let running = false;
    const dead = state.health === 0;
    const incapacitated = state.accident !== null;
    const bike = state.scooter;
    const usingBike = bike.riding || bike.action !== null;
    const sitting = state.bench !== null;
    // Going through a restaurant door or sitting on a chair: the movement is scripted.
    const script = state.script;
    s.reverseBlend = damp(s.reverseBlend, bike.riding && !bike.action && !incapacitated && bike.speed < -0.01 ? 1 : 0, 6, dt);
    const fullDrink = (h: typeof state.hands.left) => !!h && h.cups > 0 && (h.items?.length ?? 1) > 0;
    const holdingDrink = fullDrink(state.hands.left) || fullDrink(state.hands.right);
    // Reaching for food on a counter: stop, and turn a little toward it.
    const grab = state.grab, grabT = grab ? state.simulationTime - grab.at : Infinity;
    const grabbing = grab !== null && grabT < GRAB_TIME;
    // Putting food down (Q), or picking something up off the ground: a squat.
    const dropT = state.drop ? state.simulationTime - state.drop.at : Infinity, dropping = dropT < DROP_TIME;
    const lowGrab = grabbing && grab !== null && grab.target.y - groundAt(state, grab.target.x, grab.target.z) < 0.8;
    // Putting a thing from the inventory down, or picking one up: the same squat.
    const inv = state.invAct, invT = inv ? state.simulationTime - inv.at : Infinity;
    const invLow = !!inv && (inv.kind === "drop" || inv.kind === "pickup") && invT < DROP_TIME;
    const crouch = dropping ? dropReach(dropT) : lowGrab ? grabReach(grabT) : invLow ? dropReach(invT) : 0;
    if (script) {
      s.vel.set(0, 0, 0); s.vy = 0; s.grounded = true;
      p.x = script.x; p.z = script.z; p.y = groundAt(state, p.x, p.z);
      state.rotY = script.yaw;
    } else if (dead || incapacitated || usingBike || sitting) {
      s.vel.set(0, 0, 0);
      s.vy = 0;
      s.grounded = true;
      p.y = groundAt(state, p.x, p.z);
    } else if ((dropping || invLow) && s.grounded) {
      s.vel.set(damp(s.vel.x, 0, ACCEL * 2, dt), 0, damp(s.vel.z, 0, ACCEL * 2, dt));
    } else if (grabbing && s.grounded && grab) {
      s.vel.set(damp(s.vel.x, 0, ACCEL * 2, dt), 0, damp(s.vel.z, 0, ACCEL * 2, dt));
      const want = Math.atan2(grab.target.x - p.x, grab.target.z - p.z), off = Math.atan2(Math.sin(want - state.rotY), Math.cos(want - state.rotY));
      // Square up to it, but only partly: the reaching hand's shoulder leads.
      state.rotY += off * 0.6 * (1 - Math.exp(-8 * dt));
      state.camOrbit = state.camYaw - state.rotY - Math.PI;
    } else if (s.grounded) {
      // Restore view-relative walking; changing the player's facing never rotates the view.
      const useStick = stickPush > 0.12 && !fwdKey && !back && !left && !right;
      const direction = useStick ? stick!.y : Number(fwdKey) - Number(back);
      const sideways = useStick ? stick!.x : Number(right) - Number(left);
      // Nobody runs holding a drink, nor anywhere indoors.
      // (Out of energy: no running.)
      running = !holdingDrink && !state.interior && state.energy > 0 && (useStick ? stickPush > 0.92 : shift && fwdKey && !back);
      state.runningNow = running;
      // Fitness (from the gym and running) makes running faster: 2.5% a level.
      const run = RUN * (1 + 0.025 * skillLevel(state.life.skills.fitness));
      const pace = useStick && !running ? WALK * Math.min(1, 0.35 + stickPush * 0.75) : running ? run : WALK;
      const [vx, vz] = cameraRelativeVelocity(state.camYaw, direction, sideways, pace);
      s.vel.set(damp(s.vel.x, vx, ACCEL, dt), 0, damp(s.vel.z, vz, ACCEL, dt));
      if (direction || sideways) {
        const desiredYaw = Math.atan2(vx, vz);
        const angle = Math.atan2(Math.sin(desiredYaw - state.rotY), Math.cos(desiredYaw - state.rotY));
        state.rotY += angle * (1 - Math.exp(-12 * dt));
        state.camOrbit = state.camYaw - state.rotY - Math.PI;
      }
      if (state.jumpQueued) {
        s.vy = JUMP_V;
        s.grounded = false;
        s.airStyle = Math.hypot(s.vel.x, s.vel.z) > 0.8 ? 1 : 0;
      }
    }
    if (!s.grounded || dead || incapacitated) s.turnRate = 0;
    state.movingForward = !script && (fwdKey && !back && !left && !right || (!!stick && stickPush > 0.12 && stick.y > 0)) && s.grounded && !dead && !incapacitated && !usingBike && !sitting && Math.hypot(s.vel.x, s.vel.z) > 0.1;
    state.jumpQueued = false;
    // airborne: horizontal velocity frozen (no steering, same speed)

    p.x += s.vel.x * dt;
    p.z += s.vel.z * dt;
    const room = state.interior?.phase === "inside" ? state.rooms.get(state.interior.key) : undefined;
    if (room && !script) {
      // Inside a restaurant: its walls, counter and furniture (running shoves tables and chairs along).
      const [lx, lz] = toLocal(room.frame, p.x, p.z);
      const [nx, nz] = stepPerson(room, lx, lz, running, dt);
      [p.x, p.z] = toWorld(room.frame, nx, nz);
      bumpOthers(p, state.others, RADIUS, dt);
      // The staff are solid.
      for (const w of state.staffBodies) {
        const dx = p.x - w.x, dz = p.z - w.z, d = Math.hypot(dx, dz), min = RADIUS + w.r;
        if (d < min && d > 1e-5) { p.x = w.x + dx / d * min; p.z = w.z + dz / d * min; }
      }
    } else if (!incapacitated && !usingBike && !sitting && !script) {
      // Vehicles are solid: walking never pushes them, and a slow one rolling into the player shoves them along
      // (fast ones knock the player down in Traffic instead).
      for (const v of state.vehicles) { const [vx, vz] = circleBoxPush(p.x, p.z, RADIUS, v.box); p.x += vx; p.z += vz; }
      resolve(p, colliders, state.interior?.key ?? null);
      bumpOthers(p, state.others, RADIUS, dt);
      // NPCs are solid: walking into one leans on it (it gives way slowly on its own side).
      for (const n of state.npcs) {
        if (n.down) continue;
        const dx = p.x - n.x, dz = p.z - n.z, d = Math.hypot(dx, dz), min = RADIUS + 0.35;
        if (d < min && d > 1e-5) { p.x = n.x + dx / d * min; p.z = n.z + dz / d * min; }
      }
      const ground0 = groundAt(state, p.x, p.z);
      for (const [i, box] of PARK_SOLIDS.entries()) { if (i < 4 && p.y - ground0 >= BENCH_SEAT_TOP - 0.1) { const back = BENCH_BACKRESTS[i]; if (back && p.y - ground0 < BENCH_BACK_TOP - 0.05) { const [bx, bz] = circleBoxPush(p.x, p.z, RADIUS, back); p.x += bx; p.z += bz; } continue; } const [dx, dz] = circleBoxPush(p.x, p.z, RADIUS, box); p.x += dx; p.z += dz; }
      // Up on a fallen bike, it is underfoot rather than in the way.
      const onTop = (p.y - groundAt(state, p.x, p.z)) >= FALLEN_BIKE_TOP - 0.12;
      const [dx, dz] = bike.fallen && onTop ? [0, 0] : circleBoxPush(p.x, p.z, RADIUS, scooterFootprint(bike.pos.x, bike.pos.z, bike.yaw, bike.fallen, bike.fallSide));
      if (dx || dz) {
        if (!bike.fallen) {
          // Bumping a standing bike tips it over away from the player; it is never shoved upright.
          // Impact sets the bike tipping away from the player; physics decides tilt-and-return or fall.
          if (!bike.riding && !bike.action && !s.bikeContact) {
            const len = Math.hypot(dx, dz), into = Math.max(0, -(s.vel.x * dx + s.vel.z * dz) / len);
            const away = scooterSide([p.x, p.z], [bike.pos.x, bike.pos.z], bike.yaw) === 1 ? -1 : 1;
            bike.tipVel += away * into * SCOOTER_TIP.impulsePerSpeed;
          }
        } else {
          const share = bikePushShare();
          bike.pushVelocity.x -= dx * share / dt; bike.pushVelocity.z -= dz * share / dt;
        }
        // Feet never cross the bike even when it cannot move against an obstacle.
        p.x += dx; p.z += dz;
      }
      s.bikeContact = !!(dx || dz);
      for (const other of [...state.otherBikes, ...state.parkedBikes]) {
        if (other.fallen && onTop) continue;
        const [ox, oz] = circleBoxPush(p.x, p.z, RADIUS, other.box);
        // Walking into someone else's fallen bike shoves it along, as with one's own (whoever moves it moves it).
        if ((ox || oz) && other.fallen) { const share = bikePushShare(); state.bikePushes.set(other.id, [-ox * share / dt, -oz * share / dt]); }
        p.x += ox; p.z += oz;
      }
    }

    const ground = groundAt(state, p.x, p.z);
    // Benches and fallen bikes can be stood on (jumped up onto, walked along).
    let standOn = benchStandHeight(p.x, p.z, p.y - ground);
    if (!sitting && !usingBike && !incapacitated) {
      const fallen = [...(bike.fallen && bike.id !== null ? [scooterFootprint(bike.pos.x, bike.pos.z, bike.yaw, true, bike.fallSide)] : []), ...[...state.otherBikes, ...state.parkedBikes].filter((b) => b.fallen).map((b) => b.box)];
      for (const box of fallen) standOn = Math.max(standOn, fallenBikeStandHeight(p.x, p.z, p.y - ground, box));
    }
    const floor = sitting || usingBike || incapacitated ? ground : ground + standOn;
    if (!s.grounded) {
      s.vy -= GRAVITY * dt;
      p.y += s.vy * dt;
      if (p.y <= floor && s.vy <= 0) {
        p.y = floor;
        s.vy = 0;
        s.grounded = true;
      }
    } else {
      // step up/down curbs
      if (p.y - floor < 0.3) p.y = floor;
      else {
        s.grounded = false;
        s.vy = 0;
      }
    }

    // ---------- animation ----------
    const hSpeed = script ? Math.abs(script.walk) : Math.hypot(s.vel.x, s.vel.z);
    s.moveBlend = damp(s.moveBlend, s.grounded ? Math.min(1, hSpeed / WALK) : 0, 10, dt);
    s.runBlend = damp(s.runBlend, Math.max(0, Math.min(1, (hSpeed - WALK) / (RUN - WALK))), 8, dt);
    s.airBlend = damp(s.airBlend, s.grounded ? 0 : 1, 14, dt);
    if (s.grounded) s.phase += dt * (script ? script.walk : hSpeed) * (s.runBlend > 0.5 ? 2.4 : 4.2);

    const ph = s.phase;
    const run = s.runBlend;
    const mv = s.moveBlend;
    const air = s.airBlend;
    const sin = Math.sin(ph);
    const cos = Math.cos(ph);

    const legA = (0.5 + run * 0.45) * mv;
    const kneeA = (0.65 + run * 0.9) * mv;
    let hipL = -sin * legA;
    let hipR = sin * legA;
    let kneeL = 0.08 + kneeA * Math.max(0, cos) + run * 0.3 * mv;
    let kneeR = 0.08 + kneeA * Math.max(0, -cos) + run * 0.3 * mv;
    let shL = sin * (0.4 + run * 0.6) * mv;
    let shR = -sin * (0.4 + run * 0.6) * mv;
    let elbow = -0.15 - run * 1.35 - (1 - mv) * 0.05;
    let lean = run * 0.32 * mv + mv * 0.05;
    const breathe = Math.sin(performance.now() * 0.002) * 0.015 * (1 - mv);
    let bob = -Math.abs(cos) * (0.035 + run * 0.06) * mv + breathe;

    // jump pose
    const rising = s.vy > 0 ? 1 : 0;
    const jHipL = s.airStyle ? -1.2 : -0.7;
    const jHipR = s.airStyle ? 0.35 : -0.7;
    const jKneeL = s.airStyle ? 1.3 : 1.25;
    const jKneeR = s.airStyle ? 0.9 : 1.25;
    const jSh = rising ? -2.5 : -1.6;
    hipL = THREE.MathUtils.lerp(hipL, jHipL, air);
    hipR = THREE.MathUtils.lerp(hipR, jHipR, air);
    kneeL = THREE.MathUtils.lerp(kneeL, jKneeL, air);
    kneeR = THREE.MathUtils.lerp(kneeR, jKneeR, air);
    shL = THREE.MathUtils.lerp(shL, s.airStyle ? 0.9 : jSh, air);
    shR = THREE.MathUtils.lerp(shR, s.airStyle ? -1.4 : jSh, air);
    elbow = THREE.MathUtils.lerp(elbow, -0.5, air);
    lean = THREE.MathUtils.lerp(lean, s.airStyle ? 0.25 : 0.1, air);
    bob = THREE.MathUtils.lerp(bob, 0.05, air);

    const deathAge = state.deathStartedAt === null ? 0 : (performance.now() - state.deathStartedAt) / 1000;
    const fall = dead ? Math.min(1, deathAge / 1.15) : 0;
    const collapse = fall * fall * (3 - 2 * fall);
    if (dead) {
      hipL = -0.35 * collapse;
      hipR = 0.2 * collapse;
      kneeL = 0.65 * collapse;
      kneeR = 0.9 * collapse;
      shL = -2.2 * Math.sin(fall * Math.PI) - 0.7 * collapse;
      shR = -1.7 * Math.sin(fall * Math.PI) - 1.1 * collapse;
      elbow = -0.8 * collapse;
      lean = 0;
      bob = 0;
    }

    let riderOffset = 0;
    let sitHands = 0;
    let straddle = 0;
    let legSwing = 0;
    let plantSwing = 0;
    if (usingBike && !incapacitated) {
      const mount = bike.action === "mount";
      const dismount = bike.action === "dismount";
      const progress = bike.action ? Math.min(1, (state.simulationTime - bike.actionAt) / (bike.action === "pickup" ? SCOOTER_PICKUP_SECONDS : SCOOTER_MOUNT_SECONDS)) : 1;
      const seated = mount ? progress * progress * (3 - 2 * progress) : dismount ? 1 - progress : bike.riding ? 1 : 0;
      const ease = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
      const right = new THREE.Vector3(Math.cos(bike.yaw), 0, -Math.sin(bike.yaw));
      const ahead = new THREE.Vector3(Math.sin(bike.yaw), 0, Math.cos(bike.yaw));
      const actionKey = `${bike.action}:${bike.actionAt}`;
      if (s.actionKey !== actionKey) { s.actionKey = actionKey; s.actionYaw = state.rotY; }
      // Walking up to the bike takes real steps: the legs swing while the feet travel (`stride` 0..1).
      let stride = 0;
      if (bike.action === "pickup") {
        // One flow: step in and squat, grab, drive up through the legs with the torso close, then stand tall.
        const side = bike.actionSide;
        const liftT = ease((progress - 0.3) / 0.5);
        // Start right by the lying bike, then step in as it rises so the torso stays close to it.
        const stance = bike.pos.clone().addScaledVector(right, side * (1.0 - 0.42 * liftT)).addScaledVector(ahead, 0.05);
        const walkK = Math.min(1, progress / 0.22);
        p.lerpVectors(bike.actionOrigin, stance, ease(walkK));
        if (progress > 0.22) p.copy(stance);
        p.y = groundAt(state, p.x, p.z);
        // Squat once there (not while still walking up).
        const bend = progress < 0.3 ? ease((progress - 0.1) / 0.2) : 1 - liftT;
        hipL = hipR = -1.3 * bend; kneeL = kneeR = 1.9 * bend;
        lean = 0.75 * bend + 0.22 * Math.sin(Math.PI * liftT); bob = 0; riderOffset = -0.44 * bend;
        const endYaw = Math.atan2(-side * right.x, -side * right.z);
        state.rotY = walkK < 1 ? stepYaw(walkK, s.actionYaw, bike.actionOrigin, stance, endYaw) : endYaw;
        stride = walkK < 1 ? Math.sin(Math.PI * walkK) * Math.min(1, bike.actionOrigin.distanceTo(stance) / 0.4) * (1 - bend) : 0;
      } else {
        // Mount and dismount share one path; dismount (always right side) plays it backward.
        const k = mount ? progress : dismount ? 1 - progress : 1;
        const side = mount ? bike.actionSide : -1;
        // Overlapping phases make approach, leg lift, swing and sit one continuous motion.
        const sit = ease((k - 0.6) / 0.4);
        // Thighs straddle the seat with undersides on its top; torso leans far enough for straight-ish arms to reach the grips.
        hipL = hipR = -1.45 * sit; kneeL = kneeR = 1.92 * sit;
        const rideLean = 0.6 - 0.45 * s.reverseBlend;
        shL = shR = -1.05; elbow = -0.55; bob = 0;
        riderOffset = 0; straddle = sit;
        const lift = ease((k - 0.15) / 0.2) * (1 - ease((k - 0.7) / 0.25));
        const turn = ease((k - 0.3) / 0.5);
        // Lean forward as the leg rises (counterbalance), blending into the riding lean.
        lean = (mount || dismount) ? Math.max(0.35 * lift, rideLean * sit) : rideLean;
        const seatPosition = bike.pos.clone().addScaledVector(ahead, -0.27);
        if (mount || dismount) {
          const outLift = lift * (1 - turn), overLift = lift * turn;
          // Abduction raises the leg sideways with a soft knee; the sweep adds hip flexion so the foot clears the seat.
          const farHip = -0.45 * outLift - 1.9 * overLift;
          const farKnee = 0.95 * outLift + 0.45 * overLift;
          if (side > 0) { hipR += farHip; kneeR += farKnee; } else { hipL += farHip; kneeL += farKnee; }
          legSwing = side * (1.5 * outLift + 1.7 * overLift);
          // Planted leg: the foot stays where it stood while the hips slide across, so the thigh angles outward.
          const planted = Math.atan2(0.42 * turn, 0.9) * (1 - sit);
          plantSwing = side > 0 ? planted : -planted;
          const from = mount ? bike.actionOrigin : seatPosition.clone().addScaledVector(right, -0.75);
          const beside = seatPosition.clone().addScaledVector(right, side * 0.42);
          const walkK = Math.min(1, k / 0.3);
          const approach = ease(walkK);
          p.lerpVectors(from, beside, approach);
          p.lerp(seatPosition, turn);
          const faceYaw = Math.atan2(-side * right.x, -side * right.z);
          const d = Math.atan2(Math.sin(bike.yaw - faceYaw), Math.cos(bike.yaw - faceYaw));
          state.rotY = mount && walkK < 1 ? stepYaw(walkK, s.actionYaw, from, beside, faceYaw) : faceYaw + d * turn;
          stride = walkK < 1 ? Math.sin(Math.PI * walkK) * Math.min(1, from.distanceTo(beside) / 0.3) : 0;
        }
        else if (bike.riding) { p.copy(seatPosition); state.rotY = bike.yaw; }
      }
      if (stride > 0) {
        s.phase += dt * 10 * stride;
        const swing = Math.sin(s.phase) * 0.55 * stride, lift = 0.6 * stride;
        hipL -= swing; hipR += swing;
        kneeL += lift * Math.max(0, Math.cos(s.phase)); kneeR += lift * Math.max(0, -Math.cos(s.phase));
      }
    }
    if (state.bench) {
      const seat = BENCH_SEATS[state.bench.seat];
      if (seat) {
        const age = state.simulationTime - state.bench.startedAt;
        const t = Math.min(1, age / (state.bench.phase === "stand" ? BENCH_STAND_SECONDS : BENCH_SIT_SECONDS));
        const pose = benchPose(seat, state.bench.phase, t, state.bench.origin, state.bench.originYaw);
        p.x = pose.x; p.z = pose.z; state.rotY = pose.yaw;
        p.y = groundAt(state, p.x, p.z);
        const j = benchJoints(pose.seated);
        hipL = hipR = j.hip; kneeL = kneeR = j.knee;
        lean = j.lean; riderOffset = j.riderOffset;
        shL = shR = j.shoulder; elbow = j.elbow;
        sitHands = j.hands;
      }
    }
    if (script) {
      // Seated on a chair: thighs level on the seat, shins down; while shuffling in, only the lower legs step.
      const seated = script.sit;
      hipL = THREE.MathUtils.lerp(hipL, -1.57, seated); hipR = THREE.MathUtils.lerp(hipR, -1.57, seated);
      const shuffle = script.shuffle * Math.sin(state.simulationTime * 9) * 0.32;
      kneeL = THREE.MathUtils.lerp(kneeL, 1.57, seated) + shuffle; kneeR = THREE.MathUtils.lerp(kneeR, 1.57, seated) - shuffle;
      riderOffset = (CHAIR.seatTop + 0.077 - 0.95) * seated;
      lean = Math.max(lean * (1 - seated), script.lean); bob *= 1 - seated;
      if (seated > 0) { shL = shR = THREE.MathUtils.lerp(shL, -0.5, seated); elbow = THREE.MathUtils.lerp(elbow, -0.6, seated); }
    }
    if (root.current) {
      root.current.visible = !incapacitated;
      root.current.position.copy(p);
      root.current.position.y += collapse * 0.12;
      root.current.rotation.y = state.rotY;
      root.current.rotation.x = collapse * Math.PI / 2 + Math.sin(fall * Math.PI * 2) * 0.12;
      root.current.rotation.z = usingBike && !incapacitated && bike.action !== "pickup" ? bike.lean : collapse * 0.12;
    }
    // A scripted squat (taking a shopping basket off the pile) works the same way.
    const crouchNow = script?.crouch ? script.crouch : !script ? crouch : 0;
    if (crouchNow > 0 && !usingBike) {
      const crouch = crouchNow;
      // Down on the haunches: hips low, thighs forward, knees bent, leaning over the hands.
      hipL = THREE.MathUtils.lerp(hipL, -1.3, crouch); hipR = THREE.MathUtils.lerp(hipR, -1.3, crouch);
      kneeL = THREE.MathUtils.lerp(kneeL, 2.0, crouch); kneeR = THREE.MathUtils.lerp(kneeR, 2.0, crouch);
      bob = THREE.MathUtils.lerp(bob, -0.42, crouch); lean = Math.max(lean, 0.55 * crouch);
    }
    // In bed: sat on the edge, the legs up and straight, lying back flat (the whole body turns about the hips: the
    // legs stay level with the mattress as the back goes down).
    const bed = script?.bed;
    if (bed) {
      const sitK = bed.sit * (1 - bed.lie);
      hipL = hipR = -Math.PI / 2 * sitK;
      kneeL = 1.57 * bed.sit * (1 - bed.legL); kneeR = 1.57 * bed.sit * (1 - bed.legR);
      lean = script!.lean * (1 - bed.lie); bob = 0;
      riderOffset = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.95, BED_SIT_HIPS, bed.sit), BED_LIE_HIPS, bed.lie) - 0.95;
      shL = shR = THREE.MathUtils.lerp(shL, 0, bed.sit); elbow = THREE.MathUtils.lerp(elbow, -0.1, bed.sit);
    }
    // Each leg set outright (stepping high over something).
    const legs = script?.legs;
    if (legs) { hipL = legs.hipL; kneeL = legs.kneeL; hipR = legs.hipR; kneeR = legs.kneeR; bob = 0; }
    if (hips.current) { hips.current.position.y = 0.95 + bob + riderOffset; hips.current.rotation.x = bed ? -Math.PI / 2 * bed.lie : 0; }
    // Leaning in over the counter while reaching for food.
    if (grabbing && !script && !usingBike && !lowGrab) lean = Math.max(lean, 0.3 * grabReach(grabT));
    if (torso.current) torso.current.rotation.set(lean, s.reverseBlend * 0.65, 0);
    if (head.current) head.current.rotation.set(-lean * 0.5, s.reverseBlend * 1.05, 0);
    const splay = bed ? 0.15 : 1;
    thighL.current?.rotation.set(hipL, 0, (0.13 + Math.max(0, -legSwing) + Math.max(0, plantSwing) + 0.32 * straddle) * splay);
    thighR.current?.rotation.set(hipR, 0, (-0.13 - Math.max(0, legSwing) + Math.min(0, plantSwing) - 0.32 * straddle) * splay);
    shinL.current?.rotation.set(kneeL, 0, 0);
    shinR.current?.rotation.set(kneeR, 0, 0);
    armL.current?.rotation.set(shL, 0, (0.12 + air * 0.2) * (1 - sitHands) - 0.1 * sitHands);
    armR.current?.rotation.set(shR, 0, (-0.12 - air * 0.2) * (1 - sitHands) + 0.1 * sitHands);
    foreL.current?.rotation.set(elbow, 0, 0);
    foreR.current?.rotation.set(elbow, 0, 0);
    // Carrying food: the hand stays at the waist (the forearm bends to keep it there) while the upper arm swings
    // as usual and the other arm moves freely.
    const onFoot = !usingBike && !dead && !incapacitated && !sitting && !script;
    if (onFoot) {
      // Full packs ride at the waist; an empty one (or a number sign) just hangs from a relaxed arm.
      const heavy = (h: typeof state.hands.left) => !!h && h.kind !== "sign" && (h.items?.length ?? 1) > 0;
      if (heavy(state.hands.left) || grab?.hand === "left" || state.groceryBag) { armL.current?.rotation.set(shL, 0, 0.2); foreL.current?.rotation.set(carryElbow(shL), 0, 0); }
      // A thing from the inventory (or an emptied bottle) is carried the same way in the right hand.
      if (heavy(state.hands.right) || grab?.hand === "right" || state.heldSlot !== null || state.heldTrash || state.groceryBasket) { armR.current?.rotation.set(shR, 0, -0.2); foreR.current?.rotation.set(carryElbow(shR), 0, 0); }
      // The phone out: held up in front of the chest, the screen toward the face.
      if (state.phone.open && !state.hands.right && root.current) {
        root.current.updateMatrixWorld(true);
        const at = root.current.localToWorld(new THREE.Vector3(-0.08, 1.22, 0.34));
        reachArm(armR.current, foreR.current, at, POLES.low(-1), 1);
      }
      // Setting a thing down on the ground, or picking one up: the right hand goes down to it.
      if (invLow && inv?.target) {
        root.current?.updateMatrixWorld(true);
        // A bag of groceries is set down (and picked up) with the left hand; everything else with the right.
        const bag = inv.item === "groceryBag";
        const at = new THREE.Vector3(inv.target.x, groundAt(state, inv.target.x, inv.target.z) + (bag ? 0.38 : 0.2), inv.target.z);
        if (bag) reachArm(armL.current, foreL.current, at, POLES.low(1), dropReach(invT));
        else reachArm(armR.current, foreR.current, at, POLES.low(-1), dropReach(invT));
      }
      if (dropping && root.current) {
        // Each hand sets its food down on the ground beside the feet.
        root.current.updateMatrixWorld(true);
        const fx = Math.sin(state.rotY), fz = Math.cos(state.rotY), lx = Math.cos(state.rotY), lz = -Math.sin(state.rotY), floor = groundAt(state, p.x, p.z);
        for (const side of [1, -1] as const) {
          const held = side === 1 ? state.hands.left : state.hands.right;
          if (!held) continue;
          const at = new THREE.Vector3(p.x + fx * 0.36 + lx * side * 0.24, floor + PACK_SIZE[held.kind].grip, p.z + fz * 0.36 + lz * side * 0.24);
          if (side === 1) reachArm(armL.current, foreL.current, at, POLES.low(1), dropReach(dropT));
          else reachArm(armR.current, foreR.current, at, POLES.low(-1), dropReach(dropT));
        }
      }
    }
    if (usingBike && !incapacitated && root.current && torso.current) {
      const pickup = bike.action === "pickup";
      root.current.updateMatrixWorld(true);
      const gripWorld = (side: number) => {
        const grip = new THREE.Vector3(side * 0.34, 1.1, 0.46);
        if (pickup) {
          // Facing the bike, the hand toward its front takes the handlebar and the other the seat:
          // on the bike's left side the left hand holds the handle, on its right side the right hand.
          const frontHand = bike.actionSide;
          grip.set(0.22 * bike.actionSide, side === frontHand ? 1.08 : 0.82, side === frontHand ? 0.46 : -0.3);
        } else if (side === 1) {
          // Left hand follows a lifted arc to the pillion seat; right hand stays on its grip.
          grip.lerp(new THREE.Vector3(0.2, 0.85, -0.5), s.reverseBlend);
          grip.y += Math.sin(s.reverseBlend * Math.PI) * 0.18;
        }
        return grip.applyEuler(new THREE.Euler(0, bike.yaw, bike.lean, "YXZ")).add(bike.pos).add(new THREE.Vector3(0, 0.3 * Math.abs(bike.lean) / (Math.PI / 2), 0));
      };
      // After the bike settles upright, the arms let go and ease back down to rest.
      const pickupProgress = pickup ? Math.min(1, (state.simulationTime - bike.actionAt) / SCOOTER_PICKUP_SECONDS) : 0;
      const hold = pickup ? 1 - Math.max(0, Math.min(1, (pickupProgress - 0.88) / 0.12)) ** 2 : 1;
      const reach = (upper: THREE.Group | null, lower: THREE.Group | null, side: number) => {
        if (!upper || !lower) return;
        const parent = upper.parent;
        if (!parent) return;
        const restUpper = upper.quaternion.clone(), restLower = lower.quaternion.clone();
        const target = parent.worldToLocal(gripWorld(side));
        const delta = target.clone().sub(upper.position);
        const distance = Math.min(0.579, Math.max(0.08, delta.length()));
        const forward = delta.normalize();
        // Pickup bends the elbows out and back like a hard pull; riding keeps them low.
        const pole = pickup ? new THREE.Vector3(side * 0.6, 0.1, -0.5) : new THREE.Vector3(side * 0.4, -0.3, -0.3);
        pole.addScaledVector(forward, -pole.dot(forward)).normalize();
        const along = (0.3 * 0.3 - 0.28 * 0.28 + distance * distance) / (2 * distance);
        const height = Math.sqrt(Math.max(0, 0.3 * 0.3 - along * along));
        const elbowPoint = upper.position.clone().addScaledVector(forward, along).addScaledVector(pole, height);
        upper.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), elbowPoint.clone().sub(upper.position).normalize());
        const foreDirection = target.sub(elbowPoint).normalize().applyQuaternion(upper.quaternion.clone().invert());
        lower.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), foreDirection);
        if (hold < 1) { upper.quaternion.slerpQuaternions(restUpper, upper.quaternion.clone(), hold); lower.quaternion.slerpQuaternions(restLower, lower.quaternion.clone(), hold); }
      };
      reach(armL.current, foreL.current, 1); reach(armR.current, foreR.current, -1);
    }
    if (script && root.current) {
      root.current.updateMatrixWorld(true);
      if (script.left) reachArm(armL.current, foreL.current, script.left.at, POLES[script.left.pole](1), script.left.blend);
      if (script.right) reachArm(armR.current, foreR.current, script.right.at, POLES[script.right.pole](-1), script.right.blend);
    }
    // Reaching for food (to pick it up, or to set it down on a table or beside the bench), standing or seated:
    // up until the hand gets there, then back, in one movement.
    const putting = state.put, putT = putting ? state.simulationTime - putting.at : Infinity;
    const reachFor = grabbing && grab ? { hand: grab.hand, at: grab.target, k: grabReach(grabT) } : putting && putT < GRAB_TIME ? { hand: putting.hand, at: putting.target, k: grabReach(putT) } : null;
    if (reachFor && !usingBike && !dead && !incapacitated && root.current) {
      root.current.updateMatrixWorld(true);
      if (reachFor.hand === "left") reachArm(armL.current, foreL.current, reachFor.at, POLES.low(1), reachFor.k);
      else reachArm(armR.current, foreR.current, reachFor.at, POLES.low(-1), reachFor.k);
    }
    // Eating and drinking (at a table or on a bench): the right hand brings the food up to the mouth for each bite;
    // a drink is lifted once and sipped with the head tipped back.
    // (Eating or drinking a thing from the inventory works the same way, over its own time.)
    const invUse = inv && (inv.kind === "eat" || inv.kind === "drink") ? { at: inv.at, drink: inv.kind === "drink", T: USE_SECONDS } : null;
    const eat = state.eating ? { at: state.eating.at, drink: state.eating.drink, T: EAT_SECONDS } : invUse;
    if (eat && !dead && !incapacitated && root.current && head.current) {
      const t = state.simulationTime - eat.at, T = eat.T;
      let up = 0, tip = 0;
      if (eat.drink) { up = Math.min(smoothstep(t / 0.6), 1 - smoothstep((t - (T - 0.6)) / 0.6)); tip = up * Math.min(1, Math.max(0, (t - 0.5) / 0.5)); }
      else { const bite = T / 3, u = (t % bite) / bite; up = u < 0.35 ? smoothstep(u / 0.35) : u < 0.6 ? 1 : 1 - smoothstep((u - 0.6) / 0.4); }
      head.current.rotation.x -= 0.32 * tip;
      root.current.updateMatrixWorld(true);
      const mouth = head.current.localToWorld(new THREE.Vector3(0, -0.06, 0.16 + 0.04 * tip));
      reachArm(armR.current, foreR.current, mouth, POLES.low(-1), up);
    }

  });

  return <CharacterBody rig={rig} color={color} />;
}
