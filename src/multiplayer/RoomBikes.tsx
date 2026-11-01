import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import { ScooterModel, type ScooterLook } from "@/game/Scooter";
import { scooterFootprint } from "@/game/config";
import { dropScooter, takeScooter, type GameState, type OtherBike } from "@/game/state";
import { applyBikePushes, bringBike, claimBike, knockBike, pushBike, releaseBike, saveBike, watchBikes, type BikeRecord, type BikeSpot } from "@/platform/bikes";
import type { NamedRoom } from "@/platform/realtime";
import { isPoseWire } from "./pose";

/** Walking within this distance of a free bike takes control of it (its E sign then works as usual). */
export const CLAIM_METERS = 1.5;
/** Walking this far from a controlled bike that is not in use lets others take it. */
export const RELEASE_METERS = 3;
const SAVE_MS = 1000;

type Bikes = Map<string, BikeRecord>;

const spotOf = (state: GameState): BikeSpot => {
  const bike = state.scooter;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return { pos: [r(bike.pos.x), r(bike.pos.y), r(bike.pos.z)], yaw: r(bike.yaw), fallen: bike.fallen, fallSide: bike.fallSide };
};

/** An idle bike goes to whoever is clearly nearest to it, so everyone gets its E sign when they walk up. */
export function shouldHandOver(myDistance: number, bike: { x: number; z: number }, others: readonly { x: number; z: number }[]) {
  return others.some((o) => {
    const distance = Math.hypot(o.x - bike.x, o.z - bike.z);
    return distance <= CLAIM_METERS && distance + 0.3 < myDistance;
  });
}

/** Which free bike, if any, this player should take control of now. */
export function bikeToClaim(
  player: { x: number; z: number },
  held: { id: string; distance: number; busy: boolean } | null,
  free: readonly { id: string; x: number; z: number }[],
) {
  if (held?.busy) return null;
  let best: { id: string; distance: number } | null = null;
  for (const bike of free) {
    const distance = Math.hypot(bike.x - player.x, bike.z - player.z);
    if (distance <= CLAIM_METERS && (!best || distance < best.distance)) best = { id: bike.id, distance };
  }
  // Swap only to a clearly closer bike, so standing between two bikes never flips back and forth.
  if (!best || (held && best.distance + 0.3 >= held.distance)) return null;
  return best.id;
}

/**
 * Room bikes: every player brings one, and anyone can ride any of them. Each tab controls at most one bike
 * at a time (the one it is next to or using), simulated by the normal Scooter; parked bikes are drawn here.
 */
