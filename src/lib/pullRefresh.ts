import { useEffect } from "react";

// Pull to refresh on the home pages (sign-in, menu): they never scroll (they fit the screen), and an installed app
// has no browser to do it, so a finger dragged down from anywhere on the page pulls a round arrow down from the top;
// past the line, letting go reloads the page.
const PULL = 90;
/** The pull-down arrow of the page showing, to play it from a button. */
let shown: { ring: HTMLDivElement; set: (d: number) => void } | null = null;
/**
 * The pull-to-refresh as if pulled (the mobile apps' Refresh button): the arrow comes down from the top of the screen,
 * turns orange and spins, and right after, the game reloads.
 */
export function playPullRefresh() {
  const at = shown;
  if (!at) { window.location.reload(); return; }
  const t0 = performance.now(), T = 550;
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / T), e = 1 - (1 - k) ** 3;
    at.set(PULL * 1.05 * e);
    if (k < 1) requestAnimationFrame(step);
    else { at.ring.classList.add("spin"); window.setTimeout(() => window.location.reload(), 450); }
  };
  requestAnimationFrame(step);
}
/** Whether the element is inside something that scrolls (or is a text box). */
function inScroller(el: Element | null) {
  // (Never from inside a chat, or a box open over the page — Settings, Profile, pickers.)
  if (el?.closest(".chat-full, .chat-popup, .chat, .install-help, [data-no-pull]")) return true;
  for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    if (n instanceof HTMLTextAreaElement || n instanceof HTMLInputElement || n instanceof HTMLSelectElement) return true;
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight + 1) return true;
  }
  return false;
}

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
      // Only from a part of the page that doesn't scroll: a touch inside anything that scrolls (a chat, a list, the
      // languages, a text box) only scrolls it.
      startY = e.touches.length === 1 && !inScroller(e.target as Element | null) ? e.touches[0]!.clientY : null; dy = 0;
    };
    const move = (e: TouchEvent) => { if (startY === null) return; dy = Math.max(0, e.touches[0]!.clientY - startY); if (dy > 4) set(dy); };
    const up = () => {
      if (startY === null) return;
      startY = null;
      if (dy >= PULL) { ring.classList.add("spin"); window.setTimeout(() => window.location.reload(), 250); return; }
      ring.style.transition = "transform 0.2s, opacity 0.2s"; set(0); window.setTimeout(() => { ring.style.transition = ""; }, 220);
    };
    shown = { ring, set };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      window.removeEventListener("touchstart", down); window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up); window.removeEventListener("touchcancel", up);
      ring.remove();
      if (shown?.ring === ring) shown = null;
    };
  }, []);
}
