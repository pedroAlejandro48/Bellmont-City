import { useEffect } from "react";

// Pull to refresh on the home pages (sign-in, menu): they never scroll (they fit the screen), and an installed app
// has no browser to do it, so a finger dragged down from anywhere on the page pulls a round arrow down from the top;
// past the line, letting go reloads the page.
const PULL = 90;
export function usePullToRefresh() {
  useEffect(() => {
    let startY: number | null = null, dy = 0;
    const ring = document.createElement("div");
    ring.className = "pull-refresh";
    ring.innerHTML = "<span>↻</span>";
    document.body.appendChild(ring);
    const set = (d: number) => {
      const k = Math.min(1, d / PULL);
      ring.style.transform = `translate(-50%, ${Math.min(d, PULL * 1.3) * 0.7 - 48}px) rotate(${k * 300}deg)`;
      ring.style.opacity = String(Math.min(1, d / 30));
      ring.classList.toggle("ready", d >= PULL);
    };
    const down = (e: TouchEvent) => {
      const t = e.target as HTMLElement | null;
      // (Not from inside something that scrolls on its own and isn't at its top: the friends list.)
      const inner = t?.closest(".friends-list") as HTMLElement | null;
      startY = e.touches.length === 1 && (!inner || inner.scrollTop <= 0) ? e.touches[0]!.clientY : null; dy = 0;
    };
    const move = (e: TouchEvent) => { if (startY === null) return; dy = Math.max(0, e.touches[0]!.clientY - startY); if (dy > 4) set(dy); };
    const up = () => {
      if (startY === null) return;
      startY = null;
      if (dy >= PULL) { ring.classList.add("spin"); window.setTimeout(() => window.location.reload(), 250); return; }
      ring.style.transition = "transform 0.2s, opacity 0.2s"; set(0); window.setTimeout(() => { ring.style.transition = ""; }, 220);
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      window.removeEventListener("touchstart", down); window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up); window.removeEventListener("touchcancel", up);
      ring.remove();
    };
  }, []);
}
