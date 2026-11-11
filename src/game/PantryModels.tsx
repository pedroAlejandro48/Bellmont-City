import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { CANDIES, CANDY_INFO, CANS, CAN_INFO, WARES, isCan, isCandy, isWare, shelfSections, type CandyKind, type CanKind, type WareKind } from "./pantry";
import { canvas } from "./textures";

/**
 * How the pantry goods look: a can's label is a picture of what's inside (beans, a drumstick, a fish, sausages, a
 * bowl of soup, corn, peas, green beans, carrot slices) with its name; candy wrappers carry their name; kitchenware
 * is steel, porcelain and glass. All made once and shared.
 */
const ctex = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

function drawPic(g: CanvasRenderingContext2D, pic: (typeof CAN_INFO)[CanKind]["pic"], cx: number, cy: number, r: number, food: [string, string]) {
  const rnd = (() => { let s = cx * 7 + cy; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); })();
  const blob = (x: number, y: number, rx: number, ry: number, col: string, rot = 0) => { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); };
  // A white plate-like disc behind the picture.
  blob(cx, cy, r, r * 0.92, "rgba(255,255,255,0.9)");
  if (pic === "beans" || pic === "bakedBeans") {
    if (pic === "bakedBeans") blob(cx, cy, r * 0.8, r * 0.7, "#c84a22");
    for (let i = 0; i < 26; i++) { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r * 0.68; blob(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * 0.13, r * 0.08, i % 3 ? food[0] : food[1], rnd() * 3); }
  } else if (pic === "chicken") {
    blob(cx - r * 0.1, cy, r * 0.5, r * 0.38, "#c98a4a", -0.4);
    g.fillStyle = "#f2e6d0"; g.fillRect(cx + r * 0.25, cy - r * 0.1, r * 0.45, r * 0.14);
    blob(cx + r * 0.72, cy - r * 0.08, r * 0.1, r * 0.1, "#f2e6d0"); blob(cx + r * 0.72, cy + r * 0.06, r * 0.1, r * 0.1, "#f2e6d0");
  } else if (pic === "fish") {
    blob(cx, cy, r * 0.6, r * 0.3, "#7fa8c8");
    g.fillStyle = "#7fa8c8"; g.beginPath(); g.moveTo(cx + r * 0.5, cy); g.lineTo(cx + r * 0.85, cy - r * 0.3); g.lineTo(cx + r * 0.85, cy + r * 0.3); g.fill();
    blob(cx - r * 0.38, cy - r * 0.06, r * 0.06, r * 0.06, "#1a2a3a");
  } else if (pic === "sausage") {
    for (let i = 0; i < 4; i++) { g.save(); g.translate(cx - r * 0.4 + i * r * 0.27, cy); g.rotate(0.2); g.fillStyle = i % 2 ? "#b0603a" : "#c47048"; g.beginPath(); g.roundRect(-r * 0.11, -r * 0.55, r * 0.22, r * 1.1, r * 0.11); g.fill(); g.restore(); }
  } else if (pic === "soup") {
    blob(cx, cy + r * 0.15, r * 0.75, r * 0.4, "#f4f4f0");
    blob(cx, cy + r * 0.05, r * 0.62, r * 0.25, food[0]);
    for (let i = 0; i < 8; i++) blob(cx + (rnd() - 0.5) * r, cy + (rnd() - 0.5) * r * 0.3, r * 0.08, r * 0.06, food[1]);
    g.strokeStyle = "rgba(160,160,160,0.8)"; g.lineWidth = r * 0.06;
    for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(cx + k * r * 0.25, cy - r * 0.25); g.bezierCurveTo(cx + k * r * 0.25 - r * 0.15, cy - r * 0.5, cx + k * r * 0.25 + r * 0.15, cy - r * 0.6, cx + k * r * 0.25, cy - r * 0.85); g.stroke(); }
  } else if (pic === "corn") {
    blob(cx, cy, r * 0.32, r * 0.75, "#e6b52e", 0.5);
    for (let j = -5; j <= 5; j++) for (let i = -2; i <= 2; i++) { const x = cx + i * r * 0.11 + j * r * 0.055, y = cy + j * r * 0.11 - i * r * 0.03; blob(x, y, r * 0.05, r * 0.045, "#f6d64a"); }
    blob(cx - r * 0.45, cy + r * 0.45, r * 0.28, r * 0.1, "#5a9a3a", 0.8);
  } else if (pic === "peas") {
    blob(cx, cy, r * 0.75, r * 0.3, "#5a9a3a", -0.2);
    for (let i = 0; i < 6; i++) blob(cx - r * 0.5 + i * r * 0.2, cy - r * 0.05 + i * r * 0.02, r * 0.1, r * 0.1, "#8ac64a");
  } else if (pic === "greenBeans") {
    g.strokeStyle = "#4a8a2e"; g.lineCap = "round"; g.lineWidth = r * 0.12;
    for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(cx - r * 0.6, cy - r * 0.4 + i * r * 0.16); g.quadraticCurveTo(cx, cy - r * 0.55 + i * r * 0.16, cx + r * 0.6, cy - r * 0.35 + i * r * 0.16); g.stroke(); }
  } else if (pic === "carrots") {
    for (let i = 0; i < 9; i++) { const x = cx + (rnd() - 0.5) * r * 1.1, y = cy + (rnd() - 0.5) * r * 0.9; blob(x, y, r * 0.17, r * 0.17, "#f0782a"); blob(x, y, r * 0.07, r * 0.07, "#f6a04a"); }
  }
}

