import { describe, expect, it } from "vitest";
import { RIDER_SLOT, riderAt, scheduledTrip, type RiderPlaces } from "../game/liftRiders";

const places: RiderPlaces = { car: [-5, -10], out: [-5, -8], lobby: [[0, -0.5], [0, -7.5], [-5, -8]], hall: [[3, -6.5], [3, -7.6], [-5, -7.6], [-5, -8]] };
describe("elevator riders", () => {
  it("are the same for everyone (from the clock and the building only)", () => {
    for (let k = 100; k < 140; k++) expect(scheduledTrip("10:20", 7, k, [3, 5, 9])).toEqual(scheduledTrip("10:20", 7, k, [3, 5, 9]));
    const a = Array.from({ length: 40 }, (_, k) => scheduledTrip("10:20", 7, k, [3, 5, 9])?.to), b = Array.from({ length: 40 }, (_, k) => scheduledTrip("-30:40", 7, k, [3, 5, 9])?.to);
    expect(a).not.toEqual(b);
  });
  it("always finish inside their slot, and go to or from a rented floor", () => {
    for (let k = 0; k < 200; k++) {
      const t = scheduledTrip("10:20", 3, k, [2, 15]);
      if (!t) continue;
      expect([t.from, t.to].sort()).toContain(1);
      expect([2, 15]).toContain(Math.max(t.from, t.to));
      let end = 0; while (!riderAt(t, places, end).done) end += 0.5;
      expect(t.t0 + end).toBeLessThan((k + 1) * RIDER_SLOT + 2);
    }
  });
});
