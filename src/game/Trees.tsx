import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { rng, floorHeight, type Prop } from "./config";
import { makeNoise } from "./textures";

function segment(a: THREE.Vector3, b: THREE.Vector3, radius: number) {
  const g = new THREE.CylinderGeometry(radius * 0.65, radius, a.distanceTo(b), 9);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
function treeGeometry(seed: number) {
  const r = rng(seed), wood: THREE.BufferGeometry[] = [], leaves: THREE.BufferGeometry[] = [], stones: THREE.BufferGeometry[] = [];
  wood.push(segment(new THREE.Vector3(), new THREE.Vector3(0, 4.3, 0), 0.38));
  for (let i = 0; i < 7; i++) {
    const angle = i * Math.PI * 2 / 7 + r() * 0.55;
    const reach = 1.5 + r() * 1.1, height = 4.3 + r() * 1.3;
    const end = new THREE.Vector3(Math.cos(angle) * reach, height, Math.sin(angle) * reach);
    const fork = end.clone().multiplyScalar(0.75); fork.y = 3.7 + r() * 0.5;
    wood.push(segment(new THREE.Vector3(0, 2.7 + r(), 0), fork, 0.15), segment(fork, end, 0.085));
    const canopy = new THREE.IcosahedronGeometry(1, 2);
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
function TreeBatch({ trees, variant, materials }: { trees: Prop[]; variant: number; materials: THREE.Material[] }) {
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const geos = useMemo(() => treeGeometry(variant * 173 + 22), [variant]);
  const beds = useMemo(() => trees.filter((t) => t.sidewalk), [trees]);
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
  return <group>{[geos.wood, geos.leaves].map((geo, i) => geo && <instancedMesh key={i} ref={(m) => { refs.current[i] = m; }} args={[geo, materials[i], 256]} castShadow receiveShadow />)}
    {geos.stones && <instancedMesh ref={stoneRef} args={[geos.stones, materials[2], 256]} receiveShadow />}
  </group>;
}
export function Trees({ trees }: { trees: Prop[] }) {
  const materials = useMemo(() => [
    new THREE.MeshStandardMaterial({ map: makeNoise("#574b3a", "#272a20", 1), roughness: 1 }),
    new THREE.MeshStandardMaterial({ map: makeNoise("#417b42", "#a0b65a", 1), roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ map: makeNoise("#969c95", "#505954", 1), roughness: 1 }),
  ], []);
  const groups = useMemo(() => { const list = Array.from({ length: 12 }, () => [] as Prop[]); trees.forEach((t) => { const i = Math.abs(Math.floor(t.x * 73 + t.z * 31)) % 12; list[i]?.push(t); }); return list; }, [trees]);
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
    <instancedMesh ref={soil} args={[undefined, undefined, 1024]} receiveShadow><circleGeometry args={[1.15, 24]} /><meshStandardMaterial map={dirt} roughness={1} /></instancedMesh>
  </>;
}