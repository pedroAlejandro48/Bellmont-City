import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { billboards } from "./places";
import type { GameState } from "./state";

/** The ads: the city's own brands for now, and an open slot for a real brand. */
const ADS: { bg: [string, string]; title: string; line: string; fg: string; accent: string }[] = [
  { bg: ["#c9281f", "#7d130e"], title: "BIG BELL BURGERS", line: "Open 24 hours · facing the park", fg: "#fff6d8", accent: "#ffc23d" },
  { bg: ["#1f5fbf", "#0f2f66"], title: "BELLMONT BANK", line: "Save, borrow, grow · ATMs by the park", fg: "#ffffff", accent: "#7fd0ff" },
  { bg: ["#1e7a46", "#0c3d22"], title: "NONNA LUCIA'S", line: "Real pizza · 11 to 8", fg: "#fffbe9", accent: "#ff6b4a" },
  { bg: ["#232332", "#0e0e16"], title: "YOUR BRAND HERE", line: "Advertise in Bellmont City", fg: "#ffffff", accent: "#ffb547" },
  { bg: ["#e07a1f", "#8a3f06"], title: "COURIERS WANTED", line: "Phone › Jobs · get paid today", fg: "#fff5e8", accent: "#ffffff" },
  { bg: ["#6c3fc0", "#2f1666"], title: "STUDIOS FROM $40", line: "Phone › Home · near the park", fg: "#ffffff", accent: "#e2c8ff" },
  { bg: ["#1d1a1a", "#3a2a22"], title: "HANAMI", line: "Japanese fine dining · 12 to 10", fg: "#f6e6d0", accent: "#e8a598" },
  { bg: ["#f4e3c7", "#c79c66"], title: "MORNING BELL CAFÉ", line: "Coffee from 6 am", fg: "#3a2414", accent: "#8a4b22" },
];
const SHOW = 9, FLIP = 0.5, W = 9, H = 4.2;

function adTexture(ad: (typeof ADS)[number]) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 240;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 512, 240); grad.addColorStop(0, ad.bg[0]); grad.addColorStop(1, ad.bg[1]);
  g.fillStyle = grad; g.fillRect(0, 0, 512, 240);
  g.fillStyle = ad.accent; g.fillRect(0, 196, 512, 8); g.globalAlpha = 0.12; g.beginPath(); g.arc(470, 30, 120, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
  g.fillStyle = ad.fg; g.textAlign = "center"; g.textBaseline = "middle";
  let size = 64; g.font = `800 ${size}px Manrope, Arial, sans-serif`;
  while (g.measureText(ad.title).width > 470 && size > 30) { size -= 2; g.font = `800 ${size}px Manrope, Arial, sans-serif`; }
  g.fillText(ad.title, 256, 92);
  g.font = "600 26px Manrope, Arial, sans-serif"; g.fillStyle = ad.accent; g.fillText(ad.line, 256, 155);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/**
 * Billboards on the roofs around the park. Each shows one ad at a time and flips to the next (the face folds shut
 * and opens again) every few seconds, all at the same moments for everyone (the game clock drives it). They glow a
 * little at night, like lit signs.
 */
export function Billboards({ state }: { state: GameState }) {
  const spots = useMemo(() => billboards(state.worldSeed), [state.worldSeed]);
  const mats = useMemo(() => ADS.map((ad) => new THREE.MeshBasicMaterial({ map: adTexture(ad), toneMapped: false })), []);
  const frame = useMemo(() => new THREE.MeshStandardMaterial({ color: "#3b3f47", roughness: 0.6, metalness: 0.5 }), []);
  const faces = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(() => {
    const t = state.elapsed, light = 0.72 + 0.28 * (1 - state.darkness) + state.darkness * 0.1;
    for (const m of mats) m.color.setScalar(light);
    spots.forEach((_, i) => {
      const f = faces.current[i]; if (!f) return;
      const slot = t / SHOW + i * 0.37, n = Math.floor(slot), into = (slot - n) * SHOW;
      f.material = mats[(n + i * 3) % mats.length]!;
      // The flip: folds shut at the end of a showing, the next ad opens at the start of the next.
      const k = into < FLIP ? into / FLIP : into > SHOW - FLIP ? (SHOW - into) / FLIP : 1;
      f.scale.y = Math.max(0.02, Math.sin((k * Math.PI) / 2));
    });
  });
  return <group>
    {spots.map((s, i) => <group key={i} position={[s.x, s.y, s.z]} rotation-y={s.yaw}>
      {[-W / 3, W / 3].map((x) => <mesh key={x} material={frame} position={[x, 1, -0.3]}><boxGeometry args={[0.18, 2, 0.18]} /></mesh>)}
      <mesh material={frame} position={[0, 2 + H / 2, -0.08]}><boxGeometry args={[W + 0.4, H + 0.4, 0.15]} /></mesh>
      <mesh ref={(m) => { faces.current[i] = m; }} material={mats[0]!} position={[0, 2 + H / 2, 0.01]}><planeGeometry args={[W, H]} /></mesh>
      <mesh material={frame} position={[0, 2, 0.35]}><boxGeometry args={[W, 0.08, 0.6]} /></mesh>
    </group>)}
  </group>;
}
