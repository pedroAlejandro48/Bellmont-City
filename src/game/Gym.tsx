// The gym's workout while playing (see gym.ts): the player put straight onto each machine in turn — the bench, the
// dumbbells, the pull-up bar, the treadmill — 3 s each, the view held on them, then back in front of the desk (a
// free spot by it) with the session's reward. Also draws what moves with whoever's working out here, this player
// or others in the room: the barbell (in its rack, or in the hands on the bench), a dumbbell in each hand at the
// rack, the treadmill's belt running.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { serverNow } from "@/lib/serverTime";
import { RENDER_DELAY_MS } from "@/multiplayer/pose";
import { handWorld } from "./arms";
import { BODY_PARTS, type BodyRig } from "./CharacterBody";
import { SIDEWALK_H, timeInfo, type City } from "./config";
import { BENCH, BELT_Y, STAGE_MS, WORKOUT_MS, canStart, freeSpotNear, stageAt, stations, type Stage } from "./gym";
import { gainSkill, gainXp } from "./life";
import { toLocal, toWorld, worldYaw } from "./restaurantRoom";
import { toast, type GameState } from "./state";
import { venueLayout } from "./venueRoom";

/** Starts a workout here now (the panel closes). */
export function startWorkout(state: GameState, key: string) {
  state.workout = { key, start: serverNow() };
  state.shop = null;
}
/** Whether a workout can start in this gym now: nobody else here still on the first exercise. */
export function gymFree(state: GameState, key: string) {
  return canStart(state.gymPeers.filter((p) => p.key === key), serverNow());
}

type Doer = { stage: Stage; t: number; fore: [THREE.Object3D | null, THREE.Object3D | null] };

