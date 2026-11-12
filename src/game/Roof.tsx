// Up to the roof of an apartment building and down again (see roof.ts): E at the ladder on the top floor climbs it
// (the camera behind and under the climber, following up the ladder, back to its place before the top), E at the
// hatch on the roof climbs down (turned round first; the camera above, following down through the hatch). The roof
// is a place to walk about: walk into the hatch and you fall through it (hurt, down, up again); walk off the edge
// and you fall all the way down.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { APT_FLOORS, aptKey, floorKey, floorY } from "./apartments";
import { facesAt } from "./Apartments";
import type { Building, City } from "./config";
import { handsBusy, needFreeHands } from "./handsHeld";
import { InteractionPrompt } from "./InteractionPrompt";
import { toLocal, toWorld, worldYaw, type Room } from "./restaurantRoom";
import { BULK_H, CLIMB, climbPose, inHatch, onRoof, ROOF_FLOOR, roofPlan, roofY, type RoofPlan } from "./roof";
import { fallHurt, FALL_STOREY } from "./roofFall";
import type { GameState, Script } from "./state";
import { venueLayout } from "./venueRoom";

/** Getting to the ladder (and turned to it) before the climb itself. */
const APPROACH = 0.9;
/** The camera's own view lets go this long before the climb ends (it eases back behind in that time). */
const CAM_BACK = 1.3;
const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

