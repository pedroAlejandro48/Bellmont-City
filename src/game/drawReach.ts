import { useFrame } from "@react-three/fiber";
import { useState } from "react";
import { quality } from "./quality";
import type { GameState } from "./state";

/**
 * How far anything can be seen (m): the fog's reach (about 320 m by day, far further at night when lit windows and
 * lamps show), plus a margin, in 100 m steps so it only changes (re-rendering) a few times a day.
 */
export function useDrawReach(state: GameState) {
  const reach = () => Math.ceil((Math.min(quality().fogFar, 320 + state.darkness * 780) + 60) / 100) * 100;
  const [value, setValue] = useState(reach);
  useFrame(() => { const r = reach(); if (r !== value) setValue(r); });
  return value;
}
