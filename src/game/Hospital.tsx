// The hospital's nurse and treatment room while playing (see hospital.ts): the nurse drawn where the current round
// has her (or waiting by the bed), the treatment room's door as open as the round has it, and this player's own
// visit — waiting their turn, starting their round when it comes, following the nurse in (the camera held on the
// door from the reception), the health coming back on the bed, and walking out again.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { serverNow } from "@/lib/serverTime";
import { POLES, reachArm } from "./arms";
import { CharacterBody, useBodyRig } from "./CharacterBody";
import { SIDEWALK_H, type City } from "./config";
import { doorAt, nextUp, nurseAt, patientAt, roundPlan, type Request, type RoundPlan } from "./hospital";
import { CHAIR, toLocal, toWorld, worldYaw } from "./restaurantRoom";
import { toast, type GameState, type Script } from "./state";
import { leaveVenueSeat } from "./VenueSeats";
import { venueLayout } from "./venueRoom";

/** Asks for treatment (already paid `paid`): in the queue from now. */
export function requestTreatment(state: GameState, key: string, paid: number) {
  state.hospital = { key, req: serverNow(), start: null, spot: null, paid };
}
/** How many are ahead of this player in the queue (including the one being treated). */
export function queueAhead(state: GameState) {
  const me = state.hospital;
  if (!me) return 0;
  const now = serverNow();
  return state.hospitalPeers.filter((p) => p.key === me.key && (p.start === null ? p.req < me.req : now < p.start + 60_000)).length;
}

