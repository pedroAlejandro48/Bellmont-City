import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindMouseLook } from "@/game/mouseLook";

describe("hold-to-look pointer lock", () => {
  let canvas: HTMLCanvasElement;
  let locked: Element | null;
  let dispose: () => void;
  let move: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
  let request: ReturnType<typeof vi.fn>;
  let exit: ReturnType<typeof vi.fn>;
  const change = () => document.dispatchEvent(new Event("pointerlockchange"));
  const down = () => canvas.dispatchEvent(new MouseEvent("mousedown", { buttons: 1 }));
  const up = () => document.dispatchEvent(new MouseEvent("mouseup", { buttons: 0 }));
  const motion = (x: number, y: number, buttons = 1) => {
    const event = new MouseEvent("mousemove", { buttons });
    Object.defineProperties(event, { movementX: { value: x }, movementY: { value: y } });
    document.dispatchEvent(event);
  };
  beforeEach(() => {
    locked = null;
    canvas = document.createElement("canvas");
    document.body.append(canvas);
    move = vi.fn<(x: number, y: number) => void>();
    request = vi.fn(() => { locked = canvas; change(); return Promise.resolve(); });
    exit = vi.fn(() => { locked = null; change(); });
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => locked });
    Object.defineProperty(document, "exitPointerLock", { configurable: true, value: exit });
    Object.defineProperty(canvas, "requestPointerLock", { configurable: true, value: request });
    dispose = bindMouseLook(canvas, move);
  });
  afterEach(() => { dispose(); canvas.remove(); });
  it("locks on press and accepts unlimited relative movement in both directions", () => {
    down();
    expect(request).toHaveBeenCalledOnce();
    expect(locked).toBe(canvas);
    motion(5000, -5000); motion(-5000, 5000);
    expect(move.mock.calls).toEqual([[5000, -5000], [-5000, 5000]]);
  });
  it("unlocks on release outside the canvas and stops rotating", () => {
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
    expect(exit).toHaveBeenCalledOnce();
  });
  it("releases on focus loss and removes handlers when unmounted", () => {
    down(); window.dispatchEvent(new Event("blur"));
    expect(locked).toBeNull();
    dispose(); down(); motion(20, 20);
    expect(request).toHaveBeenCalledOnce();
    expect(move).not.toHaveBeenCalled();
  });
  it("ignores mouse movement after Escape or a lock failure", () => {
    down(); locked = null; change(); motion(20, 20);
    expect(move).not.toHaveBeenCalled();
  });
});