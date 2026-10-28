import { describe, expect, it } from "vitest";
import { ACCIDENT_STOP_SECONDS, collisionVelocity, GET_UP_SECONDS, KNOCKDOWN_SECONDS, queueMayResume, roadForward, roadLeft, THROW_DISTANCE, VEHICLE_MASS } from "@/game/config";
import { holdAccidentQueue, trafficTargetSpeed, type TrafficAgent } from "@/game/trafficLogic";
import type { RoadIncident } from "@/game/state";
import { createState, toSave } from "@/game/state";
import { DEFAULT_SAVE } from "@/game/config";
import { readSave } from "@/game/saves";

const vehicle = (id: number, x: number): TrafficAgent => ({ id, x, z: 29, vx: 10, vz: 0, axis: "x", dir: 1, lane: 29, kind: "car", speed: 10, heldBy: null, crashUntil: 0, brake: false });
describe("physical accident rules", () => {
  it("throws approximately two player body lengths", () => { expect(THROW_DISTANCE).toBe(3.9); });
  it("stops the hitting vehicle for five seconds before passing", () => { expect(ACCIDENT_STOP_SECONDS).toBe(5); });
  it("uses equal car/taxi mass, heavier buses, and heaviest trucks", () => {
    expect(VEHICLE_MASS.car).toBe(VEHICLE_MASS.taxi);
    expect(VEHICLE_MASS.bus).toBeGreaterThan(VEHICLE_MASS.car);
    expect(VEHICLE_MASS.truck).toBeGreaterThan(VEHICLE_MASS.bus);
    const [light, heavy] = collisionVelocity(VEHICLE_MASS.car, VEHICLE_MASS.truck, 10, 0);
    expect(Math.abs(light - 10)).toBeGreaterThan(Math.abs(heavy));
  });
  it("holds every following car until five seconds after standing finishes", () => {
    const source = vehicle(0, 20); const followers = [vehicle(1, 8), vehicle(2, -4), vehicle(3, -16)];
    const incident: RoadIncident = { vehicleId: 0, path: source, origin: [20,29], startedAt: 0, passed: true, stoodUpAt: 12 };
    holdAccidentQueue([source,...followers],source,incident);
    for (const follower of followers) {
      expect(follower.heldBy).toBe(0);
      expect(trafficTargetSpeed(follower,[follower],[incident],16.999)).toBe(0);
      expect(trafficTargetSpeed(follower,[follower],[incident],17)).toBe(10);
    }
    expect(queueMayResume(null,100)).toBe(false);
  });
  it("passes to screen-left of travel in all four road directions", () => {
    expect(roadLeft({axis:"x",dir:1,lane:29})).toEqual([0,-1]);
    expect(roadLeft({axis:"x",dir:-1,lane:23})).toEqual([0,1]);
    expect(roadLeft({axis:"z",dir:1,lane:23})).toEqual([1,0]);
    expect(roadLeft({axis:"z",dir:-1,lane:29})).toEqual([-1,0]);
    expect(roadForward({axis:"z",dir:-1,lane:29})).toEqual([0,-1]);
  });
  it("brakes before rear-ending a stopped leader", () => {
    const follower=vehicle(1,0); const leader={...vehicle(0,7),vx:0};
    expect(trafficTargetSpeed(follower,[follower,leader],[],1)).toBeLessThan(follower.speed);
  });
  it("keeps recovery when loading saved progress", () => {
    const loaded=readSave({...DEFAULT_SAVE,health:80,accident:{phase:"rising",remaining:1,direction:[1,0],seed:123}});
    const state=createState(loaded);
    expect(state.health).toBe(80);
    expect(toSave(state).accident?.remaining).toBe(1);
    expect(GET_UP_SECONDS).toBeGreaterThan(2);
    expect(KNOCKDOWN_SECONDS).toBe(2);
  });
});