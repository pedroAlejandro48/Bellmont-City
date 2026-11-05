// Apartment buildings (pure): six around the city, 15 floors each — the lobby with the reception on the ground floor,
// one small apartment on every floor above. Which floors are free changes every two game days (the same for
// everyone in a world); higher floors rent for less.
import { BUILDING_ENTRANCE, SIDEWALK_H, type Building } from "./config";
export { APARTMENT_BLOCKS, APT_HEIGHT } from "./config";

export const APT_FLOORS = 15;
/** Floor height above the lobby (the lobby itself is BUILDING_ENTRANCE.floorHeight tall). */
export const STOREY = 3;
/** The floor of storey `floor` (1 = the lobby, at the sidewalk), world height. */
export const floorY = (floor: number) => SIDEWALK_H + (floor <= 1 ? 0 : BUILDING_ENTRANCE.floorHeight + (floor - 2) * STOREY);
export const aptKey = (b: { x: number; z: number }) => `${b.x}:${b.z}`;
export const floorKey = (b: { x: number; z: number }, floor: number) => `${aptKey(b)}#${floor}`;
export const parseFloorKey = (key: string) => { const [k, f] = key.split("#"); return f ? { building: k!, floor: Number(f) } : null; };

/** Rent per week: $800 at the top floor, $25 more for each floor further down. */
export const rentFor = (floor: number) => 800 + (APT_FLOORS - floor) * 25;
/** The first week is free; rent is charged every seventh day after moving in. */
export const FREE_DAYS = 7;

function hash(n: number) {
  let h = Math.imul(n ^ 0x2c1b3c6d, 0x297a2d39); h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
/** Which floors (2..15) are free to rent at a building on a game day: a fresh draw every two days, at least three. */
export function freeFloors(seed: number, building: string, day: number): number[] {
  const period = Math.floor((day - 1) / 2);
  const [bx, bz] = building.split(":").map(Number) as [number, number];
  const base = seed * 977 + Math.round(bx * 13) * 31 + Math.round(bz * 7) * 17 + period * 7919;
  const out: number[] = [];
  for (let f = 2; f <= APT_FLOORS; f++) if (hash(base + f * 101) < 0.45) out.push(f);
  for (let f = APT_FLOORS; out.length < 3 && f >= 2; f -= 3) if (!out.includes(f)) out.push(f);
  return out.sort((a, b) => a - b);
}

export type ApartmentHome = { kind: "apartment"; building: string; floor: number; since: number; nextRent: number; weekly: number };

/** Is this one of the apartment buildings? */
export const isApartment = (b: Building) => b.venue === "apartments";
