import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { FINE, LAW_ENABLED, SPEED_LIMIT_MPH, newWatch, watchRider } from "./law";
import { addFine } from "./life";
import { SHOPS, SHOP_REACH, shopPlaces } from "./shops";
import { Storefronts } from "./Storefronts";
import * as THREE from "three";
import { SIDEWALK_H, floorHeight, timeInfo } from "./config";
import { InteractionPrompt } from "./InteractionPrompt";
import { STOP_REACH, jobInteract, nearBuskSpot, startBusking, stopBusking } from "./jobs";
import { skillLevel } from "./life";
import { guideDone, lifeEvent, stepLife } from "./lifeRuntime";
import { ATMS, ATM_REACH, ATM_SIZE, BUSK_SPOT, doorOf, homeBuilding } from "./places";
import { toast, type GameState } from "./state";

const near = (state: GameState, x: number, z: number, r: number) => Math.hypot(state.pos.x - x, state.pos.z - z) < r;

/** Where the player's rented home's front door is (null without one). */
export function homeDoor(state: GameState) {
  const home = state.life.home;
  if (!home) return null;
  const b = homeBuilding(state.worldSeed, home.kind);
  return b ? doorOf(b) : null;
}

/**
 * Life in the world: ATMs, the busking spot, the GPS beacon, the parcel in hand, the home's door; and every frame
 * the daily roll-over, distances for goals and skills, busking tips, and E at any of these places.
 */
