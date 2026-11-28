import { describe, expect, it } from "vitest";
import { generateCity } from "@/game/config";
import { STAGE_MS, WORKOUT_MS, canStart, freeSpotNear, poseAt, stageAt, stations } from "@/game/gym";
import { BILL_DAYS, bills, canPayAhead, dailyBills, newLife, payAhead, readLife } from "@/game/life";
import { venueLayout } from "@/game/venueRoom";

describe("gym workout", () => {
  it("runs the four exercises 3 s each, then ends", () => {
    expect(stageAt(0)?.stage).toBe("bench");
    expect(stageAt(STAGE_MS + 1)?.stage).toBe("curls");
    expect(stageAt(2 * STAGE_MS + 1)?.stage).toBe("pullup");
    expect(stageAt(3 * STAGE_MS + 1)?.stage).toBe("treadmill");
    expect(stageAt(WORKOUT_MS)).toBeNull();
  });
  it("loops: each exercise ends where it started", () => {
    for (const s of ["bench", "curls", "pullup", "treadmill"] as const) {
      const a = poseAt(s, 0), b = poseAt(s, 3);
      expect(JSON.stringify(a).length).toBeGreaterThan(0);
      expect(b.rootY).toBeCloseTo(a.rootY, 4); expect(b.thighL[0]).toBeCloseTo(a.thighL[0], 4); expect(b.foreL).toBeCloseTo(a.foreL, 4);
      expect(b.grips?.left[1] ?? 0).toBeCloseTo(a.grips?.left[1] ?? 0, 4);
    }
  });
  it("holds a second workout back while someone's on the bench", () => {
    expect(canStart([], 0)).toBe(true);
    expect(canStart([{ start: 1000 }], 2000)).toBe(false);
    expect(canStart([{ start: 1000 }], 1000 + STAGE_MS)).toBe(true);
  });
  it("has every station in the gym", () => {
    const b = generateCity(1337, 0, 0, 6).buildings.find((x) => x.venue === "gym")!;
    expect(stations(venueLayout(b))).not.toBeNull();
  });
  it("spawns beside someone standing on the spot", () => {
    const bounds = { minX: -5, maxX: 5, minZ: -10, maxZ: 0 };
    expect(freeSpotNear(0, -5, [], [], bounds)).toEqual([0, -5]);
    const [x, z] = freeSpotNear(0, -5, [{ x: 0, z: -5, r: 0.3 }], [], bounds);
    expect(Math.hypot(x, z + 5)).toBeGreaterThan(0.6);
  });
});

describe("bills", () => {
  it("charges the gym and the health plan monthly and pays ahead once", () => {
    const life = newLife(1);
    life.bank = 1000; life.gymDue = 11; life.insured = true; life.healthDue = 31;
    let b = bills(life, 1).find((x) => x.id === "gym")!;
    expect(b.days).toBe(10); expect(canPayAhead(b)).toBe(true);
    payAhead(life, "gym");
    b = bills(life, 1).find((x) => x.id === "gym")!;
    expect(b.days).toBe(40); expect(canPayAhead(b)).toBe(false);
    expect(canPayAhead(bills(life, 12).find((x) => x.id === "gym")!)).toBe(true); // 29 left
    expect(canPayAhead(bills(life, 11).find((x) => x.id === "gym")!)).toBe(false); // 30 left
    dailyBills(life, 41);
    expect(life.gymDue).toBe(41 + BILL_DAYS);
    expect(life.healthDue).toBe(31 + BILL_DAYS);
  });
  it("moves old weekly health plans onto a due day", () => {
    const life = readLife({ insured: true, insuredDay: 3 }, 10);
    expect(life.healthDue).toBeGreaterThan(10);
    expect(life.gymDue).toBeNull();
  });
});
