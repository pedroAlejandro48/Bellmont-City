import { useFrame } from "@react-three/fiber";
import { useState } from "react";
import { HALF, blockIndex } from "./config";
import type { GameState } from "./state";

/**
 * The world is solid (has physics) only around the character: the block they are on and the blocks next to it
 * (one block in every direction). Everything further away is still drawn and animated, but has no colliders, so
 * the physics engine has far less to do. This follows the character block by block.
 */
export const SOLID_BLOCKS = 1;
/** How near (m, on either axis) a vehicle must be to the character to be a full physics body (about a block). */
export const SOLID_VEHICLE_REACH = 75;

/** The block the character is on, updated (re-rendering) only when they step onto another one. */
export function useSolidBlock(state: GameState): [number, number] {
  const at = (): [number, number] => [blockIndex(state.pos.x), blockIndex(state.pos.z)];
  const [block, setBlock] = useState<[number, number]>(at);
  useFrame(() => {
    const [i, j] = at();
    if (i !== block[0] || j !== block[1]) setBlock([i, j]);
  });
  return block;
}

/** Whether a point is within the solid area around block (i, j). Off the city's grid, by distance instead. */
export function isSolidNear(block: [number, number], x: number, z: number) {
  const bi = blockIndex(x), bj = blockIndex(z);
  if (Math.abs(bi) > HALF + 1 || Math.abs(bj) > HALF + 1) return false;
  return Math.abs(bi - block[0]) <= SOLID_BLOCKS && Math.abs(bj - block[1]) <= SOLID_BLOCKS;
}
