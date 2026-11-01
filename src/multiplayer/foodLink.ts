import { readSnapshot, type FoodLink, type FoodRequest } from "@/game/food";
import type { NamedRoom, Peer } from "@/platform/realtime";

const joinedAt = (p: Peer) => (typeof p.presence["joinedAt"] === "number" ? p.presence["joinedAt"] : Infinity);
type Sent = { n: number; at: number; req: FoodRequest };
const isSent = (v: unknown): v is Sent => {
  const s = v as Sent | null;
  return typeof s === "object" && s !== null && typeof s.n === "number" && typeof s.at === "number" && typeof s.req === "object" && s.req !== null && typeof (s.req as { type?: unknown }).type === "string";
};

/**
 * Shares the restaurants across a room, like the NPCs: whoever has been in the room longest runs the orders, the
 * staff and the food, and publishes them (presence `food`); everyone else draws that, and sends what they do
 * (greeting the cashier, ordering, picking food up) as numbered requests (presence `foodReq`) for the host to
 * handle. Everyone also says which restaurant they are in (presence `inside`).
 */
export function makeFoodLink(channel: NamedRoom): FoodLink {
  const seen = new Map<string, number>();
  let seq = 0;
  let mine: Sent[] = [], next = 1, local: { by: string; req: FoodRequest }[] = [];
  let last: { value: unknown; view: ReturnType<typeof readSnapshot>; at: number } | null = null;
  let inside: string | null | undefined;
  const host = () => {
    let best: Peer | null = null;
    for (const p of channel.peers()) {
      if (p.kind !== "viewer") continue;
      if (!best || joinedAt(p) < joinedAt(best) || (joinedAt(p) === joinedAt(best) && p.peer < best.peer)) best = p;
    }
    return best;
  };
  const me = () => channel.peers().find((p) => p.sameTab)?.peer ?? "me";
  return {
    me,
    isHost: () => host()?.sameTab ?? true,
    // Numbered, so a snapshot is only taken as new when it is (presence objects are rebuilt on every update).
    publish: (snapshot) => { seq += 1; void channel.presence({ food: { ...snapshot, n: seq } }).catch(() => {}); },
    latest: () => {
      const h = host();
      if (!h || h.sameTab) return null;
      const value = h.presence["food"];
      const stamp = typeof value === "object" && value !== null ? (value as { n?: unknown }).n : undefined;
      if (!last || last.value !== stamp) last = { value: stamp, view: readSnapshot(value), at: Date.now() };
      return last.view ? { view: last.view, at: last.at } : null;
    },
    send: (req) => {
      if (host()?.sameTab ?? true) { local.push({ by: me(), req }); return; }
      const at = Date.now();
      mine = [...mine.filter((s) => at - s.at < 8000).slice(-15), { n: next++, at, req }];
      void channel.presence({ foodReq: mine }).catch(() => {});
    },
    takeRequests: () => {
      const out = local; local = [];
      for (const peer of channel.peers()) {
        if (peer.sameTab) continue;
        const list = Array.isArray(peer.presence["foodReq"]) ? (peer.presence["foodReq"] as unknown[]).filter(isSent) : [];
        const lastN = seen.get(peer.peer);
        // The first look at someone takes only what they sent in the last few seconds.
        for (const s of list) if (lastN === undefined ? Date.now() - s.at < 4000 : s.n > lastN) out.push({ by: peer.peer, req: s.req });
        seen.set(peer.peer, Math.max(lastN ?? 0, ...list.map((s) => s.n)));
      }
      return out;
    },
    others: () => {
      const map = new Map<string, string | null>();
      for (const p of channel.peers()) if (!p.sameTab && p.kind === "viewer") map.set(p.peer, typeof p.presence["inside"] === "string" ? p.presence["inside"] : null);
      return map;
    },
    setInside: (key) => { if (key !== inside) { inside = key; void channel.presence({ inside: key }).catch(() => {}); } },
  };
}
