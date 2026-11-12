import { describe, expect, it } from "vitest";
import { VENUE_HOURS, businessHours, businessOpen, generateCity } from "@/game/config";
import { commutePath, commutePose, shiftAt, shiftWindow } from "@/game/staffShift";
import { venueLayout } from "@/game/venueRoom";

const M = 1200 / 720;
describe("staff come and go with the opening hours", () => {
  it("the grocery opens 6 AM to 11 PM; the burger place never closes", () => {
    expect(VENUE_HOURS.grocery).toEqual({ opens: 6, closes: 23 });
    expect(businessOpen({ kind: "cafe", venue: "grocery" }, 5.9)).toBe(false);
    expect(businessOpen({ kind: "cafe", venue: "grocery" }, 6)).toBe(true);
    expect(businessOpen({ kind: "cafe", venue: "grocery" }, 23.2)).toBe(false);
    expect(businessHours({ kind: "burger" })).toBe(null);
    expect(businessOpen({ kind: "cafe", venue: "gym" }, 3)).toBe(true);
  });
  it("arrive in the ten minutes before opening, leave after closing, gone between", () => {
    const h = { opens: 6, closes: 23 };
    expect(shiftAt(h, 12, M).phase).toBe("working");
    expect(shiftAt(h, 5 + 55 / 60, M)).toMatchObject({ phase: "arriving" });
    expect(shiftAt(h, 5 + 55 / 60, M).t).toBeCloseTo(5 * M);
    expect(shiftAt(h, 23 + 5 / 60, M)).toMatchObject({ phase: "leaving" });
    expect(shiftAt(h, 2, M).phase).toBe("off");
    expect(shiftAt(null, 2, M).phase).toBe("working");
  });
  it("walks from down the sidewalk through the door to the post (there by opening), and out again", () => {
    const store = venueLayout(generateCity(1337, 0, 0).buildings.find((b) => b.venue === "grocery")!);
    const post: [number, number] = [store.staff.x, store.staff.z];
    const inn = commutePath(store, post, 0, true);
    const start = commutePose(inn, 0, 0, true, 1), done = commutePose(inn, 0, 10 * M, true, 1, shiftWindow(true, M));
    expect(Math.abs(start.x)).toBeGreaterThan(20); expect(start.z).toBeGreaterThan(2);
    expect(done).toMatchObject({ x: post[0], z: post[1], visible: true, walking: false });
    const out = commutePath(store, post, 0, false);
    expect(commutePose(out, 0, 14 * M - 0.5, false, 0, shiftWindow(false, M)).visible).toBe(false);
    expect(commutePose(out, 0, 0, false, 0).visible).toBe(true);
  });
});
