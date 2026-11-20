import type { Peer } from "@/platform/realtime";

const joinedAt = (p: Peer) => (typeof p.presence["joinedAt"] === "number" ? p.presence["joinedAt"] : Infinity);
/**
 * Who runs what's shared (traffic, people, elevators, restaurants, furniture): the earliest-joined player whose game
 * is open in front (`awake`) — a game in the background is paused by the browser, so it can't. Everyone works it
 * out the same way from the same presence, so all agree. (With nobody awake, the earliest-joined.)
 */
export function pickHost(peers: readonly Peer[]): Peer | null {
  const viewers = peers.filter((p) => p.kind === "viewer");
  // (Away — connection gone — or in the background: can't run anything.)
  const awake = viewers.filter((p) => p.presence["awake"] !== false && p.presence["away"] !== true);
  let best: Peer | null = null;
  for (const p of awake.length ? awake : viewers) if (!best || joinedAt(p) < joinedAt(best) || (joinedAt(p) === joinedAt(best) && p.peer < best.peer)) best = p;
  return best;
}
