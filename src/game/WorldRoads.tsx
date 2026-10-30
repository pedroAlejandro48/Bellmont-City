import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { CITY_GROUND_SIZE, DOUBLE_LINE_GAP, MAIN_ROAD_CENTER, MAIN_ROAD_WIDTH, ROAD_LANE_WIDTH, WORLD_HALF, wildernessCenter } from "./config";
import { cityAsphalt, makeNoise } from "./textures";

/** Centre-line samples every STEP metres; short enough that the ribbon's curves look smooth. */
const STEP = 2;
const REACH = 350;
/** The countryside road starts just inside the city's own street surface, so the two overlap seamlessly. */
const START = WORLD_HALF + 6 - 1;

type Ribbon = { positions: number[]; uvs: number[]; indices: number[] };

/**
 * A strip `width` wide following the curve `centerAt(t)` (t along the axis), sampled every STEP, with
 * texture coordinates in world space matching the city's ground plane, so its asphalt lines up with the city's.
 */
function ribbon(axis: "x" | "z", from: number, to: number, offset: number, width: number, y: number, centerAt: (t: number) => number, out: Ribbon) {
  const at = (t: number): [number, number] => {
    const c = centerAt(t) + offset;
    return axis === "x" ? [t, c] : [c, t];
  };
  const base = out.positions.length / 3;
  let rows = 0;
  for (let t = from; ; t = Math.min(to, t + STEP)) {
    const [px, pz] = at(t);
    const [ax, az] = at(t - 0.5), [bx, bz] = at(t + 0.5);
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    for (const side of [-1, 1]) {
      const x = px + nx * side * width / 2, z = pz + nz * side * width / 2;
      out.positions.push(x, y, z);
      out.uvs.push(0.5 + x / CITY_GROUND_SIZE, 0.5 - z / CITY_GROUND_SIZE);
    }
    if (rows > 0) {
      const i = base + (rows - 1) * 2;
      // Counter-clockwise seen from above, so the surface faces up.
      out.indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
    rows++;
    if (t >= to) break;
  }
}

/** Dashes along a curve: `dash` metres painted, then the same gap. */
function dashes(axis: "x" | "z", from: number, to: number, offset: number, width: number, y: number, centerAt: (t: number) => number, dash: number, out: Ribbon) {
  for (let t = Math.ceil(from / (dash * 2)) * dash * 2; t < to; t += dash * 2) ribbon(axis, t, Math.min(to, t + dash), offset, width, y, centerAt, out);
}

function toGeometry(r: Ribbon) {
  if (!r.indices.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(r.positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(r.uvs, 2));
  g.setIndex(r.indices);
  g.computeVertexNormals();
  return g;
}

/**
 * The four-lane main roads continuing from the city into the countryside, in both directions on both axes,
 * as continuous strips with the city's asphalt and markings. (The ring road around the city is part of the
 * city's own street surface.)
 */
export function WorldRoads({ x, z, seed }: { x: number; z: number; seed: number }) {
  const assets = useMemo(() => {
    const road: Ribbon = { positions: [], uvs: [], indices: [] };
    const yellow: Ribbon = { positions: [], uvs: [], indices: [] };
    const white: Ribbon = { positions: [], uvs: [], indices: [] };
    for (const axis of ["x", "z"] as const) {
      const along = axis === "x" ? x : z;
      const across = axis === "x" ? z : x;
      const centerAt = (t: number) => wildernessCenter(axis, t, seed);
      // Only build what is near the player: a road swings at most ~65 m from the main road's line.
      if (Math.abs(across - MAIN_ROAD_CENTER) > REACH + 70) continue;
      for (const sign of [-1, 1]) {
        const lo = Math.max(START, sign * along - REACH), hi = sign * along + REACH;
        if (hi <= lo) continue;
        const span = (from: number, to: number): [number, number] => (sign === 1 ? [from, to] : [-to, -from]);
        const [a, b] = span(lo, hi);
        ribbon(axis, a, b, 0, MAIN_ROAD_WIDTH, 0.002, centerAt, road);
        // Same markings as the city's main roads: a double solid yellow centre line and white lane dividers.
        for (const offset of [-DOUBLE_LINE_GAP / 2, DOUBLE_LINE_GAP / 2]) ribbon(axis, a, b, offset, 0.12, 0.012, centerAt, yellow);
        for (const offset of [-ROAD_LANE_WIDTH, ROAD_LANE_WIDTH]) dashes(axis, a, b, offset, 0.12, 0.012, centerAt, 2.5, white);
      }
    }
    return { road: toGeometry(road), yellow: toGeometry(yellow), white: toGeometry(white) };
  }, [x, z, seed]);
  useEffect(() => () => { assets.road?.dispose(); assets.yellow?.dispose(); assets.white?.dispose(); }, [assets]);
  const textures = useMemo(() => ({ asphalt: cityAsphalt(), ground: makeNoise("#516c42", "#7d895e", 60) }), []);
  return <>
    <mesh position={[x, -0.04, z]} rotation-x={-Math.PI / 2} receiveShadow><planeGeometry args={[900, 900]} /><meshStandardMaterial map={textures.ground} roughness={1} /></mesh>
    {assets.road && <mesh geometry={assets.road} receiveShadow><meshStandardMaterial map={textures.asphalt} roughness={0.95} polygonOffset polygonOffsetFactor={-1} /></mesh>}
    {assets.yellow && <mesh geometry={assets.yellow}><meshStandardMaterial color="#e8c547" roughness={0.8} polygonOffset polygonOffsetFactor={-2} /></mesh>}
    {assets.white && <mesh geometry={assets.white}><meshStandardMaterial color="#d8dcd7" roughness={0.8} polygonOffset polygonOffsetFactor={-2} /></mesh>}
  </>;
}

