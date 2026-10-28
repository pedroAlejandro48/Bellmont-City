import { useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeNoise, makeText } from "./textures";
import { rng, PARK_SEED, PARK_CORNERS, PARK_BENCHES, PARK_RING_RADIUS, PARK_PATH_WIDTH, PARK_OBELISK_HEIGHT, PARK_ARCH, SIDEWALK_H } from "./config";

function path(a: [number, number], b: [number, number], width: number) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const g = new THREE.BoxGeometry(width, 0.03, Math.hypot(dx, dz));
  g.rotateY(Math.atan2(dx, dz)); g.translate((a[0] + b[0]) / 2, SIDEWALK_H - 0.014, (a[1] + b[1]) / 2);
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * width, uv.getY(i) * Math.hypot(dx, dz));
  return g;
}
export function Park() {
  const assets = useMemo(() => {
    const trails: THREE.BufferGeometry[] = [], wood: THREE.BufferGeometry[] = [], metal: THREE.BufferGeometry[] = [], rocks: THREE.BufferGeometry[] = [];
    const addBox = (list: THREE.BufferGeometry[], dims: [number, number, number], p: [number, number, number], yaw = 0) => { const g = new THREE.BoxGeometry(...dims); g.rotateY(yaw); g.translate(...p); list.push(g); };
    for (const corner of PARK_CORNERS) {
      const length = Math.hypot(...corner);
      trails.push(path([corner[0] / length * PARK_RING_RADIUS, corner[1] / length * PARK_RING_RADIUS], corner, PARK_PATH_WIDTH));
    }
    trails.push(path([0, 18], [0, PARK_RING_RADIUS], PARK_PATH_WIDTH));
    const ring = new THREE.Shape(); ring.absarc(0, 0, PARK_RING_RADIUS + PARK_PATH_WIDTH / 2, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); hole.absarc(0, 0, PARK_RING_RADIUS - PARK_PATH_WIDTH / 2, 0, Math.PI * 2, true); ring.holes.push(hole);
    const circle = new THREE.ShapeGeometry(ring, 80); circle.rotateX(-Math.PI / 2); circle.translate(0, SIDEWALK_H + 0.001, 0); trails.push(circle);
    for (const { x, z, rot: yaw } of PARK_BENCHES) {
      // Rotate the whole assembled bench, not individual slats around world axes.
      const benchBox = (list: THREE.BufferGeometry[], dims: [number, number, number], local: [number, number, number]) => {
        const p = new THREE.Vector3(...local).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        addBox(list, dims, [x + p.x, p.y, z + p.z], yaw);
      };
      for (let slat = 0; slat < 5; slat++) benchBox(wood, [2.5, 0.085, 0.11], [0, 0.7, (slat - 2) * 0.13]);
      for (let slat = 0; slat < 4; slat++) benchBox(wood, [2.5, 0.12, 0.085], [0, 0.93 + slat * 0.15, -0.32]);
      // The 26cm standable backrest top is invisible (defined in config), so no cap board is drawn.
      for (const side of [-1, 1]) {
        benchBox(metal, [0.085, 0.54, 0.56], [side * 0.98, 0.43, 0]);
        benchBox(metal, [0.085, 1.04, 0.085], [side * 0.98, 0.81, -0.32]);
        benchBox(metal, [0.085, 0.085, 0.62], [side * 1.14, 0.98, 0]);
        benchBox(metal, [0.085, 0.25, 0.085], [side * 1.14, 0.85, 0.22]);
      }
    }
    // Fitted voussoirs: shared angular boundaries leave a clear walk-through opening.
    const fixed = rng(PARK_SEED);
    for (const side of [-1, 1]) for (let row = 0; row < 3; row++) {
      addBox(rocks, [PARK_ARCH.outer - PARK_ARCH.inner, PARK_ARCH.spring / 3 - 0.008, PARK_ARCH.depth],
        [side * (PARK_ARCH.outer + PARK_ARCH.inner) / 2, SIDEWALK_H + (row + 0.5) * PARK_ARCH.spring / 3, PARK_ARCH.z]);
    }
    const boundaries = Array.from({ length: 14 }, (_, i) => i === 0 ? 0 : i === 13 ? Math.PI : i / 13 * Math.PI + (fixed() - 0.5) * 0.055);
    for (let i = 0; i < 13; i++) {
      const a = boundaries[i] ?? 0, b = boundaries[i + 1] ?? Math.PI;
      const shape = new THREE.Shape();
      shape.moveTo(Math.cos(a) * PARK_ARCH.inner, Math.sin(a) * PARK_ARCH.inner);
      shape.absarc(0, 0, PARK_ARCH.inner, a, b, false);
      shape.lineTo(Math.cos(b) * PARK_ARCH.outer, Math.sin(b) * PARK_ARCH.outer);
      shape.absarc(0, 0, PARK_ARCH.outer, b, a, true); shape.closePath();
      const block = new THREE.ExtrudeGeometry(shape, { depth: PARK_ARCH.depth, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1, steps: 1, curveSegments: 4 });
      block.translate(0, SIDEWALK_H + PARK_ARCH.spring, PARK_ARCH.z - PARK_ARCH.depth / 2); rocks.push(block);
    }
    for (const g of trails) {
      const position = g.getAttribute("position"), uv = g.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (position.getX(i) + 20) / 2, (20 - position.getZ(i)) / 2);
    }
    const merge = (g: THREE.BufferGeometry[]) => { const normalized = g.map((v) => v.index ? v.toNonIndexed() : v); const result = mergeGeometries(normalized); normalized.forEach((v) => v.dispose()); g.forEach((v) => v.dispose()); return result; };
    return { trail: merge(trails), wood: merge(wood), metal: merge(metal), rocks: merge(rocks), stone: makeNoise("#a0a49b", "#4e5954", 2), gravel: makeNoise("#a8a49c", "#5a5650", 1, "#8c887f"), bark: makeNoise("#79664b", "#383e31", 3), sign: makeText("Bellmont City", "#a0a49b", "#242f2c", 1024, 192) };
  }, []);
  return <group>
    {assets.trail && <mesh geometry={assets.trail} receiveShadow><meshStandardMaterial map={assets.gravel} roughness={0.9} /></mesh>}
    {assets.wood && <mesh geometry={assets.wood} castShadow><meshStandardMaterial map={assets.bark} roughness={0.85} /></mesh>}
    {assets.metal && <mesh geometry={assets.metal} castShadow><meshStandardMaterial color="#323c35" roughness={0.75} /></mesh>}
    {assets.rocks && <mesh geometry={assets.rocks} castShadow receiveShadow><meshStandardMaterial map={assets.stone} roughness={1} /></mesh>}
    <mesh position={[0, 0.35, 0]} castShadow receiveShadow><boxGeometry args={[2.5, 0.4, 2.5]} /><meshStandardMaterial map={assets.stone} roughness={0.9} /></mesh>
    <mesh position={[0, 0.55 + (PARK_OBELISK_HEIGHT - 1) / 2, 0]} rotation-y={Math.PI / 4} castShadow receiveShadow><cylinderGeometry args={[0.5, 0.85, PARK_OBELISK_HEIGHT - 1, 4]} /><meshStandardMaterial map={assets.stone} bumpMap={assets.stone} bumpScale={0.08} roughness={0.8} /></mesh>
    <mesh position={[0, PARK_OBELISK_HEIGHT - 0.5, 0]} rotation-y={Math.PI / 4} castShadow><coneGeometry args={[0.5, 0.9, 4]} /><meshStandardMaterial map={assets.stone} bumpMap={assets.stone} bumpScale={0.08} roughness={0.8} /></mesh>
    <mesh position={[0, SIDEWALK_H + 3.05, PARK_ARCH.z + PARK_ARCH.depth / 2 + 0.025]}><planeGeometry args={[2.65, 0.48]} /><meshStandardMaterial map={assets.sign} roughness={1} /></mesh>
  </group>;
}