export function LifeWorld({ state }: { state: GameState }) {
  const last = useRef<{ x: number; z: number } | null>(null);
  const sat = useRef(false);
  const door = useRef<ReturnType<typeof homeDoor>>(null);
  const doorKey = useRef("");
  const sky = useRef<string | null>(null);
  const law = useRef(newWatch());
  const shops = useMemo(() => shopPlaces(state.worldSeed), [state.worldSeed]);
  const t = useMemo(() => ({ v: new THREE.Vector3(), f: new THREE.Vector3(), r: new THREE.Vector3() }), []);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1), p = state.pos;
    // The home's door is looked up only when the home changes.
    const key = state.life.home ? `${state.life.home.kind}` : "";
    if (key !== doorKey.current) { doorKey.current = key; door.current = homeDoor(state); }

    // ---- distances walked and ridden (for goals and skills) ----
    const prev = last.current;
    let walked = 0, ridden = 0;
    if (prev && !state.home) {
      const d = Math.hypot(p.x - prev.x, p.z - prev.z);
      if (d < 5) { if (state.scooter.riding) ridden = d; else if (!state.script && !state.accident) walked = d; }
    }
    last.current = { x: p.x, z: p.z };
    // A marked place (not a job's stop, which the job clears) is done with once you're there.
    const w = state.waypoint;
    if (w && !state.job && w.label !== "Busking spot" && Math.hypot(w.x - p.x, w.z - p.z) < 3) { state.waypoint = null; toast(state, `You've arrived: ${w.label}`, "info"); }

    // ---- traffic law: speeding and red lights on the bike ----
    if (LAW_ENABLED && state.scooter.riding && prev && dt > 0 && !state.accident) {
      const ticket = watchRider(law.current, state.simulationTime, dt, p.x, p.z, (p.x - prev.x) / dt, (p.z - prev.z) / dt, state.elapsed);
      if (ticket) {
        const day = timeInfo(state.elapsed).day, amount = FINE[ticket.kind];
        const reason = ticket.kind === "speeding" ? `Speeding (${Math.round(ticket.mph)} in a ${SPEED_LIMIT_MPH})` : "Ran a red light";
        addFine(state.life, day, reason, amount);
        toast(state, `Ticket: $${amount}`, "ticket", `${reason}. Pay at the police station or in the Bank app within 3 days.`);
      }
    } else law.current.over = 0;
    // A word when the weather turns (not for the weather already there when the game starts).
    const kind = state.weather.kind;
    if (sky.current !== null && kind !== sky.current) {
      const say = { rain: ["It's starting to rain", "Find some shelter, or enjoy it."], fog: ["Fog is rolling in", "It's hard to see far."], cloudy: ["Clouds are coming over", ""], clear: ["The sky is clearing", ""] }[kind];
      toast(state, say[0]!, "info", say[1] || undefined);
    }
    sky.current = kind;
    stepLife(state, dt, { walked, ridden, ran: state.keys.has("ShiftLeft") || state.keys.has("ShiftRight") || (state.stick ? Math.hypot(state.stick.x, state.stick.y) > 0.92 : false) });

    // ---- sitting in the park counts for today's goal ----
    const seated = state.bench?.phase === "seated";
    if (seated && !sat.current) lifeEvent(state, "park", 1);
    sat.current = seated;

    // ---- busking: the pose, and tips from people passing ----
    const b = state.busking;
    if (b) {
      if (state.keys.size > 0 || (state.stick && Math.hypot(state.stick.x, state.stick.y) > 0.2) || state.accident || !nearBuskSpot(state)) { stopBusking(state); }
      else {
        const now = state.simulationTime, yaw = state.rotY;
        t.f.set(Math.sin(yaw), 0, Math.cos(yaw)); t.r.set(Math.cos(yaw), 0, -Math.sin(yaw));
        const strum = Math.sin(now * 11) * 0.07;
        state.foodScript = {
          x: p.x, z: p.z, yaw, walk: 0, sit: 0, shuffle: 0, lean: 0.04,
          right: { at: new THREE.Vector3(p.x, p.y + 1.08 + strum, p.z).addScaledVector(t.f, 0.32).addScaledVector(t.r, -0.08), blend: 1, pole: "low" },
          left: { at: new THREE.Vector3(p.x, p.y + 1.28, p.z).addScaledVector(t.f, 0.42).addScaledVector(t.r, 0.38), blend: 1, pole: "out" },
        };
        if (now >= b.nextTip) {
          b.nextTip = now + 4 + Math.random() * 7;
          const audience = state.npcs.filter((n) => !n.down && Math.hypot(n.x - p.x, n.z - p.z) < 14).length + state.others.filter((o) => Math.hypot(o.x - p.x, o.z - p.z) < 14).length;
          if (audience > 0 && Math.random() < Math.min(0.85, 0.3 + audience * 0.12)) {
            const tip = Math.round((0.5 + Math.random() * 2.5) * (1 + skillLevel(state.life.skills.charm) * 0.1) * 100) / 100;
            b.tips += tip; state.cash = Math.round((state.cash + tip) * 100) / 100;
            toast(state, `+$${tip.toFixed(2)} tip`, "money");
          }
        }
      }
    }

    // ---- E at one of life's places (before benches and the bike take it) ----
    if (!state.interactQueued || state.accident || state.health <= 0 || state.scooter.riding && !state.job) return;
    if (state.job && jobInteract(state)) { state.interactQueued = false; return; }
    if (state.busking) { state.interactQueued = false; stopBusking(state); return; }
    if (!state.scooter.riding) {
      const atm = ATMS.find((a) => near(state, a.x, a.z, ATM_REACH));
      if (atm) {
        state.interactQueued = false;
        state.phone = { open: true, app: "bank", atm: true };
        lifeEvent(state, "atm", 1); guideDone(state, 1);
        return;
      }
      if (nearBuskSpot(state) && !state.job && !state.bench) { state.interactQueued = false; startBusking(state); return; }
      const shop = shops.find((sh) => near(state, sh.door.x, sh.door.z, SHOP_REACH));
      if (shop) { state.interactQueued = false; state.shop = shop.kind; state.keys.clear(); return; }
      const d = door.current;
      if (d && near(state, d.x, d.z, 1.8) && !state.job) {
        state.interactQueued = false;
        state.home = { returnTo: [d.x, d.z], returnYaw: d.yaw };
        state.keys.clear();
        return;
      }
    }
  }, -0.6);

  return <>
    <Atms />
    <Storefronts shops={shops} />
    <BuskSpot />
    <HomeMarker state={state} door={door} />
    <Beacon state={state} />
    <Parcel state={state} />
    <Guitar state={state} />
    <InteractionPrompt sample={() => {
      const p = state.pos, hide = state.accident || state.health <= 0 || state.home || state.bench || state.script && !state.busking;
      const job = state.job;
      if (!hide && job) { const s = job.stage === "pickup" ? job.from : job.to; if (Math.hypot(s[0] - p.x, s[1] - p.z) < STOP_REACH) return { visible: true, x: s[0], y: 1.9, z: s[1], time: state.simulationTime, label: job.stage === "pickup" ? "E  PICK UP" : "E  DELIVER" }; }
      if (hide || state.scooter.riding) return { visible: false, x: 0, y: 0, z: 0, time: 0 };
      const atm = ATMS.find((a) => near(state, a.x, a.z, ATM_REACH));
      if (atm) return { visible: true, x: atm.x, y: 2.2, z: atm.z, time: state.simulationTime, label: "E  ATM" };
      if (nearBuskSpot(state) && !state.job) return { visible: true, x: BUSK_SPOT.x, y: 2.1, z: BUSK_SPOT.z, time: state.simulationTime, label: state.busking ? "E  STOP" : "E  PLAY" };
      const shop = !hide && !state.scooter.riding ? shops.find((sh) => near(state, sh.door.x, sh.door.z, SHOP_REACH)) : undefined;
      if (shop && !state.shop) return { visible: true, x: shop.door.x, y: 2.4, z: shop.door.z, time: state.simulationTime, label: `E  ${SHOPS[shop.kind].name.toUpperCase()}` };
      const d = door.current;
      if (d && near(state, d.x, d.z, 1.8)) return { visible: true, x: d.x, y: 2.4, z: d.z, time: state.simulationTime, label: "E  HOME" };
      return { visible: false, x: 0, y: 0, z: 0, time: 0 };
    }} />
  </>;
}

