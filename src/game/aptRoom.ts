// One floor of an apartment building (pure), in the building's entrance frame (+z toward the front street, +x to the
// right of someone facing the building). The same plan on every floor 2..15:
//   the elevator's shaft in the back-left corner, a hallway across the whole building in front of it, the apartment
//   door at the hallway's right end; the apartment fills the front: the main room (two thirds, on the right as you
//   walk in, the kitchen in its front corner facing the door) and the bedroom (a third, behind a wall on the right
//   with its door in the back corner). The windows here are also what the building shows from outside.
import type { Building } from "./config";
import { floorKey, floorY } from "./apartments";
import type { Box, Room } from "./restaurantRoom";
import { SHAFT, venueLayout } from "./venueRoom";

export const HALL = 1.6;
export const INNER_WALL = 0.14;
/** Clear height of a floor (to its ceiling), and where its windows start and end. */
export const FLOOR_CLEAR = 2.8;
export const WIN = { y0: 0.95, y1: 2.35, kitchenY0: 1.25 } as const;

export type AptFurniture = { type: "counter" | "sink" | "oven" | "microwave" | "fridge" | "table" | "chair" | "couch" | "tvTable" | "tv" | "rug" | "bed" | "desk" | "deskChair" | "closet" | "lamp"; x: number; z: number; rot: number; w: number; d: number; solid: boolean };
export type DoorFrame = { ox: number; oz: number; theta: number };
export type AptFloor = Room & {
  upper: number; y: number;
  hallZ: [number, number]; wallZ: number; divX: number;
  /** The apartment door: its frame (origin at the doorway's right edge, +z into the apartment; the opening spans
   * local x from -1 to 0, like the restaurants' left leaf). */
  door: { x: number; z: number };
  /** Both hinged doors as frames like that one: origin, and the turn from the room's axes (θ: frame +z = into the
   * room the door opens into). */
  hinged: { apartment: DoorFrame; bedroom: DoorFrame };
  bedroomDoor: [number, number];
  furniture: AptFurniture[];
  /** The full-height walls inside (the shaft, the storage, the hallway's wall and door, the bedroom's wall). */
  walls: Box[];
  /** Window openings: on the front wall (x from–to) and on the window side's wall (z from–to), with sill height. */
  front: { a0: number; a1: number; y0: number }[];
  side: { a0: number; a1: number; y0: number }[];
  /** Spots: in front of the elevator (hallway), the bed, the fridge. */
  spots: { elevator: [number, number]; bed: [number, number]; fridge: [number, number] };
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

  // (Everything so far is a wall, floor to ceiling: the camera keeps to this side of them.)
  const walls = solids.map((w) => ({ ...w }));
  const F: AptFurniture[] = [];
  const add = (type: AptFurniture["type"], x: number, z: number, rot: number, w: number, d: number, solid = true) => { F.push({ type, x, z, rot, w, d, solid }); if (solid) { const across = Math.abs(Math.sin(rot)) > 0.5; solids.push({ x, z, hx: (across ? d : w) / 2, hz: (across ? w : d) / 2 }); } };
  // The kitchen in the main room's front corner (on the left as you walk in): counter in the corner, the sink, the
  // oven with its stovetop facing the door, the microwave on the wall above; the fridge on the side wall.
  add("counter", maxX - 0.42, maxZ - 0.32, Math.PI, 0.8, 0.62);
  add("sink", maxX - 1.22, maxZ - 0.32, Math.PI, 0.8, 0.62);
  add("oven", maxX - 2.02, maxZ - 0.32, Math.PI, 0.76, 0.62);
  add("microwave", maxX - 2.02, maxZ - 0.2, Math.PI, 0.5, 0.36, false);
  add("fridge", maxX - 0.37, maxZ - 1.3, -Math.PI / 2, 0.78, 0.7);
  // The table for two to the right of the kitchen.
  const tx = Math.max(divX + 1.0, maxX - 3.4), tz = maxZ - 1.15;
  add("table", tx, tz, 0, 0.8, 0.8);
  add("chair", tx - 0.62, tz, Math.PI / 2, 0.44, 0.44);
  add("chair", tx + 0.62, tz, -Math.PI / 2, 0.44, 0.44);
  // The couch on the left wall facing the TV on the right wall (the bedroom's wall), on its little table.
  const living0 = inside0 + 1.25, living1 = maxZ - 1.9, lz = (living0 + living1) / 2;
  add("rug", (divX + maxX) / 2, lz, 0, Math.min(2.4, maxX - divX - 1.2), 1.8, false);
  add("couch", maxX - 0.45, lz, -Math.PI / 2, 2.0, 0.85);
  add("tvTable", divX + INNER_WALL / 2 + 0.26, lz, Math.PI / 2, 1.1, 0.42);
  add("tv", divX + INNER_WALL / 2 + 0.1, lz, Math.PI / 2, 1.0, 0.06, false);
  // The bedroom: a single bed, a desk under the window, a closet by the door.
  add("bed", minX + 1.08, maxZ - 1.6, Math.PI / 2, 0.98, 2.05);
  add("desk", divX - INNER_WALL / 2 - 0.75, maxZ - 0.35, Math.PI, 1.1, 0.55);
  add("deskChair", divX - INNER_WALL / 2 - 0.75, maxZ - 0.95, 0, 0.45, 0.45, false);
  add("closet", minX + 0.95, inside0 + 0.33, 0, 1.4, 0.6);
  add("lamp", minX + 0.3, maxZ - 2.85, 0, 0.3, 0.3);

  // Windows: on the front (bedroom; the living part of the main room; over the kitchen counter, higher), and on the
  // window side's wall (the main room's over the couch, or the bedroom's beside the bed).
  const front = [
    { a0: minX + 0.6, a1: divX - 0.55, y0: WIN.y0 },
    { a0: divX + 0.55, a1: Math.max(divX + 1.2, maxX - 2.55), y0: WIN.y0 },
    { a0: maxX - 2.45, a1: maxX - 0.25, y0: WIN.kitchenY0 },
  ].filter((w) => w.a1 - w.a0 > 0.5);
  const side = ws === 1 ? [{ a0: living0 + 0.1, a1: living1 - 0.1, y0: WIN.y0 }] : [{ a0: inside0 + 0.45, a1: maxZ - 2.85, y0: WIN.y0 }];

  return {
    ...base, items: [], doors: { left: 0, right: 0 },
    key: floorKey(b, floor), upper: floor, y: floorY(floor),
    solids, walls, plants: [], hallZ: [hall0, hall1], wallZ, divX, door: { x: doorX, z: wallZ }, bedroomDoor: [bd0, bd1], furniture: F, front, side,
    // (The bedroom door opens into the bedroom, toward −x: its frame's +z is the room's −x.)
    hinged: { apartment: { ox: doorX, oz: inside0, theta: 0 }, bedroom: { ox: divX - INNER_WALL / 2, oz: bd1, theta: -Math.PI / 2 } },
    spots: { elevator: [minX + SHAFT / 2, hall0 + 0.65], bed: [minX + 1.08 + 0.75, maxZ - 1.6], fridge: [maxX - 0.37 - 0.8, maxZ - 1.3] },
  };
}