let CACHE: ReturnType<typeof build> | null = null;
function build() {
  const steel = new THREE.MeshStandardMaterial({ color: "#d3d7dc", roughness: 0.32, metalness: 0.4 });
  const canLabels = {} as Record<CanKind, THREE.MeshStandardMaterial>;
  for (const k of CANS) {
    const info = CAN_INFO[k], [c, g] = canvas(512, 256);
    g.fillStyle = info.label; g.fillRect(0, 0, 512, 256);
    g.fillStyle = info.band; g.fillRect(0, 0, 512, 26); g.fillRect(0, 230, 512, 26);
    // The picture and the name, front and back.
    for (const x0 of [128, 384]) {
      drawPic(g, info.pic, x0, 112, 66, info.food);
      g.fillStyle = info.band; g.fillRect(x0 - 100, 186, 200, 38);
      const dark = new THREE.Color(info.band).getHSL({ h: 0, s: 0, l: 0 }).l > 0.55;
      g.fillStyle = dark ? "#1a1a1a" : "#ffffff"; g.font = "bold 24px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(info.name.toUpperCase(), x0, 206, 192);
    }
    canLabels[k] = new THREE.MeshStandardMaterial({ map: ctex(c), roughness: 0.55, metalness: 0.1 });
  }
  const wrappers = {} as Record<CandyKind, THREE.MeshStandardMaterial>;
  for (const k of CANDIES) {
    const info = CANDY_INFO[k], [c, g] = canvas(256, 128);
    g.fillStyle = info.wrap; g.fillRect(0, 0, 256, 128);
    g.fillStyle = "rgba(255,255,255,0.12)"; for (let i = 0; i < 6; i++) g.fillRect(i * 46, 0, 18, 128);
    g.fillStyle = info.ink; g.font = "bold 30px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    const words = info.name.toUpperCase().split(" ");
    words.forEach((w, i) => g.fillText(w, 128, 64 + (i - (words.length - 1) / 2) * 32, 236));
    wrappers[k] = new THREE.MeshStandardMaterial({ map: ctex(c), roughness: 0.35, metalness: 0.15 });
  }
  return {
    steel, canLabels, wrappers,
    ring: new THREE.MeshStandardMaterial({ color: "#c2c7cd", roughness: 0.3, metalness: 0.45 }),
    pot: new THREE.MeshStandardMaterial({ color: "#cfd4da", roughness: 0.28, metalness: 0.45 }),
    panIn: new THREE.MeshStandardMaterial({ color: "#2a2b2e", roughness: 0.45, metalness: 0.4 }),
    handle: new THREE.MeshStandardMaterial({ color: "#1e1f22", roughness: 0.6 }),
    porcelain: new THREE.MeshStandardMaterial({ color: "#f7f6f2", roughness: 0.18 }),
    rim: new THREE.MeshStandardMaterial({ color: "#2f5f9a", roughness: 0.3 }),
    glass: new THREE.MeshStandardMaterial({ color: "#d6ecf2", roughness: 0.05, transparent: true, opacity: 0.4, depthWrite: false }),
    lid: new THREE.MeshStandardMaterial({ color: "#c2402a", roughness: 0.4, metalness: 0.3 }),
    mug: new THREE.MeshStandardMaterial({ color: "#e8e2d6", roughness: 0.3 }),
    pop: [new THREE.MeshStandardMaterial({ color: "#ff5fa8", roughness: 0.15 }), new THREE.MeshStandardMaterial({ color: "#ffd23a", roughness: 0.15 }), new THREE.MeshStandardMaterial({ color: "#3ab6ff", roughness: 0.15 })],
    stick: new THREE.MeshStandardMaterial({ color: "#fafafa", roughness: 0.5 }),
  };
}
export const pantryLooks = () => (CACHE ??= build());
export type PantryLooks = ReturnType<typeof pantryLooks>;

