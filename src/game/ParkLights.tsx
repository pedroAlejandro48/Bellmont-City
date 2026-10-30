import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OBELISK_UPLIGHTS, PARK_LAMPS, PARK_LAMP_HEIGHT, PARK_OBELISK_HEIGHT, SIDEWALK_H } from "./config";
import { makeGlow } from "./textures";
import type { GameState } from "./state";

const tmp = new THREE.Object3D();
function matrices(points: { x: number; z: number }[], y: number, scale: [number, number, number] = [1, 1, 1], flat = false) {
  return points.map((p) => {
    tmp.position.set(p.x, y, p.z);
    tmp.rotation.set(flat ? -Math.PI / 2 : 0, 0, 0);
    tmp.scale.set(...scale);
    tmp.updateMatrix();
    return tmp.matrix.clone();
  });
}

function Instances({ geometry, material, items }: { geometry: THREE.BufferGeometry; material: THREE.Material; items: THREE.Matrix4[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} castShadow={false} />;
}

/**
 * The park after dark: vintage lamp posts along its paths, and floodlights in the ground lighting up the
 * obelisk. Always in the scene (not streamed with the park), so the lamps glow from anywhere in the city. The
 * lamps' own light comes from LampLights' shared pool; the obelisk has two real floodlights of its own.
 */
export function ParkLights({ state }: { state: GameState }) {
  const assets = useMemo(() => {
    const iron = new THREE.MeshStandardMaterial({ color: "#1d2b24", roughness: 0.5, metalness: 0.6 });
    const lantern = new THREE.MeshStandardMaterial({ color: "#fff1c9", emissive: new THREE.Color("#ffc46b"), emissiveIntensity: 0, roughness: 0.3, fog: false });
    const glow = new THREE.MeshBasicMaterial({ map: makeGlow(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false });
    const lens = new THREE.MeshStandardMaterial({ color: "#fff7e0", emissive: new THREE.Color("#ffe2a8"), emissiveIntensity: 0, fog: false });
    const base = SIDEWALK_H, top = base + PARK_LAMP_HEIGHT;
    return {
      iron, lantern, glow, lens,
      parts: [
        { geometry: new THREE.CylinderGeometry(0.12, 0.17, 0.35, 10), material: iron, items: matrices(PARK_LAMPS, base + 0.175) },
        { geometry: new THREE.CylinderGeometry(0.045, 0.06, PARK_LAMP_HEIGHT - 0.75, 8), material: iron, items: matrices(PARK_LAMPS, base + 0.35 + (PARK_LAMP_HEIGHT - 0.75) / 2) },
        // The lantern: six glass sides under a little iron roof and finial.
        { geometry: new THREE.CylinderGeometry(0.17, 0.12, 0.42, 6), material: lantern, items: matrices(PARK_LAMPS, top - 0.35) },
        { geometry: new THREE.CylinderGeometry(0.2, 0.2, 0.04, 6), material: iron, items: matrices(PARK_LAMPS, top - 0.58) },
        { geometry: new THREE.ConeGeometry(0.25, 0.22, 6), material: iron, items: matrices(PARK_LAMPS, top - 0.03) },
        { geometry: new THREE.SphereGeometry(0.04, 8, 6), material: iron, items: matrices(PARK_LAMPS, top + 0.11) },
        { geometry: new THREE.PlaneGeometry(1, 1), material: glow, items: matrices(PARK_LAMPS, base + 0.02, [12, 12, 1], true) },
        // Floodlights set in the ground round the obelisk, and their glow on its plinth and the gravel.
        { geometry: new THREE.BoxGeometry(0.34, 0.12, 0.34), material: iron, items: matrices(OBELISK_UPLIGHTS, base + 0.06) },
        { geometry: new THREE.CircleGeometry(0.13, 16), material: lens, items: matrices(OBELISK_UPLIGHTS, base + 0.125, [1, 1, 1], true) },
        { geometry: new THREE.PlaneGeometry(1, 1), material: glow, items: matrices([{ x: 0, z: 0 }], base + 0.03, [8, 8, 1], true) },
      ],
    };
  }, []);
  const spots = useRef<(THREE.SpotLight | null)[]>([]);
  const target = useMemo(() => { const o = new THREE.Object3D(); o.position.set(0, PARK_OBELISK_HEIGHT * 0.65, 0); o.updateMatrixWorld(); return o; }, []);
  useFrame(() => {
    const d = state.darkness;
    assets.lantern.emissiveIntensity = d * 3.2;
    assets.lens.emissiveIntensity = d * 4;
    assets.glow.opacity = d * 0.5;
    for (const s of spots.current) if (s) s.intensity = d * 70;
  });
  // Two opposite floodlights each light two faces of the obelisk.
  const lit = [OBELISK_UPLIGHTS[0]!, OBELISK_UPLIGHTS[2]!];
  return <>
    {assets.parts.map((p, i) => <Instances key={i} geometry={p.geometry} material={p.material} items={p.items} />)}
    <primitive object={target} />
    {lit.map((u, i) => (
      <spotLight key={i} ref={(el) => { spots.current[i] = el; }} position={[u.x, SIDEWALK_H + 0.15, u.z]} target={target} color="#ffe4b0" intensity={0} distance={22} angle={0.42} penumbra={0.5} decay={1} />
    ))}
  </>;
}
