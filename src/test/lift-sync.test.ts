import { describe, expect, it } from "vitest";
import { generateCity } from "@/game/config";
import { aptKey } from "@/game/apartments";
import { LiftSystem } from "@/game/liftRiders";
import type { LiftLink, LiftSnap } from "@/game/state";

// Two players' games: one runs the elevators, the other follows. The follower calls the car and rides: both see the
// same car at the same height with its doors in the same state, all the way.
describe("the elevator is the same for everyone in a room", () => {
  const b = generateCity(1337, 0, 0).buildings.find((x) => x.venue === "apartments")!;
  const key = aptKey(b);
  it("follower's car matches the runner's (height and doors)", () => {
    let snap: { snap: LiftSnap; n: number } | null = null, n = 0;
    const reqs: { b: string; floor: number }[] = [];
    const base = { setMe: () => {}, others: () => [], setHome: () => {}, homes: () => [], setShow: () => {}, shows: () => [], setApts: () => {}, apts: () => [] };
    const hostLink: LiftLink = { ...base, isHost: () => true, publish: (s) => { snap = { snap: JSON.parse(JSON.stringify(s)), n: ++n }; }, latest: () => null, request: () => {}, takeRequests: () => reqs.splice(0) };
    const followLink: LiftLink = { ...base, isHost: () => false, publish: () => {}, latest: () => snap, request: (bb, floor) => { reqs.push({ b: bb, floor }); }, takeRequests: () => [] };
    const host = new LiftSystem(new Map([[key, b]])), follower = new LiftSystem(new Map([[key, b]]));
    const me = { b: key, floor: 1, inCar: false, inDoor: false };
    const dt = 1 / 60;
    let worstY = 0, phaseMismatch = 0, frames = 0;
    for (let i = 0; i < 60 * 40; i++) {
      const now = i * dt;
      // The follower calls the car to floor 6 at 1 s, then (riding) asks for floor 2 at 15 s.
      const mine = i === 60 ? [{ b: key, floor: 6 }] : i === 60 * 15 ? [{ b: key, floor: 2 }] : [];
      host.update(dt, now, hostLink, me, []);
      follower.update(dt, now, followLink, me, mine);
      const h = host.car(key), f = follower.car(key);
      worstY = Math.max(worstY, Math.abs(h.y - follower.shownY(key)));
      frames++; if (h.phase !== f.phase) phaseMismatch++;
    }
    console.log("SYNC worst floors apart", worstY.toFixed(3), "phase mismatch", (100 * phaseMismatch / frames).toFixed(2) + "%");
    expect(Math.round(host.car(key).y)).toBe(2);
    expect(Math.round(follower.car(key).y)).toBe(2);
    // (Within a few centimetres of a floor's height at any moment, the phase the same nearly always — an update's delay.)
    expect(worstY).toBeLessThan(0.2);
    expect(phaseMismatch / frames).toBeLessThan(0.03);
  });
});