export function RoofAccess({ state, city }: { state: GameState; city: City }) {
  const byKey = useMemo(() => new Map(city.buildings.filter((b) => b.venue === "apartments").map((b) => [aptKey(b), b])), [city]);
  const plans = useRef(new Map<string, { plan: RoofPlan; room: Room & { roof: true; walls: [] } }>());
  const prompt = useRef<{ visible: boolean; x: number; y: number; z: number; label?: string }>({ visible: false, x: 0, y: 0, z: 0 });
  const from = useRef<{ x: number; z: number; yaw: number } | null>(null);
  const own = useRef(false);
  /** The roof room's light (always there; on while you're up there or on its ladder). */
  const lamp = useRef<THREE.PointLight>(null);
  const of = (b: Building) => {
    const k = aptKey(b);
    let p = plans.current.get(k);
    if (!p) {
      const plan = roofPlan(b), L = venueLayout(b), e = plan.edge, M = 3;
      // The roof as a room: its little room's walls; room to walk right off its edge.
      const room = { ...L, key: floorKey(b, ROOF_FLOOR), items: [], doors: { left: 0, right: 0 }, solids: plan.solids, walls: [] as [], roof: true as const, bulk: plan.bulk, bulkH: BULK_H, bounds: { minX: e.minX - M, maxX: e.maxX + M, minZ: e.minZ - M, maxZ: e.maxZ + M } };
      p = { plan, room };
      plans.current.set(k, p);
    }
    if (!state.rooms.has(p.room.key)) state.rooms.set(p.room.key, p.room);
    return p;
  };

  useFrame((_, raw) => {
    const dt = Math.max(1e-3, Math.min(raw, 0.1)), now = state.simulationTime, pr = prompt.current;
    pr.visible = false; state.ladderPrompt = false;
    const lvl = state.level, b = lvl ? byKey.get(lvl.building) : undefined;
    let script: Script | null = null;
    const L = state.ladder;
    if (L) {
      const bb = byKey.get(L.building);
      if (!bb) { state.ladder = null; return; }
      const { plan, room } = of(bb), f = room.frame, base = floorY(APT_FLOORS), t = now - L.t0, tc = t - APPROACH;
      const W = (x: number, z: number) => toWorld(f, x, z);
      const yawW = worldYaw(f, Math.PI);
      const dur = L.dir === "up" ? CLIMB.up : CLIMB.down;
      const pose = climbPose(L.dir, Math.max(0, Math.min(dur, tc)));
      const [cx, cz] = W(plan.ladX, plan.wallZ + pose.z);
      if (tc < 0) {
        // Up to the ladder (or the hatch's edge), turning to face the wall (with one's back to the hatch).
        const s0 = from.current ?? { x: state.pos.x, z: state.pos.z, yaw: state.rotY };
        const k = smooth(t / APPROACH), turn = Math.atan2(Math.sin(yawW - s0.yaw), Math.cos(yawW - s0.yaw));
        const x = s0.x + (cx - s0.x) * k, z = s0.z + (cz - s0.z) * k, prev = state.foodScript;
        const speed = prev ? Math.hypot(x - prev.x, z - prev.z) / dt : 0;
        script = { x, z, yaw: s0.yaw + turn * smooth(t / (APPROACH * 0.8)), walk: Math.min(1.2, speed + Math.abs(turn) * 0.4 * Math.sin(Math.PI * k)), sit: 0, shuffle: 0, lean: 0, left: null, right: null, y: base + pose.y };
      } else {
        const hand = (h: typeof pose.hands.left) => {
          if (!h) return null;
          const [hx, hz] = W(plan.ladX + h.at[0], plan.wallZ + h.at[2]);
          return { at: new THREE.Vector3(hx, base + h.at[1], hz), blend: h.blend, pole: "low" as const };
        };
        script = { x: cx, z: cz, yaw: yawW, walk: 0, sit: 0, shuffle: 0, lean: pose.lean, left: hand(pose.hands.left), right: hand(pose.hands.right), legs: pose.legs, y: base + pose.y };
        // Up through the hatch: from the top-out on, it's the roof you're on.
        if (L.dir === "up" && tc >= CLIMB.topOut && state.level?.floor !== ROOF_FLOOR) {
          state.level = { building: L.building, floor: ROOF_FLOOR, y: roofY() };
          if (state.interior) state.interior.key = room.key;
        }
      }
      // The camera: behind and under the climber going up, above going down; following; back in its place before
      // the end.
      if (tc < dur - CAM_BACK) {
        const y = pose.y;
        const cam = L.dir === "up"
          ? { pos: [plan.ladX + 0.3, Math.max(0.5, y + 0.1), plan.wallZ + 0.84] as const, at: [plan.ladX, y + 1.55, plan.wallZ + 0.3] as const }
          : { pos: [plan.ladX + 0.2, Math.min(y + 2.3, 3.5 + 2.1), plan.wallZ + 0.78] as const, at: [plan.ladX, y + 1.05, plan.wallZ + 0.25] as const };
        const [px, pz] = W(cam.pos[0], cam.pos[2]), [ax, az] = W(cam.at[0], cam.at[2]);
        state.camLock = { pos: [px, base + cam.pos[1], pz], at: [ax, base + cam.at[1], az], by: "ladder" };
      } else if (state.camLock?.by === "ladder") {
        state.camLock = null;
        state.camYaw = yawW + Math.PI; state.camPitch = 0.28;
      }
      if (tc >= dur) {
        // There: standing (on the roof, or the top floor).
        state.pos.set(cx, base + pose.y, cz); state.rotY = yawW;
        state.ladder = null; from.current = null; script = null;
        if (state.camLock?.by === "ladder") state.camLock = null;
      }
      state.interactQueued = false;
    }
    // This drives the body while climbing; then it's the player's again.
    if (script) { state.foodScript = script; own.current = true; }
    else if (own.current) { state.foodScript = null; own.current = false; }
    {
      const lb = L ? byKey.get(L.building) : lvl && (lvl.floor === ROOF_FLOOR || lvl.floor === APT_FLOORS) ? b : undefined, el = lamp.current;
      if (el) {
        el.intensity = lb ? 1.6 : 0;
        if (lb) { const { plan, room } = of(lb), [x, z] = toWorld(room.frame, (plan.bulk.x0 + plan.bulk.x1) / 2, (plan.bulk.z0 + plan.bulk.z1) / 2); el.position.set(x, roofY() + BULK_H - 0.25, z); }
      }
    }
    if (L || !lvl || !b || state.accident || state.health <= 0 || state.script || state.seat) return;

    const { plan, room } = of(b), f = room.frame;
    const [lx, lz] = toLocal(f, state.pos.x, state.pos.z), yaw = state.rotY - f.rot;
    const show = (x: number, y: number, z: number, label: string) => { const [wx, wz] = toWorld(f, x, z); Object.assign(pr, { visible: true, x: wx, y: lvl.y + y, z: wz, label }); state.ladderPrompt = true; };
    const start = (dir: "up" | "down") => {
      if (!needFreeHands(state, "climbing the ladder")) return;
      from.current = { x: state.pos.x, z: state.pos.z, yaw: state.rotY };
      state.ladder = { dir, t0: now, building: lvl.building };
      state.keys.clear();
      if (dir === "down") {
        // Going down: it's the top floor you're going to (seen down the hatch all the way).
        state.level = { building: lvl.building, floor: APT_FLOORS, y: floorY(APT_FLOORS) };
        if (state.interior) state.interior.key = floorKey(b, APT_FLOORS);
      }
    };
    if (lvl.floor === APT_FLOORS) {
      // In front of the ladder, facing it.
      if (Math.hypot(lx - plan.ladX, lz - (plan.wallZ + 0.62)) < 0.8 && facesAt(yaw, lx, lz, plan.ladX, plan.wallZ, 0.9)) {
        show(plan.ladX, 1.45, plan.wallZ + 0.25, handsBusy(state) ? "HANDS FULL" : "E  CLIMB UP");
        if (state.interactQueued) { state.interactQueued = false; start("up"); }
      }
      return;
    }
    if (lvl.floor !== ROOF_FLOOR) return;
    // On the roof: walked into the hatch — down through it; walked off the edge — down to the street.
    if (inHatch(plan, lx, lz)) {
      const top = state.pos.y;
      state.level = { building: lvl.building, floor: APT_FLOORS, y: floorY(APT_FLOORS) };
      if (state.interior) state.interior.key = floorKey(b, APT_FLOORS);
      state.foodScript = null;
      fallHurt(state, FALL_STOREY, top);
      return;
    }
    if (!onRoof(plan, lx, lz)) { state.level = null; state.interior = null; return; }
    // At the hatch's edge, facing it: down.
    if (Math.hypot(lx - plan.ladX, lz - (plan.wallZ - 0.35)) < 0.75 && facesAt(yaw, lx, lz, plan.ladX, plan.wallZ + 0.45, 0.9)) {
      show(plan.ladX, 0.9, plan.wallZ + 0.1, handsBusy(state) ? "HANDS FULL" : "E  CLIMB DOWN");
      if (state.interactQueued) { state.interactQueued = false; start("down"); }
    }
  }, -0.67);

  return <>
    <pointLight ref={lamp} intensity={0} distance={4.5} decay={1.4} color="#fff1dc" />
    <InteractionPrompt sample={() => ({ ...prompt.current, time: state.simulationTime })} />
  </>;
}
