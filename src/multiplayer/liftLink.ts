import { pickHost } from "./host";
import type { AptClaim, LiftLink, LiftPeer, LiftSnap } from "@/game/state";
import type { AptDoc } from "@/game/aptShare";
const isClaim = (v: unknown): v is AptClaim => { const c = v as AptClaim | null; return typeof c === "object" && c !== null && typeof c.b === "string" && typeof c.floor === "number" && typeof c.locked === "boolean"; };
import type { NamedRoom, Peer } from "@/platform/realtime";

const joinedAt = (p: Peer) => (typeof p.presence["joinedAt"] === "number" ? p.presence["joinedAt"] : Infinity);
type Req = { id: number; b: string; floor: number; at: number };
const isReq = (v: unknown): v is Req => { const r = v as Req | null; return typeof r === "object" && r !== null && typeof r.id === "number" && typeof r.b === "string" && typeof r.floor === "number"; };
const isPeer = (v: unknown): v is LiftPeer => { const p = v as LiftPeer | null; return typeof p === "object" && p !== null && typeof p.floor === "number" && typeof p.inCar === "boolean"; };

/**
 * A room's apartment elevators. Like the traffic, the longest-present player runs them (every car, and the
 * residents riding) and puts them in presence (`lifts`, numbered); everyone else draws that, sends the floors they
 * call or press (`liftReqs`, the last few seconds' worth, numbered) and says where they are (`liftMe`: in which
 * building, on which floor, in a car, in a doorway) — which the runner uses for the doors and the car's room.
 */
/** `kept`: what the room keeps for good (apartment kitchens and homes), for floors whose players aren't here. */
export function makeLiftLink(channel: NamedRoom, kept?: { apts: () => AptDoc[]; homes: () => AptClaim[] }): LiftLink {
  let seq = 0, reqId = 0, mine: Req[] = [], lastMe = "", lastHome = "", lastApts = "", lastShow: string | null = null;
  const isDoc = (v: unknown): v is AptDoc => { const d = v as AptDoc | null; return typeof d === "object" && d !== null && typeof d.key === "string" && typeof d.n === "number" && typeof d.j === "string"; };
  const seenReq = new Map<string, number>();
  let last: { stamp: unknown; snap: LiftSnap | null; n: number } | null = null;
  const host = () => {
    return pickHost(channel.peers());
  };
  return {
    isHost: () => host()?.sameTab ?? true,
    publish: (snap) => { seq += 1; void channel.presence({ lifts: { ...snap, n: seq } }).catch(() => {}); },
    latest: () => {
      const h = host();
      if (!h || h.sameTab) return null;
      const v = h.presence["lifts"] as (LiftSnap & { n?: number }) | undefined;
      if (!v || typeof v !== "object" || typeof v.n !== "number" || typeof v.cars !== "object") return null;
      if (!last || last.stamp !== v.n) last = { stamp: v.n, snap: { cars: v.cars, riders: Array.isArray(v.riders) ? v.riders : [] }, n: v.n };
      return last.snap ? { snap: last.snap, n: last.n } : null;
    },
    request: (b, floor) => {
      const at = Date.now();
      mine = [...mine.filter((r) => at - r.at < 6000), { id: ++reqId, b, floor, at }];
      void channel.presence({ liftReqs: mine }).catch(() => {});
    },
    takeRequests: () => {
      const out: { b: string; floor: number }[] = [];
      for (const peer of channel.peers()) {
        if (peer.sameTab) continue;
        const list = Array.isArray(peer.presence["liftReqs"]) ? (peer.presence["liftReqs"] as unknown[]).filter(isReq) : [];
        const had = seenReq.get(peer.peer) ?? 0;
        for (const r of list) if (r.id > had) out.push({ b: r.b, floor: r.floor });
        seenReq.set(peer.peer, Math.max(had, ...list.map((r) => r.id)));
      }
      return out;
    },
    setMe: (p) => {
      const key = JSON.stringify(p);
      if (key === lastMe) return;
      lastMe = key;
      void channel.presence({ liftMe: p }).catch(() => {});
    },
    others: () => channel.peers().filter((p) => !p.sameTab).map((p) => p.presence["liftMe"]).filter(isPeer),
    setHome: (h) => {
      const key = JSON.stringify(h);
      if (key === lastHome) return;
      lastHome = key;
      void channel.presence({ aptHome: h }).catch(() => {});
    },
    setShow: (json) => {
      if (json === lastShow) return;
      lastShow = json;
      void channel.presence({ kshow: json }).catch(() => {});
    },
    shows: () => channel.peers().filter((p) => !p.sameTab && typeof p.presence["kshow"] === "string").map((p) => ({ peer: p.peer, json: p.presence["kshow"] as string })),
    setApts: (docs) => {
      const key = JSON.stringify(docs);
      if (key === lastApts) return;
      lastApts = key;
      void channel.presence({ aptDocs: docs }).catch(() => {});
    },
    // (What the players here share live, and what the room keeps — the highest number wins in aptShare.)
    apts: () => [...channel.peers().filter((p) => !p.sameTab).flatMap((p) => (Array.isArray(p.presence["aptDocs"]) ? (p.presence["aptDocs"] as unknown[]).filter(isDoc) : [])), ...(kept?.apts() ?? [])],
    homes: () => {
      const live = channel.peers().filter((p) => !p.sameTab).map((p) => p.presence["aptHome"]).filter(isClaim);
      const me = channel.peers().find((p) => p.sameTab)?.presence["aptHome"];
      const mine = isClaim(me) ? `${me.b}#${me.floor}` : "";
      // (Homes of players who aren't here, as the room keeps them; never your own, and live ones first.)
      return [...live, ...(kept?.homes() ?? []).filter((h) => `${h.b}#${h.floor}` !== mine && !live.some((l) => l.b === h.b && l.floor === h.floor))];
    },
  };
}
