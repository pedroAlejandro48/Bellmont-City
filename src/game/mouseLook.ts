/** Native pointer lock preserves the OS cursor's click position on unlock. */
/**
 * `sticky()` true (first person): moving the mouse looks around without holding a button, and once a click has
 * locked the pointer it stays locked until `sticky()` turns false or Escape.
 */
export function bindMouseLook(element: HTMLElement, onMove: (x: number, y: number) => void, sticky: () => boolean = () => false) {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  let held = false;
  let pending = false;
  let disposed = false;
  const unlock = () => {
    if (doc.pointerLockElement === element) doc.exitPointerLock();
  };
  const release = () => { held = false; unlock(); };
  const down = (event: MouseEvent) => {
    if (pending || held || disposed) return;
    if (doc.pointerLockElement && doc.pointerLockElement !== element) return;
    event.preventDefault();
    held = true;
    pending = true;
    // Request synchronously during the click's user activation.
    try {
      Promise.resolve(element.requestPointerLock()).catch(release).finally(() => {
        pending = false;
        if (!held || disposed) unlock();
      });
    } catch { pending = false; release(); }
  };
  const move = (event: MouseEvent) => {
    // First person, not locked yet: the cursor's own movement looks around.
    if (sticky() && doc.pointerLockElement !== element) { if (event.movementX !== 0 || event.movementY !== 0) onMove(event.movementX, event.movementY); return; }
    if (!held || doc.pointerLockElement !== element) return;
    if (event.buttons === 0 && !sticky()) { release(); return; }
    if (event.movementX !== 0 || event.movementY !== 0) onMove(event.movementX, event.movementY);
  };
  const up = (event: MouseEvent) => { if (event.buttons === 0 && !sticky()) release(); };
  const change = () => {
    if (doc.pointerLockElement !== element) held = false;
    else if (!held || disposed) unlock();
  };
  const visibility = () => { if (doc.visibilityState === "hidden") release(); };
  element.addEventListener("mousedown", down);
  doc.addEventListener("mousemove", move);
  doc.addEventListener("mouseup", up);
  doc.addEventListener("pointerlockchange", change);
  doc.addEventListener("pointerlockerror", release);
  doc.addEventListener("visibilitychange", visibility);
  win?.addEventListener("blur", release);
  return () => {
    disposed = true;
    release();
    element.removeEventListener("mousedown", down);
    doc.removeEventListener("mousemove", move);
    doc.removeEventListener("mouseup", up);
    doc.removeEventListener("pointerlockchange", change);
    doc.removeEventListener("pointerlockerror", release);
    doc.removeEventListener("visibilitychange", visibility);
    win?.removeEventListener("blur", release);
  };
}