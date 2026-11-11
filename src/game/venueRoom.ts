// Venue rooms (pure): the shops, the hospital and the police station as rooms you walk into, in the entrance's own
// frame like the restaurants (origin at the middle of the entrance wall, +z out to the street, +x to the right of
// someone looking at the door from outside, so also to the right of someone walking in). Each room is a list of
// fixtures; the solid ones are what people bump into, and the renderer draws each by its type.
import { buildingLayout, type Building, type VenueKind } from "./config";
import { LEAF, WALL, roomKey, type Box, type Frame, type RoomLayout } from "./restaurantRoom";

export type FixtureType =
  | "desk" | "chairOffice" | "bench" | "waitChair" | "flag" | "board" | "redCross" | "bed" | "curtain"
  | "treadmill" | "weightBench" | "dumbbells" | "mirror" | "mats"
  | "rack" | "shelfClothes" | "fittingRoom"
  | "bikeDisplay" | "toolWall" | "tireRack" | "workbench"
  | "shelf" | "crate" | "baskets" | "checkout"
  | "shaft" | "sofa" | "armchair" | "coffeeTable" | "rug" | "mailboxes" | "painting";
/** A fixture: centre (x, z), its front facing local yaw `rot` (0 = toward the entrance, +z), its size across (`w`,
 * along its front) and deep (`d`), and whether people bump into it. `tag` picks a variant (a fruit, a paint…). */
export type Fixture = { type: FixtureType; x: number; z: number; rot: number; w: number; d: number; solid: boolean; tag?: string };
export type VenueLayout = RoomLayout & {
  venue: VenueKind;
  fixtures: Fixture[];
  /** Where a customer stands to be served (the counter or the desk), facing `yaw` (local). */
  service: { x: number; z: number; yaw: number };
  /** Where the staff member stands or sits, facing the customer. */
  staff: { x: number; z: number; yaw: number; sit: boolean };
};

/** Where a venue room's customer is served (its layout keeps it; a room from it too). */
export const venueService = (room: RoomLayout) => (room as VenueLayout).service;

/** A fixture's footprint as a box in the room (turns are multiples of 90°). */
export function fixtureBox(f: Fixture): Box {
  const across = Math.abs(Math.sin(f.rot)) > 0.5;
  return { x: f.x, z: f.z, hx: (across ? f.d : f.w) / 2, hz: (across ? f.w : f.d) / 2 };
}

/** The elevator's shaft (a square of walls in the back-left corner, the same on every floor). */
export const SHAFT = 2.6;
/** The elevator doorway's width (two doors, each folding into its side of the frame). */
export const LIFT_DOOR = 1.2;
const FRUITS = ["apple", "banana", "orange", "pear", "lemon", "lime", "grape", "peach"];
const PAINTS = ["#c9281f", "#1f5fbf", "#ffb547", "#2b2d33", "#27877b"];

