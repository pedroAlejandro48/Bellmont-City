import { useLiveName } from "@/platform/liveNames";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BODY_PARTS, CharacterBody, useBodyRig } from "@/game/CharacterBody";
import { RagdollMeshes, RAGDOLL_PART_COUNT } from "@/game/Ragdoll";
import { ScooterModel, type ScooterLook } from "@/game/Scooter";
import { knockedByPlayer, type GameState, type OtherBike, type OtherBody } from "@/game/state";
import { scooterFootprint } from "@/game/config";
import type { NamedRoom, Peer } from "@/platform/realtime";
import { applyPose, capturePose, isPoseWire, PoseBuffer, RENDER_DELAY_MS, SEND_HZ, type RemoteRig } from "./pose";
import { spawnBeside, standingFromPose, type Standing } from "./spawn";
import { NameLabel } from "./NameLabel";
import { makeNpcLink } from "./npcLink";
import { makeFoodLink } from "./foodLink";
import { makeTrafficLink } from "./trafficLink";
import { makeDoorLink } from "./doorLink";
import { makeLiftLink } from "./liftLink";
import { FurnitureSync } from "./FurnitureSync";
import { HospitalSync } from "./HospitalSync";
import { GrocerySync } from "./GrocerySync";
import { GroceryBagModel, drinkTip, heldWire, tipToMouth, ItemModel, useLooks, type HeldWire, type Thing } from "@/game/InventoryWorld";
import { Basket, type InBasket } from "@/game/Grocery";
import { handWorld } from "@/game/arms";
import { bodyColor, playerOf, type Gender } from "@/platform/account";

/** How long after entering a late-arriving position can still move a player who has not moved yet. */
const SPAWN_FIX_MS = 8000;

const BODY_RADIUS = 0.35;
const bikeQuat = new THREE.Quaternion(), bikeTilt = new THREE.Euler();
const RIDER_RADIUS = 0.6;

/** A crash message one player puts in presence for the player they hit. */
export function readHit(value: unknown): { peer: string; at: number; direction: [number, number]; speed: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>, d = v["direction"];
  if (typeof v["peer"] !== "string" || typeof v["at"] !== "number" || typeof v["speed"] !== "number") return null;
  const [dx, dz] = Array.isArray(d) ? d : [];
  if (typeof dx !== "number" || typeof dz !== "number") return null;
  return { peer: v["peer"], at: v["at"], direction: [dx, dz], speed: v["speed"] };
}

/** Other players in this room (one per open tab), each with its own smoothing buffer. */
export type RemotePlayers = Map<string, { buffer: PoseBuffer; presence: Peer["presence"] | null }>;

export function remotePeers(peers: readonly Peer[]) {
  return peers.filter((p) => p.kind === "viewer" && !p.sameTab);
}

