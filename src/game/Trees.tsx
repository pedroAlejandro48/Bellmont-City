import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { rng, floorHeight, type Prop } from "./config";
import { makeNoise } from "./textures";
import { isSolidNear, useSolidBlock } from "./nearPhysics";
import type { GameState } from "./state";

function segment(a: THREE.Vector3, b: THREE.Vector3, radius: number, sides = 9) {
  const g = new THREE.CylinderGeometry(radius * 0.65, radius, a.distanceTo(b), sides, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
/**
 * A tree's shapes. `far`: the same tree for a distance (where fog softens it anyway) in a fraction of the
 * triangles: three rounded clusters of leaves on a plain trunk. Near: seven clusters on forked branches.
 */
function treeGeometry(seed: number, far = false) {
  const r = rng(seed), wood: THREE.BufferGeometry[] = [], leaves: THREE.BufferGeometry[] = [], stones: THREE.BufferGeometry[] = [];
  if (far) {
    wood.push(segment(new THREE.Vector3(), new THREE.Vector3(0, 4.6, 0), 0.36, 5));
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI * 2 / 3 + r() * 0.6, canopy = new THREE.IcosahedronGeometry(1, 0);
      canopy.scale(2.3, 1.7, 2.3); canopy.translate(Math.cos(angle) * 1.3, 5.2 + r() * 0.6, Math.sin(angle) * 1.3); leaves.push(canopy);
    }
    const merge = (g: THREE.BufferGeometry[]) => { const result = mergeGeometries(g); g.forEach((v) => v.dispose()); return result; };
    return { wood: merge(wood), leaves: merge(leaves), stones: null };
  }
  wood.push(segment(new THREE.Vector3(), new THREE.Vector3(0, 4.3, 0), 0.38, 7));
  for (let i = 0; i < 7; i++) {
    const angle = i * Math.PI * 2 / 7 + r() * 0.55;
    const reach = 1.5 + r() * 1.1, height = 4.3 + r() * 1.3;
    const end = new THREE.Vector3(Math.cos(angle) * reach, height, Math.sin(angle) * reach);
    const fork = end.clone().multiplyScalar(0.75); fork.y = 3.7 + r() * 0.5;
    wood.push(segment(new THREE.Vector3(0, 2.7 + r(), 0), fork, 0.15, 5), segment(fork, end, 0.085, 4));
    const canopy = new THREE.IcosahedronGeometry(1, 1);
    const attr = canopy.getAttribute("position");
    for (let j = 0; j < attr.count; j++) {
      const x = attr.getX(j), y = attr.getY(j), z = attr.getZ(j);
      const wobble = 1 + 0.13 * Math.sin(x * 8 + seed) * Math.cos(z * 7) + 0.1 * Math.sin(y * 11 + seed);
      attr.setXYZ(j, x * wobble, y * wobble, z * wobble);
    }
    canopy.scale(1.45 + r() * 0.55, 1.2 + r() * 0.5, 1.5 + r() * 0.4);
    canopy.translate(end.x, end.y + 0.45, end.z); canopy.computeVertexNormals(); leaves.push(canopy);
  }
  for (let i = 0; i < 13; i++) {
    const angle = i * Math.PI * 2 / 13;
    const stone = new THREE.DodecahedronGeometry(0.2 + r() * 0.08, 0);
    stone.scale(1.3, 0.65, 1); stone.rotateY(r() * 6);
    stone.translate(Math.cos(angle) * 1.2, 0.12, Math.sin(angle) * 1.2); stones.push(stone);
  }
  const merge = (g: THREE.BufferGeometry[]) => { const result = mergeGeometries(g); g.forEach((v) => v.dispose()); return result; };
  return { wood: merge(wood), leaves: merge(leaves), stones: merge(stones) };
}
function TreeBatch({ trees, variant, materials, far = false }: { trees: Prop[]; variant: number; materials: THREE.Material[]; far?: boolean }) {
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const geos = useMemo(() => treeGeometry(variant * 173 + 22, far), [variant, far]);
  const beds = useMemo(() => (far ? [] : trees.filter((t) => t.sidewalk)), [trees, far]);
  const stoneRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    trees.forEach((t, i) => {
      o.position.set(t.x, floorHeight(t.x, t.z), t.z); o.rotation.set(0, t.rot, 0); o.scale.setScalar(t.s); o.updateMatrix();
      refs.current[0]?.setMatrixAt(i, o.matrix);
      o.scale.set(t.s * (0.96 + (Math.sin(t.x + t.z) + 1) * 0.04), t.s, t.s); o.updateMatrix();
      refs.current[1]?.setMatrixAt(i, o.matrix);
    });
    refs.current.forEach((m) => { if (m) { m.count = trees.length; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); } });
    beds.forEach((t, i) => { o.position.set(t.x, 0.15, t.z); o.rotation.set(0, t.rot, 0); o.scale.setScalar(t.s); o.updateMatrix(); stoneRef.current?.setMatrixAt(i, o.matrix); });
    if (stoneRef.current) { stoneRef.current.count = beds.length; stoneRef.current.instanceMatrix.needsUpdate = true; stoneRef.current.computeBoundingSphere(); }
  }, [trees, beds]);
  // Far trees cast no shadow (the sun's shadows only reach ~50 m round the character anyway).
  return <group>{[geos.wood, geos.leaves].map((geo, i) => geo && <instancedMesh key={i} ref={(m) => { refs.current[i] = m; }} args={[geo, materials[i], far ? 2048 : 256]} castShadow={!far} receiveShadow={!far} />)}
    {geos.stones && <instancedMesh ref={stoneRef} args={[geos.stones, materials[2], 256]} receiveShadow />}
  </group>;
}
/**
 * The streamed neighbourhood's trees: those within a block of the character in full (seven leaf clusters, stone
 * beds, shadows), the rest as simple far trees, swapped over as the character moves from block to block.
 */
