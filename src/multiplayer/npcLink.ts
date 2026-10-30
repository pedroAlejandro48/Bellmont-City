import { isNpcSnapshot, type NpcLink } from "@/game/pedestrians";
import type { NamedRoom, Peer } from "@/platform/realtime";

const joinedAt = (p: Peer) => (typeof p.presence["joinedAt"] === "number" ? p.presence["joinedAt"] : Infinity);
type Hit = { id: number; d: [number, number]; at: number };
const isHit = (v: unknown): v is Hit => {
  const h = v as Hit | null;
  return typeof h === "object" && h !== null && typeof h.id === "number" && typeof h.at === "number" && Array.isArray(h.d) && h.d.length === 2 && h.d.every((n) => typeof n === "number");
};

/**
 * Shares one set of NPCs across a room. Whoever has been in the room longest (first on the people list) runs
 * them and publishes where they are (presence `npcs`); everyone else shows that, and reports any NPC their own
 * traffic hits (presence `npcHits`) for the host to knock down. When the host leaves, the next in line takes
 * over from the NPCs as last seen.
 */
export function makeNpcLink(channel: NamedRoom): NpcLink {
  const seen = new Map<string, number>();
  let mine: Hit[] = [];
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
    publish: (snapshot) => { void channel.presence({ npcs: snapshot }).catch(() => {}); },
    latest: () => {
      const h = host();
      if (!h || h.sameTab) return null;
      const value = h.presence["npcs"];
      return isNpcSnapshot(value) ? value : null;
    },
    sendHit: (id, direction) => {
      const at = Date.now();
      mine = [...mine.filter((h) => at - h.at < 5000), { id, d: direction, at }];
      void channel.presence({ npcHits: mine }).catch(() => {});
    },
    takeHits: () => {
      const out: { id: number; direction: [number, number] }[] = [];
      for (const peer of channel.peers()) {
        if (peer.sameTab) continue;
        const hits = Array.isArray(peer.presence["npcHits"]) ? (peer.presence["npcHits"] as unknown[]).filter(isHit) : [];
        const newest = hits.reduce((m, h) => Math.max(m, h.at), 0);
        const last = seen.get(peer.peer);
        // The first look at someone only notes where their reports are up to (they were already handled).
        if (last !== undefined) for (const h of hits) if (h.at > last) out.push({ id: h.id, direction: h.d });
        seen.set(peer.peer, Math.max(last ?? 0, newest));
      }
      return out;
    },
  };
}