/** Cash machines: a steel box with a lit screen, keypad and the bank's blue band. */
function Atms() {
  const m = useMemo(() => ({
    body: new THREE.MeshStandardMaterial({ color: "#c9ced3", metalness: 0.6, roughness: 0.35 }),
    band: new THREE.MeshStandardMaterial({ color: "#1f5fbf", roughness: 0.5, emissive: new THREE.Color("#1f5fbf"), emissiveIntensity: 0.35 }),
    screen: new THREE.MeshStandardMaterial({ color: "#0a2a4a", emissive: new THREE.Color("#4fb3ff"), emissiveIntensity: 0.9, roughness: 0.2 }),
    keys: new THREE.MeshStandardMaterial({ color: "#2b2f33", roughness: 0.6 }),
  }), []);
  return <>{ATMS.map((a, i) => (
    <group key={i} position={[a.x, floorHeight(a.x, a.z), a.z]} rotation-y={a.yaw}>
      <mesh material={m.body} position-y={ATM_SIZE.h / 2} castShadow receiveShadow><boxGeometry args={[ATM_SIZE.w, ATM_SIZE.h, ATM_SIZE.d]} /></mesh>
      <mesh material={m.band} position={[0, ATM_SIZE.h - 0.12, 0.001]}><boxGeometry args={[ATM_SIZE.w + 0.02, 0.2, ATM_SIZE.d + 0.02]} /></mesh>
      <mesh material={m.screen} position={[0, 1.3, ATM_SIZE.d / 2 + 0.005]} rotation-x={-0.25}><planeGeometry args={[0.42, 0.3]} /></mesh>
      <mesh material={m.keys} position={[0, 1.0, ATM_SIZE.d / 2 + 0.04]} rotation-x={-0.9}><boxGeometry args={[0.36, 0.2, 0.05]} /></mesh>
    </group>
  ))}</>;
}

