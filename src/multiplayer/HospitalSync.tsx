// The hospital's queue and rounds shared across a room: each player sends their own visit (presence `hosp`: which
// hospital, when they asked, when their round started and where they were), and reads everyone else's into
// state.hospitalPeers — which is all anyone needs to work out the queue, the nurse and the door (hospital.ts).
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { GameState } from "@/game/state";
import type { NamedRoom } from "@/platform/realtime";

type Hosp = { key: string; req: number; start: number | null; spot: [number, number] | null };
const isHosp = (v: unknown): v is Hosp => {
  const h = v as Hosp | null;
  return typeof h === "object" && h !== null && typeof h.key === "string" && typeof h.req === "number" && (h.start === null || typeof h.start === "number")
    && (h.spot === null || (Array.isArray(h.spot) && h.spot.length === 2 && h.spot.every((n) => typeof n === "number")));
};

export function HospitalSync({ state, channel }: { state: GameState; channel: NamedRoom }) {
  const sent = useRef("");
  useFrame(() => {
    const h = state.hospital, mine: Hosp | null = h ? { key: h.key, req: h.req, start: h.start, spot: h.spot ? [Math.round(h.spot[0] * 1000) / 1000, Math.round(h.spot[1] * 1000) / 1000] : null } : null;
    const json = JSON.stringify(mine);
    if (json !== sent.current) { sent.current = json; void channel.presence({ hosp: mine }).catch(() => {}); }
    const peers: GameState["hospitalPeers"] = [];
    for (const p of channel.peers()) {
      if (p.sameTab) continue;
      const v = p.presence["hosp"];
      if (isHosp(v)) peers.push({ id: p.peer, key: v.key, req: v.req, start: v.start, spot: v.spot });
    }
    state.hospitalPeers = peers;
  });
  useEffect(() => () => { state.hospitalPeers = []; }, [state]);
  return null;
}
