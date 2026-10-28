import { useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { WORLD_HALF, wildernessCenter } from "./config";
import { makeNoise } from "./textures";

export function WorldRoads({ x, z, seed }: { x: number; z: number; seed: number }) {
  const assets = useMemo(() => {
    const road: THREE.BufferGeometry[] = [], stripes: THREE.BufferGeometry[] = [], lanes: THREE.BufferGeometry[] = [];
    function strip(a: [number, number], b: [number, number], width: number, y: number, list: THREE.BufferGeometry[]) {
      const g = new THREE.BoxGeometry(width, 0.03, Math.hypot(b[0] - a[0], b[1] - a[1]) + 0.15);
      g.rotateY(Math.atan2(b[0] - a[0], b[1] - a[1])); g.translate((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2); list.push(g);
    }
    for (const axis of ["x", "z"] as const) {
      const center = axis === "x" ? x : z;
      for (let t = Math.floor((center - 350) / 8) * 8; t < center + 350; t += 8) {
        if (Math.abs(t) < WORLD_HALF) continue;
        const c1 = wildernessCenter(axis, t, seed), c2 = wildernessCenter(axis, t + 8, seed);
        const a: [number, number] = axis === "x" ? [t, c1] : [c1, t];
        const b: [number, number] = axis === "x" ? [t + 8, c2] : [c2, t + 8];
        strip(a, b, 12, 0.03, road);
        strip(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 0.15, 0.06, stripes);
        for (const offset of [-3, 3]) {
          const aa: [number, number] = axis === "x" ? [a[0], a[1] + offset] : [a[0] + offset, a[1]];
          const bb: [number, number] = axis === "x" ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + offset] : [(a[0] + b[0]) / 2 + offset, (a[1] + b[1]) / 2];
          strip(aa, bb, 0.12, 0.06, lanes);
        }
      }
    }
    // Local section of the fully connected square perimeter road.
    for (const side of [-1, 1]) {
      const boundary = side * WORLD_HALF;
      if (Math.abs(z - boundary) < 350) {
        strip([Math.max(-WORLD_HALF, x - 350), boundary], [Math.min(WORLD_HALF, x + 350), boundary], 12, 0.03, road);
        for (let t = Math.ceil(Math.max(-WORLD_HALF, x - 350) / 8) * 8; t < Math.min(WORLD_HALF, x + 350); t += 8) strip([t, boundary], [t + 4, boundary], 0.15, 0.06, stripes);
      }
      if (Math.abs(x - boundary) < 350) {
        strip([boundary, Math.max(-WORLD_HALF, z - 350)], [boundary, Math.min(WORLD_HALF, z + 350)], 12, 0.03, road);
        for (let t = Math.ceil(Math.max(-WORLD_HALF, z - 350) / 8) * 8; t < Math.min(WORLD_HALF, z + 350); t += 8) strip([boundary, t], [boundary, t + 4], 0.15, 0.06, stripes);
      }
    }
    const merge = (g: THREE.BufferGeometry[]) => { if (!g.length) return null; const result = mergeGeometries(g); g.forEach((v) => v.dispose()); return result; };
    return { road: merge(road), stripes: merge(stripes), lanes: merge(lanes) };
  }, [x, z, seed]);
  const textures = useMemo(() => ({ asphalt: makeNoise("#34383a", "#8c9391", 30), ground: makeNoise("#516c42", "#7d895e", 60) }), []);
  return <>
    <mesh position={[x, -0.04, z]} rotation-x={-Math.PI / 2} receiveShadow><planeGeometry args={[900, 900]} /><meshStandardMaterial map={textures.ground} roughness={1} /></mesh>
    {assets.road && <mesh geometry={assets.road} receiveShadow><meshStandardMaterial map={textures.asphalt} roughness={0.95} /></mesh>}
    {assets.stripes && <mesh geometry={assets.stripes}><meshStandardMaterial color="#e8c547" roughness={0.8} /></mesh>}
    {assets.lanes && <mesh geometry={assets.lanes}><meshStandardMaterial color="#d8dcd7" roughness={0.8} /></mesh>}
  </>;
}