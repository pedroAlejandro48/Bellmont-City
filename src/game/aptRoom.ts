// One floor of an apartment building (pure), in the building's entrance frame (+z toward the front street, +x to the
// right of someone facing the building). The same plan on every floor 2..15:
//   the elevator's shaft in the back-left corner, a hallway across the whole building in front of it, the apartment
//   door at the hallway's right end; the apartment fills the front: the main room (two thirds, on the right as you
//   walk in, the kitchen in its front corner facing the door) and the bedroom (a third, behind a wall on the right
//   with its door in the back corner). The windows here are also what the building shows from outside.
import type { Building } from "./config";
import { floorKey, floorY } from "./apartments";
import { TABLE, type Box, type Item, type Room } from "./restaurantRoom";
import { SHAFT, venueLayout } from "./venueRoom";

export const HALL = 1.6;
export const INNER_WALL = 0.14;
/** Clear height of a floor (to its ceiling), and where its windows start and end. */
export const FLOOR_CLEAR = 2.8;
export const WIN = { y0: 0.95, y1: 2.35, kitchenY0: 1.25 } as const;

export type AptFurniture = { type: "counter" | "sink" | "oven" | "microwave" | "fridge" | "table" | "chair" | "couch" | "tvTable" | "tv" | "rug" | "bed" | "desk" | "deskChair" | "closet" | "lamp" | "trash"; x: number; z: number; rot: number; w: number; d: number; solid: boolean };
export type DoorFrame = { ox: number; oz: number; theta: number };
export type AptFloor = Room & {
  upper: number; y: number;
  hallZ: [number, number]; wallZ: number; divX: number;
  /** The apartment door: its frame (origin at the doorway's right edge, +z into the apartment; the opening spans
   * local x from -1 to 0, like the restaurants' left leaf). */
  door: { x: number; z: number };
  /** Both hinged doors as frames like that one: origin, and the turn from the room's axes (θ: frame +z = into the
   * room the door opens into). */
  hinged: { apartment: DoorFrame; bedroom: DoorFrame; bathroom: DoorFrame };
  /**
   * The bathroom, between the living room and the bedroom: from the bedroom's wall (x0) to the TV's wall (x1), from
   * the short wall with its door (z0, its inner face; the door from dx0 to dx1) to the front. In it the shower (the
   * front corner by the bedroom wall: a low curb and a curtain along `curtainZ`), the toilet (against the bedroom
   * wall, facing in) and the sink (on the TV's wall). Each with where one stands to use it.
   */
  bath: {
    x0: number; x1: number; z0: number; z1: number; wallZ: number; door: [number, number];
    shower: { x0: number; x1: number; z0: number; z1: number; curtainZ: number; outside: [number, number]; inside: [number, number] };
    toilet: { x: number; z: number; rot: number; front: [number, number]; paper: [number, number, number]; flush: [number, number, number] };
    sink: { x: number; z: number; rot: number; stand: [number, number]; tap: [number, number, number]; bowl: [number, number, number] };
  };
  bedroomDoor: [number, number];
  furniture: AptFurniture[];
  /** The full-height walls inside (the shaft, the storage, the hallway's wall and door, the bedroom's wall). */
  walls: Box[];
  /** Window openings: on the front wall (x from–to) and on the window side's wall (z from–to), with sill height. */
  front: { a0: number; a1: number; y0: number }[];
  side: { a0: number; a1: number; y0: number }[];
  /** The bed: its middle, size; where one sits on its edge (hips), lies (hips), and stands beside it to get in. */
  bed: { x: number; z: number; w: number; l: number; edgeX: number; sit: [number, number]; lie: [number, number]; stand: [number, number] };
  /** Spots: in front of the elevator (hallway), the bed, the fridge. */
  spots: { elevator: [number, number]; bed: [number, number]; fridge: [number, number] };
  /**
   * The kitchen along the front wall (from the corner: fridge, counter, sink, oven, the bin): where one stands at
   * each (facing the wall, +z), the burner a pot sits on, the sink's basin, the counter's spots for clean plates,
   * bowls, cups, jars and silverware, the cupboard under the sink (its doors' hinges), and on the table the place
   * in front of each dining chair (`items` index → where a plate goes).
   */
  kitchen: {
    sinkStand: [number, number]; ovenStand: [number, number]; rackStand: [number, number]; trashStand: [number, number];
    burner: [number, number, number]; basin: [number, number, number]; rack: [number, number, number];
    cupboard: { x: number; z: number; w: number }; trash: [number, number, number];
    places: { chair: number; at: [number, number, number]; stand: [number, number]; yaw: number }[];
  };
};

