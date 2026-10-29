import { describe, expect, it } from "vitest";
import { bikeCanPushVehicle, bikeOutOfBoxes, circleBoxPush, HARMLESS_CONTACT_SPEED, MPH_TO_MPS, vehicleContactHurts, vehicleFootprint } from "@/game/config";

describe("vehicle contact", () => {
  it("only hurts above 10 mph", () => {
    expect(HARMLESS_CONTACT_SPEED).toBeCloseTo(10 * MPH_TO_MPS);
    expect(vehicleContactHurts(0)).toBe(false);
    expect(vehicleContactHurts(9.9 * MPH_TO_MPS)).toBe(false);
    expect(vehicleContactHurts(10 * MPH_TO_MPS)).toBe(false);
    expect(vehicleContactHurts(10.5 * MPH_TO_MPS)).toBe(true);
    expect(vehicleContactHurts(30 * MPH_TO_MPS)).toBe(true);
  });

  it("lays a car's footprint along the way it drives", () => {
    // Yaw 0 drives along +x: 4.4 m long in x, 1.9 m wide in z.
    const car = vehicleFootprint(0, 0, 0, "car");
    expect(circleBoxPush(2.4, 0, 0.35, car)).not.toEqual([0, 0]);
    expect(circleBoxPush(0, 1.4, 0.35, car)).toEqual([0, 0]);
    const turned = vehicleFootprint(0, 0, Math.PI / 2, "car");
    expect(circleBoxPush(0, 2.4, 0.35, turned)).not.toEqual([0, 0]);
    expect(circleBoxPush(1.4, 0, 0.35, turned)).toEqual([0, 0]);
  });

  it("keeps a walker outside a stopped car", () => {
    const car = vehicleFootprint(0, 0, 0, "car");
    const [dx] = circleBoxPush(2.3, 0, 0.35, car);
    expect(2.3 + dx).toBeCloseTo(2.2 + 0.35);
  });

  it("lets bikes push only cars and taxis", () => {
    expect(bikeCanPushVehicle("car")).toBe(true);
    expect(bikeCanPushVehicle("taxi")).toBe(true);
    expect(bikeCanPushVehicle("bus")).toBe(false);
    expect(bikeCanPushVehicle("truck")).toBe(false);
  });

  it("finds and resolves a bike nosing into a vehicle", () => {
    const truck = vehicleFootprint(0, 0, 0, "truck");
    // A bike heading +x (yaw π/2) with its nose just inside the truck's rear.
    const out = bikeOutOfBoxes(-4.4 - 0.8, 0, Math.PI / 2, [truck]);
    expect(out.hit).toBe(0);
    expect(out.dx).toBeLessThan(0);
    expect(bikeOutOfBoxes(-8, 0, Math.PI / 2, [truck]).hit).toBe(-1);
  });
});
