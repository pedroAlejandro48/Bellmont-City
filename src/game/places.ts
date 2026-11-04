// Fixed places for life in the city (pure): ATMs, the busking spot, where homes are, and street addresses for
// deliveries (in front of a building's door).
import { SIDEWALK_H, blockIndex, buildingLayout, generateCity, type Building } from "./config";
import type { HomeKind } from "./life";

/** ATMs on the park's sidewalk, one on each side (opposite the bins), facing the street. */
export const ATMS: { x: number; z: number; yaw: number }[] = [
  { x: -7.8, z: 17.65, yaw: 0 }, { x: 7.8, z: -17.65, yaw: Math.PI },
  { x: 17.65, z: 7.8, yaw: Math.PI / 2 }, { x: -17.65, z: -7.8, yaw: -Math.PI / 2 },
];
export const ATM_SIZE = { w: 0.7, d: 0.55, h: 1.75 };
export const ATM_REACH = 1.6;

/** The busking spot: a painted circle on the park's main path, south of the obelisk. */
export const BUSK_SPOT = { x: 0, z: 11, r: 1.3 };

/** A point on the sidewalk in front of a building's front door, and the direction it faces (out). */
export function doorOf(b: Building): { x: number; z: number; yaw: number } {
  const L = buildingLayout(b);
  if (L.door === "x") return { x: b.x + L.sx * (b.w / 2 + 1.2), z: b.z, yaw: L.sx > 0 ? Math.PI / 2 : -Math.PI / 2 };
  return { x: b.x, z: b.z + L.sz * (b.d / 2 + 1.2), yaw: L.sz > 0 ? 0 : Math.PI };
}

/** The buildings where homes can be rented: a studio block and a loft block, near the park. */
export function homeBuilding(seed: number, kind: HomeKind): Building | null {
  const want: [number, number] = kind === "studio" ? [1, -1] : [-1, 1];
  const city = generateCity(seed, 0, 0);
  return city.buildings.find((b) => !b.restaurant && blockIndex(b.x) === want[0] && blockIndex(b.z) === want[1]) ?? null;
}

/** A delivery address between `min` and `max` metres (straight line) from (x, z): a building's front door. */
export function pickAddress(seed: number, x: number, z: number, min: number, max: number, random: () => number) {
  const city = generateCity(seed, x, z);
  const options = city.buildings.filter((b) => { const d = Math.hypot(b.x - x, b.z - z); return !b.restaurant && d >= min && d <= max; });
  const b = options[Math.floor(random() * options.length)];
  if (!b) return null;
  const door = doorOf(b);
  return { ...door, label: `${Math.abs(Math.round(b.x))} ${b.z >= 0 ? "North" : "South"} ${["Elm", "Oak", "Maple", "Cedar", "Pine", "Birch"][Math.abs(Math.round(b.x + b.z)) % 6]} St` };
}

/** Rooftop billboards: one on each block around the park, on the building nearest the park, facing it. */
export function billboards(seed: number): { x: number; y: number; z: number; yaw: number }[] {
  const city = generateCity(seed, 0, 0), out: { x: number; y: number; z: number; yaw: number }[] = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    if (i === 0 && j === 0) continue;
    const inBlock = city.buildings.filter((b) => !b.restaurant && blockIndex(b.x) === i && blockIndex(b.z) === j);
    const b = inBlock.sort((a, c) => Math.hypot(a.x, a.z) - Math.hypot(c.x, c.z))[0];
    if (!b) continue;
    // Face the park along the block's main direction from it (diagonal blocks face along the longer one).
    const alongX = Math.abs(b.x) > Math.abs(b.z);
    const yaw = alongX ? (b.x > 0 ? -Math.PI / 2 : Math.PI / 2) : (b.z > 0 ? Math.PI : 0);
    const edge = alongX ? b.w / 2 : b.d / 2, inset = Math.max(0, edge - 2.5);
    out.push({ x: alongX ? b.x - Math.sign(b.x) * inset : b.x, y: SIDEWALK_H + b.h + 0.5, z: alongX ? b.z : b.z - Math.sign(b.z) * inset, yaw });
  }
  return out;
}
