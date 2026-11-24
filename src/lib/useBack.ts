import { useEffect, useRef } from "react";
import { onBack } from "@/lib/backGuard";
/** While `active`, the phone's back button (or the browser's) calls `close` instead of leaving the game. */
export function useBack(active: boolean, close: () => void) {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => (active ? onBack(() => ref.current()) : undefined), [active]);
}
