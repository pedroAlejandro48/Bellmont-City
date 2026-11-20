import { describe, expect, it } from "vitest";
import { generateCity } from "@/game/config";
import { aptKey } from "@/game/apartments";
import { LiftSystem } from "@/game/liftRiders";

// Residents arriving together at an apartment building: they wait in a line (never on top of each other), go into
// the elevator one at a time, and get off one at a time.
describe("residents and the elevator", () => {
  const b = generateCity(1337, 0, 0).buildings.find((x) => x.venue === "apartments")!;
  const key = aptKey(b);
  it("line up, get in and out one by one, never overlapping", () => {
    const sys = new LiftSystem(new Map([[key, b]]));
    sys.rented = () => [5];
    const me = { b: key, floor: 1, inCar: false, inDoor: false, x: 4, z: -3 };
    for (let id = 1; id <= 6; id++) sys.bridge.arrive(id, key);
    let worst = Infinity, maxEntering = 0, maxExiting = 0, sawLine = 0;
    const dt = 1 / 30;
    for (let i = 0; i < 30 * 120; i++) {
      const now = i * dt;
      sys.update(dt, now, null, me, []);
      const sim = (sys as unknown as { sim: { st: string; x: number; z: number; off: [number, number]; floor: number; d: number }[] }).sim;
      const onFloor = (f: number) => sim.filter((r) => r.floor === f && r.st !== "ride" && r.st !== "lobbyIn" && r.st !== "inApt" && r.st !== "key");
      for (const f of [1, 5]) {
        const ppl = onFloor(f);
        for (let a = 0; a < ppl.length; a++) for (let c = a + 1; c < ppl.length; c++) {
          const p = ppl[a]!, q = ppl[c]!;
          worst = Math.min(worst, Math.hypot(p.x + p.off[0] - q.x - q.off[0], p.z + p.off[1] - q.z - q.off[1]));
        }
      }
      sawLine = Math.max(sawLine, sim.filter((r) => r.st === "wait").length);
      maxEntering = Math.max(maxEntering, sim.filter((r) => r.st === "enter" && r.d < 1.3).length);
      maxExiting = Math.max(maxExiting, sim.filter((r) => r.st === "exit" && r.d < 1.3).length);
    }
    expect(sawLine).toBeGreaterThan(1);
    expect(maxEntering).toBe(1);
    expect(maxExiting).toBe(1);
    expect(worst).toBeGreaterThan(0.45);
    // Nobody stuck: everyone got home in the two minutes.
    expect((sys as unknown as { sim: unknown[] }).sim.length).toBe(0);
  });
});
