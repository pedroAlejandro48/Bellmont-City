import { describe, expect, it } from "vitest";
import { generateCity } from "@/game/config";
import { route, setGroceryObstacles } from "@/game/groceryRun";
import { venueLayout } from "@/game/venueRoom";

const store = venueLayout(generateCity(1337, 0, 0).buildings.find((b) => b.venue === "grocery")!);
setGroceryObstacles(store.solids, store.bounds);
/** Whether a straight line passes through a box (not grown). */
const hits = (a: [number, number], b: [number, number]) => store.solids.some((o) => {
  for (let i = 0; i <= 40; i++) { const x = a[0] + (b[0] - a[0]) * i / 40, z = a[1] + (b[1] - a[1]) * i / 40; if (Math.abs(x - o.x) < o.hx + 0.2 && Math.abs(z - o.z) < o.hz + 0.2) return true; }
  return false;
});

describe("shoppers walk round the shelves", () => {
  it("goes round the middle shelves from the front of the store to the back", () => {
    const a: [number, number] = [0, -5.6], b: [number, number] = [0.5, -8.6];
    expect(hits(a, b)).toBe(true);
    const pts = [a, ...route(a, b), b];
    expect(pts.length).toBeGreaterThan(2);
    for (let i = 0; i < pts.length - 1; i++) expect(hits(pts[i]!, pts[i + 1]!)).toBe(false);
  });
  it("walks straight when nothing's in the way", () => {
    expect(route([0, -2], [0.5, -3])).toEqual([]);
  });
});
