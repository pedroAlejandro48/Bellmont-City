import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { BLOCK, CITY_GROUND_SIZE, SIDEWALK_H, WORLD_HALF, cityRoadDashes, BUILDING_ENTRANCE, FACADE_STYLES, buildingLayout, type City as CityT } from "./config";
import { buildingGeo, cityAsphalt, makeFacade, makeGlow, makeNoise, makeGroundFloor, makeBlankWall, makeBackDoor } from "./textures";
import type { GameState } from "./state";
import { Trees } from "./Trees";
import { Park } from "./Park";
import { Restaurants } from "./Restaurants";

function useInstances(ref: React.RefObject<THREE.InstancedMesh | null>, mats: THREE.Matrix4[]) {
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    mats.forEach((mat, i) => m.setMatrixAt(i, mat));
    m.instanceMatrix.needsUpdate = true;
    m.count = mats.length;
    m.computeBoundingSphere();
  }, [ref, mats]);
}

const tmp = new THREE.Object3D();
function mat4(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1) {
  tmp.position.set(x, y, z);
  tmp.rotation.set(0, ry, 0);
  tmp.scale.set(sx, sy, sz);
  tmp.updateMatrix();
  return tmp.matrix.clone();
}

export function City({ city, state }: { city: CityT; state: GameState }) {
  const facadeMats = useMemo(
    () =>
      Array.from({ length: 4 * FACADE_STYLES }, (_, i) => {
        const { map, emissiveMap } = makeFacade(i % 4, Math.floor(i / 4));
        return new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0, roughness: 0.85 });
      }),
    [],
  );
  const blankMats = useMemo(() => [0, 1, 2, 3].map((v) => new THREE.MeshStandardMaterial({ map: makeBlankWall(v), roughness: 0.9 })), []);
  const roofMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#4a4a4c", roughness: 1 }), []);
  // Box groups: +X, -X, +Y, -Y, +Z, -Z. Instances are rotated so local +X/+Z face the streets; interior sides stay windowless.
  const facadeSets = useMemo(() => facadeMats.map((street, i) => { const blank = blankMats[i % 4] ?? street; return [street, blank, roofMat, roofMat, street, blank]; }), [facadeMats, blankMats, roofMat]);
  const asphalt = useMemo(() => cityAsphalt(), []);
  const concrete = useMemo(() => makeNoise("#a8a49c", "#5a5650", 20, "#8c887f"), []);
  const grass = useMemo(() => makeNoise("#4f7a3a", "#2e4d22", 12), []);
  const glowTex = useMemo(() => makeGlow(), []);
  const groundMats = useMemo(() => [0, 1, 2, 3].flatMap((v) => [true, false].flatMap((door) => [false, true].map((lit) => { const { map, emissiveMap } = makeGroundFloor(v, door); return new THREE.MeshStandardMaterial({ map, emissiveMap: lit ? emissiveMap : null, emissive: new THREE.Color(lit ? "#ffd48a" : "#000000"), emissiveIntensity: 0, roughness: 0.55, metalness: 0.1 }); }))), []);
  const backDoorMat = useMemo(() => new THREE.MeshStandardMaterial({ map: makeBackDoor(), roughness: 0.8 }), []);
  const groundRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const backDoorRef = useRef<THREE.InstancedMesh>(null);
  const blockRef = useRef<THREE.InstancedMesh>(null);
  const grassRef = useRef<THREE.InstancedMesh>(null);
  const { groundMatrices, backDoors } = useMemo(() => {
    const groundMatrices: THREE.Matrix4[][] = groundMats.map(() => []);
    const backDoors: THREE.Matrix4[] = [];
    const fh = BUILDING_ENTRANCE.floorHeight, y = SIDEWALK_H + fh / 2;
    for (const b of city.buildings) {
      const L = buildingLayout(b);
      if (L.backDoor === "x") backDoors.push(mat4(b.x - L.sx * (b.w / 2 + 0.025), SIDEWALK_H + 1.05, b.z + L.sz * b.d * 0.25, -L.sx * Math.PI / 2, 1.1, 2.1, 1));
      else if (L.backDoor === "z") backDoors.push(mat4(b.x + L.sx * b.w * 0.25, SIDEWALK_H + 1.05, b.z - L.sz * (b.d / 2 + 0.025), L.sz === 1 ? Math.PI : 0, 1.1, 2.1, 1));
      // Restaurants draw their own storefronts.
      if (b.restaurant) continue;
      const xFace = mat4(b.x + L.sx * (b.w / 2 + 0.025), y, b.z, L.sx * Math.PI / 2, b.d, fh, 1);
      const zFace = mat4(b.x, y, b.z + L.sz * (b.d / 2 + 0.025), L.sz === 1 ? 0 : Math.PI, b.w, fh, 1);
      const lit = L.groundLit ? 1 : 0;
      groundMatrices[b.variant * 4 + (L.door === "x" ? 0 : 2) + lit]?.push(xFace);
      groundMatrices[b.variant * 4 + (L.door === "z" ? 0 : 2) + lit]?.push(zFace);
    }
    return { groundMatrices, backDoors };
  }, [city, groundMats]);
  useLayoutEffect(() => {
    groundMatrices.forEach((mats, i) => { const mesh = groundRefs.current[i]; if (!mesh) return; mats.forEach((m, j) => mesh.setMatrixAt(j, m)); mesh.count = mats.length; mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); });
  }, [groundMatrices]);
  useInstances(backDoorRef, backDoors);
  // Blocks beside a main road are narrower than BLOCK; their lawns keep the same pavement margin.
  const blockMatrices = useMemo(() => city.blocks.map((b) => mat4(b.x, b.x === 0 && b.z === 0 ? SIDEWALK_H / 2 - 0.016 : SIDEWALK_H / 2, b.z, 0, b.w / BLOCK, 1, b.d / BLOCK)), [city]);
  const grassMatrices = useMemo(() => city.blocks.filter((b) => b.park).map((b) => mat4(b.x, b.x === 0 && b.z === 0 ? SIDEWALK_H - 0.0075 : SIDEWALK_H + 0.01, b.z, 0, (b.w - 7) / 33, 1, (b.d - 7) / 33)), [city]);
  useInstances(blockRef, blockMatrices);
  useInstances(grassRef, grassMatrices);
  const lampHeadMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#fff3d6", emissive: "#ffcf80", emissiveIntensity: 0 }),
    [],
  );
  const glowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: glowTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      }),
    [glowTex],
  );

  const buildings = useMemo(() => facadeMats.map((_, i) => city.buildings.filter((b) => b.variant === i % 4 && buildingLayout(b).style === Math.floor(i / 4)).map((b) => { const L = buildingLayout(b); return mat4(b.x, SIDEWALK_H + b.h / 2, b.z, L.rot, (L.swap ? b.d : b.w) / 13, b.h / 24, (L.swap ? b.w : b.d) / 13); })), [city, facadeMats]);
  const facadeGeo = useMemo(() => buildingGeo(13, 24, 13), []);
  const unitPlane = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const facadeRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const roofRef = useRef<THREE.InstancedMesh>(null);
  const roofs = useMemo(() => city.buildings.map((b) => mat4(b.x, SIDEWALK_H + b.h + 0.25, b.z, 0, b.w + 0.4, 0.5, b.d + 0.4)), [city]);
  useLayoutEffect(() => {
    buildings.forEach((matrices, variant) => { const mesh = facadeRefs.current[variant]; if (!mesh) return; matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix)); mesh.count = matrices.length; mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); });
  }, [buildings]);
  useInstances(roofRef, roofs);

  // instanced props
  const poleRef = useRef<THREE.InstancedMesh>(null);
  const armRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const glowRef = useRef<THREE.InstancedMesh>(null);
  const laneDashRef = useRef<THREE.InstancedMesh>(null);
  const solidLineRef = useRef<THREE.InstancedMesh>(null);
  const dashRef = useRef<THREE.InstancedMesh>(null);

  const m = useMemo(() => {
    const poles = city.lamps.map((l) => mat4(l.x, 3, l.z));
    const out = (l: { rot: number }): [number, number] => [Math.sin(l.rot), Math.cos(l.rot)];
    const arms = city.lamps.map((l) => {
      const [ox, oz] = out(l);
      return mat4(l.x + ox * 0.7, 5.9, l.z + oz * 0.7, l.rot);
    });
    const heads = city.lamps.map((l) => {
      const [ox, oz] = out(l);
      return mat4(l.x + ox * 1.35, 5.75, l.z + oz * 1.35, l.rot);
    });
    const glows = city.lamps.map((l) => {
      const [ox, oz] = out(l);
      tmp.position.set(l.x + ox * 1.35, 0.02, l.z + oz * 1.35);
      tmp.rotation.set(-Math.PI / 2, 0, 0);
      tmp.scale.set(9, 9, 1);
      tmp.updateMatrix();
      return tmp.matrix.clone();
    });
    // dashed centre lines
    const markings = cityRoadDashes(state.pos.x, state.pos.z);
    const laneDashes = markings.filter((d) => d.divider).map((d) => mat4(d.x, 0.025, d.z, d.rot));
    const dashes = markings.filter((d) => !d.divider && !d.solid).map((d) => mat4(d.x, 0.02, d.z, d.rot));
    const solids = markings.filter((d) => d.solid).map((d) => mat4(d.x, 0.02, d.z, d.rot));
    return { poles, arms, heads, glows, dashes, laneDashes, solids };
  }, [city]);

  useInstances(poleRef, m.poles);
  useInstances(armRef, m.arms);
  useInstances(headRef, m.heads);
  useInstances(glowRef, m.glows);
  useInstances(dashRef, m.dashes);
  useInstances(laneDashRef, m.laneDashes);
  useInstances(solidLineRef, m.solids);

  useFrame(() => {
    const d = state.darkness;
    for (const f of facadeMats) f.emissiveIntensity = d * 1.3;
    lampHeadMat.emissiveIntensity = d * 4;
    glowMat.opacity = d * 0.75;
    for (const g of groundMats) g.emissiveIntensity = d * 1.1;
  });

  return (
    <group>
      {/* ground / streets */}
      <mesh position={[0, 0, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[CITY_GROUND_SIZE, CITY_GROUND_SIZE]} />
        <meshStandardMaterial map={asphalt} roughness={0.95} />
      </mesh>
      <instancedMesh ref={dashRef} args={[undefined, undefined, 2048]} receiveShadow>
        <boxGeometry args={[2.5, 0.02, 0.18]} />
        <meshStandardMaterial color="#e8c547" roughness={0.8} />
      </instancedMesh>

      {/* Double solid yellow centre lines of the main roads, laid end to end in 6 m pieces. */}
      <instancedMesh ref={solidLineRef} args={[undefined, undefined, 2048]} receiveShadow><boxGeometry args={[6.04, 0.02, 0.12]} /><meshStandardMaterial color="#e8c547" roughness={0.8} /></instancedMesh>
      <instancedMesh ref={laneDashRef} args={[undefined, undefined, 2048]} receiveShadow><boxGeometry args={[2.5, 0.02, 0.12]} /><meshStandardMaterial color="#d8dcd7" roughness={0.8} /></instancedMesh>
      {/* blocks */}
      <instancedMesh ref={blockRef} args={[undefined, undefined, 64]} receiveShadow><boxGeometry args={[BLOCK, SIDEWALK_H, BLOCK]} /><meshStandardMaterial map={concrete} roughness={0.9} /></instancedMesh>
      <instancedMesh ref={grassRef} args={[undefined, undefined, 64]} receiveShadow><boxGeometry args={[33, 0.015, 33]} /><meshStandardMaterial map={grass} roughness={1} /></instancedMesh>

      {/* Instanced downtown facades keep streamed blocks affordable. */}
      {buildings.map((_, i) => <instancedMesh key={i} ref={(mesh) => { facadeRefs.current[i] = mesh; }} args={[facadeGeo, facadeSets[i], 256]} castShadow receiveShadow />)}
      <instancedMesh ref={roofRef} args={[undefined, roofMat, 256]} castShadow><boxGeometry args={[1, 1, 1]} /></instancedMesh>
      {groundMats.map((mat, i) => <instancedMesh key={`g${i}`} ref={(mesh) => { groundRefs.current[i] = mesh; }} args={[unitPlane, mat, 256]} receiveShadow />)}
      <instancedMesh ref={backDoorRef} args={[unitPlane, backDoorMat, 128]} receiveShadow />
      <Restaurants city={city} state={state} />
      <Trees trees={city.trees} />
      {city.blocks.some((b) => b.x === 0 && b.z === 0) && <Park />}

      {/* street lights */}
      <instancedMesh ref={poleRef} args={[undefined, undefined, 512]} castShadow>
        <cylinderGeometry args={[0.08, 0.12, 6, 8]} />
        <meshStandardMaterial color="#2b2f33" metalness={0.6} roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={armRef} args={[undefined, undefined, 512]}>
        <boxGeometry args={[0.08, 0.08, 1.5]} />
        <meshStandardMaterial color="#2b2f33" metalness={0.6} roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[undefined, undefined, 512]} material={lampHeadMat}>
        <boxGeometry args={[0.35, 0.18, 0.6]} />
      </instancedMesh>
      <instancedMesh ref={glowRef} args={[undefined, undefined, 512]} material={glowMat}>
        <planeGeometry args={[1, 1]} />
      </instancedMesh>
    </group>
  );
}

/** A handful of real point lights that follow the nearest street lamps at night. */
export function LampLights({ city, state }: { city: CityT; state: GameState }) {
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const timer = useRef(0);
  const heads = useMemo(
    () => city.lamps.map((l) => new THREE.Vector3(l.x + Math.sin(l.rot) * 1.35, 5.5, l.z + Math.cos(l.rot) * 1.35)),
    [city],
  );
  useFrame((_, dt) => {
    timer.current -= dt;
    if (timer.current <= 0) {
      timer.current = 0.4;
      const p = state.pos;
      const sorted = heads
        .map((h) => [h, h.distanceToSquared(p)] as const)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 6);
      sorted.forEach(([h], i) => lights.current[i]?.position.copy(h));
    }
    for (const l of lights.current) if (l) l.intensity = state.darkness * 60;
  });
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <pointLight
          key={i}
          ref={(el) => {
            lights.current[i] = el;
          }}
          color="#ffc27a"
          distance={22}
          decay={1.6}
          intensity={0}
        />
      ))}
    </>
  );
}
