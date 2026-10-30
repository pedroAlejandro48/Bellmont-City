import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { SIDEWALK_H, restaurantOpen, timeInfo, type City } from "./config";
import type { GameState, Script, WorldReach } from "./state";
import { InteractionPrompt } from "./InteractionPrompt";
import {
  CHAIR, ENTER, LEAVE, LOBBY, enterLead, leaveLead, OUTSIDE, SIT, behindChair, enterPose, leavePose, localYaw, makeRoom, nearDoorInside, nearDoorOutside,
  planSit, roomKey, sitPose, smooth, toLocal, toWorld, worldYaw, type Frame, type Pose, type Reach, type Room,
} from "./restaurantRoom";

const FADE_IN = 0.6;

/** Behind the character, looking the way it faces (after a fade, the view starts from there). */
function cameraBehind(state: GameState) {
  state.camOrbit = 0;
  state.camYaw = state.rotY + Math.PI;
  state.camPitch = 0.22;
}

/**
 * Restaurant doors and chairs: shows the E hint, starts going in or out, sitting down or standing up, and
 * plays those movements (Player follows `state.script`).
 */
export function RestaurantInteraction({ state, city }: { state: GameState; city: City }) {
  const here = useMemo(() => city.buildings.filter((b) => b.restaurant), [city]);
  const prompt = useRef({ visible: false, x: 0, y: 0, z: 0, label: undefined as string | undefined });
  const last = useRef<{ x: number; z: number; walk: number } | null>(null);

  useFrame((_, raw) => {
    const dt = Math.max(1e-3, Math.min(raw, 0.05)), now = state.simulationTime;
    for (const b of here) if (!state.rooms.has(roomKey(b))) state.rooms.set(roomKey(b), makeRoom(b));
    const hours = timeInfo(state.elapsed).hours;
    const bike = state.scooter;
    const busy = bike.riding || bike.action !== null || state.bench !== null || state.accident !== null || state.health <= 0;
    let fade = 0;
    if (state.fadeInAt !== null) {
      fade = 1 - smooth((now - state.fadeInAt) / FADE_IN);
      if (now - state.fadeInAt > FADE_IN) state.fadeInAt = null;
    }

    // What the player could use right now.
    const p = prompt.current;
    p.visible = false; p.label = undefined;
    let door: { room: Room; open: boolean } | null = null, inDoor: Room | null = null, chair: { room: Room; index: number } | null = null;
    const inter = state.interior, room = inter ? state.rooms.get(inter.key) ?? null : null;
    if (!inter && !busy) {
      for (const b of here) {
        const r = state.rooms.get(roomKey(b));
        if (!r) continue;
        const [lx, lz] = toLocal(r.frame, state.pos.x, state.pos.z);
        if (nearDoorOutside(lx, lz)) { door = { room: r, open: restaurantOpen(r.kind, hours) }; break; }
      }
      if (door) {
        const [x, z] = toWorld(door.room.frame, 0, 0.45);
        Object.assign(p, { visible: true, x, y: SIDEWALK_H + 2.05, z, label: door.open ? undefined : "CLOSED" });
      }
    } else if (inter?.phase === "inside" && room && !state.seat && !state.accident) {
      const [lx, lz] = toLocal(room.frame, state.pos.x, state.pos.z), yaw = localYaw(room.frame, state.rotY);
      if (nearDoorInside(lx, lz)) {
        inDoor = room;
        const [x, z] = toWorld(room.frame, 0, -0.45);
        Object.assign(p, { visible: true, x, y: SIDEWALK_H + 2.05, z });
      } else {
        let best = Infinity;
        room.items.forEach((it, index) => {
          if (it.kind !== "chair" || !behindChair(it, lx, lz, yaw)) return;
          const d = Math.hypot(it.x - lx, it.z - lz);
          if (d < best) { best = d; chair = { room, index }; }
        });
        const found = chair as { room: Room; index: number } | null;
        const c = found ? room.items[found.index] : null;
        if (c) {
          const [x, z] = toWorld(room.frame, c.x - c.f[0] * CHAIR.back, c.z - c.f[1] * CHAIR.back);
          Object.assign(p, { visible: true, x, y: SIDEWALK_H + 1.5, z });
        }
      }
    }
    state.doorPrompt = door !== null || inter !== null;

    // E: go in, come out, or sit down. Inside, E never reaches the bike or the benches.
    if (state.interactQueued) {
      if (door) {
        state.interactQueued = false;
        if (door.open) {
          const f = door.room.frame, [lx, lz] = toLocal(f, state.pos.x, state.pos.z);
          state.interior = { key: door.room.key, phase: "entering", startedAt: now, from: [lx, lz], fromYaw: localYaw(f, state.rotY), outside: toWorld(f, OUTSIDE[0], OUTSIDE[1]), outsideYaw: worldYaw(f, 0), cameraSet: false };
          state.keys.clear(); state.jumpQueued = false;
        }
      } else if (inter) {
        state.interactQueued = false;
        const found = chair as { room: Room; index: number } | null;
        if (inDoor) {
          const [lx, lz] = toLocal(inDoor.frame, state.pos.x, state.pos.z);
          Object.assign(inter, { phase: "leaving", startedAt: now, from: [lx, lz], fromYaw: localYaw(inDoor.frame, state.rotY), cameraSet: false });
          state.keys.clear(); state.jumpQueued = false;
        } else if (found) {
          const [lx, lz] = toLocal(found.room.frame, state.pos.x, state.pos.z);
          const plan = planSit(found.room, found.index, lx, lz, localYaw(found.room.frame, state.rotY));
          if (plan) { state.seat = { room: found.room.key, plan, phase: "sit", startedAt: now }; state.keys.clear(); state.jumpQueued = false; }
        }
      }
    }
    // Space: stand up from a chair (only once fully seated).
    if (state.standQueued && state.seat?.phase === "seated") { state.seat.phase = "stand"; state.seat.startedAt = now; }
    state.standQueued = false;

    // This frame's scripted movement.
    let pose: Pose | null = null, frame: Frame | null = null;
    const active = state.interior, activeRoom = active ? state.rooms.get(active.key) ?? null : null;
    if (active && activeRoom) {
      frame = activeRoom.frame;
      const t = now - active.startedAt;
      if (active.phase === "entering") {
        const lead = enterLead(active.from);
        const step = enterPose(Math.min(t, ENTER.done + lead), active.from, active.fromYaw);
        activeRoom.doors = step.door; pose = step; fade = Math.max(fade, step.fade);
        if (t >= ENTER.black + lead + 0.5 && !active.cameraSet) { active.cameraSet = true; state.rotY = worldYaw(frame, step.yaw); cameraBehind(state); }
        if (t >= ENTER.done + lead) {
          // In the lobby with the door closed behind; the world outside carried on all along.
          active.phase = "inside"; active.startedAt = now; state.fadeInAt = now; fade = 1; pose = null;
          activeRoom.doors = { left: 0, right: 0 };
          const [x, z] = toWorld(frame, LOBBY[0], LOBBY[1]);
          state.pos.x = x; state.pos.z = z; state.rotY = worldYaw(frame, Math.PI);
        }
      } else if (active.phase === "leaving") {
        const lead = leaveLead(active.from);
        const step = leavePose(Math.min(t, LEAVE.done + lead), active.from, active.fromYaw);
        activeRoom.doors = step.door; pose = step; fade = Math.max(fade, step.fade);
        if (t >= LEAVE.black + lead + 0.5 && !active.cameraSet) { active.cameraSet = true; state.rotY = worldYaw(frame, step.yaw); cameraBehind(state); }
        if (t >= LEAVE.done + lead) {
          state.interior = null; state.fadeInAt = now; fade = 1; pose = null;
          activeRoom.doors = { left: 0, right: 0 };
          const [x, z] = toWorld(frame, OUTSIDE[0], OUTSIDE[1]);
          state.pos.x = x; state.pos.z = z; state.rotY = worldYaw(frame, 0);
        }
      } else if (state.seat) {
        const seat = state.seat, plan = seat.plan;
        let t = 0;
        const done = SIT.done + plan.extra;
        if (seat.phase === "sit") { t = now - seat.startedAt; if (t >= done) seat.phase = "seated"; }
        if (seat.phase === "seated") t = done;
        if (seat.phase === "stand") t = done - (now - seat.startedAt);
        const step = sitPose(plan, Math.max(0, Math.min(done, t)), activeRoom);
        const c = activeRoom.items[plan.chair];
        if (c) { c.x = step.chair[0]; c.z = step.chair[1]; }
        pose = step;
        if (seat.phase === "stand" && t <= 0) {
          state.seat = null; pose = null;
          const [x, z] = toWorld(frame, plan.start[0], plan.start[1]);
          state.pos.x = x; state.pos.z = z; state.rotY = worldYaw(frame, plan.startYaw);
        }
      }
    }

    if (pose && frame) {
      const [x, z] = toWorld(frame, pose.x, pose.z), yaw = worldYaw(frame, pose.yaw);
      const prev = last.current;
      // Any movement steps the legs (sideways too); stepping backward plays them in reverse.
      const dx = prev ? x - prev.x : 0, dz = prev ? z - prev.z : 0, speed = Math.hypot(dx, dz) / dt;
      const along = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      const raw = along < -0.3 * Math.hypot(dx, dz) ? -speed : speed;
      const walk = prev ? prev.walk + (raw - prev.walk) * (1 - Math.exp(-14 * dt)) : 0;
      last.current = { x, z, walk };
      const reach = (r: Reach | null): WorldReach | null => {
        if (!r || !frame) return null;
        const [wx, wz] = toWorld(frame, r.at[0], r.at[2]);
        return { at: new THREE.Vector3(wx, SIDEWALK_H + r.at[1], wz), blend: r.blend, pole: r.pole };
      };
      const script: Script = { x, z, yaw, walk, sit: pose.sit, shuffle: pose.shuffle, lean: pose.lean, left: reach(pose.left), right: reach(pose.right) };
      state.script = script;
    } else { state.script = null; last.current = null; }
    state.fade = fade;
  }, -0.6);

  return <InteractionPrompt sample={() => ({ ...prompt.current, time: state.simulationTime })} />;
}