/** The busking spot: a painted ring and a little chalkboard sign. */
function BuskSpot() {
  const m = useMemo(() => ({
    paint: new THREE.MeshStandardMaterial({ color: "#ffd166", roughness: 0.8, transparent: true, opacity: 0.85 }),
    board: new THREE.MeshStandardMaterial({ map: chalkboard(), roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ color: "#6b4a2f", roughness: 0.8 }),
  }), []);
  return <group position={[BUSK_SPOT.x, SIDEWALK_H + 0.012, BUSK_SPOT.z]}>
    <mesh material={m.paint} rotation-x={-Math.PI / 2}><ringGeometry args={[BUSK_SPOT.r - 0.08, BUSK_SPOT.r, 48]} /></mesh>
    <group position={[BUSK_SPOT.r + 0.5, 0, 0]} rotation-y={-Math.PI / 2}>
      <mesh material={m.board} position-y={0.75}><boxGeometry args={[0.55, 0.7, 0.03]} /></mesh>
      {[-0.22, 0.22].map((x) => <mesh key={x} material={m.wood} position={[x, 0.45, -0.04]} rotation-x={0.2}><boxGeometry args={[0.04, 0.9, 0.04]} /></mesh>)}
    </group>
  </group>;
}
function chalkboard() {
  const c = document.createElement("canvas"); c.width = 256; c.height = 320;
  const g = c.getContext("2d")!;
  g.fillStyle = "#26302b"; g.fillRect(0, 0, 256, 320);
  g.strokeStyle = "#8b6a45"; g.lineWidth = 16; g.strokeRect(0, 0, 256, 320);
  g.fillStyle = "#f4f1e8"; g.textAlign = "center"; g.font = "700 40px Manrope, sans-serif";
  g.fillText("LIVE", 128, 100); g.fillText("MUSIC", 128, 150);
  g.font = "400 26px Manrope, sans-serif"; g.fillText("tips welcome ♪", 128, 230);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** A soft glowing frame over the home's door, and a little "HOME" plate. */
function HomeMarker({ state, door }: { state: GameState; door: React.RefObject<ReturnType<typeof homeDoor>> }) {
  const g = useRef<THREE.Group>(null);
  const m = useMemo(() => new THREE.MeshBasicMaterial({ color: "#8fd3ff", transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }), []);
  useFrame(() => {
    const d = door.current, el = g.current;
    if (!el) return;
    el.visible = !!d && !state.home;
    if (!d) return;
    el.position.set(d.x, floorHeight(d.x, d.z), d.z); el.rotation.y = d.yaw;
    m.opacity = 0.35 + Math.sin(state.simulationTime * 2) * 0.15;
  });
  return <group ref={g} visible={false}>
    <mesh material={m} position-y={0.02} rotation-x={-Math.PI / 2}><ringGeometry args={[0.7, 0.85, 40]} /></mesh>
  </group>;
}

/** The GPS beacon: a tall soft column of light and a pulsing ring where the player is headed. */
function Beacon({ state }: { state: GameState }) {
  const g = useRef<THREE.Group>(null), ring = useRef<THREE.Mesh>(null);
  const m = useMemo(() => ({
    beam: new THREE.MeshBasicMaterial({ color: "#5ec8ff", transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
    ring: new THREE.MeshBasicMaterial({ color: "#5ec8ff", transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }),
  }), []);
  useFrame(() => {
    const w = state.waypoint, el = g.current;
    if (!el) return;
    el.visible = !!w && !state.home;
    if (!w) return;
    el.position.set(w.x, floorHeight(w.x, w.z) + 0.03, w.z);
    const k = (state.simulationTime * 0.7) % 1;
    ring.current?.scale.setScalar(0.6 + k * 1.2);
    m.ring.opacity = 0.8 * (1 - k);
    // Fainter when right there (it would only get in the way).
    const d = Math.hypot(w.x - state.pos.x, w.z - state.pos.z);
    m.beam.opacity = Math.min(0.28, d / 40);
  });
  return <group ref={g} visible={false}>
    <mesh material={m.beam} position-y={20}><cylinderGeometry args={[0.6, 0.6, 40, 16, 1, true]} /></mesh>
    <mesh ref={ring} material={m.ring} rotation-x={-Math.PI / 2}><ringGeometry args={[0.85, 1.0, 40]} /></mesh>
  </group>;
}

/** The parcel (or take-out bag) in the right hand while delivering. */
function Parcel({ state }: { state: GameState }) {
  const box = useRef<THREE.Mesh>(null);
  const m = useMemo(() => ({ parcel: new THREE.MeshStandardMaterial({ color: "#b98a53", roughness: 0.9 }), bag: new THREE.MeshStandardMaterial({ color: "#c8a165", roughness: 0.9 }) }), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const el = box.current, job = state.job;
    if (!el) return;
    el.visible = !!job && job.stage === "deliver" && !state.home && !state.accident;
    if (!el.visible || !job) return;
    const fore = state.avatar.body[11];
    if (!fore) { el.visible = false; return; }
    fore.updateWorldMatrix(true, false); fore.localToWorld(v.set(0, -0.3, 0));
    el.material = job.id === "delivery" ? m.bag : m.parcel;
    el.position.set(v.x, v.y - 0.12, v.z); el.rotation.set(0, state.rotY, 0);
  });
  return <mesh ref={box} visible={false} castShadow><boxGeometry args={[0.3, 0.22, 0.24]} /></mesh>;
}

/** A guitar held across the body while busking. */
function Guitar({ state }: { state: GameState }) {
  const g = useRef<THREE.Group>(null);
  const m = useMemo(() => ({ body: new THREE.MeshStandardMaterial({ color: "#b5651d", roughness: 0.5 }), neck: new THREE.MeshStandardMaterial({ color: "#3b2a1a", roughness: 0.6 }), hole: new THREE.MeshStandardMaterial({ color: "#1a120b" }) }), []);
  useFrame(() => {
    const el = g.current;
    if (!el) return;
    el.visible = !!state.busking;
    if (!state.busking) return;
    const p = state.pos, yaw = state.rotY;
    el.position.set(p.x + Math.sin(yaw) * 0.28, p.y + 1.1, p.z + Math.cos(yaw) * 0.28);
    el.rotation.set(0, yaw, 0);
  });
  return <group ref={g} visible={false}>
    <group rotation-z={-0.9}>
      <mesh material={m.body} scale={[0.22, 0.28, 0.08]}><sphereGeometry args={[1, 16, 12]} /></mesh>
      <mesh material={m.hole} position={[0, 0.03, 0.081]}><circleGeometry args={[0.06, 16]} /></mesh>
      <mesh material={m.neck} position={[0, 0.5, 0]}><boxGeometry args={[0.06, 0.55, 0.03]} /></mesh>
    </group>
  </group>;
}

void timeInfo;
