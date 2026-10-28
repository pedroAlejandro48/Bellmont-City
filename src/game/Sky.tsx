import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { rng, timeInfo } from "./config";
import { Environment, Lightformer } from "@react-three/drei";
import type { GameState } from "./state";

const DAY = new THREE.Color("#8cbfe9");
const DUSK = new THREE.Color("#f0a46c");
const TWILIGHT = new THREE.Color("#3a2c4a");
const NIGHT = new THREE.Color("#060a17");

export function SkyAndLights({ state }: { state: GameState }) {
  const { scene, camera } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);
  const moon = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sunMesh = useRef<THREE.Mesh>(null);
  const moonMesh = useRef<THREE.Mesh>(null);
  const stars = useRef<THREE.Points>(null);
  const color = useMemo(() => new THREE.Color(), []);
  const fog = useMemo(() => new THREE.Fog("#8cbfe9", 60, 320), []);

  const starGeo = useMemo(() => {
    const r = rng(7);
    const n = 2500;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = r() * Math.PI * 2;
      const v = Math.acos(r() * 0.98);
      arr[i * 3] = Math.sin(v) * Math.cos(u) * 500;
      arr[i * 3 + 1] = Math.cos(v) * 500;
      arr[i * 3 + 2] = Math.sin(v) * Math.sin(u) * 500;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return g;
  }, []);
  const starMat = useMemo(
    () => new THREE.PointsMaterial({ color: "#ffffff", size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0, depthWrite: false }),
    [],
  );

  useEffect(() => {
    scene.background = color;
    scene.fog = fog;
    if (sun.current) scene.add(sun.current.target);
    if (moon.current) scene.add(moon.current.target);
  }, [scene, color, fog]);

  useFrame((_, raw) => {
    if (state.health > 0) state.elapsed += Math.min(raw, 0.1);
    const ti = timeInfo(state.elapsed);
    state.darkness = ti.darkness;
    const e = ti.elevation;
    const dir = new THREE.Vector3(Math.cos(ti.angle), Math.sin(ti.angle), 0.35).normalize();

    // sky colour
    if (ti.isDay) {
      if (e < 0.15) color.copy(TWILIGHT).lerp(DUSK, e / 0.15);
      else color.copy(DUSK).lerp(DAY, Math.min(1, (e - 0.15) / 0.35));
    } else {
      color.copy(TWILIGHT).lerp(NIGHT, Math.min(1, e * 6));
    }
    fog.color.copy(color);
    fog.far = 320 - ti.darkness * 120;

    const p = state.pos;
    if (sun.current && moon.current && hemi.current) {
      const sunI = 1 - ti.darkness;
      const moonI = ti.darkness * (0.18 + e * 0.32);
      sun.current.intensity = sunI * 2.6;
      sun.current.color.setHSL(0.1, 0.6, 0.6 + Math.min(1, e * 2) * 0.35);
      moon.current.intensity = moonI;
      hemi.current.intensity = sunI * 0.7;
      scene.environmentIntensity = sunI * 0.48;
      hemi.current.color.copy(ti.isDay ? color : NIGHT).lerp(new THREE.Color("#9fb4d8"), ti.isDay ? 0.3 : 0.4);
      const solarAngle = state.elapsed / 1200 * Math.PI * 2;
      const sx = Math.cos(solarAngle), sy = Math.sin(solarAngle);
      sun.current.position.set(p.x + sx * 80, p.y + Math.max(4, sy * 80), p.z + 28);
      moon.current.position.set(p.x - sx * 80, p.y + Math.max(4, -sy * 80), p.z + 28);
      sun.current.target.position.copy(p); moon.current.target.position.copy(p);
      sun.current.target.updateMatrixWorld(); moon.current.target.updateMatrixWorld();
      sun.current.castShadow = ti.isDay;
      moon.current.castShadow = !ti.isDay;
    }
    if (sunMesh.current && moonMesh.current) {
      const body = new THREE.Vector3().copy(camera.position).addScaledVector(dir, 450);
      sunMesh.current.visible = ti.isDay;
      moonMesh.current.visible = !ti.isDay;
      (ti.isDay ? sunMesh.current : moonMesh.current).position.copy(body);
    }
    if (stars.current) {
      stars.current.position.copy(camera.position);
      starMat.opacity = ti.darkness;
      stars.current.rotation.y = state.elapsed * 0.002;
    }
  });

  const shadow = {
    "shadow-mapSize-width": 2048,
    "shadow-mapSize-height": 2048,
    "shadow-camera-left": -50,
    "shadow-camera-right": 50,
    "shadow-camera-top": 50,
    "shadow-camera-bottom": -50,
    "shadow-camera-near": 1,
    "shadow-camera-far": 220,
    "shadow-bias": -0.0004,
  };

  return (
    <>
      <Environment resolution={64}><Lightformer intensity={1.5} position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[20, 20, 1]} /><Lightformer intensity={0.7} color="#abc6bb" position={[-8, 2, 0]} rotation-y={Math.PI / 2} scale={[15, 6, 1]} /></Environment>
      <hemisphereLight ref={hemi} args={["#bcd3f0", "#3a3530", 0.5]} />
      <directionalLight ref={sun} castShadow {...shadow} />
      <directionalLight ref={moon} color="#9db5ff" {...shadow} />
      <mesh ref={sunMesh}>
        <sphereGeometry args={[16, 24, 16]} />
        <meshBasicMaterial color="#fff2c2" fog={false} toneMapped={false} />
      </mesh>
      <mesh ref={moonMesh}>
        <sphereGeometry args={[10, 24, 16]} />
        <meshBasicMaterial color="#e6ecf7" fog={false} toneMapped={false} />
      </mesh>
      <points ref={stars} geometry={starGeo} material={starMat} />
    </>
  );
}
