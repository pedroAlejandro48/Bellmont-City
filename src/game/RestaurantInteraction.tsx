import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { SIDEWALK_H, openGroundFloor, restaurantOpen, timeInfo, type City } from "./config";
import type { GameState, Script, WorldReach } from "./state";
import { InteractionPrompt } from "./InteractionPrompt";
import { OPENER_PASS, doorState, type DoorUse, type Leaf } from "./doors";
import {
  CHAIR, ENTER, LEAVE, LOBBY, enterLead, leaveLead, OUTSIDE, SIT, behindChair, enterPose, leavePose, localYaw, makeRoom, nearDoorInside, nearDoorOutside,
  planSit, planWalkThrough, roomKey, sitPose, toLocal, walkThroughPose, toWorld, worldYaw, type Frame, type Pose, type Reach, type Room,
} from "./restaurantRoom";

/**
 * Restaurant doors and chairs: shows the E hint, starts going in or out, sitting down or standing up, and
 * plays those movements (Player follows `state.script`).
 */
export function RestaurantInteraction({ state, city }: { state: GameState; city: City }) {
  // Every room with a door: the restaurants and the venues (shops, hospital, police).
  const here = useMemo(() => city.buildings.filter((b) => openGroundFloor(b)), [city]);
  const prompt = useRef({ visible: false, x: 0, y: 0, z: 0, label: undefined as string | undefined });
  const last = useRef<{ x: number; z: number; walk: number } | null>(null);
  /** This player's door uses (shared in a room), and a door it is waiting on to finish closing. */
  const mine = useRef<DoorUse[]>([]);
  const waiting = useRef<{ key: string; leaf: Leaf } | null>(null);

  useFrame((_, raw) => {
    const dt = Math.max(1e-3, Math.min(raw, 0.05)), now = state.simulationTime;
    // Everyone's uses of the doors (this player's and, in a room, the others'), on this player's clock.
    const wall = performance.now() / 1000;
    mine.current = mine.current.filter((u) => wall - u.start < 40);
    const uses = [...mine.current, ...(state.doorLink?.others(wall) ?? []), ...state.npcDoorUses];
    const usesOf = (key: string, leaf: Leaf) => uses.filter((u) => u.key === key && u.leaf === leaf);
    state.doorUsesNow = usesOf;
    /**
     * Going through a door: open it if it is shut, walk through behind whoever has it open, or (while it swings
     * shut) wait for it to close. Returns how, or null when waiting.
     */
    const useDoor = (r: Room, leaf: Leaf, from: [number, number], fromYaw: number) => {
      const ds = doorState(usesOf(r.key, leaf), wall);
      if (ds.phase === "closing") { waiting.current = { key: r.key, leaf }; return null; }
      waiting.current = null;
      let use: DoorUse, walk: ReturnType<typeof planWalkThrough> | undefined;
      if (ds.phase === "closed") {
        const lead = leaf === "right" ? enterLead(from) : leaveLead(from);
        use = { key: r.key, leaf, mode: "open", start: wall, lead, pass: lead + OPENER_PASS[leaf] };
      } else {
        // Behind whoever has it open: wait clear of the door until they are through, then follow them in.
        walk = planWalkThrough(leaf === "right" ? "in" : "out", from, fromYaw, Math.max(0, ds.closesAt - 0.6 - wall));
        use = { key: r.key, leaf, mode: "follow", start: wall, lead: 0, pass: walk.pass };
      }
      mine.current.push(use);
      state.doorLink?.publish(use);
      return { mode: use.mode, walk };
    };
    for (const b of here) if (!state.rooms.has(roomKey(b))) state.rooms.set(roomKey(b), makeRoom(b));
    const hours = timeInfo(state.elapsed).hours;
    const bike = state.scooter;
    const busy = bike.riding || bike.action !== null || state.bench !== null || state.accident !== null || state.health <= 0;

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
        if (nearDoorOutside(lx, lz)) { door = { room: r, open: r.venue ? true : restaurantOpen(r.kind, hours) }; break; }
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
          if (it.kind !== "chair" || state.takenChairs.has(`${room.key}#${index}`) || !behindChair(it, lx, lz, yaw)) return;
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

    // Waiting for a door to finish closing: once it is shut, open it (unless the player has walked off).
    const w = waiting.current;
    if (w) {
      const at = w.leaf === "right" ? door?.room : inDoor ?? undefined;
      if (!at || at.key !== w.key || state.keys.size > 0) waiting.current = null;
      else if (doorState(usesOf(w.key, w.leaf), wall).phase === "closed") state.interactQueued = true;
    }
    // E: go in, come out, or sit down. Inside, E never reaches the bike or the benches.
    if (state.interactQueued) {
      if (door) {
        state.interactQueued = false;
        if (door.open) {
          const f = door.room.frame, [lx, lz] = toLocal(f, state.pos.x, state.pos.z), fromYaw = localYaw(f, state.rotY);
          const how = useDoor(door.room, "right", [lx, lz], fromYaw);
          if (how) {
            state.interior = { key: door.room.key, phase: "entering", startedAt: now, from: [lx, lz], fromYaw, outside: toWorld(f, OUTSIDE[0], OUTSIDE[1]), outsideYaw: worldYaw(f, 0), cameraSet: false, mode: how.mode, ...(how.walk ? { walk: how.walk } : {}) };
            state.keys.clear(); state.jumpQueued = false;
          }
        }
      } else if (inter) {
        state.interactQueued = false;
        const found = chair as { room: Room; index: number } | null;
        if (inDoor) {
          const [lx, lz] = toLocal(inDoor.frame, state.pos.x, state.pos.z), fromYaw = localYaw(inDoor.frame, state.rotY);
          const how = useDoor(inDoor, "left", [lx, lz], fromYaw);
          if (how) {
            Object.assign(inter, { phase: "leaving", startedAt: now, from: [lx, lz], fromYaw, cameraSet: false, mode: how.mode, walk: how.walk });
            state.keys.clear(); state.jumpQueued = false;
          }
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
        const lead = enterLead(active.from), walk = active.mode === "follow" ? active.walk : undefined;
        // Free to move as soon as they are a step inside, clear of the door (which closes behind on its own).
        const end = walk ? Math.min(walk.done, walk.pass + 0.15) : ENTER.free + lead;
        pose = walk ? walkThroughPose(Math.min(t, end), walk) : enterPose(Math.min(t, end), active.from, active.fromYaw);
        if (t >= end) {
          // Inside, where they got to (the camera came in too); the world outside carried on.
          active.phase = "inside"; active.startedAt = now;
          const [x, z] = toWorld(frame, pose.x, pose.z);
          state.pos.x = x; state.pos.z = z; state.rotY = worldYaw(frame, pose.yaw);
          pose = null;
        }
      } else if (active.phase === "leaving") {
        const lead = leaveLead(active.from), walk = active.mode === "follow" ? active.walk : undefined;
        // Free to move as soon as they are out on the sidewalk, clear of the door's swing.
        const end = walk ? Math.min(walk.done, walk.pass + 0.15) : LEAVE.free + lead;
        pose = walk ? walkThroughPose(Math.min(t, end), walk) : leavePose(Math.min(t, end), active.from, active.fromYaw);
        if (t >= end) {
          state.interior = null;
          const [x, z] = toWorld(frame, pose.x, pose.z);
          state.pos.x = x; state.pos.z = z; state.rotY = worldYaw(frame, pose.yaw);
          pose = null;
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

    // Every door swings the same for everyone: from all the uses of it.
    for (const r of state.rooms.values()) {
      const left = doorState(usesOf(r.key, "left"), wall).angle, right = doorState(usesOf(r.key, "right"), wall).angle;
      if (r.doors.left !== left || r.doors.right !== right) r.doors = { left, right };
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
    } else { state.script = state.foodScript; last.current = null; }
    state.fade = 0;
  }, -0.6);

  return <InteractionPrompt sample={() => ({ ...prompt.current, time: state.simulationTime })} />;
}
