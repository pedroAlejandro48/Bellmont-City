import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { quality } from "./quality";
import type { GameState } from "./state";

const BOX = 36, HEIGHT = 18;

/**
 * Rain around the camera: a fixed set of streaks, each falling and wrapping inside a box that follows the camera.
 * All the movement happens on the graphics card (one draw, no work per drop on the CPU). Streaks fade with how hard
 * it rains, lean with a little wind and are hidden when it's dry.
 */
export function Rain({ state }: { state: GameState }) {
  const camera = useThree((t) => t.camera);
  const count = Math.round(2400 * Math.min(1, quality().detail + 0.2));
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(count * 6), seed = new Float32Array(count * 2 * 4);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * BOX, y = Math.random() * HEIGHT, z = Math.random() * BOX, speed = 0.8 + Math.random() * 0.4;
      for (let e = 0; e < 2; e++) { pos.set([0, e, 0], i * 6 + e * 3); seed.set([x, y, z, speed], i * 8 + e * 4); }
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("seed", new THREE.BufferAttribute(seed, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, [count]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { time: { value: 0 }, center: { value: new THREE.Vector3() }, amount: { value: 0 }, light: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec4 seed; uniform float time; uniform vec3 center; uniform float amount;
      varying float vA;
      void main() {
        float fall = mod(seed.y - time * 18.0 * seed.w, ${HEIGHT.toFixed(1)});
        // Each drop lives in a box that follows the camera, wrapped so the rain never runs out at its edge.
        vec3 p = vec3(mod(seed.x - center.x + time * 1.5, ${BOX.toFixed(1)}), fall, mod(seed.z - center.z, ${BOX.toFixed(1)}));
        p.xz -= ${(BOX / 2).toFixed(1)};
        p += vec3(center.x, center.y - 6.0, center.z);
        p += position.y * vec3(0.08, 0.95, 0.0);
        // Only some of the drops when it's light rain.
        vA = step(fract(seed.x * 13.7 + seed.z * 7.1), amount) * (0.35 + 0.65 * position.y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float light; varying float vA;
      void main() { if (vA < 0.01) discard; gl_FragColor = vec4(vec3(0.82, 0.86, 0.95) * light, 0.55 * vA); }`,
  }), []);
  const lines = useRef<THREE.LineSegments>(null);
  useFrame((_, dt) => {
    const r = state.weather.rain, l = lines.current;
    if (!l) return;
    l.visible = r > 0.01 && !state.home;
    if (!l.visible) return;
    mat.uniforms["time"]!.value += Math.min(dt, 0.1);
    (mat.uniforms["center"]!.value as THREE.Vector3).copy(camera.position);
    mat.uniforms["amount"]!.value = r;
    mat.uniforms["light"]!.value = 1 - state.darkness * 0.55;
  });
  return <lineSegments ref={lines} geometry={geo} material={mat} frustumCulled={false} visible={false} />;
}
