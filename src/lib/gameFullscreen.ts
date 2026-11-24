// The Android app shows the phone's bars (clock and battery, back · home · recents or the swipe line) on its pages
// and chats, and goes full screen only while playing: on entering a game, and again at the next touch if Android
// took it away (the app was left, or back was pressed). Back, which Android spends on leaving full screen, still
// does what back does in the game (closes what's open, or leaves for the menu).
import { useEffect } from "react";
import { appKind } from "@/lib/appKind";
import { pressBack } from "@/lib/backGuard";

export function useGameFullscreen(active: boolean) {
  useEffect(() => {
    if (!active || appKind() !== "android" || !document.documentElement.requestFullscreen) return;
    let leaving = false;
    const enter = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {}); };
    const changed = () => {
      // Out of full screen while still looking at the game (not by leaving the app): that was the back button.
      if (!document.fullscreenElement && !leaving && document.visibilityState === "visible") pressBack();
    };
    const hidden = () => { if (document.visibilityState === "hidden") leaving = true; else window.setTimeout(() => { leaving = false; }, 500); };
    enter();
    window.addEventListener("pointerdown", enter, { capture: true });
    document.addEventListener("fullscreenchange", changed);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      leaving = true;
      window.removeEventListener("pointerdown", enter, { capture: true });
      document.removeEventListener("fullscreenchange", changed);
      document.removeEventListener("visibilitychange", hidden);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [active]);
}
