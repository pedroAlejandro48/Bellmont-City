import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { quality } from "./quality";
import * as THREE from "three";
import type { AptFloor } from "./aptRoom";
import { handWorld } from "./arms";
import { toLocal } from "./restaurantRoom";
import type { GameState } from "./state";
import { makeBlot, makeTiles, scaledPlane } from "./floorTextures";
import { FLOOR_CLEAR, WIN } from "./aptRoom";

/** The bathroom's surfaces, made once: grey ceramic floor tiles, glossy pale wall tiles, a contact-shadow blot. */
let SURF: { floor: ReturnType<typeof makeTiles>; wall: ReturnType<typeof makeTiles>; blot: THREE.Texture } | null = null;
const surfaces = () => (SURF ??= { floor: makeTiles("#b9bcba", "#6f7472", 4, 1.2, 11), wall: makeTiles("#eef2f3", "#a9b4b8", 8, 1.2, 3), blot: makeBlot() });
type Rect = { a0: number; a1: number; y0: number; y1: number };
/** A band of wall (a0..a1 along it, y0..y1 up) less the openings in it (doors, windows): the pieces left. */
function band(a0: number, a1: number, y0: number, y1: number, holes: Rect[]): Rect[] {
  const out: Rect[] = [], hs = holes.filter((h) => h.a1 > a0 && h.a0 < a1 && h.y1 > y0 && h.y0 < y1).sort((p, q) => p.a0 - q.a0);
  let at = a0;
  for (const h of hs) {
    const c0 = Math.max(a0, h.a0), c1 = Math.min(a1, h.a1);
    if (c0 > at) out.push({ a0: at, a1: c0, y0, y1 });
    if (h.y0 > y0) out.push({ a0: c0, a1: c1, y0, y1: Math.min(y1, h.y0) });
    if (h.y1 < y1) out.push({ a0: c0, a1: c1, y0: Math.max(y0, h.y1), y1 });
    at = Math.max(at, c1);
  }
  if (at < a1) out.push({ a0: at, a1, y0, y1 });
  return out.filter((r) => r.a1 - r.a0 > 0.01 && r.y1 - r.y0 > 0.01);
}

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
    tile: new THREE.MeshStandardMaterial({ map: surfaces().floor.map, bumpMap: surfaces().floor.bump, bumpScale: 1.5, roughness: 0.32, metalness: 0.02 }),
    wallTile: new THREE.MeshStandardMaterial({ map: surfaces().wall.map, bumpMap: surfaces().wall.bump, bumpScale: 1.2, roughness: 0.18, metalness: 0.02 }),
    paint: m.s("#a9c3cb", 0.85), trim: m.s("#4f585e", 0.5), wood: m.s("#6a4630", 0.55), counter: m.s("#e4e0d9", 0.25),
    mirror: m.s("#d9e6ec", 0.06, 0.35), shadowy: new THREE.MeshBasicMaterial({ map: surfaces().blot, transparent: true, depthWrite: false, color: "#000000", opacity: 0.85 }),
    tray: m.s("#f4f6f7", 0.25), porcelain: m.s("#fbfbf9", 0.1), seat: m.s("#e9e8e2", 0.3), chrome: m.s("#d4d9de", 0.15, 0.9),
    glass: new THREE.MeshStandardMaterial({ color: "#cfe6ee", transparent: true, opacity: 0.22, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }),
    curtain: new THREE.MeshStandardMaterial({ color: "#fbfbf8", roughness: 0.85, side: THREE.DoubleSide }),
    paper: m.s("#ffffff", 0.9), bowlWater: new THREE.MeshStandardMaterial({ color: "#b9dcf0", transparent: true, opacity: 0.75, roughness: 0.05 }),
  }), [m]);
  useEffect(() => () => { mats.glass.dispose(); mats.curtain.dispose(); mats.bowlWater.dispose(); mats.tile.dispose(); mats.wallTile.dispose(); mats.shadowy.dispose(); }, [mats]);
  // The walls inside: glossy tiles to 1.25 m (all the way up in the shower), painted above; a dark skirting.
  const walls = useMemo(() => {
    const H = FLOOR_CLEAR, TILE = 1.25, out: { geo: THREE.PlaneGeometry; pos: [number, number, number]; ry: number; mat: "wallTile" | "paint" }[] = [];
    const doorHole: Rect = { a0: b.door[0], a1: b.door[1], y0: 0, y1: 2.1 };
    const winHoles: Rect[] = fl.front.filter((w) => w.a1 > b.x0 && w.a0 < b.x1).map((w) => ({ a0: w.a0, a1: w.a1, y0: w.y0, y1: WIN.y1 }));
    const sides: { a0: number; a1: number; holes: Rect[]; place: (a: number) => [number, number]; ry: number; shower: [number, number] }[] = [
      { a0: b.z0, a1: b.z1, holes: [], place: (a) => [b.x0 + 0.004, a], ry: Math.PI / 2, shower: [sh.z0, sh.z1] },
      { a0: b.z0, a1: b.z1, holes: [], place: (a) => [b.x1 - 0.004, a], ry: -Math.PI / 2, shower: [0, 0] },
      { a0: b.x0, a1: b.x1, holes: [doorHole], place: (a) => [a, b.z0 + 0.004], ry: 0, shower: [0, 0] },
      { a0: b.x0, a1: b.x1, holes: winHoles, place: (a) => [a, b.z1 - 0.004], ry: Math.PI, shower: [sh.x0, sh.x1] },
    ];
    for (const sd of sides) {
      const pieces: (Rect & { mat: "wallTile" | "paint" })[] = [];
      for (const r of band(sd.a0, sd.a1, 0, TILE, sd.holes)) pieces.push({ ...r, mat: "wallTile" });
      // Above: tiles in the shower's stretch of this wall, paint elsewhere.
      const [s0, s1] = sd.shower;
      for (const r of band(sd.a0, sd.a1, TILE, H, sd.holes)) {
        if (s1 > s0 && r.a0 < s1 && r.a1 > s0) {
          if (r.a0 < s0) pieces.push({ ...r, a1: s0, mat: "paint" });
          pieces.push({ ...r, a0: Math.max(r.a0, s0), a1: Math.min(r.a1, s1), y1: Math.min(r.y1, 2.1), mat: "wallTile" });
          if (r.y1 > 2.1) pieces.push({ ...r, a0: Math.max(r.a0, s0), a1: Math.min(r.a1, s1), y0: 2.1, mat: "paint" });
          if (r.a1 > s1) pieces.push({ ...r, a0: s1, mat: "paint" });
        } else pieces.push({ ...r, mat: "paint" });
      }
      for (const r of pieces) {
        const [x, z] = sd.place((r.a0 + r.a1) / 2);
        out.push({ geo: scaledPlane(r.a1 - r.a0, r.y1 - r.y0, 1.2), pos: [x, (r.y0 + r.y1) / 2, z], ry: sd.ry, mat: r.mat });
      }
    }
    return out;
  }, [b, sh, fl.front]);
  useEffect(() => () => walls.forEach((w) => w.geo.dispose()), [walls]);
  const floorGeo = useMemo(() => scaledPlane(b.x1 - b.x0, b.z1 - b.z0, 1.2), [b]);
  useEffect(() => () => floorGeo.dispose(), [floorGeo]);
  const water = useWaterMaterial();
  // The mirror's reflection: only while the player is on this floor, as it draws the room again (smaller on Low).
  const reflector = useMemo(() => { const lo = quality().detail < 1; return new Reflector(new THREE.PlaneGeometry(0.54, 0.68), { textureWidth: lo ? 256 : 512, textureHeight: lo ? 320 : 640, color: 0xd2dade, clipBias: 0.003 }); }, []);
  useEffect(() => () => { reflector.getRenderTarget().dispose(); reflector.dispose(); }, [reflector]);
  const [reflect, setReflect] = useState(false);
  useFrame(() => {
    const on = state.level?.building === fl.key.split("#")[0] && state.level?.floor === fl.upper;
    if (on !== reflect) setReflect(on);
  });
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
    <mesh position={[(b.x0 + b.x1) / 2, 0.007, (b.z0 + b.z1) / 2]} rotation-x={-Math.PI / 2} material={mats.tile} geometry={floorGeo} receiveShadow />
    {/* Tiled walls, painted above; a dark skirting round the floor. */}
    {walls.map((w, i) => <mesh key={i} geometry={w.geo} position={w.pos} rotation-y={w.ry} material={mats[w.mat]} receiveShadow />)}
    {[[b.x0 + 0.012, (b.z0 + b.z1) / 2, 0.02, b.z1 - b.z0], [b.x1 - 0.012, (b.z0 + b.z1) / 2, 0.02, b.z1 - b.z0], [(b.x0 + b.door[0]) / 2, b.z0 + 0.012, b.door[0] - b.x0, 0.02], [(b.door[1] + b.x1) / 2, b.z0 + 0.012, b.x1 - b.door[1], 0.02]].map(([x, z, w, d], i) =>
      <mesh key={i} position={[x!, 0.04, z!]} material={mats.trim}>{B([w!, 0.08, d!])}</mesh>)}
    {/* Soft contact shadows where things meet the floor. */}
    {([[to.x + 0.02, to.z, 0.85, 0.7], [si.x - 0.02, si.z, 0.75, 0.95], [(sh.x0 + sh.x1) / 2, (sh.z0 + sh.z1) / 2, 1.25, 1.25]] as const).map(([x, z, w, d], i) =>
      <mesh key={i} position={[x, 0.009, z]} rotation-x={-Math.PI / 2} material={mats.shadowy} renderOrder={1}><planeGeometry args={[w, d]} /></mesh>)}
    {/* The ceiling light. */}
    <mesh position={[(b.x0 + b.x1) / 2, FLOOR_CLEAR - 0.02, (b.z0 + b.z1) / 2]} rotation-x={Math.PI / 2} material={m.white}><circleGeometry args={[0.2, 20]} /></mesh>
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
      <mesh position={[-0.24, 0.66, 0]} material={mats.porcelain} castShadow receiveShadow>{B([0.18, 0.4, 0.44])}</mesh>
      <mesh position={[-0.24, 0.87, 0]} material={mats.seat}>{B([0.2, 0.03, 0.46])}</mesh>
      <mesh position={[0.04, 0.2, 0]} scale={[1.25, 1, 1]} material={mats.porcelain} castShadow receiveShadow><cylinderGeometry args={[0.17, 0.12, 0.4, 20]} /></mesh>
      <mesh position={[0.06, 0.42, 0]} scale={[1.3, 1, 1]} rotation-x={Math.PI / 2} material={mats.seat}><torusGeometry args={[0.15, 0.03, 8, 24]} /></mesh>
      <mesh ref={swirl} visible={false} position={[0.06, 0.37, 0]} scale={[1.25, 1, 1]} rotation-x={-Math.PI / 2} material={swirlMat}><circleGeometry args={[0.12, 24]} /></mesh>
      <mesh position={[0.06, 0.36, 0]} scale={[1.25, 1, 1]} rotation-x={-Math.PI / 2} material={mats.bowlWater}><circleGeometry args={[0.12, 24]} /></mesh>
    </group>
    <mesh position={[to.flush[0], to.flush[1], to.flush[2]]} rotation-z={Math.PI / 2} material={mats.chrome}><cylinderGeometry args={[0.012, 0.012, 0.07, 8]} /></mesh>
    <group position={[to.paper[0], to.paper[1], to.paper[2]]}>
      <mesh position={[0.03, 0.05, 0]} material={m.steel}>{B([0.06, 0.02, 0.14])}</mesh>
      <mesh position={[0.07, 0, 0]} rotation-x={Math.PI / 2} material={mats.paper}><cylinderGeometry args={[0.055, 0.055, 0.1, 16]} /></mesh>
    </group>
    <mesh ref={paperHand} visible={false} material={mats.paper}>{B([0.09, 0.012, 0.1])}</mesh>
    <mesh ref={paperDrop} visible={false} material={mats.paper}>{B([0.09, 0.012, 0.1])}</mesh>
    {/* The sink: a cabinet, the basin, the tap with its knob; the water and its splash. */}
    <group position={[si.x, 0, si.z]} rotation-y={si.rot}>
      {/* A wooden vanity: plinth, two doors with handles; a stone top with the basin set in it. */}
      <mesh position={[0, 0.05, 0.03]} material={mats.trim}>{B([0.56, 0.1, 0.42])}</mesh>
      <mesh position={[0, 0.44, 0.02]} material={mats.wood} castShadow receiveShadow>{B([0.6, 0.7, 0.46])}</mesh>
      <mesh position={[0, 0.44, 0.252]} material={mats.trim}>{B([0.006, 0.62, 0.004])}</mesh>
      {[-1, 1].map((sd) => <mesh key={sd} position={[sd * 0.05, 0.66, 0.26]} material={mats.chrome}>{B([0.015, 0.1, 0.02])}</mesh>)}
      <mesh position={[0, 0.815, 0.02]} material={mats.counter} castShadow receiveShadow>{B([0.64, 0.03, 0.5])}</mesh>
      <mesh position={[0, 0.8, 0.05]} material={mats.porcelain} receiveShadow><cylinderGeometry args={[0.2, 0.15, 0.06, 28]} /></mesh>
      <mesh position={[0, 0.833, 0.05]} rotation-x={-Math.PI / 2} material={mats.trim}><circleGeometry args={[0.165, 28]} /></mesh>
      <mesh position={[0, 0.834, 0.05]} rotation-x={-Math.PI / 2} material={mats.porcelain}><ringGeometry args={[0.03, 0.17, 28]} /></mesh>
      <mesh position={[0, 0.835, 0.05]} rotation-x={-Math.PI / 2} material={mats.chrome}><circleGeometry args={[0.022, 16]} /></mesh>
      {/* The mirror above, in a thin dark frame. */}
      <mesh position={[0, 1.55, -0.225]} material={mats.trim}>{B([0.58, 0.72, 0.02])}</mesh>
      <mesh position={[0, 1.55, -0.213]} material={mats.mirror}>{B([0.54, 0.68, 0.006])}</mesh>
      {/* A real mirror on your own floor: it reflects the room and you in it (drawn only while in view). */}
      {reflect && <primitive object={reflector} position={[0, 1.55, -0.2095]} />}
    </group>
    <mesh position={[si.tap[0], si.tap[1] - 0.1, si.tap[2]]} material={mats.chrome} castShadow><cylinderGeometry args={[0.018, 0.022, 0.2, 10]} /></mesh>
    <mesh position={[(si.tap[0] + si.bowl[0]) / 2, si.tap[1], si.tap[2]]} rotation-z={Math.PI / 2} material={mats.chrome} castShadow><cylinderGeometry args={[0.015, 0.015, si.tap[0] - si.bowl[0] + 0.02, 10]} /></mesh>
    <mesh position={[si.tap[0] + 0.01, si.tap[1] + 0.04, si.tap[2]]} material={mats.chrome}><cylinderGeometry args={[0.03, 0.03, 0.03, 12]} /></mesh>
    <mesh ref={sinkStream} visible={false} position={[si.bowl[0], (si.tap[1] + si.bowl[1]) / 2 - 0.01, si.tap[2]]} material={water}><cylinderGeometry args={[0.011, 0.013, si.tap[1] - si.bowl[1], 12, 1, true]} /></mesh>
    <mesh ref={splash} visible={false} position={[si.bowl[0], si.bowl[1] - 0.02, si.bowl[2]]} rotation-x={-Math.PI / 2} material={water}><ringGeometry args={[0.02, 0.06, 20]} /></mesh>
  </group>;
}
