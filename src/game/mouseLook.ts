/**
 * Looking around with the mouse, a touchpad or a finger.
 *
 * Pressing on the canvas asks for pointer lock (unlimited turning, the cursor hidden). Where the browser won't
 * lock — iPad Safari often refuses or ignores it, and fingers never lock — the drag still turns the view, measured
 * from the pointer's own positions, so it works everywhere. Pointer events (not mouse events) are used, and the
 * canvas is marked `touch-action: none`, so Safari doesn't take a touchpad or finger drag as a page pan.
 *
 * `sticky()` true (first person): moving the mouse looks around without holding a button, and once a click has
 * locked the pointer it stays locked until `sticky()` turns false or Escape.
 */
/** This browser has refused (or can't do) pointer lock: looking around works by dragging instead. */
export const lookSupport = { lockRefused: typeof document !== "undefined" && typeof document.exitPointerLock !== "function" };

export function bindMouseLook(element: HTMLElement, onMove: (x: number, y: number) => void, sticky: () => boolean = () => false, onFingers?: (count: number) => void) {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  let held = false;
  let pending = false;
  let disposed = false;
  /** The lock was granted during this press (losing it then, e.g. Escape, ends the look). */
  let wasLocked = false;
  /** The pointer being dragged without a lock, and where it last was. */
  let dragId: number | null = null;
  /** Where each pointer last was (a finger on the joystick and one turning the view move separately). */
  const lastBy = new Map<number, { x: number; y: number }>();
  /** Fingers pressed on the canvas (turning the view), for the camera's follow-behind timing. */
  const fingers = new Set<number>();
  const idOf = (event: PointerEvent) => (typeof event.pointerId === "number" ? event.pointerId : -1);
  const prevTouchAction = element.style.touchAction;
  element.style.touchAction = "none";
  const locked = () => doc.pointerLockElement === element;
  const unlock = () => {
    if (locked()) doc.exitPointerLock();
  };
  const release = () => {
    held = false; wasLocked = false; lastBy.clear();
    if (fingers.size) { fingers.clear(); onFingers?.(0); }
    if (dragId !== null) { try { element.releasePointerCapture?.(dragId); } catch { /* already released */ } dragId = null; }
    unlock();
  };
  /** The lock couldn't be had: keep looking by dragging instead. */
  const lockFailed = () => { pending = false; lookSupport.lockRefused = true; };
  const down = (event: PointerEvent) => {
    if (disposed) return;
    if (doc.pointerLockElement && !locked()) return;
    if (held && locked()) return;
    event.preventDefault();
    // Another finger on the view while one already turns it (a pinch): counted, but the first keeps the turning.
    if (held && event.pointerType === "touch" && dragId !== null) {
      lastBy.set(idOf(event), { x: event.clientX, y: event.clientY });
      fingers.add(idOf(event)); onFingers?.(fingers.size);
      return;
    }
    held = true; wasLocked = locked();
    lastBy.set(idOf(event), { x: event.clientX, y: event.clientY });
    if (event.pointerType === "touch") { fingers.add(idOf(event)); onFingers?.(fingers.size); }
    dragId = typeof event.pointerId === "number" ? event.pointerId : null;
    if (dragId !== null) { try { element.setPointerCapture?.(dragId); } catch { /* not capturable */ } }
    // Fingers don't lock; a mouse or touchpad asks, synchronously during the press's user activation.
    if (event.pointerType === "touch" || pending || locked() || typeof element.requestPointerLock !== "function") return;
    pending = true;
    try {
      Promise.resolve(element.requestPointerLock()).catch(lockFailed).finally(() => {
        pending = false;
        if ((!held && !sticky()) || disposed) unlock();
      });
    } catch { lockFailed(); }
  };
  const move = (event: PointerEvent) => {
    const x = event.clientX, y = event.clientY;
    let dx = 0, dy = 0;
    if (locked()) {
      dx = event.movementX || 0; dy = event.movementY || 0;
      // Some browsers report one huge bogus jump just as the lock starts or ends: no hand moves that far at once.
      if (Math.abs(dx) > 800 || Math.abs(dy) > 800) { dx = 0; dy = 0; }
    }
    else { const last = lastBy.get(idOf(event)); if (last) { dx = x - last.x; dy = y - last.y; } }
    lastBy.set(idOf(event), { x, y });
    // A finger is only ever the one pressed on the canvas (never the joystick's).
    const isDrag = dragId === null || typeof event.pointerId !== "number" || event.pointerId === dragId;
    // First person, not locked: the cursor's own movement looks around (a mouse or touchpad; a finger only while
    // pressed on the view).
    if (sticky() && !locked()) { if (event.pointerType !== "touch" ? isDrag || !held : held && isDrag) { if (dx || dy) onMove(dx, dy); } return; }
    if (!held) return;
    // (The press ends on pointerup; `buttons` isn't trusted here, as some browsers report 0 while locked.)
    if (!locked() && dragId !== null && typeof event.pointerId === "number" && event.pointerId !== dragId) return;
    if (dx || dy) onMove(dx, dy);
  };
  const up = (event: PointerEvent) => {
    lastBy.delete(idOf(event));
    if (fingers.delete(idOf(event))) onFingers?.(fingers.size);
    // The turning finger lifted with another still on the view: that one turns it now.
    if (event.pointerType === "touch" && idOf(event) === dragId && fingers.size > 0) { dragId = fingers.values().next().value ?? null; return; }
    if (dragId !== null && typeof event.pointerId === "number" && event.pointerId !== dragId) return;
    if (sticky()) { held = false; if (dragId !== null) { try { element.releasePointerCapture?.(dragId); } catch { /* fine */ } dragId = null; } return; }
    if (event.buttons === 0 || event.type === "pointercancel") release();
  };
  const change = () => {
    if (locked()) { if ((!held && !sticky()) || disposed) unlock(); else wasLocked = true; return; }
    // Lost the lock mid-look (Escape, or a browser that grants it and takes it straight back, as iPad Safari and
    // headless browsers can): carry on turning by dragging until the press ends.
    if (wasLocked) { wasLocked = false; lastBy.clear(); }
  };
  const visibility = () => { if (doc.visibilityState === "hidden") release(); };
  element.addEventListener("pointerdown", down);
  doc.addEventListener("pointermove", move);
  doc.addEventListener("pointerup", up);
  doc.addEventListener("pointercancel", up);
  doc.addEventListener("pointerlockchange", change);
  doc.addEventListener("pointerlockerror", lockFailed);
  doc.addEventListener("visibilitychange", visibility);
  win?.addEventListener("blur", release);
  return () => {
    disposed = true;
    release();
    element.style.touchAction = prevTouchAction;
    element.removeEventListener("pointerdown", down);
    doc.removeEventListener("pointermove", move);
    doc.removeEventListener("pointerup", up);
    doc.removeEventListener("pointercancel", up);
    doc.removeEventListener("pointerlockchange", change);
    doc.removeEventListener("pointerlockerror", lockFailed);
    doc.removeEventListener("visibilitychange", visibility);
    win?.removeEventListener("blur", release);
  };
}
