import type { DoorLink, DoorUse } from "@/game/doors";
import type { NamedRoom } from "@/platform/realtime";

type Wire = { n: number; key: string; leaf: "left" | "right"; mode: "open" | "follow"; lead: number; pass: number };
const isWire = (v: unknown): v is Wire => {
  const w = v as Wire | null;
  return typeof w === "object" && w !== null && typeof w.n === "number" && typeof w.key === "string" && (w.leaf === "left" || w.leaf === "right") && (w.mode === "open" || w.mode === "follow") && typeof w.lead === "number" && typeof w.pass === "number";
};
/** About how long a door use takes to reach the others. */
const LAG = 0.12;

/**
 * Shares who is using which restaurant door: each player puts their latest use in presence (`door`); the others
 * time it from when they first see it, so every leaf swings the same way for everyone.
 */
export function makeDoorLink(channel: NamedRoom): DoorLink {
  let n = 0;
  const seen = new Map<string, { n: number; use: DoorUse }[]>();
  return {
    publish: (use) => {
      n += 1;
      const wire: Wire = { n, key: use.key, leaf: use.leaf, mode: use.mode, lead: Math.round(use.lead * 100) / 100, pass: Math.round(use.pass * 100) / 100 };
      void channel.presence({ door: wire }).catch(() => {});
    },
    others: (now) => {
      const out: DoorUse[] = [];
      const present = new Set<string>();
      for (const peer of channel.peers()) {
        if (peer.sameTab) continue;
        present.add(peer.peer);
        const first = !seen.has(peer.peer), list = seen.get(peer.peer) ?? [];
        const w = peer.presence["door"];
        if (isWire(w) && !list.some((e) => e.n === w.n)) {
          // The first look at someone only notes their last use (long over, as far as this player knows).
          list.push({ n: w.n, use: { key: w.key, leaf: w.leaf, mode: w.mode, lead: w.lead, pass: w.pass, start: first ? now - 1000 : now - LAG } });
        }
        const kept = list.filter((e, i) => now - e.use.start < 40 || i === list.length - 1);
        seen.set(peer.peer, kept);
        for (const e of kept) out.push(e.use);
      }
      for (const id of seen.keys()) if (!present.has(id)) seen.delete(id);
      return out;
    },
  };
}