/** Streams this player's pose to the room and draws everyone else's. */
export function RoomScene({ state, channel, remotes, joinedAt, creator }: { state: GameState; channel: NamedRoom; remotes: RemotePlayers; joinedAt: number; creator: string }) {
  // One avatar per other tab, with the account it is signed in as (for its username label).
  const listed = (peers: readonly Peer[]) => remotePeers(peers).map((p) => `${p.peer} ${p.by ?? ""}`);
  const [ids, setIds] = useState<string[]>(() => listed(channel.peers()));
  useEffect(() => channel.onPeers(({ peers }) => {
    const next = listed(peers);
    setIds((old) => (old.length === next.length && old.every((id, i) => id === next[i]) ? old : next));
  }), [channel]);

  // The room's NPCs are shared: one player runs them, everyone sees the same ones.
  useEffect(() => {
    state.npcLink = makeNpcLink(channel);
    // And so are the restaurants: the orders, the staff and the food.
    state.foodLink = makeFoodLink(channel);
    // So are the traffic and the restaurant doors.
    state.trafficLink = makeTrafficLink(channel);
    state.doorLink = makeDoorLink(channel);
    state.liftLink = makeLiftLink(channel, { apts: () => state.roomKept?.apts ?? [], homes: () => state.roomKept?.homes ?? [] });
    return () => { state.npcLink = null; state.foodLink = null; state.trafficLink = null; state.doorLink = null; state.liftLink = null; };
  }, [state, channel]);
  const lastSent = useRef({ at: 0, body: "" });
  const lastHeld = useRef({ at: 0, body: "" });
  const lastHitAt = useRef(Date.now());
  // Until this player first moves, someone found standing on their spawn point (whose position arrived late) and who
  // was here first makes them step to that person's left, as if they had spawned there.
  const spawnCheck = useRef<{ x: number; z: number; until: number } | null>(null);
  // Whether this game is open in front (else the browser pauses it, and someone else runs the shared world).
  useEffect(() => {
    const say = () => { void channel.presence({ awake: document.visibilityState === "visible" }).catch(() => {}); };
    say();
    document.addEventListener("visibilitychange", say);
    window.addEventListener("pagehide", say);
    return () => { document.removeEventListener("visibilitychange", say); window.removeEventListener("pagehide", say); };
  }, [channel]);
  useEffect(() => {
    spawnCheck.current = { x: state.pos.x, z: state.pos.z, until: Date.now() + SPAWN_FIX_MS };
    // While arriving, others do not bump into this player, so nobody is shoved off the spawn point.
    void channel.presence({ arriving: true }).catch(() => {});
  }, [state, channel]);
  useFrame(() => {
    const now = Date.now();
    // Send at SEND_HZ, and only when something moved (an idle player costs nothing).
    if (now - lastSent.current.at >= 1000 / SEND_HZ) {
      // (The car's height as it is now, after this frame's step: the one the body stands on.)
      const ride = state.carRide, carNow = ride ? { b: ride.b, y: state.carYOf?.(ride.b) ?? ride.y } : null;
      const pose = capturePose(state.avatar, state.scooter, now, carNow);
      if (pose) {
        const body = JSON.stringify([pose.b, pose.bv, pose.r, pose.s, pose.sf, pose.lk]);
        if (body !== lastSent.current.body) {
          lastSent.current = { at: now, body };
          void channel.presence({ pose }).catch(() => {});
        }
      }
    }
    // What's in this player's hands (for the others to draw), when it changes.
    if (now - lastHeld.current.at > 150) {
      const w = JSON.stringify(heldWire(state));
      if (w !== lastHeld.current.body) { lastHeld.current = { at: now, body: w }; void channel.presence({ held: w }).catch(() => {}); }
      else lastHeld.current.at = now;
    }
    // Take in new poses, drop players who left, and hand their bodies to the local collision.
    const present = new Set<string>();
    const others: OtherBody[] = [];
    const bikes: OtherBike[] = [];
    for (const peer of remotePeers(channel.peers())) {
      present.add(peer.peer);
      let remote = remotes.get(peer.peer);
      if (!remote) remotes.set(peer.peer, (remote = { buffer: new PoseBuffer(), presence: null }));
      if (peer.presence !== remote.presence) {
        remote.presence = peer.presence;
        if (isPoseWire(peer.presence["pose"])) remote.buffer.push(peer.presence["pose"], now);
      }
      const at = remote.buffer.sample(now);
      if (at && at.b.bv === 1 && peer.presence["arriving"] !== true) {
        const ax = at.a.b[0]!, az = at.a.b[2]!, bx = at.b.b[0]!, bz = at.b.b[2]!;
        others.push({ x: ax + (bx - ax) * at.t, z: az + (bz - az) * at.t, r: at.b.sf & 1 ? RIDER_RADIUS : BODY_RADIUS, id: peer.peer });
      }
      if (at && (at.b.sf & 4) && !(at.b.sf & 1)) {
        const [x, , z, qx, qy, qz, qw] = at.b.s;
        if (x !== undefined && z !== undefined && qx !== undefined && qy !== undefined && qz !== undefined && qw !== undefined) {
          const { y: yaw, z: lean } = bikeTilt.setFromQuaternion(bikeQuat.set(qx, qy, qz, qw), "YXZ");
          const fallen = Math.abs(lean) > 1;
          const held = peer.presence["bike"];
          if (typeof held === "string") bikes.push({ id: held, box: scooterFootprint(x, z, yaw, fallen, lean < 0 ? 1 : -1), fallen });
        }
      }
    }
    for (const id of remotes.keys()) if (!present.has(id)) remotes.delete(id);

    // Crashing into another player at speed knocks them down too: tell them; and hear when it happens to us.
    for (const impact of state.impacts) {
      if (impact.kind === "player") void channel.presence({ hit: { peer: impact.id, at: now, direction: impact.direction, speed: impact.speed } }).catch(() => {});
    }
    state.impacts = state.impacts.filter((impact) => impact.kind !== "player");
    const me = channel.peers().find((p) => p.sameTab)?.peer;
    for (const peer of remotePeers(channel.peers())) {
      const hit = readHit(peer.presence["hit"]);
      if (!hit || hit.peer !== me || hit.at <= lastHitAt.current) continue;
      lastHitAt.current = hit.at;
      knockedByPlayer(state, hit.direction, hit.speed, Math.floor(Math.random() * 1e8));
    }
    state.others = others;
    state.otherBikes = bikes;

    const check = spawnCheck.current;
    if (check) {
      const p = state.pos;
      // Others draw this player a moment in the past, so stay "arriving" until they have seen the final spot.
      const settle = () => { spawnCheck.current = null; window.setTimeout(() => { void channel.presence({ arriving: null }).catch(() => {}); }, RENDER_DELAY_MS * 5); };
      // Only the player's own input counts as moving: bumps from the person standing here do not.
      if (now > check.until || state.keys.size > 0 || state.scooter.riding || state.scooter.action || state.bench) settle();
      else {
        const earlier = remotePeers(channel.peers()).flatMap((peer): Standing[] => {
          const pose = peer.presence["pose"], at = isPoseWire(pose) ? standingFromPose(pose) : null;
          const since = peer.presence["joinedAt"];
          return at && typeof since === "number" && since < joinedAt ? [at] : [];
        });
        const to = spawnBeside({ x: check.x, z: check.z }, earlier);
        if (to.x !== check.x || to.z !== check.z) {
          const dx = to.x - p.x, dz = to.z - p.z;
          p.x = to.x; p.z = to.z;
          if (!state.scooter.fallen && !state.scooter.action) { state.scooter.pos.x += dx; state.scooter.pos.z += dz; }
          settle();
        }
      }
    }
  });
  useEffect(() => () => { state.others = []; state.otherBikes = []; }, [state]);

  return <><FurnitureSync state={state} channel={channel} /><HospitalSync state={state} channel={channel} /><GrocerySync state={state} channel={channel} />{ids.map((entry) => {
    const [id = "", uid = ""] = entry.split(" ");
    return <RemoteAvatar key={entry} id={id} uid={uid} creator={uid !== "" && uid === creator} remotes={remotes} state={state} />;
  })}</>;
}

