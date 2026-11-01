import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { SIT } from "@/game/restaurantRoom";
import type { GameState } from "@/game/state";
import type { NamedRoom, Peer } from "@/platform/realtime";

const joinedAt = (p: Peer) => (typeof p.presence["joinedAt"] === "number" ? p.presence["joinedAt"] : Infinity);
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Moves this recent belong to whoever made them: nobody else's word on that piece counts for now. */
const HOLD_MS = 1500;

type Moves = { key: string; items: [number, number, number][] };
type Claim = { key: string; chair: number; at: number };
const isMoves = (v: unknown): v is Moves => {
  const m = v as Moves | null;
  return typeof m === "object" && m !== null && typeof m.key === "string" && Array.isArray(m.items);
};
const isClaim = (v: unknown): v is Claim => {
  const c = v as Claim | null;
  return typeof c === "object" && c !== null && typeof c.key === "string" && typeof c.chair === "number" && typeof c.at === "number";
};
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : typeof x === "object" && x !== null ? Object.values(x) : []);

/**
 * Restaurant furniture and chairs shared across a room. Whoever moves a table or chair (pulling a chair out to sit,
 * sliding it back, or running into furniture) sends where it is (presence `fmoves`), and everyone else slides it
 * there; the room's host also shares where everything is now and then (`furniture`), for players who arrive
 * later. Sitting down claims the chair (`chair`): a chair someone sits on, or has started sitting on, cannot be
 * taken, and if two players go for the same chair at once, the one who pressed E first keeps it.
 */
