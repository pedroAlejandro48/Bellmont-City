import type { LiftLink, LiftUse } from "@/game/state";
import type { NamedRoom } from "@/platform/realtime";

type Wire = { n: number; b: string; from: number; to: number; at: number; active: boolean };
const isWire = (v: unknown): v is Wire => {
  const w = v as Wire | null;
  return typeof w === "object" && w !== null && typeof w.n === "number" && typeof w.b === "string" && typeof w.from === "number" && typeof w.to === "number" && typeof w.at === "number" && typeof w.active === "boolean";
};
/** About how long it takes to reach the others. */
const LAG = 0.12;

/**
 * Shares the apartment buildings' elevators: each player puts what they're doing with one in presence (`lift`: the
 * building, the car going from one floor to another, how far along, whether they're using it); the others time it
 * from when they first see it, so the car is in the same place (and busy) for everyone.
 */
export function makeLiftLink(channel: NamedRoom): LiftLink {
  let n = 0, last = "";
  const seen = new Map<string, { n: number; use: LiftUse }>();
  return {
    publish: (use) => {
      const key = `${use.b}|${use.from}|${use.to}|${use.active}`;
      if (key === last) return;
      last = key; n += 1;
      const wire: Wire = { n, b: use.b, from: use.from, to: use.to, at: Math.round(use.at * 100) / 100, active: use.active };
      void channel.presence({ lift: wire }).catch(() => {});
    },
    others: (now) => {
      const out: LiftUse[] = [], present = new Set<string>();
      for (const peer of channel.peers()) {
        if (peer.sameTab) continue;
        present.add(peer.peer);
        const w = peer.presence["lift"], had = seen.get(peer.peer);
        if (isWire(w) && (!had || had.n !== w.n)) seen.set(peer.peer, { n: w.n, use: { b: w.b, from: w.from, to: w.to, at: w.at, active: w.active, t0: had ? now - w.at - LAG : now - w.at - 1000 } });
        const e = seen.get(peer.peer);
        if (e) out.push(e.use);
      }
      for (const id of seen.keys()) if (!present.has(id)) seen.delete(id);
      return out;
    },
  };
}
