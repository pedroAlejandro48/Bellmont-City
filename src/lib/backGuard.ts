// The phone's back button (and the browser's): the first press doesn't leave the game, it says "Press back again to
// exit"; a second press within two seconds does. (A history entry is added after the first touch or key — browsers
// skip entries added before any — and put back after each first press.)
const WINDOW_MS = 2000;
// What back does first, newest last: each open thing (a chat, Settings, Profile, a game) adds how it closes.
const handlers: Array<() => void> = [];
export function onBack(close: () => void): () => void {
  const fn = () => close();
  handlers.push(fn);
  return () => { const i = handlers.lastIndexOf(fn); if (i >= 0) handlers.splice(i, 1); };
}
export function guardBackButton() {
  let armed = false, last = 0, note: HTMLDivElement | null = null, hide = 0;
  const arm = () => { if (armed) return; armed = true; history.pushState({ backGuard: true }, ""); };
  const show = () => {
    if (!note) { note = document.createElement("div"); note.className = "back-note"; note.setAttribute("role", "status"); document.body.appendChild(note); }
    note.textContent = "Press back again to exit";
    note.classList.add("on");
    window.clearTimeout(hide);
    hide = window.setTimeout(() => note?.classList.remove("on"), WINDOW_MS);
  };
  window.addEventListener("pointerdown", arm, { capture: true });
  window.addEventListener("keydown", arm, { capture: true });
  window.addEventListener("popstate", () => {
    if (!armed) return;
    // Something open (a chat, Settings, Profile, the game itself): back closes the newest one instead.
    const top = handlers[handlers.length - 1];
    if (top) { history.pushState({ backGuard: true }, ""); note?.classList.remove("on"); last = 0; top(); return; }
    const now = Date.now();
    if (now - last < WINDOW_MS) { armed = false; note?.classList.remove("on"); history.back(); return; }
    last = now;
    history.pushState({ backGuard: true }, "");
    show();
  });
}
