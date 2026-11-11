import { describe, expect, it } from "vitest";
import { aptFloor } from "@/game/aptRoom";
import { newBathLink } from "@/game/Bathroom";
import { SHOWER, TOILET, WASH, showerAt, showerSpots, toiletAt, washAt, type BathPose } from "@/game/bathMoves";
import { generateCity } from "@/game/config";

const fl = aptFloor(generateCity(1337, 0, 0).buildings.find((b) => b.venue === "apartments")!, 3);
const finite = (p: BathPose) => [p.x, p.z, p.yaw, p.lean, ...(p.left?.at ?? []), ...(p.right?.at ?? [])].every(Number.isFinite);

describe("bathroom moves", () => {
  it("washing the hands runs the water and shuts it off", () => {
    const l = newBathLink();
    washAt(fl, (WASH.into + WASH.rub) / 2, l); expect(l.sink).toBe(1);
    for (let u = 0; u <= WASH.down; u += 0.05) expect(finite(washAt(fl, u, l))).toBe(true);
    expect(l.sink).toBe(0);
  });
  it("the toilet: paper into the bowl, then the flush", () => {
    const l = newBathLink();
    toiletAt(fl, (TOILET.lean + TOILET.wipe) / 2, l, 10); expect(l.paper).toBe("hand");
    toiletAt(fl, TOILET.drop + 0.05, l, 10); expect(l.paper).toBe("drop");
    toiletAt(fl, TOILET.press + 0.3, l, 10); expect(l.flush).toBeGreaterThan(0);
    expect(toiletAt(fl, (TOILET.settle + TOILET.reach) / 2, l, 10).sit).toBe(1);
  });
  it("the shower: in over the curb and out again, the curtain shut at the end", () => {
    const l = newBathLink(), s = fl.bath.shower;
    showerAt(fl, (SHOWER.let + SHOWER.stepIn) / 2 - 0.25, l);
    const mid = showerAt(fl, (SHOWER.let + SHOWER.stepIn) / 2 - 0.25, l);
    expect(mid.legs!.hipL).toBeLessThan(-0.8);
    const inside = showerAt(fl, (SHOWER.valve + SHOWER.wash) / 2, l);
    expect(inside.z).toBeGreaterThan(s.curtainZ); expect(l.shower).toBe(1); expect(l.curtain).toBe(0);
    for (let u = 0; u <= SHOWER.let4; u += 0.05) expect(finite(showerAt(fl, u, l))).toBe(true);
    const end = showerAt(fl, SHOWER.let4, l);
    expect(end.z).toBeCloseTo(showerSpots(fl).out[1]); expect(l.curtain).toBe(0); expect(l.shower).toBe(0);
  });
});
