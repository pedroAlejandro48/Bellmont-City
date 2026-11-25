// Sitting down in the venues: the apartment lobbies' sofa and armchairs, the police station's benches, the
// hospital's waiting couches. Up to a free seat, facing it: E sits (walk to just in front of it, turn, lower onto
// it, the hands on the knees); E, Space or walking off stands up again. The body is the player's own, so others in
// a room see all of it (the pose goes out with every other pose).
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { InteractionPrompt } from "./InteractionPrompt";
import { CHAIR, toLocal, toWorld, worldYaw } from "./restaurantRoom";
import { type Fixture, type VenueLayout } from "./venueRoom";
import type { GameState, Script, WorldReach } from "./state";

/** A seat in a venue (its room's frame): where one sits, facing `yaw`, and the spot in front to sit down from. */
export type VenueSeat = { x: number; z: number; yaw: number; ax: number; az: number };
const PLACES: Partial<Record<Fixture["type"], number[]>> = { sofa: [-0.62, 0, 0.62], armchair: [0], waitChair: [0], bench: [-0.8, 0, 0.8] };
/** The seats a venue room has. */
export function venueSeats(fixtures: Fixture[]): VenueSeat[] {
  const out: VenueSeat[] = [];
  for (const f of fixtures) {
    const places = PLACES[f.type];
    if (!places) continue;
    const fx = Math.sin(f.rot), fz = Math.cos(f.rot), lx = Math.cos(f.rot), lz = -Math.sin(f.rot);
    // (Sat a little forward of the middle of its depth; stood up from just in front of it.)
    const fwd = f.type === "bench" ? 0.02 : 0.08, reach = f.d / 2 + 0.42;
    for (const a of places) {
      const x = f.x + lx * a + fx * fwd, z = f.z + lz * a + fz * fwd;
      out.push({ x, z, yaw: f.rot, ax: f.x + lx * a + fx * reach, az: f.z + lz * a + fz * reach });
    }
  }
  return out;
}
/** The lobby's armchair the visitor sometimes sits in (taken while they're there). */
export const lobbyVisitorHere = (layout: VenueLayout, elapsed: number) => Math.floor((elapsed + layout.frame.ox * 7) / 90) % 2 === 0;

const SIT = 0.9, WALK = 1.3;
const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
type Sitting = { key: string; seat: VenueSeat; phase: "walk" | "down" | "seated" | "up"; t0: number; from: [number, number, number]; walk: number };

/** Whoever's sitting here: stood up at once (the nurse came for them, say). */
export function leaveVenueSeat(state: GameState) { state.venueSeatLeave = true; }

