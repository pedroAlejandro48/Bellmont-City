import { readTrafficSnapshot, type TrafficLink, type TrafficSnapshot } from "@/game/trafficShare";
import type { NamedRoom, Peer } from "@/platform/realtime";

const joinedAt = (p: Peer) => (typeof p.presence["joinedAt"] === "number" ? p.presence["joinedAt"] : Infinity);
type Hit = { id: number; at: number };
const isHit = (v: unknown): v is Hit => { const h = v as Hit | null; return typeof h === "object" && h !== null && typeof h.id === "number" && typeof h.at === "number"; };

/**
 * Shares one traffic across a room, like the NPCs (the same player runs both): the longest-present player runs
 * the vehicles and publishes them (presence `traffic`); everyone else draws them and reports the vehicles that
 * knock them down (presence `trafficHits`) so the host stops those.
 */
export function makeTrafficLink(channel: NamedRoom): TrafficLink {
  const seen = new Map<string, number>();
  let mine: Hit[] = [];
  let last: { value: unknown; snapshot: TrafficSnapshot | null; at: number } | null = null;
  const host = () => {
    let best: Peer | null = null;
    for (const p of channel.peers()) {
      if (p.kind !== "viewer") continue;
      if (!best || joinedAt(p) < joinedAt(best) || (joinedAt(p) === joinedAt(best) && p.peer < best.peer)) best = p;
    }
    return best;
  };
  return {
    isHost: () => host()?.sameTab ?? true,
    publish: (snapshot) => { void channel.presence({ traffic: snapshot }).catch(() => {}); },
    latest: () => {
      const h = host();
      if (!h || h.sameTab) return null;
      const value = h.presence["traffic"];
      if (!last || last.value !== value) last = { value, snapshot: readTrafficSnapshot(value), at: Date.now() };
      return last.snapshot ? { snapshot: last.snapshot, at: last.at } : null;
    },
    sendHit: (id) => {
      const at = Date.now();
      mine = [...mine.filter((h) => at - h.at < 5000), { id, at }];
      void channel.presence({ trafficHits: mine }).catch(() => {});
    },
    takeHits: () => {
      const out: number[] = [];
      for (const peer of channel.peers()) {
        if (peer.sameTab) continue;
        const hits = Array.isArray(peer.presence["trafficHits"]) ? (peer.presence["trafficHits"] as unknown[]).filter(isHit) : [];
        const lastAt = seen.get(peer.peer);
        if (lastAt !== undefined) for (const h of hits) if (h.at > lastAt) out.push(h.id);
        seen.set(peer.peer, Math.max(lastAt ?? 0, ...hits.map((h) => h.at)));
      }
      return out;
    },
  };
}