export function Trees({ trees, state }: { trees: Prop[]; state: GameState }) {
  const block = useSolidBlock(state);
  const nearTrees = useMemo(() => trees.filter((t) => isSolidNear(block, t.x, t.z)), [trees, block]);
  const farTrees = useMemo(() => trees.filter((t) => !isSolidNear(block, t.x, t.z)), [trees, block]);
  const materials = useMemo(() => [
    new THREE.MeshStandardMaterial({ map: makeNoise("#574b3a", "#272a20", 1), roughness: 1 }),
    new THREE.MeshStandardMaterial({ map: makeNoise("#417b42", "#a0b65a", 1), roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ map: makeNoise("#969c95", "#505954", 1), roughness: 1 }),
  ], []);
  const groups = useMemo(() => { const list = Array.from({ length: 12 }, () => [] as Prop[]); nearTrees.forEach((t) => { const i = Math.abs(Math.floor(t.x * 73 + t.z * 31)) % 12; list[i]?.push(t); }); return list; }, [nearTrees]);
  const soil = useRef<THREE.InstancedMesh>(null);
  const beds = useMemo(() => trees.filter((t) => t.sidewalk), [trees]);
  const dirt = useMemo(() => makeNoise("#34372b", "#867b60", 1), []);
  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    beds.forEach((t, i) => { o.position.set(t.x, 0.16, t.z); o.rotation.set(-Math.PI / 2, 0, t.rot); o.scale.setScalar(t.s); o.updateMatrix(); soil.current?.setMatrixAt(i, o.matrix); });
    if (soil.current) { soil.current.count = beds.length; soil.current.instanceMatrix.needsUpdate = true; soil.current.computeBoundingSphere(); }
  }, [beds]);
  return <>
    {groups.map((group, i) => <TreeBatch key={i} trees={group} variant={i} materials={materials} />)}
    <TreeBatch trees={farTrees} variant={0} materials={materials} far />
    <instancedMesh ref={soil} args={[undefined, undefined, 1024]} receiveShadow><circleGeometry args={[1.15, 24]} /><meshStandardMaterial map={dirt} roughness={1} /></instancedMesh>
  </>;
}