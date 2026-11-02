import { describe, expect, it } from "vitest";
import { SCOOTER_TIP, scooterTipStep, DEFAULT_SAVE, SCOOTER_COLLISION_PARTS, scooterFootprint, MPH_TO_MPS, SCOOTER_MAX_SPEED, SCOOTER_REVERSE_SPEED, TRAFFIC_SPEED, SCOOTER_PROMPT_FADE_SECONDS, canInteractScooter, scooterBypassReady, scooterNextAction, scooterSpeed, scooterCanDismount, scooterTurn, recenterOrbit } from "@/game/config";
import { createState, knockDown, toSave } from "@/game/state";
import { readSave } from "@/game/saves";

describe("scooter rules", () => {
  it("allows E within half a meter of the scooter surface, not beyond", () => {
    expect(canInteractScooter([0.8, 0], [0, 0], 0)).toBe(true);
    expect(canInteractScooter([0.801, 0], [0, 0], 0)).toBe(false);
  });
  it("fades the interaction prompt in no more than 0.2 seconds", () => {
    expect(SCOOTER_PROMPT_FADE_SECONDS).toBe(0.2);
  });
  it("sets regular traffic to 30 mph and caps scooter speed at 45 mph", () => {
    expect(TRAFFIC_SPEED / MPH_TO_MPS).toBe(30);
    expect(SCOOTER_MAX_SPEED / MPH_TO_MPS).toBeCloseTo(45, 8);
    let speed = 0;
    for (let i = 0; i < 500; i++) speed = scooterSpeed(speed, true, false, 0.05);
    expect(speed / MPH_TO_MPS).toBeCloseTo(45, 8);
    expect(scooterSpeed(speed, true, true, 0.05)).toBeLessThan(speed);
  });
  it("requires a pickup E before a separate mounting E after a fall", () => {
    expect(scooterNextAction(true, false)).toBe("pickup");
    expect(scooterNextAction(false, false)).toBe("mount");
    expect(scooterNextAction(false, true)).toBe("dismount");
  });
  it("waits fifteen seconds before fallen-bike bypass", () => {
    expect(scooterBypassReady(20, 34.999)).toBe(false);
    expect(scooterBypassReady(20, 35)).toBe(true);
  });
  it("ejects a rider and leaves their scooter fallen on a vehicle impact", () => {
    const state = createState(DEFAULT_SAVE); state.scooter.riding = true;
    expect(knockDown(state, 1, { axis: "x", dir: 1, lane: 29 }, [0, 29], [1, 0], 6, 123)).toBe(true);
    expect(state.scooter.riding).toBe(false); expect(state.scooter.fallen).toBe(true);
    expect(state.health).toBe(80); expect(state.incidents[0]?.scooterCrash).toBe(true);
  });
  it("preserves scooter location and fallen state across account reloads", () => {
    const state = createState(DEFAULT_SAVE); state.scooter.pos.set(700, 0, 26); state.scooter.fallen = true;
    expect(readSave(toSave(state)).scooter).toMatchObject({ pos: [700, 0, 26], fallen: true, riding: false });
    expect(readSave({ elapsed: 900, pos: [3, 0, 7] }).pos).toEqual([3, 0, 7]);
  });
  it("allows dismount only at a full stop", () => {
    expect(scooterCanDismount(0)).toBe(true);
    expect(scooterCanDismount(0.01)).toBe(false);
    expect(scooterCanDismount(12)).toBe(false);
    expect(scooterCanDismount(-1)).toBe(false);
  });
  it("drives backwards slower than the 45 mph forward maximum", () => {
    let speed = 0;
    for (let i = 0; i < 500; i++) speed = scooterSpeed(speed, false, true, 0.05);
    expect(speed).toBe(-SCOOTER_REVERSE_SPEED);
    expect(Math.abs(speed) / MPH_TO_MPS).toBeCloseTo(8);
    expect(Math.abs(speed)).toBeLessThan(45 * MPH_TO_MPS);
  });
  it("brakes to a full stop before reversing and coasts to rest on release", () => {
    expect(scooterSpeed(0.1, false, true, 0.05)).toBe(0);
    expect(scooterSpeed(0, false, true, 0.05)).toBeLessThan(0);
    expect(scooterSpeed(-0.1, true, false, 0.05)).toBe(0);
    expect(scooterSpeed(-0.01, false, false, 0.05)).toBe(0);
  });
  it("reverses steering direction naturally while backing up", () => {
    expect(scooterTurn(0, 1, -2, 0.1)).toBeLessThan(0);
    expect(scooterTurn(0, 1, 2, 0.1)).toBeGreaterThan(0);
  });
  it("steering at rest leaves scooter heading unchanged", () => {
    expect(scooterTurn(1.5, 2.4, 0, 1)).toBe(1.5);
    expect(scooterTurn(1.5, 2.4, 5, 1)).toBeGreaterThan(1.5);
  });
  it("recenters camera orbit smoothly during forward movement only", () => {
    expect(recenterOrbit(1, false, 0.1)).toBe(1);
    expect(recenterOrbit(1, true, 0.1)).toBeGreaterThan(0);
    expect(recenterOrbit(1, true, 0.1)).toBeLessThan(1);
  });
  it("throws the intact scooter on a riding collision", () => {
    const state = createState(DEFAULT_SAVE); state.scooter.riding = true;
    knockDown(state, 1, { axis: "x", dir: 1, lane: 29 }, [0, 29], [1, 0], 6, 123);
    expect(state.scooter.throwVelocity.x).toBe(6);
    expect(state.scooter.throwVelocity.y).toBe(3.2);
    expect(state.scooter.throwRemaining).toBe(1.6);
  });
});
import { scooterSide } from "@/game/config";
describe("scooter sides", () => {
  it("detects left (+x) and right (-x) sides of a north-facing bike", () => {
    expect(scooterSide([0.6, 0], [0, 0], 0)).toBe(1);
    expect(scooterSide([-0.6, 0], [0, 0], 0)).toBe(-1);
  });
});
import { scooterTurnRadius, MPH_TO_MPS as MPH } from "@/game/config";
describe("scooter fixed-radius steering", () => {
  it("keeps the same tightest circle at any speed up to 10 mph", () => {
    expect(scooterTurnRadius(3 * MPH)).toBe(4);
    expect(scooterTurnRadius(10 * MPH)).toBe(4);
  });
  it("turns a 90° street corner with a 9 m radius at 25 mph and widens above it", () => {
    expect(scooterTurnRadius(25 * MPH)).toBeCloseTo(9);
    expect(scooterTurnRadius(45 * MPH)).toBeGreaterThan(9);
    let yaw = 0; const speed = 25 * MPH;
    for (let i = 0; i < 1000; i++) yaw = scooterTurn(yaw, 1, speed, (Math.PI / 2 * 9 / speed) / 1000);
    expect(yaw).toBeCloseTo(Math.PI / 2);
  });
});

