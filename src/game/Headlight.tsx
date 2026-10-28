import { useEffect, useMemo } from "react";
import * as THREE from "three";

/** A real forward beam, parented to the vehicle so steering carries its light. */
export function Headlight({ position, forward = "z", intensity = 90, lightRef }: { position: [number, number, number]; forward?: "x" | "z"; intensity?: number; lightRef?: React.Ref<THREE.SpotLight> }) {
  const target = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => { target.position.set(position[0] + (forward === "x" ? 12 : 0), 0, position[2] + (forward === "z" ? 12 : 0)); }, [target, forward, position[0], position[2]]);
  return <><primitive object={target} /><spotLight ref={lightRef ?? null} position={position} target={target} color="#fff0cd" intensity={intensity} distance={42} angle={0.52} penumbra={0.6} decay={1.4} /></>;
}