export function venueLayout(b: Building): VenueLayout {
  const venue = b.venue!;
  const L = buildingLayout(b);
  const alongX = L.door === "x";
  const ox = alongX ? b.x + L.sx * b.w / 2 : b.x, oz = alongX ? b.z : b.z + L.sz * b.d / 2;
  const rot = alongX ? L.sx * Math.PI / 2 : L.sz === 1 ? 0 : Math.PI;
  const frame: Frame = { ox, oz, c: Math.cos(rot), s: Math.sin(rot), rot };
  const width = alongX ? b.d : b.w, depth = alongX ? b.w : b.d;
  const [nx, nz] = alongX ? [0, L.sz] : [L.sx, 0];
  const windowSide = (nx * frame.c - nz * frame.s > 0 ? 1 : -1) as 1 | -1;
  const bounds = { minX: -width / 2 + WALL, maxX: width / 2 - WALL, minZ: -depth + WALL, maxZ: -WALL };
  const { minX, maxX, minZ } = bounds;
  const F: Fixture[] = [];
  const add = (type: FixtureType, x: number, z: number, rot: number, w: number, d: number, solid = true, tag?: string) => F.push({ type, x, z, rot, w, d, solid, ...(tag ? { tag } : {}) });
  // The desk (or counter) at the back, in the middle: staff behind it, the customer in front.
  const backDesk = (w = 2.6) => {
    const z = minZ + 2.1;
    add("desk", 0, z, 0, w, 0.8);
    return { service: { x: 0, z: z + 0.4 + 0.5, yaw: Math.PI }, staff: { x: 0, z: z - 0.4 - 0.45, yaw: 0, sit: false } };
  };
  let service = { x: 0, z: -3, yaw: Math.PI }, staff = { x: 0, z: -4, yaw: 0, sit: false };
  const midZ = (minZ + -WALL) / 2;

  if (venue === "police") {
    ({ service, staff } = backDesk(2.8));
    staff.sit = true; staff.z += 0.1;
    add("chairOffice", staff.x, staff.z, 0, 0.55, 0.55, false);
    // Two long grey benches for waiting, one on each side wall, facing across the room.
    add("bench", minX + 0.35, midZ + 0.4, Math.PI / 2, 2.6, 0.5);
    add("bench", maxX - 0.35, midZ + 0.4, -Math.PI / 2, 2.6, 0.5);
    add("flag", -1.9, minZ + 0.45, 0, 0.3, 0.3, true, "us");
    add("flag", 1.9, minZ + 0.45, 0, 0.3, 0.3, true, "city");
    add("board", minX + 0.03, midZ - 2.4, Math.PI / 2, 1.8, 0.05, false, "wanted");
    add("board", maxX - 0.03, midZ - 2.4, -Math.PI / 2, 1.8, 0.05, false, "notices");
  } else if (venue === "hospital") {
    ({ service, staff } = backDesk(2.6));
    // Waiting chairs along the left wall, a bed behind a curtain at the back right, the red cross above the desk.
    for (let k = 0; k < 4; k++) add("waitChair", minX + 0.35, -3.2 - k * 0.65, Math.PI / 2, 0.55, 0.55);
    for (let k = 0; k < 3; k++) add("waitChair", minX + 2.0, -3.5 - k * 0.65, -Math.PI / 2, 0.55, 0.55);
    add("bed", maxX - 0.7, minZ + 1.4, -Math.PI / 2, 1.0, 2.05);
    add("curtain", maxX - 1.45, minZ + 1.4, -Math.PI / 2, 2.6, 0.04, false);
    add("redCross", 0, minZ + 0.03, 0, 1.2, 0.05, false);
  } else if (venue === "gym") {
    ({ service, staff } = backDesk(2.4));
    add("mats", 0.5, midZ, 0, width - 3.5, depth - 5.5, false);
    add("treadmill", minX + 0.75, -3.6, 0, 0.8, 1.8);
    add("treadmill", minX + 0.75, -6.0, 0, 0.8, 1.8);
    add("weightBench", maxX - 2.6, -5.0, Math.PI / 2, 0.5, 1.4);
    add("dumbbells", maxX - 0.35, -3.6, -Math.PI / 2, 2.2, 0.5);
    add("mirror", minX + 0.03, -8.0, Math.PI / 2, 3.2, 0.04, false);
  } else if (venue === "clothing") {
    const z = minZ + 1.9;
    add("desk", maxX - 1.8, z, 0, 2.2, 0.75);
    service = { x: maxX - 1.8, z: z + 0.38 + 0.5, yaw: Math.PI }; staff = { x: maxX - 1.8, z: z - 0.38 - 0.45, yaw: 0, sit: false };
    for (const [x, zz] of [[-2.6, -4.4], [2.6, -4.4], [-2.6, -6.8], [2.6, -6.8]] as const) add("rack", x, zz, 0, 1.9, 0.55);
    add("shelfClothes", minX + 0.3, -4.0, Math.PI / 2, 3.0, 0.5);
    add("fittingRoom", minX + 0.7, minZ + 0.7, 0, 1.15, 1.15);
    add("fittingRoom", minX + 1.95, minZ + 0.7, 0, 1.15, 1.15);
    add("mirror", maxX - 0.03, -6.0, -Math.PI / 2, 1.6, 0.04, false);
  } else if (venue === "bikes") {
    const z = minZ + 1.9;
    add("desk", minX + 1.9, z, 0, 2.2, 0.75);
    service = { x: minX + 1.9, z: z + 0.38 + 0.5, yaw: Math.PI }; staff = { x: minX + 1.9, z: z - 0.38 - 0.45, yaw: 0, sit: false };
    [-2.4, 0, 2.4].forEach((x, k) => add("bikeDisplay", x, -6.2, 0, 0.75, 1.7, true, PAINTS[k]));
    add("toolWall", maxX - 0.03, -4.2, -Math.PI / 2, 2.6, 0.04, false);
    add("tireRack", maxX - 0.35, -7.6, -Math.PI / 2, 1.6, 0.5);
    add("workbench", maxX - 1.4, minZ + 0.45, 0, 2.2, 0.7);
  } else if (venue === "apartments") {
    // The lobby: the reception desk along the left wall, the elevator's shaft in the back-left corner with its
    // doors facing the reception, a sitting corner on the right, mailboxes by the door.
    const z = -4.2;
    add("desk", minX + 1.1, z, Math.PI / 2, 2.4, 0.8);
    service = { x: minX + 1.1 + 0.4 + 0.55, z, yaw: -Math.PI / 2 }; staff = { x: minX + 0.38, z, yaw: Math.PI / 2, sit: false };
    add("shaft", minX + SHAFT / 2, minZ + SHAFT / 2, 0, SHAFT, SHAFT);
    add("rug", maxX - 1.6, midZ, 0, 3.2, 2.6, false);
    add("sofa", maxX - 0.48, midZ, -Math.PI / 2, 2.2, 0.85);
    add("coffeeTable", maxX - 1.7, midZ, 0, 0.6, 1.1);
    add("armchair", maxX - 1.7, midZ - 1.35, 0, 0.85, 0.8);
    add("armchair", maxX - 1.7, midZ + 1.35, Math.PI, 0.85, 0.8);
    add("mailboxes", maxX - 0.03, -2.2, -Math.PI / 2, 1.6, 0.05, false);
    add("painting", 1.2, minZ + 0.03, 0, 1.6, 0.05, false);
  } else {
    // The grocery: the checkout on the right, its register at its left end; fruit crates along the left wall,
    // shelving aisles in the middle, the baskets by the door.
    const cz = -4.6;
    add("checkout", maxX - 0.95, cz, -Math.PI / 2, 2.6, 0.7);
    // The register is at the counter's left end as the customer faces it (deeper in the store): pay there.
    service = { x: maxX - 0.95 - 0.35 - 0.5, z: cz - 0.85, yaw: Math.PI / 2 }; staff = { x: maxX - 0.25, z: cz - 0.85, yaw: -Math.PI / 2, sit: false };
    // Big crates heaped with fruit; one shelf of drinks at the back (the middle aisles are the pantry).
    FRUITS.forEach((tag, k) => add("crate", minX + 0.42, -2.55 - k * 0.88, Math.PI / 2, 0.82, 0.62, true, tag));
    // The pantry shelf (cans on the front, candy on the back) and the kitchenware shelf.
    add("shelf", -1.2, -7.2, 0, 3.2, 0.6, true, "pantry");
    add("shelf", 1.6, -7.2, 0, 3.0, 0.6, true, "kitchenware");
    add("shelf", 0, minZ + 0.35, 0, Math.min(6, width - 4), 0.6, true, "bottles");
    add("baskets", -1.9, -1.0, 0, 0.5, 0.4, true);
  }

  const solids: Box[] = F.filter((f) => f.solid).map(fixtureBox);
  const plants: [number, number][] = venue === "gym" || venue === "grocery" ? [[windowSide * (maxX - 0.4), -0.65]] : [[maxX - 0.4, -0.65], [minX + 0.4, -0.65]];
  for (const [x, z] of plants) solids.push({ x, z, hx: 0.28, hz: 0.28 });
  const counterFix = F.find((f) => f.type === "desk" || f.type === "checkout")!;
  const frontWindows: [number, number][] = [[-width / 2 + 0.7, -LEAF - 0.75], [LEAF + 0.75, width / 2 - 0.7]];
  const from = minZ + 0.6, to = -WALL - 0.6, half = (to - from - 0.6) / 2;
  const sideWindows: [number, number][] = [[from, from + half], [to - half, to]];
  return {
    key: roomKey(b), kind: "cafe", venue, frame, width, depth, bounds, counter: fixtureBox(counterFix), windowSide,
    // No divider: the lights hang over the front and back halves.
    divider: { z: midZ, doorX: 0 }, frontWindows, sideWindows, solids, plants, fixtures: F, service, staff,
  };
}