export function Gym({ state, city }: { state: GameState; city: City }) {
  const b = useMemo(() => city.buildings.find((x) => x.venue === "gym"), [city]);
  const layout = useMemo(() => (b ? venueLayout(b) : null), [b]);
  const st = useMemo(() => (layout ? stations(layout) : null), [layout]);
  const bar = useRef<THREE.Group>(null), bells = useRef<(THREE.Group | null)[]>([]), slats = useRef<THREE.Group>(null), all = useRef<THREE.Group>(null);
  const belt = useRef(0), own = useRef(false);
  const v = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), q: new THREE.Quaternion(), x: new THREE.Vector3(1, 0, 0) }), []);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1);
    if (!layout || !st) return;
    const f = layout.frame, key = layout.key, now = serverNow();
    const w = state.workout?.key === key ? state.workout : null;

    // ---- this player's workout ----
    const stage = w ? stageAt(now - w.start) : null;
    if (w && (state.health <= 0 || state.accident)) { state.workout = null; release(); }
    else if (w && stage) {
      const s = st[stage.stage], [x, z] = toWorld(f, s.x, s.z), yaw = worldYaw(f, s.yaw);
      state.foodScript = { x, z, yaw, walk: 0, sit: 0, shuffle: 0, lean: 0, left: null, right: null }; own.current = true;
      state.stick = null; state.jumpQueued = false; state.keys.clear();
      // The view held on the machine (snapped: it changes with the machine, in a blink).
      const cam = view(stage.stage, s), [cx, cz] = toWorld(f, cam.pos[0], cam.pos[2]), [ax, az] = toWorld(f, cam.at[0], cam.at[2]);
      state.camLock = { pos: [cx, SIDEWALK_H + cam.pos[1], cz], at: [ax, SIDEWALK_H + cam.at[1], az], snap: true, by: "gym" };
    } else if (w && now - w.start >= WORKOUT_MS) finish();
    else if (own.current) release();

    // ---- what moves with whoever's working out here ----
    const near = Math.hypot(state.pos.x - f.ox, state.pos.z - f.oz) < 45;
    if (all.current) all.current.visible = near;
    if (!near) return;
    const doers: Doer[] = [];
    const mine = state.avatar.body, fi = (p: string) => BODY_PARTS.indexOf(p as (typeof BODY_PARTS)[number]);
    if (stage) doers.push({ ...stage, fore: [mine[fi("foreL")] ?? null, mine[fi("foreR")] ?? null] });
    for (const p of state.gymPeers) {
      if (p.key !== key) continue;
      // (Their body is drawn a little in the past: the gear follows the same moment.)
      const s = stageAt(now - p.start - RENDER_DELAY_MS), rig = state.remoteRigs.get(p.id) as BodyRig | undefined;
      if (s && rig) doers.push({ ...s, fore: [rig.foreL.current, rig.foreR.current] });
    }
    // The barbell: in the hands of whoever's on the bench, else in its rack.
    const benching = doers.find((d) => d.stage === "bench");
    const g = bar.current;
    if (g) {
      if (benching && benching.fore[0] && benching.fore[1]) {
        handWorld(benching.fore[0], v.a); handWorld(benching.fore[1], v.b);
        g.position.addVectors(v.a, v.b).multiplyScalar(0.5);
        g.quaternion.setFromUnitVectors(v.x, v.a.sub(v.b).normalize());
      } else {
        const bf = st.bench.fixture, c = Math.cos(bf.rot), s = Math.sin(bf.rot);
        const [x, z] = toWorld(f, bf.x + BENCH.rackZ * s, bf.z + BENCH.rackZ * c);
        g.position.set(x, SIDEWALK_H + BENCH.rackY + 0.035, z); g.rotation.set(0, worldYaw(f, bf.rot), 0);
      }
    }
    // Dumbbells: one in each hand of everyone curling.
    let n = 0;
    for (const d of doers) {
      if (d.stage !== "curls") continue;
      for (const fore of d.fore) {
        const m = bells.current[n];
        if (!m || !fore) continue;
        m.visible = true; handWorld(fore, m.position); fore.getWorldQuaternion(m.quaternion); n++;
      }
    }
    for (let i = n; i < bells.current.length; i++) { const m = bells.current[i]; if (m) m.visible = false; }
    // The treadmill's belt runs while someone's on it.
    const running = doers.some((d) => d.stage === "treadmill");
    if (running) belt.current = (belt.current + dt * 3.4) % SLAT_GAP;
    if (slats.current) {
      const tf = st.treadmill.fixture, [x, z] = toWorld(f, tf.x, tf.z);
      slats.current.position.set(x, SIDEWALK_H, z); slats.current.rotation.y = worldYaw(f, tf.rot);
      slats.current.children.forEach((c, i) => { c.position.z = -BELT_L / 2 + ((i * SLAT_GAP + belt.current) % BELT_L) + 0.1; });
    }
  }, -0.64);

  /** Lets go of the player (and the view) without finishing. */
  function release() {
    if (own.current) { state.foodScript = null; own.current = false; }
    if (state.camLock?.by === "gym") { state.camLock = null; state.camSnapBack = true; }
  }
  /** The workout's over: back in front of the desk (somewhere nobody's standing), the reward and the toast. */
  function finish() {
    if (!layout) return;
    const f = layout.frame, sv = layout.service;
    const people = [...state.others, ...state.staffBodies].map((p) => { const [x, z] = toLocal(f, p.x, p.z); return { x, z, r: p.r }; });
    const [lx, lz] = freeSpotNear(sv.x, sv.z, people, layout.solids, layout.bounds), [x, z] = toWorld(f, lx, lz);
    release();
    state.workout = null;
    state.pos.set(x, SIDEWALK_H, z); state.rotY = worldYaw(f, sv.yaw);
    // (The view straight back behind the player.)
    state.camOrbit = 0; state.camYaw = state.rotY + Math.PI; state.camPitch = 0.22;
    const life = state.life;
    life.workoutDay = timeInfo(state.elapsed).day; gainSkill(life, "fitness", 60);
    const up = gainXp(life, 20); if (up) toast(state, `Level ${up}!`, "level");
    state.hunger = Math.max(0, state.hunger - 8); state.thirst = Math.max(0, state.thirst - 12);
    toast(state, "Great workout!", "info", "+60 fitness · +20 XP. You're hungry and thirsty now.");
  }

  if (import.meta.env["VITE_TRAFFIC_AUDIT"] === "1" && layout) (window as unknown as { __gym?: unknown }).__gym = { key: layout.key, service: toWorld(layout.frame, layout.service.x, layout.service.z) };
  if (!layout || !st) return null;
  return <group ref={all}>
    <group ref={bar}><Barbell /></group>
    {Array.from({ length: 6 }, (_, i) => <group key={i} ref={(g) => { bells.current[i] = g; }} visible={false}><Dumbbell /></group>)}
    <group ref={slats}>{Array.from({ length: SLATS }, (_, i) => <mesh key={i} position={[0, BELT_Y + 0.003, 0]} rotation-x={-Math.PI / 2} material={gearMats().slat}><planeGeometry args={[0.6, 0.035]} /></mesh>)}</group>
  </group>;
}

