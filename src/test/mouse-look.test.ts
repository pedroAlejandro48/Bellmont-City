import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindMouseLook } from "@/game/mouseLook";
import { setTouchMode } from "@/game/touchMode";

describe("looking around (pointer lock, or dragging where there is none)", () => {
  let canvas: HTMLCanvasElement;
  let locked: Element | null;
  let dispose: () => void;
  let move: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
  let request: ReturnType<typeof vi.fn>;
  let exit: ReturnType<typeof vi.fn>;
  let firstPerson = false;
  const change = () => document.dispatchEvent(new Event("pointerlockchange"));
  /** A pointer event (jsdom has no PointerEvent constructor): a mouse event with the pointer's fields. */
  const pointer = (type: string, init: { x?: number; y?: number; mx?: number; my?: number; buttons?: number; kind?: string; id?: number } = {}) => {
    const event = new MouseEvent(type, { buttons: init.buttons ?? 0, clientX: init.x ?? 0, clientY: init.y ?? 0, bubbles: true, cancelable: true });
    Object.defineProperties(event, { movementX: { value: init.mx ?? 0 }, movementY: { value: init.my ?? 0 }, pointerType: { value: init.kind ?? "mouse" }, pointerId: { value: init.id ?? 1 } });
    return event;
  };
  const down = (x = 0, y = 0, kind = "mouse") => canvas.dispatchEvent(pointer("pointerdown", { x, y, buttons: 1, kind }));
  const up = () => document.dispatchEvent(pointer("pointerup"));
  const motion = (mx: number, my: number, buttons = 1) => document.dispatchEvent(pointer("pointermove", { mx, my, buttons }));
  const drag = (x: number, y: number, buttons = 1) => document.dispatchEvent(pointer("pointermove", { x, y, buttons }));
  beforeEach(() => {
    locked = null; firstPerson = false; setTouchMode(false);
    canvas = document.createElement("canvas");
    document.body.append(canvas);
    move = vi.fn<(x: number, y: number) => void>();
    request = vi.fn(() => { locked = canvas; change(); return Promise.resolve(); });
    exit = vi.fn(() => { locked = null; change(); });
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => locked });
    Object.defineProperty(document, "exitPointerLock", { configurable: true, value: exit });
    Object.defineProperty(canvas, "requestPointerLock", { configurable: true, value: request });
    dispose = bindMouseLook(canvas, move, () => firstPerson);
  });
  afterEach(() => { dispose(); canvas.remove(); });
  it("stops Safari taking a drag on the canvas as a page pan", () => {
    expect(canvas.style.touchAction).toBe("none");
  });
  it("locks on press and accepts unlimited relative movement in both directions", () => {
    down();
    expect(request).toHaveBeenCalledOnce();
    expect(locked).toBe(canvas);
    // Far beyond any screen's width, both ways.
    for (let i = 0; i < 100; i++) motion(80, -3);
    for (let i = 0; i < 200; i++) motion(-80, 3);
    const total = move.mock.calls.reduce((t, [x]) => t + x, 0);
    expect(move).toHaveBeenCalledTimes(300); expect(total).toBe(-8000);
    // A single bogus jump as the lock settles is ignored.
    move.mockClear(); motion(-1500, 0);
    expect(move).not.toHaveBeenCalled();
  });
  it("unlocks on release and stops rotating", () => {
    down(); up(); motion(100, 100);
    expect(exit).toHaveBeenCalledOnce();
    expect(locked).toBeNull();
    expect(move).not.toHaveBeenCalled();
  });
  it("releases a lock granted after the button was already released", async () => {
    let resolve: (() => void) | undefined;
    request.mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    down(); up(); locked = canvas; change(); resolve?.();
    await Promise.resolve();
    expect(locked).toBeNull();
    expect(exit).toHaveBeenCalled();
  });
  it("releases on focus loss and removes handlers when unmounted", () => {
    down(); window.dispatchEvent(new Event("blur"));
    expect(locked).toBeNull();
    dispose(); down(); motion(20, 20);
    expect(request).toHaveBeenCalledOnce();
    expect(move).not.toHaveBeenCalled();
  });
  it("carries on by dragging when the lock is taken back mid-press, and stops on release", () => {
    down(0, 0); locked = null; change();
    drag(10, 0); drag(25, 4);
    expect(move.mock.calls).toEqual([[15, 4]]);
    up(); drag(60, 60, 0);
    expect(move).toHaveBeenCalledOnce();
  });
  it("still turns by dragging where the lock is refused or ignored (iPad)", async () => {
    request.mockImplementation(() => Promise.reject(new Error("refused")));
    down(100, 100);
    await Promise.resolve(); await Promise.resolve();
    drag(130, 90); drag(110, 95);
    expect(move.mock.calls).toEqual([[30, -10], [-20, 5]]);
    up(); drag(200, 200, 0);
    expect(move).toHaveBeenCalledTimes(2);
    // Ignored outright (no answer at all): the same.
    move.mockClear(); request.mockImplementation(() => new Promise(() => {}));
    down(0, 0); drag(12, 0);
    expect(move.mock.calls).toEqual([[12, 0]]);
  });
  it("turns with a finger drag, without asking for a lock", () => {
    request.mockClear();
    down(50, 50, "touch"); drag(80, 50);
    expect(request).not.toHaveBeenCalled();
    expect(move.mock.calls).toEqual([[30, 0]]);
  });
  it("turns only with the finger pressed on the view, not one moving the joystick at the same time", () => {
    const fingers: number[] = [];
    dispose(); dispose = bindMouseLook(canvas, move, () => firstPerson, (n) => fingers.push(n));
    for (const fp of [false, true]) {
      firstPerson = fp; move.mockClear();
      // Finger 7 on the joystick (pressed elsewhere), finger 3 on the view.
      document.dispatchEvent(pointer("pointermove", { x: 10, y: 300, kind: "touch", id: 7 }));
      canvas.dispatchEvent(pointer("pointerdown", { x: 200, y: 100, buttons: 1, kind: "touch", id: 3 }));
      document.dispatchEvent(pointer("pointermove", { x: 60, y: 300, kind: "touch", id: 7, buttons: 1 }));
      document.dispatchEvent(pointer("pointermove", { x: 230, y: 100, kind: "touch", id: 3, buttons: 1 }));
      document.dispatchEvent(pointer("pointermove", { x: 90, y: 280, kind: "touch", id: 7, buttons: 1 }));
      expect(move.mock.calls).toEqual([[30, 0]]);
      document.dispatchEvent(pointer("pointerup", { kind: "touch", id: 3 }));
    }
    expect(fingers).toEqual([1, 0, 1, 0]);
  });
  it("keeps turning with the first finger when a second lands (a pinch), and hands over when the first lifts", () => {
    canvas.dispatchEvent(pointer("pointerdown", { x: 100, y: 100, buttons: 1, kind: "touch", id: 1 }));
    canvas.dispatchEvent(pointer("pointerdown", { x: 300, y: 100, buttons: 1, kind: "touch", id: 2 }));
    document.dispatchEvent(pointer("pointermove", { x: 110, y: 100, kind: "touch", id: 1, buttons: 1 }));
    document.dispatchEvent(pointer("pointermove", { x: 290, y: 100, kind: "touch", id: 2, buttons: 1 }));
    expect(move.mock.calls).toEqual([[10, 0]]);
    document.dispatchEvent(pointer("pointerup", { kind: "touch", id: 1 }));
    document.dispatchEvent(pointer("pointermove", { x: 280, y: 104, kind: "touch", id: 2, buttons: 1 }));
    expect(move.mock.calls).toEqual([[10, 0], [-10, 4]]);
  });
  it("in first person, locks by itself (no click on the view) and then turns without limit", () => {
    firstPerson = true;
    drag(10, 10, 0);
    expect(request).toHaveBeenCalledOnce(); expect(locked).toBe(canvas);
    motion(15, -5, 0);
    expect(move.mock.calls).toEqual([[15, -5]]);
  });
  it("in first person, where the browser won't lock yet, the cursor's own movement still looks around", () => {
    firstPerson = true;
    request.mockImplementation(() => Promise.reject(new Error("needs a gesture")));
    drag(10, 10, 0); drag(25, 5, 0);
    expect(move.mock.calls).toEqual([[15, -5]]);
  });
  it("in first person, a key press locks the pointer (not Escape)", async () => {
    firstPerson = true;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await new Promise((r) => setTimeout(r, 5));
    expect(request).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    await new Promise((r) => setTimeout(r, 5));
    expect(request).toHaveBeenCalledOnce(); expect(locked).toBe(canvas);
  });
  it("in first person with the on-screen joystick, never locks (a lock would freeze the joystick's finger)", async () => {
    firstPerson = true; setTouchMode(true);
    drag(10, 10, 0);
    document.dispatchEvent(pointer("pointerup", { kind: "touch", id: 4 }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    await new Promise((r) => setTimeout(r, 5));
    expect(request).not.toHaveBeenCalled();
    // Already locked when the touch controls come up: let go.
    locked = canvas; setTouchMode(false); setTouchMode(true);
    expect(exit).toHaveBeenCalled();
  });
});
