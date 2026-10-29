import { createRef, useMemo, type RefObject } from "react";
import * as THREE from "three";

function Bone({ len, mat, r = 0.075 }: { len: number; mat: THREE.Material; r?: number }) {
  return (
    <>
      <mesh material={mat} position={[0, -len / 2, 0]} castShadow receiveShadow>
        <capsuleGeometry args={[r, Math.max(0.01, len - r * 0.5), 6, 12]} />
      </mesh>
    </>
  );
}

export const BODY_PARTS = ["root", "hips", "torso", "head", "thighL", "shinL", "thighR", "shinR", "armL", "foreL", "armR", "foreR"] as const;
export type BodyRig = Record<(typeof BODY_PARTS)[number], RefObject<THREE.Group | null>>;

export function useBodyRig(): BodyRig {
  return useMemo(() => Object.fromEntries(BODY_PARTS.map((part) => [part, createRef<THREE.Group>()])) as BodyRig, []);
}

/** The animated character's meshes; the rig's groups are posed by Player (or by a remote player's pose). */
export function CharacterBody({ rig, color = "#ffffff" }: { rig: BodyRig; color?: string }) {
  const lineMat = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0 }), [color]);
  const headMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color, roughness: 0.4 }),
    [color],
  );

  return (
    <group ref={rig.root}>
      <group ref={rig.hips} position={[0, 0.95, 0]}>
        {([
          [rig.thighL, rig.shinL, 0.065],
          [rig.thighR, rig.shinR, -0.065],
        ] as const).map(([thigh, shin, x], i) => (
          <group key={i} ref={thigh} position={[x, 0, 0]}>
            <Bone len={0.46} mat={lineMat} />
            <group ref={shin} position={[0, -0.46, 0]}>
              <Bone len={0.46} mat={lineMat} />
              <mesh material={lineMat} position={[0, -0.46, 0.06]} rotation-x={Math.PI / 2}>
                <capsuleGeometry args={[0.07, 0.1, 6, 12]} />
              </mesh>
            </group>
          </group>
        ))}
        <group ref={rig.torso}>
          <mesh material={lineMat} position={[0, 0.28, 0]} castShadow receiveShadow>
            <capsuleGeometry args={[0.16, 0.29, 8, 16]} />
          </mesh>
          <group position={[0, 0.55, 0]}>
            <mesh material={lineMat} rotation-z={Math.PI / 2} castShadow receiveShadow>
              <capsuleGeometry args={[0.09, 0.25, 6, 12]} />
            </mesh>
            {([
              [rig.armL, rig.foreL, 0.2],
              [rig.armR, rig.foreR, -0.2],
            ] as const).map(([arm, fore, x], i) => (
              <group key={i} ref={arm} position={[x, 0, 0]}>
                <Bone len={0.3} mat={lineMat} r={0.06} />
                <group ref={fore} position={[0, -0.3, 0]}>
                  <Bone len={0.28} mat={lineMat} r={0.055} />
                </group>
              </group>
            ))}
            <mesh material={lineMat} position={[0, 0.06, 0]}>
              <cylinderGeometry args={[0.07, 0.07, 0.12, 12]} />
            </mesh>
            <group ref={rig.head} position={[0, 0.25, 0]}>
              <mesh material={headMat} castShadow receiveShadow>
                <sphereGeometry args={[0.14, 24, 18]} />
              </mesh>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