export function VenueSeats({ state }: { state: GameState }) {
  const sit = useRef<Sitting | null>(null), own = useRef(false);
  const prompt = useRef({ visible: false, x: 0, y: 0, z: 0, time: 0, label: undefined as string | undefined });
  const cache = useRef(new Map<string, VenueSeat[]>());
  const seatsOf = (room: VenueLayout) => { let s = cache.current.get(room.key); if (!s) { s = venueSeats(room.fixtures); cache.current.set(room.key, s); } return s; };

  useFrame(() => {
    const now = state.simulationTime, pr = prompt.current, p = state.pos;
    pr.visible = false; pr.time = now;
    const inter = state.interior, room = inter?.phase === "inside" ? state.rooms.get(inter.key) as VenueLayout | undefined : undefined;
    let script: Script | null = null;
    const s = sit.current;
    if (s) {
      const r = state.rooms.get(s.key) as VenueLayout | undefined;
      if (!r || state.health <= 0 || state.accident) { sit.current = null; state.venueSeat = null; }
      else {
        const f = r.frame, W = (x: number, z: number) => toWorld(f, x, z), yaw = worldYaw(f, s.seat.yaw);
        const [sx, sz] = W(s.seat.x, s.seat.z), [ax, az] = W(s.seat.ax, s.seat.az), t = now - s.t0;
        const fx = Math.sin(yaw), fz = Math.cos(yaw), lx = Math.cos(yaw), lz = -Math.sin(yaw);
        const knees = (k: number): { left: WorldReach | null; right: WorldReach | null } => {
          if (k <= 0.02) return { left: null, right: null };
          const knee = (side: 1 | -1): WorldReach => ({ at: new THREE.Vector3(sx + fx * 0.42 + lx * side * 0.12, p.y + CHAIR.seatTop + 0.16, sz + fz * 0.42 + lz * side * 0.12), blend: smooth(k), pole: "out" });
          return { left: knee(1), right: knee(-1) };
        };
        const base = { sit: 0, shuffle: 0, lean: 0, left: null, right: null } as const;
        const leave = state.venueSeatLeave;
        if (s.phase === "walk") {
          // Over to the spot in front of the seat (turning round to it as it nears), then down.
          const k = Math.min(1, t / s.walk), e = smooth(k);
          const x = s.from[0] + (ax - s.from[0]) * e, z = s.from[1] + (az - s.from[1]) * e;
          const go = Math.atan2(ax - s.from[0], az - s.from[1]), turnK = smooth((k - 0.55) / 0.45);
          const dy = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
          const head = s.walk > 0.15 ? s.from[2] + dy(s.from[2], go) * smooth(k / 0.3) : s.from[2];
          const yy = head + dy(head, yaw) * turnK;
          script = { ...base, x, z, yaw: yy, walk: k < 1 ? Math.min(1.2, WALK * (1 - turnK * 0.7)) : 0 };
          if (k >= 1) { s.phase = "down"; s.t0 = now; }
          if (leave) { s.phase = "up"; s.t0 = now - SIT; }
        } else if (s.phase === "down" || s.phase === "up") {
          const k = s.phase === "down" ? smooth(t / SIT) : 1 - smooth(t / SIT);
          script = { ...base, x: ax + (sx - ax) * k, z: az + (sz - az) * k, yaw, walk: 0, lean: 0.25 * Math.sin(Math.PI * k), sit: k, ...knees(k) };
          if (t >= SIT) {
            if (s.phase === "down") { s.phase = "seated"; s.t0 = now; }
            else { p.x = ax; p.z = az; state.rotY = yaw; sit.current = null; state.venueSeat = null; script = null; }
          }
        } else {
          script = { ...base, x: sx, z: sz, yaw, walk: 0, lean: 0.06, sit: 1, ...knees(1) };
          // E, Space or a push to walk: up again.
          const push = state.keys.has("KeyW") || state.keys.has("KeyS") || state.keys.has("KeyA") || state.keys.has("KeyD") || state.keys.has("ArrowUp") || state.keys.has("ArrowDown") || (state.stick && Math.hypot(state.stick.x, state.stick.y) > 0.4);
          if (state.interactQueued || state.standQueued || state.jumpQueued || push || leave) {
            state.interactQueued = false; state.standQueued = false; state.jumpQueued = false;
            s.phase = "up"; s.t0 = now;
          }
        }
      }
      state.venueSeatLeave = false;
      state.interactQueued = false;
    } else if (room?.venue && !state.foodScript && !state.script && !state.shop && !state.bench && !state.seat && !state.accident && state.health > 0) {
      state.venueSeatLeave = false;
      // A free seat right ahead (its front spot within reach, the player facing roughly toward it).
      const [lx, lz] = toLocal(room.frame, p.x, p.z), ly = state.rotY - room.frame.rot;
      let best: VenueSeat | null = null, bestD = 1.1;
      const visitor = room.venue === "apartments" && lobbyVisitorHere(room, state.elapsed) ? room.fixtures.find((f) => f.type === "armchair") : undefined;
      for (const seat of seatsOf(room)) {
        const d = Math.hypot(lx - seat.ax, lz - seat.az);
        if (d > bestD) continue;
        const toward = Math.atan2(seat.x - lx, seat.z - lz), off = Math.abs(Math.atan2(Math.sin(toward - ly), Math.cos(toward - ly)));
        if (off > 1.1) continue;
        if (visitor && Math.hypot(seat.x - visitor.x, seat.z - visitor.z) < 0.3) continue;
        const [wx, wz] = toWorld(room.frame, seat.x, seat.z);
        if (state.others.some((o) => Math.hypot(o.x - wx, o.z - wz) < 0.45)) continue;
        best = seat; bestD = d;
      }
      if (best) {
        const [wx, wz] = toWorld(room.frame, best.x, best.z);
        Object.assign(pr, { visible: true, x: wx, y: p.y + 1.05, z: wz, label: "E  SIT" });
        if (state.interactQueued) {
          state.interactQueued = false;
          const [ax, az] = toWorld(room.frame, best.ax, best.az);
          sit.current = { key: room.key, seat: best, phase: "walk", t0: now, from: [p.x, p.z, state.rotY], walk: Math.max(0.12, Math.hypot(ax - p.x, az - p.z) / WALK) };
          state.venueSeat = { key: room.key, x: best.x, z: best.z };
          state.keys.clear();
        }
      }
    }
    if (script) { state.foodScript = script; own.current = true; }
    else if (own.current) { state.foodScript = null; own.current = false; }
  });
  return <InteractionPrompt sample={() => prompt.current} />;
}
