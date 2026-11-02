/**
 * Whether to show the on-screen joystick and buttons.
 *
 * Phones and tablets start with them; anything with a mouse or touchpad (a laptop with a touchscreen, an iPad on a
 * keyboard/trackpad, a phone with a mouse plugged in) starts without. A finger on the screen brings them up; a
 * physical key or a mouse moving hides them again.
 */
type Listener = (on: boolean) => void;
const listeners = new Set<Listener>();
let on = false;
let started = false;

const media = (q: string) => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches;
/** A screen that can be touched at all. */
export function touchCapable() {
  return typeof navigator !== "undefined" && ((navigator.maxTouchPoints ?? 0) > 0 || (typeof window !== "undefined" && "ontouchstart" in window));
}
/** At the start: a touch device whose only pointer is a finger (no mouse or touchpad connected). */
export function startsInTouchMode() {
  return touchCapable() && media("(pointer: coarse)") && !media("(any-pointer: fine)");
}
function set(next: boolean) { if (next !== on) { on = next; for (const l of listeners) l(on); } }

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  on = startsInTouchMode();
  window.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") set(true); }, true);
  window.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" && (e.movementX || e.movementY)) set(false); }, true);
  window.addEventListener("keydown", (e) => {
    // A physical key (an on-screen keyboard reports "Unidentified" or composes; typing into a field doesn't count).
    const t = e.target as HTMLElement | null;
    if (!e.isTrusted || e.isComposing || e.key === "Unidentified" || e.keyCode === 229) return;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    set(false);
  }, true);
}

export function touchMode() { start(); return on; }
export function watchTouchMode(listener: Listener) { start(); listeners.add(listener); listener(on); return () => { listeners.delete(listener); }; }
/** For tests. */
export function setTouchMode(next: boolean) { start(); set(next); }
