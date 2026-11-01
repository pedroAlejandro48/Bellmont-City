import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { SIT } from "@/game/restaurantRoom";
import type { GameState } from "@/game/state";
import type { NamedRoom, Peer } from "@/platform/realtime";

const joinedAt = (p: Peer) => (typeof p.presence["joinedAt"] === "number" ? p.presence["joinedAt"] : Infinity);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const BAKE_MS = 3000;

type Claim = { key: string; chair: number; at: number };
const isClaim = (v: unknown): v is Claim => {
  const c = v as Claim | null;
  return typeof c === "object" && c !== null && typeof c.key === "string" && typeof c.chair === "number" && typeof c.at === "number";
};
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : typeof x === "object" && x !== null ? Object.values(x) : []);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
type Deltas = Map<string, [number, number]>;
/** Rows [roomKey, index, dx, dz] read back into a map by `roomKey#index`. */
function readDeltas(value: unknown): Deltas {
  const out: Deltas = new Map();
  for (const row of list(value)) {
    if (!Array.isArray(row)) continue;
    const [key, i, dx, dz] = row as unknown[];
    if (typeof key === "string" && num(i) && num(dx) && num(dz)) out.set(`${key}#${i}`, [dx, dz]);
  }
  return out;
}
const rows = (d: Deltas) => [...d].map(([k, [dx, dz]]) => { const at = k.lastIndexOf("#"); return [k.slice(0, at), Number(k.slice(at + 1)), r3(dx), r3(dz)]; });

/**
 * Restaurant furniture and chairs shared across a room, so several players can shove the same table at once.
 * Nobody sends where a piece is: each player sends how far, in total, they have pushed each piece (presence
 * `fdel`), and everyone puts every piece at its settled place plus all the players' pushes since then. Pushes
 * from several players add up (a table pushed from two sides goes where both push it) and nothing is ever
 * overwritten, so nothing jumps back and forth. Every few seconds the room's host settles everything (`fbase`:
 * where each piece is, and how far each player had pushed it by then), which is also what late arrivals start
 * from. Sitting down claims the chair (`chair`): a claimed chair can't be taken, and if two players start on the
 * same chair, whoever pressed E first keeps it.
 */