export function FurnitureSync({ state, channel }: { state: GameState; channel: NamedRoom }) {
  const s = useRef({
    known: new Map<string, [number, number]>(),
    mineAt: new Map<string, number>(),
    theirsAt: new Map<string, number>(),
    sentAt: 0, sentShape: "", hostAt: 0, hostShape: "", lastSeenMoves: new Map<string, unknown>(), hostSeen: null as unknown, hostRooms: null as Record<string, number[]> | null, applied: new Set<string>(), everApplied: new Set<string>(),
    claim: null as Claim | null,
  });
  useEffect(() => () => { state.takenChairs = new Set(); void channel.presence({ chair: null, fmoves: null }).catch(() => {}); }, [state, channel]);

  useFrame((_, raw) => {
    const now = Date.now(), dt = Math.min(raw, 0.05), m = s.current;
    const peers = channel.peers(), others = peers.filter((p) => !p.sameTab && p.kind === "viewer");
    const id = (key: string, i: number) => `${key}#${i}`;

    // ---- this player's own moves: anything that changed since last frame was moved here ----
    const moved = new Map<string, [number, number, number][]>();
    for (const room of state.rooms.values()) room.items.forEach((it, i) => {
      const k = id(room.key, i), was = m.known.get(k);
      if (was && (Math.abs(was[0] - it.x) > 1e-4 || Math.abs(was[1] - it.z) > 1e-4)) {
        m.mineAt.set(k, now);
        const list = moved.get(room.key) ?? []; list.push([i, r2(it.x), r2(it.z)]); moved.set(room.key, list);
      }
      m.known.set(k, [it.x, it.z]);
    });
    // Keep telling the others while moving (ten times a second), and once more when it stops.
    const busy = [...moved][0];
    const shape = busy ? JSON.stringify(busy) : "";
    if (busy && now - m.sentAt > 100) {
      m.sentAt = now; m.sentShape = shape;
      void channel.presence({ fmoves: { key: busy[0], items: busy[1] } }).catch(() => {});
    } else if (!busy && m.sentShape && now - m.sentAt > 100) {
      // The final resting places of what was last moved.
      const last = JSON.parse(m.sentShape) as [string, [number, number, number][]];
      const room = state.rooms.get(last[0]);
      if (room) void channel.presence({ fmoves: { key: last[0], items: last[1].map(([i]) => [i, r2(room.items[i]?.x ?? 0), r2(room.items[i]?.z ?? 0)]) } }).catch(() => {});
      m.sentShape = ""; m.sentAt = now;
    }

    // ---- others' moves: slide each piece to where they have it ----
    const follow = (key: string, i: number, x: number, z: number, snap: boolean) => {
      const room = state.rooms.get(key), it = room?.items[i];
      if (!room || !it) return;
      const k = id(key, i);
      if (now - (m.mineAt.get(k) ?? 0) < HOLD_MS) return;
      const kk = snap ? 1 : 1 - Math.exp(-14 * dt);
      it.x += (x - it.x) * kk; it.z += (z - it.z) * kk;
      m.known.set(k, [it.x, it.z]);
    };
    const targets = new Map<string, [number, number]>();
    for (const p of others) {
      const v = p.presence["fmoves"];
      if (!isMoves(v)) continue;
      if (m.lastSeenMoves.get(p.peer) !== v) { m.lastSeenMoves.set(p.peer, v); for (const row of list(v.items)) if (Array.isArray(row)) m.theirsAt.set(id(v.key, Number(row[0])), now); }
      for (const row of list(v.items)) {
        if (!Array.isArray(row) || row.length < 3) continue;
        const [i, x, z] = row as number[];
        if (typeof i === "number" && typeof x === "number" && typeof z === "number") targets.set(id(v.key, i), [x, z]);
      }
    }
    for (const [k, [x, z]] of targets) { const [key, i] = k.split("#"); if (key && i) follow(key, Number(i), x, z, false); }

    // ---- the host's record of every room, for late arrivals ----
    let host: Peer | null = null;
    for (const p of peers) if (p.kind === "viewer" && (!host || joinedAt(p) < joinedAt(host) || (joinedAt(p) === joinedAt(host) && p.peer < host.peer))) host = p;
    if (host?.sameTab) {
      if (now - m.hostAt > 2000) {
        const rooms: Record<string, number[]> = {};
        for (const room of state.rooms.values()) rooms[room.key.replace(/[.#$/[\]]/g, "_")] = room.items.flatMap((it) => [r2(it.x), r2(it.z)]);
        const text = JSON.stringify(rooms);
        if (text !== m.hostShape) { m.hostShape = text; void channel.presence({ furniture: { rooms: text } }).catch(() => {}); }
        m.hostAt = now;
      }
    } else if (host) {
      const v = host.presence["furniture"] as { rooms?: unknown } | undefined;
      if (v && v !== m.hostSeen && typeof v.rooms === "string") {
        m.hostSeen = v; m.applied.clear();
        try { m.hostRooms = JSON.parse(v.rooms) as Record<string, number[]>; } catch { m.hostRooms = null; }
      }
      // Each room takes the record once per new record (straight away the first time this player sees it).
      if (m.hostRooms) for (const room of state.rooms.values()) {
        if (m.applied.has(room.key)) continue;
        m.applied.add(room.key);
        const flat = m.hostRooms[room.key.replace(/[.#$/[\]]/g, "_")];
        if (!Array.isArray(flat)) continue;
        const first = !m.everApplied.has(room.key); m.everApplied.add(room.key);
        room.items.forEach((_, i) => {
          const k = id(room.key, i), x = flat[i * 2], z = flat[i * 2 + 1];
          if (typeof x !== "number" || typeof z !== "number") return;
          // Only for pieces nobody is moving right now.
          // (and not anything this player moved lately: the record may not have caught up with it yet).
          if (now - (m.theirsAt.get(k) ?? 0) < HOLD_MS * 2 || (!first && now - (m.mineAt.get(k) ?? 0) < 6000)) return;
          follow(room.key, i, x, z, true);
        });
      }
    }

    // ---- chairs: claimed while sat on ----
    const seat = state.seat;
    if (seat && (!m.claim || m.claim.key !== seat.room || m.claim.chair !== seat.plan.chair)) {
      m.claim = { key: seat.room, chair: seat.plan.chair, at: now };
      void channel.presence({ chair: m.claim }).catch(() => {});
    } else if (!seat && m.claim) {
      m.claim = null;
      void channel.presence({ chair: null }).catch(() => {});
    }
    const taken = new Set<string>();
    for (const p of others) {
      const c = p.presence["chair"];
      if (!isClaim(c)) continue;
      taken.add(id(c.key, c.chair));
      // Two at once on the same chair: whoever pressed E first keeps it; the other gets back up.
      const mine = m.claim;
      if (seat && mine && c.key === mine.key && c.chair === mine.chair && (c.at < mine.at || (c.at === mine.at && p.peer < (peers.find((q) => q.sameTab)?.peer ?? "")))) {
        if (seat.phase === "sit") {
          const t = state.simulationTime - seat.startedAt, done = SIT.done + seat.plan.extra;
          seat.phase = "stand"; seat.startedAt = state.simulationTime - (done - Math.min(done, t));
        }
      }
    }
    state.takenChairs = taken;
  });
  return null;
}