export function Hospital({ state, city }: { state: GameState; city: City }) {
  const b = useMemo(() => city.buildings.find((x) => x.venue === "hospital"), [city]);
  const layout = useMemo(() => (b ? venueLayout(b) : null), [b]);
  const rig = useBodyRig();
  const plans = useRef(new Map<string, RoundPlan>());
  const walkPhase = useRef(0), own = useRef(false), away = useRef(0);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1), root = rig.root.current, hips = rig.hips.current;
    if (!layout?.ward || !root || !hips) return;
    const W = layout.ward, f = layout.frame, key = layout.key, now = serverNow();
    const planOf = (start: number, spot: [number, number]) => { const k = `${start}:${spot[0].toFixed(2)}:${spot[1].toFixed(2)}`; let p = plans.current.get(k); if (!p) { p = roundPlan(W, spot); plans.current.set(k, p); if (plans.current.size > 12) plans.current.delete(plans.current.keys().next().value!); } return p; };
    // Every round going on here (this player's and others'); the latest one running is the nurse's.
    const me = state.hospital?.key === key ? state.hospital : null;
    const all: (Request & { spot: [number, number] | null })[] = [...state.hospitalPeers.filter((p) => p.key === key), ...(me ? [{ id: "me", key, req: me.req, start: me.start, spot: me.spot }] : [])];
    let active: { r: RoundPlan; t: number; mine: boolean } | null = null;
    for (const q of all) {
      if (q.start === null || !q.spot) continue;
      const r = planOf(q.start, q.spot), t = (now - q.start) / 1000;
      if (t >= -1 && t < r.end && (!active || q.start > now - active.t * 1000)) active = { r, t, mine: q.id === "me" };
    }
    const room = state.rooms.get(key) as { wardDoor?: number } | undefined;
    if (room) room.wardDoor = active ? doorAt(active.r, active.t) : 0;

    // ---- the nurse ----
    const near = Math.hypot(state.pos.x - f.ox, state.pos.z - f.oz) < 45;
    root.visible = near;
    if (near) {
      const n = nurseAt(W, active?.r ?? null, active?.t ?? 0), [x, z] = toWorld(f, n.at[0], n.at[1]);
      root.position.set(x, SIDEWALK_H, z); root.rotation.y = worldYaw(f, n.yaw);
      walkPhase.current += dt * (n.walking ? 7.5 : 0);
      const w = n.walking ? 1 : 0, sn = Math.sin(walkPhase.current), cs = Math.cos(walkPhase.current);
      hips.position.y = 0.95 - 0.02 * w * Math.abs(cs);
      rig.thighL.current?.rotation.set(-0.45 * sn * w, 0, 0.06); rig.thighR.current?.rotation.set(0.45 * sn * w, 0, -0.06);
      rig.shinL.current?.rotation.set(0.55 * Math.max(0, cs) * w + 0.05, 0, 0); rig.shinR.current?.rotation.set(0.55 * Math.max(0, -cs) * w + 0.05, 0, 0);
      rig.torso.current?.rotation.set(0.03 * w, 0, 0);
      rig.armL.current?.rotation.set(0.35 * sn * w, 0, 0.1); rig.armR.current?.rotation.set(-0.35 * sn * w, 0, -0.1);
      rig.foreL.current?.rotation.set(-0.25, 0, 0); rig.foreR.current?.rotation.set(-0.25, 0, 0);
      rig.head.current?.rotation.set(0, 0, 0);
      if (n.hand > 0.001 && active) {
        // Her right hand on the door's handle while she opens it.
        const [hx, hz] = toWorld(f, active.r.handle[0], active.r.handle[1] - 0.06);
        root.updateMatrixWorld(true);
        reachArm(rig.armR.current, rig.foreR.current, tmp.set(hx, SIDEWALK_H + 1.0, hz), POLES.out(-1), Math.min(1, n.hand * 1.6));
      }
      if (n.hands && n.hands.blend > 0.001) {
        // Both hands on the patient (the chest, the shoulders, the face), and her head bent to them a little.
        root.updateMatrixWorld(true);
        const [lx, lz] = toWorld(f, n.hands.left[0], n.hands.left[2]), [rx, rz] = toWorld(f, n.hands.right[0], n.hands.right[2]);
        reachArm(rig.armL.current, rig.foreL.current, tmp.set(lx, SIDEWALK_H + n.hands.left[1], lz), POLES.low(1), n.hands.blend);
        root.updateMatrixWorld(true);
        reachArm(rig.armR.current, rig.foreR.current, tmp.set(rx, SIDEWALK_H + n.hands.right[1], rz), POLES.low(-1), n.hands.blend);
        rig.torso.current?.rotation.set(0.12 * n.hands.blend, 0, 0); rig.head.current?.rotation.set(0.15 * n.hands.blend, 0, 0);
      }
    }

    // ---- this player's visit ----
    const mine = state.hospital;
    let script: Script | null = null;
    if (mine && mine.key === key) {
      const inside = state.interior?.phase === "inside" && state.interior.key === key;
      if (mine.start === null) {
        // Waiting. Gone from the hospital a while: the visit's off (and paid back).
        away.current = inside ? 0 : away.current + dt;
        if (away.current > 2) {
          if (mine.paid > 0) { state.cash = Math.round((state.cash + mine.paid) * 100) / 100; toast(state, "Treatment cancelled", "info", `You left before the nurse came: $${mine.paid.toFixed(2)} back.`); }
          else toast(state, "Treatment cancelled", "info", "You left before the nurse came.");
          state.hospital = null;
        } else if (inside && !active && nextUp(all, key) === "me") {
          // Our turn, and the nurse is free: the round starts (from where we are — sitting: in front of the seat).
          const vs = state.venueSeat, [lx, lz] = toLocal(f, state.pos.x, state.pos.z);
          mine.spot = vs && vs.key === key ? [vs.ax, vs.az] : [lx, lz];
          mine.start = now + 250;
        }
      } else if (mine.spot) {
        const r = planOf(mine.start, mine.spot), t = (now - mine.start) / 1000;
        // From the round's start on, this player keeps still for the nurse (whatever they were doing stops when she
        // gets there: up from the couch, any panel closed).
        state.keys.clear(); state.jumpQueued = false; state.interactQueued = false;
        if (t >= r.met - 0.2) { state.shop = null; if (state.venueSeat) leaveVenueSeat(state); }
        const pp = patientAt(r, t);
        if (pp && !state.venueSeat) {
          const [x, z] = toWorld(f, pp.at[0], pp.at[1]);
          const bed = pp.sit > 0 ? (0.6 - CHAIR.seatTop) * pp.sit : 0;
          script = { x, z, yaw: worldYaw(f, pp.yaw), walk: pp.walking ? 1.1 : 0, sit: pp.sit, shuffle: 0, lean: 0, left: null, right: null, ...(bed > 0 ? { y: SIDEWALK_H + bed } : {}) };
          // Sitting down onto the bed and getting up like from a couch (only higher): leaning forward on the way, the
          // hands coming to rest on the knees.
          if (pp.sit > 0.02) {
            const yw = worldYaw(f, pp.yaw), fx = Math.sin(yw), fz = Math.cos(yw), lx = Math.cos(yw), lz = -Math.sin(yw);
            const [sx, sz] = toWorld(f, r.q.seat[0], r.q.seat[1]), k = pp.sit * pp.sit * (3 - 2 * pp.sit);
            const knee = (side: 1 | -1) => ({ at: new THREE.Vector3(sx + fx * 0.42 + lx * side * 0.12, SIDEWALK_H + 0.6 + 0.16, sz + fz * 0.42 + lz * side * 0.12), blend: k, pole: "out" as const });
            script.lean = pp.sit < 0.98 ? 0.25 * Math.sin(Math.PI * pp.sit) : 0.06;
            script.left = knee(1); script.right = knee(-1);
          }
          if (pp.hand > 0.001) {
            const [hx, hz] = toWorld(f, r.handle[0], r.handle[1] - 0.06);
            script.right = { at: new THREE.Vector3(hx, SIDEWALK_H + 1.0, hz), blend: Math.min(1, pp.hand * 1.6), pole: "out" };
          }
          state.interactQueued = false;
        }
        // The health comes back while on the bed.
        if (t >= r.seated && t < r.treated) {
          mine.h0 ??= state.health;
          state.health = Math.max(state.health, mine.h0 + (100 - mine.h0) * Math.min(1, (t - r.seated) / (r.treated - r.seated)));
        }
        if (t >= r.treated && mine.h0 !== undefined && state.health < 100) state.health = 100;
        // The camera: from the nurse's arrival till the door shuts behind the patient on the way out, looking at
        // the treatment room's door from the reception.
        const camEnd = r.shut2 + 0.9;
        if (t >= r.met && t < camEnd) {
          const [px, pz] = toWorld(f, Math.min(r.q.out[0] + 1.2, layout.bounds.maxX - 0.4), W.z + 3.4), [ax, az] = toWorld(f, W.doorX, W.z);
          state.camLock = { pos: [px, SIDEWALK_H + 1.85, pz], at: [ax, SIDEWALK_H + 1.15, az], by: "hospital" };
        } else if (state.camLock?.by === "hospital") state.camLock = null;
        if (t >= r.end) {
          const [x, z] = toWorld(f, r.q.exit[0], r.q.exit[1]);
          state.pos.x = x; state.pos.z = z; state.rotY = worldYaw(f, 0);
          if (state.camLock?.by === "hospital") state.camLock = null;
          state.hospital = null; script = null;
          toast(state, "You feel much better", "info", "Health is full.");
        }
      }
    } else if (state.camLock?.by === "hospital") state.camLock = null;
    if (script) { state.foodScript = script; own.current = true; }
    else if (own.current) { state.foodScript = null; own.current = false; }
  }, -0.63);

  if (!layout?.ward) return null;
  return <CharacterBody rig={rig} color="#8fd0dc" />;
}