export function RoomBikes({ state, code, uid, channel }: { state: GameState; code: string; uid: string; channel: NamedRoom }) {
  const bikes = useRef<Bikes>(new Map());
  const [parked, setParked] = useState<string[]>([]);
  const busy = useRef(false);
  const knocks = useRef(new Map<string, number>());
  const saved = useRef({ at: 0, spot: "" });
  /** Where each parked bike is drawn (with this player's own shove the host has not used yet). */
  const shown = useRef(new Map<string, [number, number, number]>());
  // Shoving other bikes: totals per bike this tab has pushed (sent now and then), and those seen applied here.
  const shoves = useRef({ totals: new Map<string, [number, number]>(), pushed: new Set<string>(), sentAt: 0, appliedAt: 0, seen: new Map<string, [number, number]>() });

  useEffect(() => {
    dropScooter(state);
    void channel.presence({ bike: null }).catch(() => {});
    void bringBike(code, uid, { pos: [state.pos.x + 0.75, state.pos.y, state.pos.z], yaw: state.rotY, fallen: false, fallSide: 1 }).catch(() => {});
    const stop = watchBikes(code, (next) => { bikes.current = next; });
    return () => {
      stop();
      const id = state.scooter.id;
      if (id) void releaseBike(code, id, spotOf(state)).catch(() => {});
    };
  }, [state, code, uid, channel]);

  useFrame((_, raw) => {
    const now = Date.now(), dt = Math.min(raw, 0.05);
    const peers = channel.peers();
    const me = peers.find((p) => p.sameTab)?.peer ?? "";
    const present = new Set(peers.map((p) => p.peer));
    const heldElsewhere = new Set(peers.filter((p) => !p.sameTab).map((p) => p.presence["bike"]).filter((b): b is string => typeof b === "string"));
    const bike = state.scooter;
    const isFree = (id: string, rec: BikeRecord) => id !== bike.id && !heldElsewhere.has(id) && (rec.holder === null || rec.holder === me || !present.has(rec.holder));
    const free = [...bikes.current].filter(([id, rec]) => isFree(id, rec));

    // This player crashed into other bikes: knock them over (whoever controls one applies it below).
    for (const impact of state.impacts) if (impact.kind === "bike") void knockBike(code, impact.id, impact.side).catch(() => {});
    state.impacts = state.impacts.filter((impact) => impact.kind !== "bike");
    // Someone crashed into the bike this player controls (and isn't using): it falls over.
    const heldRec = bike.id ? bikes.current.get(bike.id) : undefined;
    if (bike.id && heldRec && heldRec.knock > (knocks.current.get(bike.id) ?? 0)) {
      knocks.current.set(bike.id, heldRec.knock);
      if (!bike.riding && !bike.action && !bike.fallen && Date.now() - heldRec.knock < 10_000) {
        bike.fallen = true; bike.fallSide = heldRec.knockSide; bike.fallenAt = state.simulationTime; bike.tip = 0; bike.tipVel = 0;
      }
    }

    // This player's bike shoved other bikes along: a parked one is moved here and now; one someone else controls
    // is moved by them (they are sent how far, in total).
    const sh = shoves.current;
    // Shoves add up: every player sends how far, in total, they have pushed each bike, and whoever moves it (its
    // controller, or for a parked one the room's host) moves it by everyone's shoves together.
    for (const [id, [vx, vz]] of state.bikePushes) {
      if (!bikes.current.get(id)) continue;
      const t = sh.totals.get(id) ?? [0, 0]; sh.totals.set(id, [t[0] + vx * dt, t[1] + vz * dt]); sh.pushed.add(id);
    }
    state.bikePushes.clear();
    if (now - sh.sentAt > 100 && sh.pushed.size) {
      sh.sentAt = now;
      for (const id of sh.pushed) { const t = sh.totals.get(id); if (t && me) void pushBike(code, id, me, t).catch(() => {}); }
      sh.pushed.clear();
    }
    // Hosting the room: parked bikes nobody controls are moved here by everyone's shoves.
    const hosting = (() => { let best: (typeof peers)[number] | null = null; for (const p of peers) if (p.kind === "viewer" && (!best || ((p.presence["joinedAt"] as number) ?? Infinity) < ((best.presence["joinedAt"] as number) ?? Infinity) || (p.presence["joinedAt"] === best.presence["joinedAt"] && p.peer < best.peer))) best = p; return best?.sameTab ?? false; })();
    if (hosting && now - sh.appliedAt > 100) {
      sh.appliedAt = now;
      for (const [id, rec] of free) {
        let dx = 0, dz = 0;
        const applied: Record<string, [number, number]> = {};
        for (const [by, total] of Object.entries(rec.pushes)) {
          const done = rec.applied[by] ?? [0, 0];
          if (Math.abs(total[0] - done[0]) < 1e-4 && Math.abs(total[1] - done[1]) < 1e-4) continue;
          dx += total[0] - done[0]; dz += total[1] - done[1]; applied[by] = total;
        }
        if (!Object.keys(applied).length) continue;
        rec.pos = [rec.pos[0] + dx, rec.pos[1], rec.pos[2] + dz];
        for (const [by, total] of Object.entries(applied)) rec.applied[by] = total;
        void applyBikePushes(code, id, rec.pos, applied).catch(() => {});
      }
    }
    // Others shoving the bike this player controls: it moves by however much more they have pushed it.
    if (bike.id && heldRec && !bike.riding && !bike.action) {
      for (const [by, total] of Object.entries(heldRec.pushes)) {
        const key = `${bike.id}:${by}`, before = sh.seen.get(key);
        sh.seen.set(key, total);
        if (!before) continue;
        bike.pos.x += total[0] - before[0]; bike.pos.z += total[1] - before[1];
      }
    }

    // Let go of a bike left behind, or one another player has walked up to, so they can ride it.
    const idle = !bike.riding && !bike.action && bike.throwRemaining <= 0;
    const mine = Math.hypot(bike.pos.x - state.pos.x, bike.pos.z - state.pos.z);
    const othersAt = peers.flatMap((p) => {
      const pose = p.presence["pose"];
      return !p.sameTab && isPoseWire(pose) && pose.bv === 1 ? [{ x: pose.b[0]!, z: pose.b[2]! }] : [];
    });
    if (bike.id && idle && (mine > RELEASE_METERS || shouldHandOver(mine, bike.pos, othersAt))) {
      const id = bike.id, spot = spotOf(state);
      dropScooter(state);
      void releaseBike(code, id, spot).catch(() => {});
      void channel.presence({ bike: null }).catch(() => {});
    }

    // Never reach for a bike someone else is clearly closer to: they get it (and its E sign) instead.
    const reachable = free
      .map(([id, rec]) => ({ id, x: rec.pos[0], z: rec.pos[2] }))
      .filter((b) => !shouldHandOver(Math.hypot(b.x - state.pos.x, b.z - state.pos.z), b, othersAt));
    const target = busy.current || state.accident ? null : bikeToClaim(
      state.pos,
      bike.id ? { id: bike.id, distance: Math.hypot(bike.pos.x - state.pos.x, bike.pos.z - state.pos.z), busy: !idle } : null,
      reachable,
    );
    if (target) {
      busy.current = true;
      void claimBike(code, target, me, (holder) => present.has(holder)).then((ok) => {
        const rec = bikes.current.get(target);
        if (!ok || !rec) return;
        // The player may have started using their current bike meanwhile: then hand the new one straight back.
        if (state.scooter.riding || state.scooter.action) { void releaseBike(code, target, rec); return; }
        if (state.scooter.id) void releaseBike(code, state.scooter.id, spotOf(state)).catch(() => {});
        takeScooter(state, target, rec);
        knocks.current.set(target, rec.knock);
        saved.current = { at: Date.now(), spot: JSON.stringify(spotOf(state)) };
        void channel.presence({ bike: target }).catch(() => {});
      }).catch(() => {}).finally(() => { busy.current = false; });
    }

    // Keep the controlled bike's resting place current for late arrivals and for after this player leaves.
    if (bike.id && now - saved.current.at >= SAVE_MS) {
      const spot = spotOf(state), text = JSON.stringify(spot);
      if (text !== saved.current.spot) { saved.current = { at: now, spot: text }; void saveBike(code, bike.id, spot).catch(() => {}); }
    }

    // Parked bikes are solid for walking into, and drawn below.
    const boxes: OtherBike[] = [];
    // A parked bike this player is shoving is shown where it is going (its own shove the host has not used yet added).
    const ahead = (id: string, rec: BikeRecord): [number, number] => { const t = sh.totals.get(id), done = me ? rec.applied[me] : undefined; return t ? [t[0] - (done?.[0] ?? 0), t[1] - (done?.[1] ?? 0)] : [0, 0]; };
    shown.current = new Map(free.map(([id, rec]) => { const [ox, oz] = hosting ? [0, 0] : ahead(id, rec); return [id, [rec.pos[0] + ox, rec.pos[1], rec.pos[2] + oz] as [number, number, number]]; }));
    for (const [id, rec] of free) { const at = shown.current.get(id) ?? rec.pos; boxes.push({ id, box: scooterFootprint(at[0], at[2], rec.yaw, rec.fallen, rec.fallSide), fallen: rec.fallen }); }
    state.parkedBikes = boxes;
    const ids = free.map(([id]) => id);
    setParked((old) => (old.length === ids.length && old.every((id, i) => id === ids[i]) ? old : ids));
  });
  useEffect(() => () => { state.parkedBikes = []; }, [state]);

  return <>{parked.map((id) => <ParkedBike key={id} id={id} bikes={bikes} shown={shown} state={state} />)}</>;
}

const ParkedBike = memo(function ParkedBike({ id, bikes, shown, state }: { id: string; bikes: React.RefObject<Bikes>; shown: React.RefObject<Map<string, [number, number, number]>>; state: GameState }) {
  const group = useRef<THREE.Group>(null);
  const look = useMemo<ScooterLook>(() => ({ darkness: 0, scooter: { riding: false, steering: 0, braking: false } }), []);
  useFrame(() => {
    const rec = bikes.current?.get(id), g = group.current;
    if (!rec || !g) return;
    // Same resting pose as the Scooter: a fallen bike lies on its side, lifted by its own width.
    const lean = rec.fallen ? -Math.PI / 2 * rec.fallSide : -0.08;
    const at = shown.current?.get(id) ?? rec.pos;
    g.position.set(at[0], at[1] + 0.3 * Math.abs(lean) / (Math.PI / 2), at[2]);
    g.rotation.set(0, rec.yaw, lean);
    look.darkness = state.darkness;
  });
  return <group ref={group}><ScooterModel state={look} headlight={false} /></group>;
});
