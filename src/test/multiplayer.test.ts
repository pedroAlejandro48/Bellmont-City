import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { bumpOthers, PUSH_SPEED, SQUASH } from "@/multiplayer/bump";
import { PoseBuffer, RENDER_DELAY_MS, capturePose, applyPose, type PoseWire } from "@/multiplayer/pose";
import { spawnBeside, SPAWN_SIDE_STEP, standingFromPose } from "@/multiplayer/spawn";
import { createRoomWith, normalizeRoomCode, randomRoomCode, ROOM_CODE_LENGTH } from "@/platform/rooms";

const pose = (ts: number, x: number, yaw = 0): PoseWire => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, "YXZ"));
  return { ts, b: [x, 0, 0, q.x, q.y, q.z, q.w], bv: 1, s: [x + 0.75, 0, 0, 0, 0, 0, 1, 0], sf: 4 };
};

describe("room codes", () => {
  it("are 6 random letters and digits", () => {
    for (let i = 0; i < 200; i++) expect(randomRoomCode()).toMatch(/^[A-Z0-9]{6}$/);
    expect(randomRoomCode(() => 0)).toBe("AAAAAA");
    expect(randomRoomCode(() => 0.999)).toBe("999999");
    expect(randomRoomCode().length).toBe(ROOM_CODE_LENGTH);
  });

  it("accept typed codes in any case and reject malformed ones", () => {
    expect(normalizeRoomCode(" ab12cd ")).toBe("AB12CD");
    expect(normalizeRoomCode("AB12C")).toBeNull();
    expect(normalizeRoomCode("AB-2CD")).toBeNull();
  });

  it("never reuse the code of a room that still exists", async () => {
    const live = new Set(["AAAAAA"]);
    // The first draw collides with the live room; the next is free.
    const draws = [...Array(6).fill(0), 0.1, ...Array(6).fill(0.5), 0.25];
    const room = await createRoomWith(async (r) => {
      if (live.has(r.code)) return false;
      live.add(r.code);
      return true;
    }, () => draws.shift() ?? 0.5);
    expect(room.code).toBe("SSSSSS");
    expect([...live]).toEqual(["AAAAAA", "SSSSSS"]);
  });
});

describe("spawning in a room", () => {
  it("uses the spawn point when it is free", () => {
    expect(spawnBeside({ x: 0, z: 18 }, [{ x: 5, z: 5, yaw: 0 }])).toEqual({ x: 0, z: 18 });
  });

  it("steps to the left of someone standing on it", () => {
    // Facing +z (yaw 0) a character's left arm is on +x.
    expect(spawnBeside({ x: 0, z: 18 }, [{ x: 0, z: 18, yaw: 0 }])).toEqual({ x: SPAWN_SIDE_STEP, z: 18 });
    const turned = spawnBeside({ x: 0, z: 18 }, [{ x: 0, z: 18, yaw: Math.PI / 2 }]);
    expect(turned.x).toBeCloseTo(0);
    expect(turned.z).toBeCloseTo(18 - SPAWN_SIDE_STEP);
  });

  it("keeps stepping left while that spot is taken too", () => {
    const at = spawnBeside({ x: 0, z: 18 }, [{ x: 0, z: 18, yaw: 0 }, { x: SPAWN_SIDE_STEP, z: 18, yaw: 0 }]);
    expect(at).toEqual({ x: SPAWN_SIDE_STEP * 2, z: 18 });
  });

  it("reads where a peer stands and faces from their pose", () => {
    const at = standingFromPose(pose(0, 3, 1.2))!;
    expect(at.x).toBe(3);
    expect(at.yaw).toBeCloseTo(1.2, 3);
  });
});

describe("bumping into other players", () => {
  it("never lets bodies pass through each other", () => {
    const p = { x: 0, z: 0 };
    bumpOthers(p, [{ x: 0.1, z: 0, r: 0.35 }], 0.35, 1 / 60);
    expect(Math.abs(p.x - 0.1)).toBeGreaterThanOrEqual(0.7 * SQUASH - 1e-9);
  });

  it("eases a touched player apart slowly", () => {
    const p = { x: 0.65, z: 0 };
    const dt = 1 / 60;
    bumpOthers(p, [{ x: 0, z: 0, r: 0.35 }], 0.35, dt);
    expect(p.x).toBeCloseTo(Math.min(0.7, 0.65 + PUSH_SPEED * dt));
  });

  it("ignores players who are not touching", () => {
    const p = { x: 2, z: 0 };
    bumpOthers(p, [{ x: 0, z: 0, r: 0.35 }], 0.35, 1 / 60);
    expect(p).toEqual({ x: 2, z: 0 });
  });
});

describe("remote poses", () => {
  it("round-trip a rig and blend between updates", () => {
    const part = (x: number) => { const o = new THREE.Group(); o.position.x = x; return o; };
    const body = [part(1), part(0)];
    const captured = capturePose({ body, ragdoll: [], scooter: [part(1.75), part(0)] }, { riding: true, braking: false, id: "b1" }, 100)!;
    expect(captured.b.slice(0, 3)).toEqual([1, 0, 0]);
    expect(captured.sf).toBe(1 | 4);
    const target = { body: [new THREE.Group(), new THREE.Group()], ragdoll: [], scooter: new THREE.Group(), front: new THREE.Group() };
    applyPose(target, pose(0, 0), pose(100, 2), 0.25);
    expect(target.body[0]!.position.x).toBeCloseTo(0.5);
    expect(target.scooter.position.x).toBeCloseTo(1.25);
  });

  it("draw a peer slightly in the past, between two received poses", () => {
    const buffer = new PoseBuffer();
    // Sender clock is 5 s behind ours; arrivals 20 ms after sending.
    buffer.push(pose(0, 0), 5020);
    buffer.push(pose(66, 1), 5086);
    buffer.push(pose(133, 2), 5153);
    const at = buffer.sample(5020 + 66 + RENDER_DELAY_MS + 33)!;
    expect(at.a.ts).toBe(66);
    expect(at.b.ts).toBe(133);
    expect(at.t).toBeCloseTo(0.5, 1);
  });

  it("hold the newest pose when updates stop, and ignore stale ones", () => {
    const buffer = new PoseBuffer();
    buffer.push(pose(0, 0), 0);
    buffer.push(pose(66, 1), 66);
    buffer.push(pose(10, 9), 70);
    const at = buffer.sample(10_000)!;
    expect(at.b.b[0]).toBe(1);
    expect(at.t).toBe(1);
  });
});
