import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { AptFloor } from "./aptRoom";
import { handWorld } from "./arms";
import { toLocal } from "./restaurantRoom";
import type { GameState } from "./state";

/**
 * What the bathroom's moves tell its things each frame: how far the sink's and the shower's water run (0..1), how
 * open the shower curtain is (0 drawn across, 1 gathered at the wall) and how much it's swaying, the toilet's flush
 * (seconds since, or −1), and the bit of toilet paper (in the right hand, or dropped into the bowl at `paperAt`).
 */
export type BathLink = { sink: number; shower: number; curtain: number; sway: number; flush: number; paper: "none" | "hand" | "drop"; paperAt: number };
export const newBathLink = (): BathLink => ({ sink: 0, shower: 0, curtain: 0, sway: 0, flush: -1, paper: "none", paperAt: 0 });

/** The shower curtain's cloth: columns along the rod, rows down from it; the rod's height. */
export const CURTAIN = { cols: 18, rows: 12, rod: 2.02, hem: 0.16 };
/** The curtain's free edge (where a hand takes it) with the curtain this open, in the floor's frame. */
export function curtainEdge(fl: AptFloor, open: number): [number, number, number] {
  const s = fl.bath.shower, xe = s.x1 - 0.02 - open * (s.x1 - s.x0 - 0.16);
  return [xe, 1.25, s.curtainZ];
}

/** Running water: a column of light, moving streaks (a shader), clear at the edges, brighter in the middle. */
function useWaterMaterial() {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { time: { value: 0 }, flow: { value: 0 } },
    vertexShader: "varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }",
    fragmentShader: "uniform float time; uniform float flow; varying vec2 vUv; varying vec3 vN; varying vec3 vV;\n" +
      "float h(float n){ return fract(sin(n) * 43758.5453); }\n" +
      "void main(){\n" +
      "  float edge = pow(1.0 - abs(dot(vN, vV)), 1.6);\n" +
      "  float col = floor(vUv.x * 24.0);\n" +
      "  float streak = fract(vUv.y * 5.0 + time * (2.2 + h(col) * 1.6) + h(col * 3.1));\n" +
      "  float s = smoothstep(0.0, 0.35, streak) * (1.0 - smoothstep(0.55, 1.0, streak));\n" +
      "  float reach = smoothstep(0.0, 0.08, flow - (1.0 - vUv.y));\n" +
      "  vec3 c = mix(vec3(0.42, 0.72, 0.98), vec3(0.85, 0.95, 1.0), s * 0.8 + edge * 0.5);\n" +
      "  float a = (0.28 + 0.45 * s + 0.35 * edge) * reach * flow;\n" +
      "  gl_FragColor = vec4(c, a);\n" +
      "}",
  }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  return mat;
}

/**
 * The bathroom's things: tiles on the floor, the toilet (with its paper roll and flush), the sink (with its tap),
 * the shower (tray, the curb one steps over, a glass side, the head, the rod and a white cloth curtain that bunches
 * into folds as it's pulled open and sways as it settles), and the water that runs from the tap and the shower.
 */