const RemoteAvatar = memo(function RemoteAvatar({ id, uid, creator, remotes, state }: { id: string; uid: string; creator: boolean; remotes: RemotePlayers; state: GameState }) {
  const [profile, setProfile] = useState<{ username: string | null; gender: Gender | null }>({ username: null, gender: null });
  useEffect(() => {
    let live = true, retry: number | undefined;
    // Keep trying until the profile loads, so nobody is left without a name label after a network hiccup.
    const load = (delay: number) => {
      if (!uid) return;
      void playerOf(uid).then((p) => {
        if (!live) return;
        if (p.username) setProfile(p); else retry = window.setTimeout(() => load(Math.min(delay * 2, 15000)), delay);
      }).catch(() => { if (live) retry = window.setTimeout(() => load(Math.min(delay * 2, 15000)), delay); });
    };
    load(1000);
    return () => { live = false; window.clearTimeout(retry); };
  }, [uid]);
  // (The name label follows their username live: a rename shows at once.)
  const name = useLiveName(uid, profile.username ?? "") || null, color = bodyColor(profile.gender);
  const body = useBodyRig();
  // Food this player holds is drawn in their hands.
  useEffect(() => { state.remoteRigs.set(id, body); return () => { if (state.remoteRigs.get(id) === body) state.remoteRigs.delete(id); }; }, [state, id, body]);
  const rig = useRef<RemoteRig>({ body: [], ragdoll: Array(RAGDOLL_PART_COUNT).fill(null), scooter: null, front: null });
  const look = useMemo<ScooterLook>(() => ({ darkness: 0, scooter: { riding: false, steering: 0, braking: false } }), []);
  const ragdollMat = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.72 }), [color]);
  const group = useRef<THREE.Group>(null);

  useFrame(() => {
    const remote = remotes.get(id);
    const at = remote?.buffer.sample(Date.now());
    if (group.current) group.current.visible = !!at;
    if (!at) return;
    rig.current.body = BODY_PARTS.map((part) => body[part].current);
    applyPose(rig.current, at.a, at.b, at.t);
    // In an elevator car: standing in this player's own copy of it (the same height above its floor as they sent),
    // so everyone in it moves together with it here, however late their poses arrive.
    const root = rig.current.body[0];
    if (root && at.b.lk !== undefined && at.b.ly !== undefined) {
      const here = state.carYOf?.(at.b.lk) ?? null;
      if (here !== null) {
        const sentCar = at.a.lk === at.b.lk && at.a.ly !== undefined ? THREE.MathUtils.lerp(at.a.ly, at.b.ly, at.t) : at.b.ly;
        root.position.y += here - sentCar;
      }
    }
    look.darkness = state.darkness;
    look.scooter.riding = (at.b.sf & 1) === 1;
    look.scooter.braking = (at.b.sf & 2) === 2;
    look.scooter.steering = THREE.MathUtils.lerp(at.a.s[7] ?? 0, at.b.s[7] ?? 0, at.t); // The model steers its own front wheel from this.
  });

  return <group ref={group} visible={false}>
    <CharacterBody rig={body} color={color} />
    {name && <NameLabel name={name} crown={creator} follow={() => body.root.current} />}
    <RemoteHeld id={id} remotes={remotes} body={body} />
    <RagdollMeshes mat={ragdollMat} groupRef={(i, el) => { rig.current.ragdoll[i] = el; }} />
    <group ref={(el) => { rig.current.scooter = el; }}>
      <ScooterModel state={look} headlight={false} frontRef={(el) => { rig.current.front = el; }} />
    </group>
  </group>;
});

