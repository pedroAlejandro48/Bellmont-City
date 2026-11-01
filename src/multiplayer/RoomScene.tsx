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
    return () => { state.npcLink = null; state.foodLink = null; };
  }, [state, channel]);
  const lastSent = useRef({ at: 0, body: "" });
  const lastHitAt = useRef(Date.now());
  // Until this player first moves, someone found standing on their spawn point (whose position arrived late) and who
  // was here first makes them step to that person's left, as if they had spawned there.
  const spawnCheck = useRef<{ x: number; z: number; until: number } | null>(null);
  useEffect(() => {
    spawnCheck.current = { x: state.pos.x, z: state.pos.z, until: Date.now() + SPAWN_FIX_MS };
    // While arriving, others do not bump into this player, so nobody is shoved off the spawn point.
    void channel.presence({ arriving: true }).catch(() => {});
  }, [state, channel]);
  useFrame(() => {
    const now = Date.now();
    // Send at SEND_HZ, and only when something moved (an idle player costs nothing).
    if (now - lastSent.current.at >= 1000 / SEND_HZ) {
      const pose = capturePose(state.avatar, state.scooter, now);
      if (pose) {
        const body = JSON.stringify([pose.b, pose.bv, pose.r, pose.s, pose.sf]);
        if (body !== lastSent.current.body) {
          lastSent.current = { at: now, body };
          void channel.presence({ pose }).catch(() => {});
        }
      }
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
          if (typeof held === "string") bikes.push({ id: held, box: scooterFootprint(x, z, yaw, fallen, lean < 0 ? 1 : -1) });
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

  return <>{ids.map((entry) => {
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
  const name = profile.username, color = bodyColor(profile.gender);
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
    look.darkness = state.darkness;
    look.scooter.riding = (at.b.sf & 1) === 1;
    look.scooter.braking = (at.b.sf & 2) === 2;
    look.scooter.steering = THREE.MathUtils.lerp(at.a.s[7] ?? 0, at.b.s[7] ?? 0, at.t); // The model steers its own front wheel from this.
  });

  return <group ref={group} visible={false}>
    <CharacterBody rig={body} color={color} />
    {name && <NameLabel name={name} crown={creator} follow={() => body.root.current} />}
    <RagdollMeshes mat={ragdollMat} groupRef={(i, el) => { rig.current.ragdoll[i] = el; }} />
    <group ref={(el) => { rig.current.scooter = el; }}>
      <ScooterModel state={look} headlight={false} frontRef={(el) => { rig.current.front = el; }} />
    </group>
  </group>;
});