export function FurnitureSync({ state, channel }: { state: GameState; channel: NamedRoom }) {
  const s = useRef({
    /** Settled places (from the host), by `roomKey#index`, and each player's pushes already counted in them. */
    base: new Map<string, [number, number]>(), settled: new Map<string, Deltas>(), baseN: null as unknown,
    /** This player's own pushes so far, everyone else's (as last sent, and as shown, eased toward that). */
    mine: new Map<string, [number, number]>() as Deltas, theirs: new Map<string, Deltas>(), shown: new Map<string, Deltas>(),
    /** Where each piece was put last frame (anything that has moved since was pushed here). */
    placed: new Map<string, [number, number]>(),
    sentAt: 0, sent: "", bakedAt: 0, seq: 0,
    claim: null as Claim | null,
  });
  useEffect(() => () => { state.takenChairs = new Set(); void channel.presence({ chair: null, fdel: null }).catch(() => {}); }, [state, channel]);

  useFrame((_, raw) => {
    const now = Date.now(), dt = Math.min(raw, 0.05), m = s.current;
    const peers = channel.peers(), others = peers.filter((p) => !p.sameTab && p.kind === "viewer");
    const me = peers.find((p) => p.sameTab)?.peer ?? "";
    const id = (key: string, i: number) => `${key}#${i}`;

    // ---- this player's pushes: whatever moved since it was last put somewhere was moved here ----
    for (const room of state.rooms.values()) room.items.forEach((it, i) => {
      const k = id(room.key, i), was = m.placed.get(k);
      // A room seen for the first time: its pieces are where the game set them.
      if (!m.base.has(k)) m.base.set(k, [it.x, it.z]);
      if (was && (Math.abs(was[0] - it.x) > 1e-5 || Math.abs(was[1] - it.z) > 1e-5)) {
        const d = m.mine.get(k) ?? [0, 0];
        m.mine.set(k, [d[0] + it.x - was[0], d[1] + it.z - was[1]]);
      }
    });

    // ---- everyone else's pushes, eased in so they glide rather than step ----
    const present = new Set<string>([me]);
    for (const p of others) {
      present.add(p.peer);
      const latest = readDeltas(p.presence["fdel"]);
      m.theirs.set(p.peer, latest);
      const shown = m.shown.get(p.peer) ?? new Map<string, [number, number]>();
      const k = 1 - Math.exp(-15 * dt);
      for (const [key, [dx, dz]] of latest) {
        const was = shown.get(key);
        // The first sight of someone's pushes is taken as it is (they are already in the settled places).
        shown.set(key, was ? [was[0] + (dx - was[0]) * k, was[1] + (dz - was[1]) * k] : [dx, dz]);
      }
      m.shown.set(p.peer, shown);
    }
    for (const peer of [...m.theirs.keys()]) if (!present.has(peer)) { m.theirs.delete(peer); m.shown.delete(peer); }

    // ---- the host's settled record ----
    let host: Peer | null = null;
    for (const p of peers) if (p.kind === "viewer" && (!host || joinedAt(p) < joinedAt(host) || (joinedAt(p) === joinedAt(host) && p.peer < host.peer))) host = p;
    if (host && !host.sameTab) {
      const v = host.presence["fbase"] as { n?: unknown; pos?: unknown; snap?: unknown } | undefined;
      if (v && v.n !== undefined && v.n !== m.baseN) {
        m.baseN = v.n;
        for (const row of list(v.pos)) {
          if (!Array.isArray(row)) continue;
          const [key, i, x, z] = row as unknown[];
          if (typeof key === "string" && num(i) && num(x) && num(z)) m.base.set(id(key, i), [x, z]);
        }
        m.settled = new Map();
        for (const row of list(v.snap)) {
          if (!Array.isArray(row)) continue;
          const [peer, key, i, dx, dz] = row as unknown[];
          if (typeof peer !== "string" || typeof key !== "string" || !num(i) || !num(dx) || !num(dz)) continue;
          const d = m.settled.get(peer) ?? new Map<string, [number, number]>(); d.set(id(key, i), [dx, dz]); m.settled.set(peer, d);
        }
      }
    }

    // ---- every piece: settled place, plus everyone's pushes since ----
    const contributions: [string, Deltas][] = [[me, m.mine], ...[...m.shown].filter(([p]) => present.has(p))];
    for (const room of state.rooms.values()) room.items.forEach((it, i) => {
      const k = id(room.key, i), base = m.base.get(k);
      if (!base) return;
      let x = base[0], z = base[1];
      for (const [peer, d] of contributions) {
        const own = d.get(k), was = m.settled.get(peer)?.get(k);
        if (own) { x += own[0]; z += own[1]; }
        if (was) { x -= was[0]; z -= was[1]; }
      }
      it.x = x; it.z = z;
      m.placed.set(k, [x, z]);
    });

    // ---- tell the others (ten times a second, when there is something new) ----
    if (now - m.sentAt > 100) {
      const text = JSON.stringify(rows(m.mine));
      if (text !== m.sent) { m.sent = text; m.sentAt = now; void channel.presence({ fdel: rows(m.mine) }).catch(() => {}); }
    }
    // ---- hosting: settle everything now and then ----
    if (host?.sameTab && now - m.bakedAt > BAKE_MS) {
      m.bakedAt = now;
      const pos: unknown[] = [];
      for (const room of state.rooms.values()) room.items.forEach((it, i) => { pos.push([room.key, i, r3(it.x), r3(it.z)]); m.base.set(id(room.key, i), [it.x, it.z]); });
      const snap: unknown[] = [];
      m.settled = new Map();
      for (const [peer, d] of [[me, m.mine] as [string, Deltas], ...[...m.theirs].filter(([p]) => present.has(p))]) {
        const copy = new Map<string, [number, number]>();
        for (const [k, [dx, dz]] of d) { const at = k.lastIndexOf("#"); snap.push([peer, k.slice(0, at), Number(k.slice(at + 1)), r3(dx), r3(dz)]); copy.set(k, [dx, dz]); }
        m.settled.set(peer, copy);
      }
      // What others show is eased: settle on what they actually sent.
      for (const [peer, d] of m.theirs) m.shown.set(peer, new Map(d));
      m.seq += 1;
      void channel.presence({ fbase: { n: m.seq, pos, snap } }).catch(() => {});
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
      if (seat && mine && c.key === mine.key && c.chair === mine.chair && (c.at < mine.at || (c.at === mine.at && p.peer < me))) {
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
