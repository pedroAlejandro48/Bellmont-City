import { describe, expect, it } from "vitest";
import { timeInfo } from "@/game/config";

describe("day/night cycle", () => {
  it("daytime lasts 20 minutes", () => {
    expect(timeInfo(1199).isDay).toBe(true);
    expect(timeInfo(1201).isDay).toBe(false);
  });
  it("night lasts 20 minutes then a new day starts", () => {
    expect(timeInfo(2399).isDay).toBe(false);
    expect(timeInfo(2401).isDay).toBe(true);
    expect(timeInfo(2401).day).toBe(2);
  });
  it("starts on day 1", () => {
    expect(timeInfo(0).day).toBe(1);
  });
  it("smoothly blends all lighting across sunset and sunrise", () => {
    for (const horizon of [1200, 2400]) {
      expect(Math.abs(timeInfo(horizon - 0.01).darkness - timeInfo(horizon + 0.01).darkness)).toBeLessThan(0.001);
    }
    expect(timeInfo(600).darkness).toBe(0); expect(timeInfo(1800).darkness).toBe(1);
    expect(timeInfo(1160).darkness).toBeLessThan(timeInfo(1240).darkness);
    expect(timeInfo(2360).darkness).toBeGreaterThan(timeInfo(2440).darkness);
  });
});
