import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BODY_PARTS, CharacterBody, useBodyRig } from "@/game/CharacterBody";
import { RagdollMeshes, RAGDOLL_PART_COUNT } from "@/game/Ragdoll";
import { ScooterModel, type ScooterLook } from "@/game/Scooter";
import type { GameState, OtherBody } from "@/game/state";
import { scooterFootprint, type SolidBox } from "@/game/config";
import type { NamedRoom, Peer } from "@/platform/claude";
import { applyPose, capturePose, isPoseWire, PoseBuffer, RENDER_DELAY_MS, SEND_HZ, type RemoteRig } from "./pose";
import { spawnBeside, standingFromPose, type Standing } from "./spawn";

/** How long after entering a late-arriving position can still move a player who has not moved yet. */
const SPAWN_FIX_MS = 8000;

const BODY_RADIUS = 0.35;
const bikeQuat = new THREE.Quaternion(), bikeTilt = new THREE.Euler();
const RIDER_RADIUS = 0.6;

/** Other players in this room (one per open tab), each with its own smoothing buffer. */
export type RemotePlayers = Map<string, { buffer: PoseBuffer; presence: Peer["presence"] | null }>;

export function remotePeers(peers: readonly Peer[]) {
  return peers.filter((p) => p.kind === "viewer" && !p.sameTab);
}

/** Streams this player's pose to the room and draws everyone else's. */
export function RoomScene({ state, channel, remotes, joinedAt }: { state: GameState; channel: NamedRoom; remotes: RemotePlayers; joinedAt: number }) {
  const [ids, setIds] = useState<string[]>(() => remotePeers(channel.peers()).map((p) => p.peer));
  useEffect(() => channel.onPeers(({ peers }) => {
    const next = remotePeers(peers).map((p) => p.peer);
    setIds((old) => (old.length === next.length && old.every((id, i) => id === next[i]) ? old : next));
  }), [channel]);

  const lastSent = useRef({ at: 0, body: "" });
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
    const bikes: SolidBox[] = [];
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
        others.push({ x: ax + (bx - ax) * at.t, z: az + (bz - az) * at.t, r: at.b.sf & 1 ? RIDER_RADIUS : BODY_RADIUS });
      }
      if (at && !(at.b.sf & 1)) {
        const [x, , z, qx, qy, qz, qw] = at.b.s;
        if (x !== undefined && z !== undefined && qx !== undefined && qy !== undefined && qz !== undefined && qw !== undefined) {
          const { y: yaw, z: lean } = bikeTilt.setFromQuaternion(bikeQuat.set(qx, qy, qz, qw), "YXZ");
          const fallen = Math.abs(lean) > 1;
          bikes.push(scooterFootprint(x, z, yaw, fallen, lean < 0 ? 1 : -1));
        }
      }
    }
    for (const id of remotes.keys()) if (!present.has(id)) remotes.delete(id);
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

  return <>{ids.map((id) => <RemoteAvatar key={id} id={id} remotes={remotes} state={state} />)}</>;
}

const RemoteAvatar = memo(function RemoteAvatar({ id, remotes, state }: { id: string; remotes: RemotePlayers; state: GameState }) {
  const body = useBodyRig();
  const rig = useRef<RemoteRig>({ body: [], ragdoll: Array(RAGDOLL_PART_COUNT).fill(null), scooter: null, front: null });
  const look = useMemo<ScooterLook>(() => ({ darkness: 0, scooter: { riding: false, steering: 0, braking: false } }), []);
  const ragdollMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.72 }), []);
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
    <CharacterBody rig={body} />
    <RagdollMeshes mat={ragdollMat} groupRef={(i, el) => { rig.current.ragdoll[i] = el; }} />
    <group ref={(el) => { rig.current.scooter = el; }}>
      <ScooterModel state={look} headlight={false} frontRef={(el) => { rig.current.front = el; }} />
    </group>
  </group>;
});