/** A can (origin at its bottom middle): its label round the side, steel top and bottom, the easy-open ring on top
 * (`open` 0..1: the lid peeled back by its tab). */
export function CanModel({ kind, open = 0 }: { kind: CanKind; open?: number }) {
  const L = pantryLooks(), H = 0.105, R = 0.037;
  return <group>
    <mesh position={[0, H / 2, 0]} material={[L.canLabels[kind], L.steel, L.steel]} castShadow><cylinderGeometry args={[R, R, H, 20]} /></mesh>
    <mesh position={[0, H + 0.003, 0]} material={L.steel}><cylinderGeometry args={[R - 0.002, R, 0.006, 20]} /></mesh>
    {/* The lid: hinged at its back edge, peeling up as it's pulled by the ring. */}
    <group position={[0, H + 0.007, -R + 0.006]} rotation-x={-open * 2.2}>
      <mesh position={[0, 0, R - 0.006]} material={L.steel}><cylinderGeometry args={[R - 0.005, R - 0.005, 0.002, 20]} /></mesh>
      <mesh position={[0, 0.003, R + 0.012]} rotation-x={Math.PI / 2} material={L.ring}><torusGeometry args={[0.009, 0.0025, 6, 14]} /></mesh>
    </group>
  </group>;
}
/** A candy (origin at its bottom middle). */
export function CandyModel({ kind }: { kind: CandyKind }) {
  const L = pantryLooks(), info = CANDY_INFO[kind], w = L.wrappers[kind];
  if (info.shape === "pop") return <group>
    <mesh position={[0, 0.05, 0]} material={L.stick}><cylinderGeometry args={[0.003, 0.003, 0.1, 6]} /></mesh>
    <mesh position={[0, 0.115, 0]} scale={[1, 1, 0.5]} material={L.pop[0]!}><sphereGeometry args={[0.024, 14, 10]} /></mesh>
  </group>;
  if (info.shape === "bag") return <mesh position={[0, 0.06, 0]} scale={[1, 1, 0.35]} material={w} castShadow><sphereGeometry args={[0.06, 14, 10]} /></mesh>;
  if (info.shape === "tin") return <mesh position={[0, 0.012, 0]} material={[w, w, w, w, w, w]} castShadow><boxGeometry args={[0.07, 0.024, 0.045]} /></mesh>;
  if (info.shape === "cups") return <mesh position={[0, 0.011, 0]} material={w} castShadow><boxGeometry args={[0.1, 0.022, 0.06]} /></mesh>;
  return <mesh position={[0, 0.009, 0]} material={w} castShadow><boxGeometry args={[0.14, 0.018, 0.05]} /></mesh>;
}
/** Kitchenware (origin at its bottom middle; a pot's and pan's handles along +x). `food` shows what's in it. */
export function WareModel({ kind, food = null }: { kind: WareKind; food?: { a: string; b: string; level: number } | null }) {
  const L = pantryLooks();
  switch (kind) {
    case "pot": return <group>
      <mesh position={[0, 0.07, 0]} material={L.pot} castShadow><cylinderGeometry args={[0.11, 0.1, 0.14, 24, 1, true]} /></mesh>
      <mesh position={[0, 0.003, 0]} material={L.pot}><cylinderGeometry args={[0.1, 0.1, 0.006, 24]} /></mesh>
      {[-1, 1].map((s) => <mesh key={s} position={[s * 0.125, 0.115, 0]} rotation-x={Math.PI / 2} material={L.handle}><torusGeometry args={[0.022, 0.006, 6, 12, Math.PI]} /></mesh>)}
      {food && <FoodFill r={0.1} y={0.012 + 0.11 * food.level} food={food} />}
    </group>;
    case "pan": return <group>
      <mesh position={[0, 0.025, 0]} material={[L.pot, L.panIn, L.pot]} castShadow><cylinderGeometry args={[0.13, 0.11, 0.05, 24, 1, true]} /></mesh>
      <mesh position={[0, 0.003, 0]} material={L.panIn}><cylinderGeometry args={[0.11, 0.11, 0.006, 24]} /></mesh>
      <mesh position={[0.25, 0.04, 0]} rotation-z={-0.12} material={L.handle} castShadow><boxGeometry args={[0.2, 0.018, 0.03]} /></mesh>
      {food && <FoodFill r={0.11} y={0.01 + 0.035 * food.level} food={food} />}
    </group>;
    case "plate": return <group>
      <mesh position={[0, 0.008, 0]} material={L.porcelain} castShadow><cylinderGeometry args={[0.12, 0.085, 0.016, 28]} /></mesh>
      <mesh position={[0, 0.0165, 0]} rotation-x={-Math.PI / 2} material={L.rim}><ringGeometry args={[0.108, 0.115, 28]} /></mesh>
      {food && <FoodFill r={0.08} y={0.018 + 0.012 * food.level} food={food} mound />}
    </group>;
    case "bowl": return <group>
      <mesh position={[0, 0.035, 0]} material={L.porcelain} castShadow><cylinderGeometry args={[0.08, 0.045, 0.07, 22, 1, true]} /></mesh>
      <mesh position={[0, 0.003, 0]} material={L.porcelain}><cylinderGeometry args={[0.045, 0.045, 0.006, 22]} /></mesh>
      {food && <FoodFill r={0.07} y={0.02 + 0.04 * food.level} food={food} />}
    </group>;
    case "cup": return <group>
      <mesh position={[0, 0.045, 0]} material={L.mug} castShadow><cylinderGeometry args={[0.038, 0.034, 0.09, 18]} /></mesh>
      <mesh position={[0.045, 0.05, 0]} material={L.mug}><torusGeometry args={[0.022, 0.006, 6, 14]} /></mesh>
    </group>;
    case "jar": return <group>
      <mesh position={[0, 0.06, 0]} material={L.glass}><cylinderGeometry args={[0.045, 0.045, 0.12, 18]} /></mesh>
      <mesh position={[0, 0.127, 0]} material={L.lid}><cylinderGeometry args={[0.042, 0.042, 0.015, 18]} /></mesh>
    </group>;
    case "silverware": return <group>
      {/* Fork, knife and spoon side by side, lying down. */}
      {[-0.03, 0, 0.03].map((x, i) => <group key={i} position={[x, 0.004, 0]}>
        <mesh material={L.steel}><boxGeometry args={[0.012, 0.004, 0.13]} /></mesh>
        {i === 2 ? <mesh position={[0, 0.002, 0.075]} scale={[1, 0.3, 1.4]} material={L.steel}><sphereGeometry args={[0.014, 10, 8]} /></mesh>
          : i === 0 ? [-1, 0, 1].map((t) => <mesh key={t} position={[t * 0.004, 0, 0.08]} material={L.steel}><boxGeometry args={[0.0025, 0.003, 0.035]} /></mesh>)
          : <mesh position={[0, 0, 0.08]} material={L.steel}><boxGeometry args={[0.016, 0.002, 0.04]} /></mesh>}
      </group>)}
    </group>;
  }
}
/** Cooked food in a pot, pan or on a plate: a stew (sauce with bits in it), blackened when burnt. */
export function FoodFill({ r, y, food, mound = false }: { r: number; y: number; food: { a: string; b: string; level: number; burnt?: number }; mound?: boolean }) {
  const mats = useMemo(() => ({ sauce: new THREE.MeshStandardMaterial({ color: food.a, roughness: 0.25 }), bits: new THREE.MeshStandardMaterial({ color: food.b, roughness: 0.6 }) }), [food.a, food.b]);
  useEffect(() => () => { mats.sauce.dispose(); mats.bits.dispose(); }, [mats]);
  const bits = useMemo(() => Array.from({ length: 14 }, (_, i) => { const a = i * 2.4, d = Math.sqrt((i + 0.5) / 14) * r * 0.82; return [Math.cos(a) * d, Math.sin(a) * d, 0.008 + (i % 3) * 0.003] as const; }), [r]);
  return <group position={[0, y, 0]}>
    {mound ? <mesh scale={[1, 0.28, 1]} material={mats.sauce}><sphereGeometry args={[r, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
      : <mesh rotation-x={-Math.PI / 2} material={mats.sauce}><circleGeometry args={[r, 24]} /></mesh>}
    {bits.map(([x, z, s], i) => <mesh key={i} position={[x, mound ? 0.012 : 0.004, z]} material={mats.bits}><sphereGeometry args={[s, 6, 5]} /></mesh>)}
  </group>;
}
/** Any pantry good. */
export function PantryItem({ kind }: { kind: string }) {
  if (isCan(kind)) return <CanModel kind={kind} />;
  if (isCandy(kind)) return <CandyModel kind={kind} />;
  if (isWare(kind)) return <WareModel kind={kind} />;
  return null;
}

/** A thing's parts for drawing many of it at once: geometry, material (or a cylinder's three), and where. */
type Part = { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[]; m: THREE.Matrix4 };
const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
function partsOf(kind: string): Part[] {
  const L = pantryLooks();
  if (isCan(kind)) return [
    { geo: new THREE.CylinderGeometry(0.037, 0.037, 0.105, 16), mat: [L.canLabels[kind], L.steel, L.steel], m: at(0, 0.0525, 0) },
    { geo: new THREE.TorusGeometry(0.009, 0.0025, 5, 10), mat: L.ring, m: at(0, 0.109, 0.02, Math.PI / 2) },
  ];
  if (isCandy(kind)) {
    const info = CANDY_INFO[kind], w = L.wrappers[kind];
    if (info.shape === "pop") return [{ geo: new THREE.CylinderGeometry(0.003, 0.003, 0.1, 5), mat: L.stick, m: at(0, 0.05, 0) }, { geo: new THREE.SphereGeometry(0.024, 12, 8), mat: L.pop[0]!, m: at(0, 0.115, 0, 0, 0, 0, 1, 1, 0.5) }];
    if (info.shape === "bag") return [{ geo: new THREE.SphereGeometry(0.06, 12, 8), mat: w, m: at(0, 0.06, 0, 0, 0, 0, 1, 1, 0.35) }];
    // Bars, cups and tins stand up on their edge facing out, in a row.
    const [bw, bh, bd] = info.shape === "tin" ? [0.07, 0.045, 0.024] : info.shape === "cups" ? [0.1, 0.06, 0.022] : [0.14, 0.05, 0.018];
    return [{ geo: new THREE.BoxGeometry(bw, bh, bd), mat: w, m: at(0, bh / 2, 0) }];
  }
  switch (kind) {
    case "pot": return [
      { geo: new THREE.CylinderGeometry(0.11, 0.1, 0.14, 20), mat: L.pot, m: at(0, 0.07, 0) },
      { geo: new THREE.TorusGeometry(0.022, 0.006, 5, 10, Math.PI), mat: L.handle, m: at(0.125, 0.115, 0, Math.PI / 2) },
      { geo: new THREE.TorusGeometry(0.022, 0.006, 5, 10, Math.PI), mat: L.handle, m: at(-0.125, 0.115, 0, Math.PI / 2) },
    ];
    case "pan": return [
      { geo: new THREE.CylinderGeometry(0.13, 0.11, 0.05, 20), mat: [L.pot, L.panIn, L.pot], m: at(0, 0.025, 0) },
      { geo: new THREE.BoxGeometry(0.2, 0.018, 0.03), mat: L.handle, m: at(0.22, 0.035, 0, 0, 0, -0.1) },
    ];
    case "plate": return [{ geo: new THREE.CylinderGeometry(0.12, 0.085, 0.016, 24), mat: L.porcelain, m: at(0, 0.008, 0) }, { geo: new THREE.RingGeometry(0.108, 0.115, 24), mat: L.rim, m: at(0, 0.0165, 0, -Math.PI / 2) }];
    case "bowl": return [{ geo: new THREE.CylinderGeometry(0.08, 0.045, 0.07, 18), mat: L.porcelain, m: at(0, 0.035, 0) }];
    case "cup": return [{ geo: new THREE.CylinderGeometry(0.038, 0.034, 0.09, 14), mat: L.mug, m: at(0, 0.045, 0) }, { geo: new THREE.TorusGeometry(0.022, 0.006, 5, 10), mat: L.mug, m: at(0.045, 0.05, 0) }];
    case "jar": return [{ geo: new THREE.CylinderGeometry(0.045, 0.045, 0.12, 14), mat: L.glass, m: at(0, 0.06, 0) }, { geo: new THREE.CylinderGeometry(0.042, 0.042, 0.015, 14), mat: L.lid, m: at(0, 0.127, 0) }];
    case "silverware": return [-0.03, 0, 0.03].map((x) => ({ geo: new THREE.BoxGeometry(0.012, 0.16, 0.004), mat: L.steel, m: at(x, 0.08, 0) }));
  }
  return [];
}

/** The grocery's pantry and kitchenware shelves, stocked: a section of each thing on each face, four levels (each
 * kind's parts drawn all at once). */
export function PantryShelf({ tag, w, d, frame }: { tag: string; w: number; d: number; frame: THREE.Material }) {
  const levels = [0.12, 0.55, 1.0, 1.45];
  const secs = useMemo(() => shelfSections(tag, w), [tag, w]);
  const meshes = useMemo(() => {
    const out: THREE.InstancedMesh[] = [];
    for (const sec of secs) {
      const span = sec.u1 - sec.u0, step = sec.kind === "pot" || sec.kind === "pan" ? 0.3 : isCan(sec.kind) ? 0.082 : sec.kind === "plate" || sec.kind === "bowl" ? 0.26 : 0.11;
      const per = Math.max(1, Math.floor((span - 0.04) / step)), stack = sec.kind === "plate" ? 4 : sec.kind === "bowl" ? 2 : 1, rise = sec.kind === "plate" ? 0.018 : 0.05;
      const places: THREE.Matrix4[] = [];
      for (const y of levels) for (let i = 0; i < per; i++) for (let k = 0; k < stack; k++) {
        const x = sec.u0 + 0.02 + (i + 0.5) * (span - 0.04) / per, z = sec.side * d / 4;
        places.push(at(x, y + 0.016 + k * rise, z, 0, sec.side > 0 ? 0 : Math.PI));
      }
      for (const part of partsOf(sec.kind)) {
        const im = new THREE.InstancedMesh(part.geo, part.mat, places.length);
        places.forEach((pm, i) => im.setMatrixAt(i, pm.clone().multiply(part.m)));
        im.castShadow = false; out.push(im);
      }
    }
    return out;
  }, [secs, d]);
  // (The materials are shared and kept; the geometries are this shelf's.)
  useEffect(() => () => meshes.forEach((im) => { im.geometry.dispose(); im.dispose(); }), [meshes]);
  return <group>
    <mesh position={[0, 0.9, 0]} material={frame}><boxGeometry args={[w, 1.8, 0.04]} /></mesh>
    {[-1, 1].map((s) => <mesh key={s} position={[s * w / 2, 0.9, 0]} material={frame}><boxGeometry args={[0.04, 1.8, d]} /></mesh>)}
    {levels.map((y) => <mesh key={y} position={[0, y, 0]} material={frame}><boxGeometry args={[w, 0.03, d]} /></mesh>)}
    {secs.map((sec, si) => <mesh key={si} position={[sec.u0, 0.9, sec.side * d / 4]} material={frame}><boxGeometry args={[0.012, 1.8, d / 2]} /></mesh>)}
    {meshes.map((im, i) => <primitive key={i} object={im} />)}
  </group>;
}
void WARES;