/** What another player holds, in their hands as they move: the thing in each hand, the grocery bag, the store basket. */
function RemoteHeld({ id, remotes, body }: { id: string; remotes: RemotePlayers; body: ReturnType<typeof useBodyRig> }) {
  const looks0 = useLooks();
  const looks = useMemo(() => Object.assign({}, looks0, { basket: new THREE.MeshStandardMaterial({ color: "#d62f3a", roughness: 0.55 }) }), [looks0]);
  const [held, setHeld] = useState<HeldWire>({ r: null, l: null, bag: -1, bk: null });
  const raw = useRef(""), drinkStart = useRef<number | null>(null);
  const rG = useRef<THREE.Group>(null), lG = useRef<THREE.Group>(null), bagG = useRef<THREE.Group>(null), bkG = useRef<THREE.Group>(null);
  const tmp = useMemo(() => ({ e: new THREE.Euler(), q: new THREE.Quaternion() }), []);
  useFrame(() => {
    const w = remotes.get(id)?.presence?.["held"];
    if (typeof w === "string" && w !== raw.current) { raw.current = w; try { setHeld(JSON.parse(w) as HeldWire); } catch { /* */ } }
    const root = body.root.current, foreR = body.foreR.current, foreL = body.foreL.current;
    if (!root) return;
    const yaw = tmp.e.setFromQuaternion(root.getWorldQuaternion(tmp.q), "YXZ").y;
    const place = (g: THREE.Group | null, fore: THREE.Object3D | null, kind: string | null, turn = 0) => {
      if (!g || !fore) return;
      fore.updateWorldMatrix(true, false); handWorld(fore, g.position);
      let tipX = 0;
      if (kind === "phone") { tipX = -0.55; turn = Math.PI; g.position.y += 0.05; }
      if (kind === "key") { tipX = Math.PI / 2; g.position.x += Math.sin(yaw) * 0.035; g.position.z += Math.cos(yaw) * 0.035; g.position.y -= 0.01; }
      if (kind === "water" || kind === "bottle" || kind === "orangeJuice" || kind === "appleJuice") g.position.y -= 0.07;
      if (kind === "cola" || kind === "lemonSoda" || kind === "energy" || kind === "can") g.position.y -= 0.05;
      g.rotation.set(tipX, yaw + turn, 0, "YXZ");
      g.scale.setScalar(kind === "key" ? 1.7 : 1);
    };
    place(rG.current, foreR, held.r);
    place(lG.current, foreL, held.l);
    // Drinking: tipped back to their face, the opening at the lips (timed from when it started here).
    if (held.dr) { drinkStart.current ??= performance.now() / 1000; } else drinkStart.current = null;
    const head = body.head.current, dg = held.dr === "l" ? lG.current : held.dr === "r" ? rG.current : null, dk = held.dr === "l" ? held.l : held.r;
    if (dg && head && dk && drinkStart.current !== null) tipToMouth(dg, dk, head, yaw, drinkTip(performance.now() / 1000 - drinkStart.current));
    if (bagG.current && foreL) { foreL.updateWorldMatrix(true, false); handWorld(foreL, bagG.current.position); bagG.current.rotation.set(0, yaw, 0); }
    if (bkG.current && foreR) { foreR.updateWorldMatrix(true, false); handWorld(foreR, bkG.current.position); bkG.current.rotation.set(0, yaw + Math.PI / 2, 0); }
  });
  const basketItems = useMemo<InBasket[]>(() => (held.bk ?? []).map(([kind, x, y, z, rot]) => ({ kind: kind as InBasket["kind"], x, y, z, rot })), [held.bk]);
  return <>
    {held.r && !held.bk && <group ref={rG}><ItemModel kind={held.r as Thing} looks={looks} empty={held.r === "bottle"} /></group>}
    {held.l && held.bag < 0 && <group ref={lG}><ItemModel kind={held.l as Thing} looks={looks} empty={held.l === "bottle"} /></group>}
    {held.bag >= 0 && <group ref={bagG}><GroceryBagModel items={held.bag} looks={looks} /></group>}
    {held.bk && <group ref={bkG}><Basket looks={looks} items={basketItems} /></group>}
  </>;
}