/** The treadmill's belt: its running length (the fixture's, less its ends), and the marks drawn on it. */
const BELT_L = 1.4, SLATS = 7, SLAT_GAP = BELT_L / SLATS;

/** Where the camera's held for each machine (room frame, height above the floor), looking at the body. */
function view(stage: Stage, s: { x: number; z: number; yaw: number; fixture: { x: number; z: number; rot: number } }) {
  const fx = s.fixture, c = Math.cos(fx.rot), sn = Math.sin(fx.rot);
  const local = (lx: number, lz: number): [number, number] => [fx.x + lx * c + lz * sn, fx.z - lx * sn + lz * c];
  // (From whichever side of the machine faces the middle of the room.)
  const side = (lx: number, lz: number) => { const [ax, az] = local(lx, lz), [bx, bz] = local(-lx, lz); return Math.hypot(ax, az + 6) < Math.hypot(bx, bz + 6) ? 1 : -1; };
  const at = (lx: number, ly: number, lz: number, tx: number, ty: number, tz: number) => {
    const [px, pz] = local(lx, lz), [qx, qz] = local(tx, tz);
    return { pos: [px, ly, pz] as [number, number, number], at: [qx, ty, qz] as [number, number, number] };
  };
  if (stage === "bench") { const k = side(2.3, 0.6); return at(k * 2.3, 1.6, 0.9, 0, 0.55, -0.05); }
  if (stage === "curls") return at(1.5, 1.6, 1.25 + 2.9, 0, 0.95, 1.25);
  if (stage === "pullup") return at(2.0, 1.7, 2.5, 0, 1.55, 0);
  const k = side(2.4, -0.6);
  return at(k * 2.4, 1.6, -1.1, 0, 1.0, 0.15);
}

let mats: { steel: THREE.Material; plate: THREE.Material; grip: THREE.Material; slat: THREE.Material } | null = null;
function gearMats() {
  return mats ??= {
    steel: new THREE.MeshStandardMaterial({ color: "#c9ccd2", metalness: 0.85, roughness: 0.28 }),
    plate: new THREE.MeshStandardMaterial({ color: "#1d1e22", roughness: 0.55, metalness: 0.2 }),
    grip: new THREE.MeshStandardMaterial({ color: "#3a3c42", roughness: 0.8 }),
    slat: new THREE.MeshStandardMaterial({ color: "#2a2b30", roughness: 0.9 }),
  };
}

/** An Olympic bar with one plate each side (its axis along x, centred). */
function Barbell() {
  const m = gearMats();
  return <group>
    <mesh rotation-z={Math.PI / 2} material={m.steel} castShadow><cylinderGeometry args={[0.014, 0.014, 1.3, 10]} /></mesh>
    {[-1, 1].map((s) => <group key={s}>
      <mesh position={[s * 0.81, 0, 0]} rotation-z={Math.PI / 2} material={m.steel}><cylinderGeometry args={[0.025, 0.025, 0.36, 12]} /></mesh>
      <mesh position={[s * 0.66, 0, 0]} rotation-z={Math.PI / 2} material={m.steel}><cylinderGeometry args={[0.04, 0.04, 0.03, 14]} /></mesh>
      <mesh position={[s * 0.71, 0, 0]} rotation-z={Math.PI / 2} material={m.plate} castShadow><cylinderGeometry args={[0.215, 0.215, 0.05, 28]} /></mesh>
      <mesh position={[s * 0.745, 0, 0]} rotation-z={Math.PI / 2} material={m.steel}><cylinderGeometry args={[0.035, 0.035, 0.02, 12]} /></mesh>
    </group>)}
  </group>;
}
/** A dumbbell as held: the handle across the hand (its forearm's x), a plate either side. */
function Dumbbell() {
  const m = gearMats();
  return <group>
    <mesh rotation-z={Math.PI / 2} material={m.grip}><cylinderGeometry args={[0.016, 0.016, 0.13, 10]} /></mesh>
    {[-1, 1].map((s) => <mesh key={s} position={[s * 0.1, 0, 0]} rotation-z={Math.PI / 2} material={m.plate} castShadow><cylinderGeometry args={[0.052, 0.052, 0.07, 14]} /></mesh>)}
  </group>;
}

// (Kept for the stage length in tests.)
export const GYM_STAGE_MS = STAGE_MS;