describe("parked scooter tipping", () => {
  const run = (speed: number) => { let a = 0, v = speed * SCOOTER_TIP.impulsePerSpeed; for (let i = 0; i < 300; i++) { const r = scooterTipStep(a, v, 1 / 60); a = r.angle; v = r.vel; if (r.fallen) return r.fallen; } return Math.abs(a) < 0.01 ? 0 : 9; };
  it("a walking bump only tilts it and it settles back upright", () => expect(run(2.2)).toBe(0));
  it("a running bump knocks it over on that side", () => { expect(run(6.2)).toBe(1); expect(run(-6.2)).toBe(-1); });
});

describe("fallen scooter reach and wheel bounds", () => {
  it("reaches the fallen body from either side within half a meter", () => {
    expect(canInteractScooter([1.6, 0], [0, 0], 0, true)).toBe(true);
    expect(canInteractScooter([-0.4, 0], [0, 0], 0, true)).toBe(false);
    expect(canInteractScooter([0.4, 0], [0, 0], 0, true, -1)).toBe(false);
    expect(canInteractScooter([-1.6, 0], [0, 0], 0, true, -1)).toBe(true);
    expect(canInteractScooter([1.751, 0], [0, 0], 0, true)).toBe(false);
    expect(scooterFootprint(0, 0, 0, true).x).toBe(0.6);
  });
  it("leaves no invisible collision block underneath the wheels", () => {
    for (const p of SCOOTER_COLLISION_PARTS) expect(p.center[1] - p.half[1]).toBeGreaterThanOrEqual(0);
    expect(SCOOTER_COLLISION_PARTS[0].center[1] - SCOOTER_COLLISION_PARTS[0].half[1]).toBeCloseTo(0.005);
  });
});

describe("driving with the joystick", () => {
  it("steers in proportion to the sideways tilt, at any angle", async () => {
    const { stickDrive } = await import("@/game/config");
    expect(stickDrive(null)).toBeNull();
    expect(stickDrive({ x: 0.05, y: 0.05 })).toEqual({ forward: false, reverse: false, throttle: 0, steer: 0 });
    const slight = stickDrive({ x: 0.2, y: 0.95 })!, more = stickDrive({ x: 0.6, y: 0.75 })!, full = stickDrive({ x: 1, y: 0 })!;
    expect(slight.forward && more.forward && full.forward).toBe(true);
    // Right is a negative steer (as the D key), growing with the tilt; straight over is full lock.
    expect(slight.steer).toBeLessThan(0); expect(more.steer).toBeLessThan(slight.steer); expect(full.steer).toBe(-1);
    expect(stickDrive({ x: -0.3, y: 0.9 })!.steer).toBeGreaterThan(0);
    // How far it is pushed is the throttle; pulled back, it brakes and reverses.
    expect(stickDrive({ x: 0, y: 0.4 })!.throttle).toBeLessThan(stickDrive({ x: 0, y: 1 })!.throttle);
    expect(stickDrive({ x: 0, y: 1 })!.throttle).toBe(1);
    expect(stickDrive({ x: 0.2, y: -0.9 })!.reverse).toBe(true);
  });
  it("rides at the speed the push asks for", async () => {
    const { scooterSpeed, SCOOTER_MAX_SPEED } = await import("@/game/config");
    let half = 0, full = 0;
    for (let i = 0; i < 600; i++) { half = scooterSpeed(half, true, false, 0.05, 0.5); full = scooterSpeed(full, true, false, 0.05); }
    expect(full).toBeCloseTo(SCOOTER_MAX_SPEED); expect(half).toBeCloseTo(SCOOTER_MAX_SPEED * 0.5);
  });
});
