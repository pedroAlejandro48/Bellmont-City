import { stepNeeds } from "./needs";
import { quality } from "./quality";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GAME_MINUTE, rng, timeInfo } from "./config";
import { Environment, Lightformer } from "@react-three/drei";
import type { GameState } from "./state";

const DAY = new THREE.Color("#8cbfe9");
const DUSK = new THREE.Color("#f0a46c");
const TWILIGHT = new THREE.Color("#3a2c4a");
const NIGHT = new THREE.Color("#060a17");

function canvas(size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (!g) throw new Error("Canvas textures are unavailable");
  return [c, g] as const;
}
function texture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** A white-hot core fading through warm light to nothing. */
function makeSunGlow() {
  const [c, g] = canvas(256);
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.12, "rgba(255,255,250,1)"); r.addColorStop(0.22, "rgba(255,246,214,0.85)");
  r.addColorStop(0.42, "rgba(255,224,160,0.35)"); r.addColorStop(0.7, "rgba(255,206,130,0.1)"); r.addColorStop(1, "rgba(255,200,120,0)");
  g.fillStyle = r; g.fillRect(0, 0, 256, 256);
  return texture(c);
}
/** The moon's surface: pale grey with darker seas and craters. */
function makeMoon() {
  const [c, g] = canvas(512);
  g.fillStyle = "#d9dde3"; g.fillRect(0, 0, 512, 512);
  const r = rng(11);
  for (let i = 0; i < 9; i++) {
    // The dark seas (maria).
    const x = 80 + r() * 352, y = 120 + r() * 272, rad = 30 + r() * 70;
    const sea = g.createRadialGradient(x, y, 0, x, y, rad);
    sea.addColorStop(0, "rgba(120,126,138,0.55)"); sea.addColorStop(1, "rgba(120,126,138,0)");
    g.fillStyle = sea; g.beginPath(); g.ellipse(x, y, rad * 1.4, rad, r() * 3, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 140; i++) {
    const x = r() * 512, y = 40 + r() * 432, rad = 2 + r() ** 3 * 22;
    g.fillStyle = "rgba(90,96,108,0.35)"; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = Math.max(1, rad * 0.18); g.beginPath(); g.arc(x - rad * 0.15, y - rad * 0.15, rad, Math.PI * 0.9, Math.PI * 1.7); g.stroke();
  }
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.06})`; g.fillRect(r() * 512, r() * 512, 2, 2); }
  return texture(c);
}
/** The soft glow around the moon. */
function makeHalo() {
  const [c, g] = canvas(256);
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  r.addColorStop(0, "rgba(220,230,255,0.75)"); r.addColorStop(0.3, "rgba(200,215,255,0.38)"); r.addColorStop(0.6, "rgba(180,200,255,0.1)"); r.addColorStop(1, "rgba(170,190,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 256, 256);
  return texture(c);
}

export function SkyAndLights({ state }: { state: GameState }) {
  const { scene, camera } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);
  const moon = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sunMesh = useRef<THREE.Group>(null);
  const moonMesh = useRef<THREE.Group>(null);
  const bodies = useMemo(() => ({
    sun: new THREE.SpriteMaterial({ map: makeSunGlow(), color: "#ffffff", transparent: true, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending }),
    moon: new THREE.MeshBasicMaterial({ map: makeMoon(), fog: false, toneMapped: false }),
    halo: new THREE.SpriteMaterial({ map: makeHalo(), color: "#cfdcff", transparent: true, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending, opacity: 0.85 }),
  }), []);
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
    if (state.health > 0) {
      const step = Math.min(raw, 0.1);
      state.elapsed += step;
      // Hunger and thirst run down; either at zero hurts, otherwise health slowly comes back.
      const next = stepNeeds(state, step / GAME_MINUTE);
      state.hunger = next.hunger; state.thirst = next.thirst; state.health = next.health;
      if (state.health <= 0) { state.health = 0; state.deathStartedAt = performance.now(); state.keys.clear(); state.jumpQueued = false; }
    }
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
    // At night the haze thins out so the lit city shows all the way to the horizon.
    fog.near = 60 + ti.darkness * 140;
    fog.far = Math.min(quality().fogFar, 320 + ti.darkness * 780);
    if (fog.near > fog.far * 0.6) fog.near = fog.far * 0.6;

    const p = state.pos;
    if (sun.current && moon.current && hemi.current) {
      const sunI = 1 - ti.darkness;
      const moonI = ti.darkness * (0.18 + e * 0.32);
      sun.current.intensity = sunI * 2.6;
      sun.current.color.setHSL(0.1, 0.6, 0.6 + Math.min(1, e * 2) * 0.35);
      moon.current.intensity = moonI;
      // On Low there are no reflections lighting the shaded sides, so the sky light makes up for them.
      hemi.current.intensity = sunI * (quality().environment ? 0.7 : 1.6);
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
      // Just inside the far clip (Low sees less far), so the sun and moon always show.
      const away = Math.min(450, quality().far * 0.85);
      const body = new THREE.Vector3().copy(camera.position).addScaledVector(dir, away);
      sunMesh.current.visible = ti.isDay;
      moonMesh.current.visible = !ti.isDay;
      const shown = ti.isDay ? sunMesh.current : moonMesh.current;
      // Nearer, smaller in proportion: the same size in the sky either way.
      shown.position.copy(body); shown.scale.setScalar(away / 450);
    }
    if (stars.current) {
      stars.current.position.copy(camera.position);
      starMat.opacity = ti.darkness;
      stars.current.rotation.y = state.elapsed * 0.002;
    }
  });

  const shadow = {
    "shadow-mapSize-width": quality().shadowMap,
    "shadow-mapSize-height": quality().shadowMap,
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
      {/* Soft reflections on every material (not on Low: they cost every pixel, and it looks fine without). */}
      {quality().environment && <Environment resolution={64}><Lightformer intensity={1.5} position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[20, 20, 1]} /><Lightformer intensity={0.7} color="#abc6bb" position={[-8, 2, 0]} rotation-y={Math.PI / 2} scale={[15, 6, 1]} /></Environment>}
      <hemisphereLight ref={hemi} args={["#bcd3f0", "#3a3530", 0.5]} />
      <directionalLight ref={sun} castShadow {...shadow} />
      <directionalLight ref={moon} color="#9db5ff" {...shadow} />
      {/* The sun: a blinding ball of light with soft edges rather than a disc. */}
      <group ref={sunMesh}>
        <sprite material={bodies.sun} scale={[150, 150, 1]} />
      </group>
      {/* The moon: twice its old size, cratered, in a soft halo of its own light. */}
      <group ref={moonMesh}>
        <sprite material={bodies.halo} scale={[120, 120, 1]} renderOrder={-1} />
        <mesh material={bodies.moon} rotation={[0.3, -1.2, 0]}><sphereGeometry args={[20, 32, 24]} /></mesh>
      </group>
      <points ref={stars} geometry={starGeo} material={starMat} />
    </>
  );
}
