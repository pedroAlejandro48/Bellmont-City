// Everyone on the same version (so what one player does, the others' games know how to show): an open game checks
// every few minutes, and when it comes back to the front, whether a newer one is out. On the home pages it reloads
// straight away; in a game it waits until you're back on a home page.
declare const __BUILD__: string;
let pending = false;
let inGame = false;
async function check() {
  if (typeof __BUILD__ === "undefined" || import.meta.env.DEV) return;
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    const v = (await r.json()) as { v?: string };
    if (v.v && v.v !== __BUILD__) { pending = true; if (!inGame) location.reload(); }
  } catch { /* offline: next time */ }
}
/** Starts the checks (once). */
export function watchForUpdates() {
  void check();
  window.setInterval(() => void check(), 3 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void check(); });
}
/** In a game (true) or back on a home page (false: a waiting update loads now). */
export function setInGame(v: boolean) { inGame = v; if (!v && pending) location.reload(); }
