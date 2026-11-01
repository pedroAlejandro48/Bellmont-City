import { describe, expect, it } from "vitest";
import { CLOSING, OPENER_PASS, doorState, type DoorUse } from "@/game/doors";
import { LOBBY, OUTSIDE, planWalkThrough, walkThroughPose } from "@/game/restaurantRoom";
import { TRAFFIC_DELAY_MS, TrafficBuffer, readTrafficSnapshot, trafficRow } from "@/game/trafficShare";

const open = (start: number, lead = 0): DoorUse => ({ key: "k", leaf: "left", mode: "open", start, lead, pass: lead + OPENER_PASS.left });
const follow = (start: number, pass: number): DoorUse => ({ key: "k", leaf: "left", mode: "follow", start, lead: 0, pass });

describe("shared restaurant doors", () => {
  it("opens for whoever presses E first and closes once they are through", () => {
    const uses = [open(10)];
    expect(doorState(uses, 9).phase).toBe("closed");
    expect(doorState(uses, 11.5).phase).toBe("opening");
    expect(doorState(uses, 13).phase).toBe("open");
    expect(doorState(uses, 13).angle).toBeGreaterThan(1.2);
    expect(doorState(uses, 10 + OPENER_PASS.left + 0.5).phase).toBe("closing");
    expect(doorState(uses, 10 + OPENER_PASS.left + CLOSING.left + 0.01)).toMatchObject({ phase: "closed", angle: 0 });
  });
  it("stays open until everyone following through is out", () => {
    const uses = [open(10), follow(12, 4)];
    const st = doorState(uses, 15);
    expect(st.phase).toBe("open");
    expect(st.closesAt).toBe(16);
    expect(doorState(uses, 16.5).phase).toBe("closing");
    expect(doorState(uses, 16 + CLOSING.left + 0.01).phase).toBe("closed");
  });
  it("opens afresh for someone who waited for it to shut", () => {
    const uses = [open(10), open(20)];
    expect(doorState(uses, 19).phase).toBe("closed");
    expect(doorState(uses, 21.5).phase).toBe("opening");
  });
  it("walks straight through an open door, in or out", () => {
    const inside = planWalkThrough("in", [0.3, 1.6], Math.PI);
    const end = walkThroughPose(inside.done, inside);
    expect(end.x).toBeCloseTo(LOBBY[0]); expect(end.z).toBeCloseTo(LOBBY[1]);
    expect(walkThroughPose(inside.pass, inside).z).toBeLessThan(-0.5);
    const out = planWalkThrough("out", [0.2, -2.2], 0);
    expect(walkThroughPose(out.done, out).z).toBeCloseTo(OUTSIDE[1]);
    expect(walkThroughPose(out.pass, out).z).toBeGreaterThan(1);
  });
});

describe("shared traffic", () => {
  it("draws vehicles smoothly between snapshots, a moment in the past", () => {
    const buf = new TrafficBuffer();
    buf.push({ v: 1, rows: [trafficRow(3, 0, 0, 0, 10, 0, false, "x", 1, true, 5, 0)] }, 1000);
    buf.push({ v: 1, rows: [trafficRow(3, 1, 0, 0, 10, 0, true, "x", 1, true, 5, 0)] }, 1100);
    const mid = buf.sample(3, 1050 + TRAFFIC_DELAY_MS)!;
    expect(mid.x).toBeCloseTo(0.5);
    expect(buf.sample(4, 1100)).toBeNull();
    // Recycled to a new road: not slid across the city.
    buf.push({ v: 1, rows: [trafficRow(3, 300, 0, 0, 10, 0, false, "x", 1, true, 5, 0)] }, 1200);
    expect(buf.sample(3, 1150 + TRAFFIC_DELAY_MS)!.x).toBe(300);
  });
  it("reads snapshots back the way the database hands them over", () => {
    const row = trafficRow(1, 2, 3, 0.5, 1, 0, true, "z", -1, false, 4, 1);
    expect(readTrafficSnapshot({ v: 1, rows: { 0: row } })?.rows[0]).toEqual(row);
    expect(readTrafficSnapshot({ v: 1 })?.rows).toEqual([]);
    expect(row[6]).toBe(1 | 2 | 4);
  });
});