export function BathroomThings({ fl, state, link, m }: { fl: AptFloor; state: GameState; link: BathLink; m: { white: THREE.Material; steel: THREE.Material; s: (c: string, r?: number, mt?: number, side?: THREE.Side) => THREE.MeshStandardMaterial } }) {
  const b = fl.bath, sh = b.shower, to = b.toilet, si = b.sink;
  const mats = useMemo(() => ({
    tile: m.s("#dfe6ea", 0.35), tray: m.s("#f4f6f7", 0.3), porcelain: m.s("#fbfbfa", 0.22), seat: m.s("#f1f1ee", 0.35),
    glass: new THREE.MeshStandardMaterial({ color: "#cfe6ee", transparent: true, opacity: 0.22, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }),
    curtain: new THREE.MeshStandardMaterial({ color: "#fbfbf8", roughness: 0.85, side: THREE.DoubleSide }),
    paper: m.s("#ffffff", 0.9), bowlWater: new THREE.MeshStandardMaterial({ color: "#b9dcf0", transparent: true, opacity: 0.75, roughness: 0.05 }),
  }), [m]);
  useEffect(() => () => { mats.glass.dispose(); mats.curtain.dispose(); mats.bowlWater.dispose(); }, [mats]);
  const water = useWaterMaterial();
  const sinkStream = useRef<THREE.Mesh>(null), showerStream = useRef<THREE.Mesh>(null), splash = useRef<THREE.Mesh>(null), swirl = useRef<THREE.Mesh>(null);
  const paperHand = useRef<THREE.Mesh>(null), paperDrop = useRef<THREE.Mesh>(null);

  // The curtain: rings on the rod, the cloth hanging from them in soft folds (deeper the more it's bunched up).
  const { cols, rows, rod, hem } = CURTAIN;
  const curtainGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(cols * rows * 3), 3));
    const idx: number[] = [];
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) { const a = j * cols + i; idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1); }
    g.setIndex(idx);
    return g;
  }, [cols, rows]);
  useEffect(() => () => curtainGeo.dispose(), [curtainGeo]);
  const last = useRef("");
  const swirlTex = useMemo(() => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = "#9fd0ee"; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "rgba(255,255,255,0.85)"; g.lineWidth = 5;
    for (let k = 0; k < 3; k++) { g.beginPath(); for (let t = 0; t < 1; t += 0.02) { const a = t * Math.PI * 3 + k * 2.1, r = 60 * t; g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); } g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }, []);
  const swirlMat = useMemo(() => new THREE.MeshStandardMaterial({ map: swirlTex, transparent: true, opacity: 0, roughness: 0.1 }), [swirlTex]);
  useEffect(() => () => { swirlTex.dispose(); swirlMat.dispose(); }, [swirlTex, swirlMat]);

  useFrame((_, raw) => {
    const t = state.simulationTime;
    water.uniforms["time"]!.value = t;
    // The water: from the tap into the basin, and from the shower head down.
    if (sinkStream.current) { sinkStream.current.visible = link.sink > 0.01; sinkStream.current.scale.set(1, Math.max(0.01, link.sink), 1); }
    if (showerStream.current) showerStream.current.visible = link.shower > 0.01;
    water.uniforms["flow"]!.value = Math.max(link.sink, link.shower);
    if (splash.current) { splash.current.visible = link.sink > 0.3; const k = 1 + 0.15 * Math.sin(t * 18); splash.current.scale.set(k, k, k); }
    // The flush: the bowl's water swirls round and settles.
    if (swirl.current) {
      const f = link.flush, on = f >= 0 && f < 3;
      swirl.current.visible = on;
      if (on) { swirl.current.rotation.z = -f * 7; swirlMat.opacity = Math.min(1, f * 3) * (1 - Math.max(0, (f - 2.2) / 0.8)); }
    }
    // Toilet paper: in the hand, or falling into the bowl.
    const fore = state.avatar.body[11];
    if (paperHand.current) {
      paperHand.current.visible = link.paper === "hand" && !!fore;
      if (paperHand.current.visible && fore) {
        fore.updateWorldMatrix(true, false);
        const w = handWorld(fore, new THREE.Vector3());
        const [x, z] = toLocal(fl.frame, w.x, w.z);
        paperHand.current.position.set(x, w.y - fl.y - 0.02, z);
      }
    }
    if (paperDrop.current) {
      const d = t - link.paperAt, on = link.paper === "drop" && d < 0.6;
      paperDrop.current.visible = on;
      if (on) { paperDrop.current.position.set(to.x + 0.12, 0.62 - 0.32 * Math.min(1, d / 0.45), to.z); paperDrop.current.rotation.set(d * 4, d * 2, 0); }
    }
    // The curtain: only redrawn when it moves.
    const key = `${link.curtain.toFixed(3)}|${link.sway.toFixed(3)}|${link.sway > 0.002 ? t.toFixed(2) : ""}`;
    if (key !== last.current) {
      last.current = key;
      const P = (curtainGeo.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
      const xs = sh.x0 + 0.03, xe = curtainEdge(fl, link.curtain)[0], width = xe - xs, full = sh.x1 - 0.02 - xs;
      // Folds: shallow when drawn flat across, deep when bunched up at the wall.
      const fold = 0.015 + 0.075 * (1 - width / full);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const k = (j * cols + i) * 3, down = j / (rows - 1);
        const x = xs + width * (i / (cols - 1));
        // Heavier at the hem: it lags a little behind the rings as it swings.
        const swing = link.sway * Math.sin(t * 6 + i * 0.5) * down * down;
        P[k] = x + swing * 0.5; P[k + 1] = rod - 0.02 - (rod - 0.02 - hem) * down; P[k + 2] = sh.curtainZ + fold * (i % 2 ? 1 : -1) * (0.6 + 0.4 * down) + swing;
      }
      const attr = curtainGeo.getAttribute("position") as THREE.BufferAttribute; attr.needsUpdate = true;
      curtainGeo.computeVertexNormals(); curtainGeo.computeBoundingSphere();
    }
    void raw;
  });

  const B = (a: [number, number, number]) => <boxGeometry args={a} />;
  const headX = (sh.x0 + sh.x1) / 2, headZ = sh.z1 - 0.1;
  return <group>
    {/* Tiles on the floor. */}
    <mesh position={[(b.x0 + b.x1) / 2, 0.007, (b.z0 + b.z1) / 2]} rotation-x={-Math.PI / 2} material={mats.tile} receiveShadow><planeGeometry args={[b.x1 - b.x0, b.z1 - b.z0]} /></mesh>
    {/* The shower: tray, the curb along the curtain, a glass side, the head, the rod and the curtain. */}
    <mesh position={[(sh.x0 + sh.x1) / 2, 0.03, (sh.z0 + sh.z1) / 2]} material={mats.tray} receiveShadow>{B([sh.x1 - sh.x0, 0.05, sh.z1 - sh.z0])}</mesh>
    <mesh position={[(sh.x0 + sh.x1) / 2, 0.07, sh.curtainZ + 0.03]} material={mats.tray} castShadow>{B([sh.x1 - sh.x0, 0.14, 0.06])}</mesh>
    <mesh position={[sh.x1 + 0.01, 1.05, (sh.z0 + sh.z1) / 2 + 0.03]} material={mats.glass}>{B([0.02, 2.0, sh.z1 - sh.z0 - 0.06])}</mesh>
    <mesh position={[sh.x1 + 0.01, 1.05, sh.curtainZ + 0.04]} material={m.steel}>{B([0.03, 2.0, 0.03])}</mesh>
    <mesh position={[headX, 2.0, sh.z1 - 0.06]} rotation-x={Math.PI / 2} material={m.steel}><cylinderGeometry args={[0.012, 0.012, 0.1, 8]} /></mesh>
    <mesh position={[headX, 1.97, headZ]} material={m.steel}><cylinderGeometry args={[0.07, 0.05, 0.03, 16]} /></mesh>
    <mesh position={[headX, 1.1, sh.z1 - 0.03]} material={m.steel}>{B([0.06, 0.1, 0.04])}</mesh>
    <mesh position={[(sh.x0 + sh.x1) / 2, CURTAIN.rod, sh.curtainZ]} rotation-z={Math.PI / 2} material={m.steel}><cylinderGeometry args={[0.012, 0.012, sh.x1 - sh.x0, 8]} /></mesh>
    <mesh geometry={curtainGeo} material={mats.curtain} castShadow />
    <mesh ref={showerStream} visible={false} position={[headX, 0.99, headZ]} material={water}><cylinderGeometry args={[0.07, 0.24, 1.94, 24, 1, true]} /></mesh>
    {/* The toilet: tank against the bedroom wall, the bowl, the seat; the paper on the wall to the right. */}
    <group position={[to.x, 0, to.z]}>
      <mesh position={[-0.24, 0.66, 0]} material={mats.porcelain} castShadow>{B([0.18, 0.4, 0.44])}</mesh>
      <mesh position={[-0.24, 0.87, 0]} material={mats.seat}>{B([0.2, 0.03, 0.46])}</mesh>
      <mesh position={[0.04, 0.2, 0]} scale={[1.25, 1, 1]} material={mats.porcelain} castShadow><cylinderGeometry args={[0.17, 0.12, 0.4, 20]} /></mesh>
      <mesh position={[0.06, 0.42, 0]} scale={[1.3, 1, 1]} rotation-x={Math.PI / 2} material={mats.seat}><torusGeometry args={[0.15, 0.03, 8, 24]} /></mesh>
      <mesh ref={swirl} visible={false} position={[0.06, 0.37, 0]} scale={[1.25, 1, 1]} rotation-x={-Math.PI / 2} material={swirlMat}><circleGeometry args={[0.12, 24]} /></mesh>
      <mesh position={[0.06, 0.36, 0]} scale={[1.25, 1, 1]} rotation-x={-Math.PI / 2} material={mats.bowlWater}><circleGeometry args={[0.12, 24]} /></mesh>
    </group>
    <mesh position={[to.flush[0], to.flush[1], to.flush[2]]} rotation-z={Math.PI / 2} material={m.steel}><cylinderGeometry args={[0.012, 0.012, 0.07, 8]} /></mesh>
    <group position={[to.paper[0], to.paper[1], to.paper[2]]}>
      <mesh position={[0.03, 0.05, 0]} material={m.steel}>{B([0.06, 0.02, 0.14])}</mesh>
      <mesh position={[0.07, 0, 0]} rotation-x={Math.PI / 2} material={mats.paper}><cylinderGeometry args={[0.055, 0.055, 0.1, 16]} /></mesh>
    </group>
    <mesh ref={paperHand} visible={false} material={mats.paper}>{B([0.09, 0.012, 0.1])}</mesh>
    <mesh ref={paperDrop} visible={false} material={mats.paper}>{B([0.09, 0.012, 0.1])}</mesh>
    {/* The sink: a cabinet, the basin, the tap with its knob; the water and its splash. */}
    <group position={[si.x, 0, si.z]} rotation-y={si.rot}>
      <mesh position={[0, 0.4, 0.02]} material={mats.porcelain} castShadow>{B([0.6, 0.8, 0.46])}</mesh>
      <mesh position={[0, 0.81, 0.02]} material={mats.porcelain}>{B([0.62, 0.04, 0.5])}</mesh>
      <mesh position={[0, 0.82, 0.05]} material={mats.tile}><cylinderGeometry args={[0.19, 0.14, 0.03, 24]} /></mesh>
    </group>
    <mesh position={[si.tap[0], si.tap[1] - 0.1, si.tap[2]]} material={m.steel}><cylinderGeometry args={[0.018, 0.022, 0.2, 10]} /></mesh>
    <mesh position={[(si.tap[0] + si.bowl[0]) / 2, si.tap[1], si.tap[2]]} rotation-z={Math.PI / 2} material={m.steel}><cylinderGeometry args={[0.015, 0.015, si.tap[0] - si.bowl[0] + 0.02, 10]} /></mesh>
    <mesh position={[si.tap[0] + 0.01, si.tap[1] + 0.04, si.tap[2]]} material={m.steel}><cylinderGeometry args={[0.03, 0.03, 0.03, 12]} /></mesh>
    <mesh ref={sinkStream} visible={false} position={[si.bowl[0], (si.tap[1] + si.bowl[1]) / 2 - 0.01, si.tap[2]]} material={water}><cylinderGeometry args={[0.011, 0.013, si.tap[1] - si.bowl[1], 12, 1, true]} /></mesh>
    <mesh ref={splash} visible={false} position={[si.bowl[0], si.bowl[1] - 0.02, si.bowl[2]]} rotation-x={-Math.PI / 2} material={water}><ringGeometry args={[0.02, 0.06, 20]} /></mesh>
  </group>;
}
