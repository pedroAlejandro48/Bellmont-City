import { describe, expect, it } from "vitest";
import { generateCity, restaurantSpots, PITCH, type Building } from "@/game/config";
import { enterLead, leaveLead, CHAIR, ENTER, LEAF, LEAVE, LOBBY, OUTSIDE, SIT, TABLE, chairBack, enterPose, footprint, leavePose, makeRoom, onLeaf, planSit, separation, sitPose, stepPerson, tableTop, toLocal, toWorld, behindChair } from "@/game/restaurantRoom";

const restaurants = (): Building[] => [...restaurantSpots(1337).keys()].flatMap((key) => {
  const [i = 0, j = 0] = key.split(",").map(Number);
  return generateCity(1337, i * PITCH, j * PITCH).buildings.filter((b) => b.restaurant);
});

describe("restaurant rooms", () => {
  it("has a counter and at most four square tables with two chairs each, tucked in", () => {
    for (const b of restaurants()) {
      const room = makeRoom(b);
      const tables = room.items.filter((i) => i.kind === "table"), chairs = room.items.filter((i) => i.kind === "chair");
      expect(tables.length).toBeGreaterThan(0); expect(tables.length).toBeLessThanOrEqual(4);
      expect(chairs.length).toBe(tables.length * 2);
      // Each chair's seat is partly under its table, its back clear of the table top.
      for (const c of chairs) {
        expect(tables.some((t) => separation(tableTop(t), footprint(c)))).toBe(true);
        expect(tables.every((t) => !separation(tableTop(t), chairBack(c)))).toBe(true);
      }
      // Nothing overlaps the counter or the walls.
      for (const it of room.items) expect(separation(room.counter, footprint(it))).toBeNull();
    }
  });
  it("maps between the room and the world both ways", () => {
    const room = makeRoom(restaurants()[0]!);
    const [x, z] = toWorld(room.frame, 1.2, -3.4), [lx, lz] = toLocal(room.frame, x, z);
    expect(lx).toBeCloseTo(1.2); expect(lz).toBeCloseTo(-3.4);
  });
  it("is solid when walking into furniture, and shoves it at walking pace when running", () => {
    const room = makeRoom(restaurants()[0]!);
    const t = room.items.find((i) => i.kind === "table")!;
    const before = { x: t.x, z: t.z };
    // Walk into the table's near side (toward -z from its +z side).
    let [x, z] = [t.x, t.z + TABLE.half + 0.36];
    for (let i = 0; i < 30; i++) [x, z] = stepPerson(room, x, z - 0.05, false, 1 / 60);
    expect([t.x, t.z]).toEqual([before.x, before.z]);
    expect(z).toBeGreaterThan(t.z + TABLE.half + 0.3);
    for (let i = 0; i < 30; i++) [x, z] = stepPerson(room, x, z - 0.1, true, 1 / 60);
    const moved = before.z - t.z;
    expect(moved).toBeGreaterThan(0.3);
    expect(moved).toBeLessThanOrEqual(2.2 * 30 / 60 + 1e-6);
  });
  it("lets a table carry its chairs along, the legs and backs pushing each other", () => {
    const room = makeRoom(restaurants()[0]!);
    const ti = room.items.findIndex((i) => i.kind === "table"), t = room.items[ti]!;
    const chair = room.items.find((c) => c.kind === "chair" && Math.abs(c.z - t.z) < 0.01 && c.x > t.x)!;
    const x0 = chair.x;
    let [x, z] = [t.x - TABLE.half - 0.36, t.z];
    for (let i = 0; i < 40; i++) [x, z] = stepPerson(room, x + 0.1, z, true, 1 / 60);
    expect(chair.x).toBeGreaterThan(x0);
    for (const a of room.items) for (const b of room.items) if (a !== b && a.kind === "table" && b.kind === "chair") expect(separation(tableTop(a), chairBack(b))).toBeNull();
  });
});

describe("going in and out", () => {
  it("pulls the right door open, walks in, and ends in the lobby with the door shut and the screen black", () => {
    const start = enterPose(0, [0, 1.3], Math.PI);
    expect([start.x, start.z]).toEqual([0, 1.3]);
    const lead = enterLead([0, 1.3]);
    const end = enterPose(ENTER.done + lead, [0, 1.3], Math.PI);
    expect([end.x, end.z]).toEqual(LOBBY); expect(end.door.right).toBeCloseTo(0); expect(end.fade).toBe(0);
    expect(end.yaw).toBeCloseTo(Math.PI);
    // The hand is on the handle while it pulls; the door never sweeps through the body.
    const pull = enterPose(1.6 + lead, [0, 1.3], Math.PI);
    expect(pull.right?.blend).toBe(1);
    for (let t = 0; t <= ENTER.done + lead; t += 0.05) {
      const p = enterPose(t, [0, 1.3], Math.PI);
      for (let r = 0.05; r <= LEAF; r += 0.05) {
        const [lx, lz] = onLeaf("right", p.door.right, r);
        if (p.door.right > 0.02) expect(Math.hypot(lx - p.x, lz - p.z)).toBeGreaterThan(0.2);
      }
    }
  });
  it("pushes the door on the right on the way out and stops outside facing the street", () => {
    const lead = leaveLead(LOBBY);
    expect(lead).toBeGreaterThan(0);
    const end = leavePose(LEAVE.done + lead, LOBBY, Math.PI);
    expect([end.x, end.z]).toEqual(OUTSIDE); expect(end.yaw).toBeCloseTo(0); expect(end.door.left).toBeCloseTo(0);
    expect(leavePose(1.6 + lead, LOBBY, Math.PI).right?.blend).toBe(1);
    // Walking there from the lobby: facing the way he walks (toward the door, +z), not sliding sideways.
    const mid = leavePose(lead * 0.5 + 0.35, LOBBY, Math.PI);
    expect(Math.cos(mid.yaw)).toBeGreaterThan(0.5);
  });
});

describe("sitting at a table", () => {
  it("only offers the seat from behind the chair, facing it", () => {
    const c = { kind: "chair" as const, x: 0, z: 0, f: [1, 0] as [number, number] };
    expect(behindChair(c, -0.8, 0, Math.PI / 2)).toBe(true);
    expect(behindChair(c, 0.8, 0, -Math.PI / 2)).toBe(false);
    expect(behindChair(c, -0.8, 0, -Math.PI / 2)).toBe(false);
  });
  it("pulls the chair out, sits, slides in to the table, and standing up puts it back", () => {
    const room = makeRoom(restaurants()[0]!);
    const index = room.items.findIndex((i) => i.kind === "chair"), c = room.items[index]!;
    const plan = planSit(room, index, c.x - c.f[0] * 0.8, c.z - c.f[1] * 0.8, Math.atan2(c.f[0], c.f[1]))!;
    expect(plan.table).not.toBeNull();
    const pulled = sitPose(plan, SIT.pull[1] + plan.extra, room).chair, seated = sitPose(plan, SIT.done + plan.extra, room);
    const out = (p: [number, number]) => (p[0] - c.x) * c.f[0] + (p[1] - c.z) * c.f[1];
    expect(out(pulled)).toBeLessThan(-0.3);
    expect(seated.sit).toBe(1); expect(out(seated.chair)).toBeGreaterThan(out(pulled));
    expect(seated.left?.at[1]).toBeGreaterThan(TABLE.top); expect(seated.right?.at[1]).toBeGreaterThan(TABLE.top);
    expect(sitPose(plan, 0, room).chair).toEqual([c.x, c.z]);
    expect(CHAIR.seatTop).toBeLessThan(TABLE.top);
  });
});
