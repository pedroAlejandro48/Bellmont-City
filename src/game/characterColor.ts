import { useEffect, useState } from "react";
import type { GameState } from "./state";

/** The character's colour now: a bought outfit, else the account's colour. Rechecked twice a second. */
export const characterColor = (state: GameState) => state.life.outfit ?? state.bodyColor;
export function useCharacterColor(state: GameState) {
  const [c, setC] = useState(() => characterColor(state));
  useEffect(() => { const id = window.setInterval(() => setC(characterColor(state)), 500); return () => window.clearInterval(id); }, [state]);
  return c;
}