export function aptFloor(b: Building, floor: number): AptFloor {
  const base = venueLayout(b), { bounds, windowSide: ws } = base;
  const { minX, maxX, minZ, maxZ } = bounds;
  const W = maxX - minX;
  const hall0 = minZ + SHAFT, hall1 = hall0 + HALL, wallZ = hall1, inside0 = wallZ + INNER_WALL;
  const divX = maxX - (W * 2) / 3;
  const doorX = maxX - 0.35;
  const solids: Box[] = [];
  const box = (x0: number, x1: number, z0: number, z1: number) => solids.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2 });
  // The shaft and the closed storage behind the hallway.
  box(minX, minX + SHAFT, minZ, hall0);
  box(minX + SHAFT, maxX, minZ, hall0);
  // The wall between the hallway and the apartment, either side of the door; the door itself (shut, it's a wall
  // too: going through is a scripted move).
  box(minX, doorX - 1, wallZ, inside0);
  box(doorX, maxX, wallZ, inside0);
  box(doorX - 1, doorX, wallZ - 0.02, inside0 + 0.02);
  // The wall between the main room and the bedroom, with the bedroom doorway (1 m) at its back end; its door is
  // shut unless someone's going through (a scripted move), so it's solid too.
  const bd0 = inside0 + 0.2, bd1 = bd0 + 1;
  box(divX - INNER_WALL / 2, divX + INNER_WALL / 2, bd1, maxZ);
  box(divX - INNER_WALL / 2, divX + INNER_WALL / 2, inside0, bd0);
  box(divX - INNER_WALL / 2 - 0.02, divX + INNER_WALL / 2 + 0.02, bd0, bd1);
  // The bathroom: a wall where the TV is (parallel to the bedroom's), and a short wall across to it with the
  // bathroom's door, toward the bedroom door. 0.6 of the bedroom's width; from the front only as deep as leaves the
  // TV (in the middle of the living part) on its wall.
  const living0 = inside0 + 1.25, living1 = maxZ - 1.9, lz = (living0 + living1) / 2;
  const bx0 = divX + INNER_WALL / 2, bx1 = bx0 + 0.6 * (divX - minX), sw0 = Math.max(bd1 + 0.35, lz - 0.72), sw1 = sw0 + INNER_WALL;
  const bdx0 = bx0 + 0.35, bdx1 = bdx0 + 1;
  box(bx1, bx1 + INNER_WALL, sw0, maxZ);
  box(bx0, bdx0, sw0, sw1);
  box(bdx1, bx1 + INNER_WALL, sw0, sw1);
  box(bdx0, bdx1, sw0 - 0.02, sw1 + 0.02);

  // (Everything so far is a wall, floor to ceiling: the camera keeps to this side of them.)
  const walls = solids.map((w) => ({ ...w }));
  const F: AptFurniture[] = [];
  const add = (type: AptFurniture["type"], x: number, z: number, rot: number, w: number, d: number, solid = true) => { F.push({ type, x, z, rot, w, d, solid }); if (solid) { const across = Math.abs(Math.sin(rot)) > 0.5; solids.push({ x, z, hx: (across ? d : w) / 2, hz: (across ? w : d) / 2 }); } };
  // The kitchen in the main room's front corner (on the left as you walk in): counter in the corner, the sink, the
  // oven with its stovetop facing the door, the microwave on the wall above; the fridge on the side wall.
  // (The fridge in the corner, so the sink has room in front of it to stand and wash up.)
  const KZ = maxZ - 0.32;
  add("fridge", maxX - 0.42, maxZ - 0.37, Math.PI, 0.78, 0.7);
  add("counter", maxX - 1.22, KZ, Math.PI, 0.8, 0.62);
  add("sink", maxX - 2.02, KZ, Math.PI, 0.8, 0.62);
  add("oven", maxX - 2.8, KZ, Math.PI, 0.76, 0.62);
  add("trash", maxX - 3.42, maxZ - 0.28, Math.PI, 0.36, 0.36);
  // The table for two to the right of the kitchen. It and its chairs are the room's furniture (`items`), like a
  // restaurant's: solid, and sat at the same way (the chair pulled out, round it, down, shuffled in).
  const items: Item[] = [];
  const tx = Math.max(bx1 + INNER_WALL + 1.05, maxX - 2.4), tz = maxZ - 2.1;
  add("table", tx, tz, 0, TABLE.half * 2, TABLE.half * 2, false);
  items.push({ kind: "table", x: tx, z: tz, f: [0, 1] });
  items.push({ kind: "chair", x: tx - 0.72, z: tz, f: [1, 0] }, { kind: "chair", x: tx + 0.72, z: tz, f: [-1, 0] });
  // The couch on the left wall facing the TV on the right wall (the bathroom's wall), on its little table.
  const tvWall = bx1 + INNER_WALL;
  add("rug", (tvWall + maxX) / 2, lz, 0, Math.min(2.4, maxX - tvWall - 1.2), 1.8, false);
  add("couch", maxX - 0.45, lz, -Math.PI / 2, 2.0, 0.85);
  add("tvTable", tvWall + 0.26, lz, Math.PI / 2, 1.1, 0.42);
  add("tv", tvWall + 0.1, lz, Math.PI / 2, 1.0, 0.06, false);
  // The bedroom: a single bed, a desk under the window, a closet by the door.
  // The bed in the front corner, its head against the front wall (under the window), the long side to the room.
  const BW = 0.98, BL = 2.05, bedX = minX + BW / 2 + 0.05, bedZ = maxZ - BL / 2 - 0.05;
  add("bed", bedX, bedZ, Math.PI, BW, BL);
  add("desk", divX - INNER_WALL / 2 - 0.75, maxZ - 0.35, Math.PI, 1.1, 0.55);
  // The desk chair sits like a dining chair: the desk counts as a table (its near edge where the desk's is).
  items.push({ kind: "table", x: divX - INNER_WALL / 2 - 0.75, z: maxZ - 0.625 + TABLE.half, f: [0, 1] });
  items.push({ kind: "chair", x: divX - INNER_WALL / 2 - 0.75, z: maxZ - 0.95, f: [0, 1] });
  add("closet", minX + 0.95, inside0 + 0.33, 0, 1.4, 0.6);
  add("lamp", minX + 0.3, maxZ - 2.85, 0, 0.3, 0.3);

  // The bathroom's fixtures: the shower tray (a low curb where one steps in), the toilet, the sink.
  const SH = 0.95, shower = { x0: bx0, x1: bx0 + SH, z0: maxZ - SH, z1: maxZ, curtainZ: maxZ - SH, outside: [bx0 + SH / 2, maxZ - SH - 0.55] as [number, number], inside: [bx0 + SH / 2, maxZ - SH / 2 - 0.05] as [number, number] };
  solids.push({ x: (shower.x0 + shower.x1) / 2, z: (shower.z0 + shower.z1) / 2, hx: SH / 2, hz: SH / 2 });
  const toilet = { x: bx0 + 0.36, z: maxZ - SH - 1.05, rot: Math.PI / 2, front: [bx0 + 0.36 + 0.62, maxZ - SH - 1.05] as [number, number], paper: [bx0 + 0.06, 0.72, maxZ - SH - 1.05 + 0.45] as [number, number, number], flush: [bx0 + 0.12, 0.86, maxZ - SH - 1.05 - 0.12] as [number, number, number] };
  solids.push({ x: toilet.x - 0.03, z: toilet.z, hx: 0.36, hz: 0.22 });
  const sink = { x: bx1 - 0.25, z: sw1 + 1.15, rot: -Math.PI / 2, stand: [bx1 - 0.25 - 0.62, sw1 + 1.15] as [number, number], tap: [bx1 - 0.08, 1.02, sw1 + 1.15] as [number, number, number], bowl: [bx1 - 0.27, 0.86, sw1 + 1.15] as [number, number, number] };
  solids.push({ x: sink.x, z: sink.z, hx: 0.25, hz: 0.3 });
  // Windows: on the front (bedroom; the living part of the main room; over the kitchen counter, higher), and on the
  // window side's wall (the main room's over the couch, or the bedroom's beside the bed).
  const front = [
    { a0: minX + 0.6, a1: divX - 0.55, y0: WIN.y0 },
    { a0: divX + 1.2, a1: bx1 - 0.35, y0: WIN.y0 },
    { a0: tvWall + 0.35, a1: Math.max(tvWall + 1.0, maxX - 3.75), y0: WIN.y0 },
    { a0: maxX - 3.2, a1: maxX - 0.95, y0: WIN.kitchenY0 },
  ].filter((w) => w.a1 - w.a0 > 0.5);
  const side = ws === 1 ? [{ a0: living0 + 0.1, a1: living1 - 0.1, y0: WIN.y0 }] : [{ a0: inside0 + 0.45, a1: maxZ - 2.85, y0: WIN.y0 }];

  return {
    ...base, items, doors: { left: 0, right: 0 },
    key: floorKey(b, floor), upper: floor, y: floorY(floor),
    solids, walls, plants: [], hallZ: [hall0, hall1], wallZ, divX, door: { x: doorX, z: wallZ }, bedroomDoor: [bd0, bd1], furniture: F, front, side,
    // (The bedroom door opens into the bedroom, toward −x: its frame's +z is the room's −x.)
    // (The bathroom door opens into the bathroom, toward +z, like the apartment's.)
    hinged: { apartment: { ox: doorX, oz: inside0, theta: 0 }, bedroom: { ox: divX - INNER_WALL / 2, oz: bd1, theta: -Math.PI / 2 }, bathroom: { ox: bdx1, oz: sw1, theta: 0 } },
    bath: { x0: bx0, x1: bx1, z0: sw1, z1: maxZ, wallZ: sw0, door: [bdx0, bdx1], shower, toilet, sink },
    bed: { x: bedX, z: bedZ, w: BW, l: BL, edgeX: bedX + BW / 2, sit: [bedX + BW / 2 - 0.22, maxZ - 1.12], lie: [bedX, maxZ - 1.03], stand: [bedX + BW / 2 + 0.48, maxZ - 1.12] },
    spots: { elevator: [minX + SHAFT / 2, hall0 + 0.65], bed: [bedX + BW / 2 + 0.48, maxZ - 1.12], fridge: [maxX - 0.42, maxZ - 1.3] },
    kitchen: {
      sinkStand: [maxX - 2.02, KZ - 0.72], ovenStand: [maxX - 2.8, KZ - 0.74], rackStand: [maxX - 1.22, KZ - 0.72], trashStand: [maxX - 3.42, maxZ - 0.95],
      burner: [maxX - 2.8 - 0.17, 0.92, KZ - 0.13], basin: [maxX - 2.02, 0.84, KZ + 0.02], rack: [maxX - 1.22, 0.92, KZ + 0.02],
      cupboard: { x: maxX - 2.02, z: KZ - 0.31, w: 0.7 }, trash: [maxX - 3.42, 0.62, maxZ - 0.28],
      places: [1, 2].map((ci) => {
        const c = items[ci]!, at: [number, number, number] = [c.x + c.f[0] * 0.5, TABLE.top + 0.005, c.z + c.f[1] * 0.5];
        // Standing beside the chair (toward the room's front), turned to the table.
        const stand: [number, number] = [c.x + c.f[0] * 0.1, c.z + 0.55];
        return { chair: ci, at, stand, yaw: Math.atan2(at[0] - stand[0], at[2] - stand[1]) };
      }),
    },
  };
}
