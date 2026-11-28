// Gym workouts shared across a room: each player sends their own (presence `gym`: which gym, when it started in
// server ms) and reads everyone else's into state.gymPeers — enough for everyone to draw the same barbell, dumbbells
// and belt with each body, and to hold back a new workout while someone's still on the first exercise (gym.ts).
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { GameState } from "@/game/state";
import type { NamedRoom } from "@/platform/realtime";

type GymWire = { key: string; start: number };
const isGym = (v: unknown): v is GymWire => {
  const g = v as GymWire | null;
  return typeof g === "object" && g !== null && typeof g.key === "string" && typeof g.start === "number";
};

export function GymSync({ state, channel }: { state: GameState; channel: NamedRoom }) {
  const sent = useRef("");
  useFrame(() => {
    const w = state.workout, mine: GymWire | null = w ? { key: w.key, start: w.start } : null;
    const json = JSON.stringify(mine);
    if (json !== sent.current) { sent.current = json; void channel.presence({ gym: mine }).catch(() => {}); }
    const peers: GameState["gymPeers"] = [];
    for (const p of channel.peers()) {
      if (p.sameTab) continue;
      const v = p.presence["gym"];
      if (isGym(v)) peers.push({ id: p.peer, key: v.key, start: v.start });
    }
    state.gymPeers = peers;
  });
  useEffect(() => () => { state.gymPeers = []; }, [state]);
  return null;
}
