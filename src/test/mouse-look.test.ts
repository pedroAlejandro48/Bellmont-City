import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindMouseLook } from "@/game/mouseLook";

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
    locked = null; firstPerson = false;
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
  it("in first person, looks around by just moving the cursor before any lock", () => {
    firstPerson = true;
    drag(10, 10, 0); drag(25, 5, 0);
    expect(move.mock.calls).toEqual([[15, -5]]);
  });
});
