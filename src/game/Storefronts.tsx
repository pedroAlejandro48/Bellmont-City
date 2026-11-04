import { useMemo } from "react";
import * as THREE from "three";
import { SHOPS, type ShopKind, type shopPlaces } from "./shops";

type Place = ReturnType<typeof shopPlaces>[number];

/** A shop's sign: its name on its colour, with a mark for the hospital (a cross) and the police (a star). */
function signTexture(kind: ShopKind) {
  const shop = SHOPS[kind], c = document.createElement("canvas");
  c.width = 512; c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = shop.color; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = shop.ink; g.globalAlpha = 0.35; g.lineWidth = 6; g.strokeRect(8, 8, 496, 112); g.globalAlpha = 1;
  let x = 256;
  if (kind === "hospital") { g.fillStyle = shop.ink; g.fillRect(40, 50, 52, 20); g.fillRect(56, 34, 20, 52); x = 290; }
  if (kind === "police") {
    g.fillStyle = "#ffd166"; g.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 13 : 30, a = (i * Math.PI) / 5 - Math.PI / 2; g.lineTo(66 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
    g.closePath(); g.fill(); x = 290;
  }
  g.fillStyle = shop.ink; g.textAlign = "center"; g.textBaseline = "middle";
  let size = 58; g.font = `800 ${size}px Manrope, Arial, sans-serif`;
  const room = x === 256 ? 470 : 380;
  while (g.measureText(shop.name).width > room && size > 26) { size -= 2; g.font = `800 ${size}px Manrope, Arial, sans-serif`; }
  g.fillText(shop.name, x, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/**
 * The shops' fronts: a lit name sign over the door and a striped awning in the shop's colour, out from the wall
 * the door is in (the door point is 1.2 m out from that wall).
 */
export function Storefronts({ shops }: { shops: Place[] }) {
  const looks = useMemo(() => shops.map((s) => {
    const shop = SHOPS[s.kind];
    return {
      sign: new THREE.MeshBasicMaterial({ map: signTexture(s.kind), toneMapped: false }),
      awning: new THREE.MeshStandardMaterial({ color: shop.color === "#ffffff" ? "#d62f3a" : shop.color, roughness: 0.8 }),
    };
  }), [shops]);
  const trim = useMemo(() => new THREE.MeshStandardMaterial({ color: "#e9e6df", roughness: 0.7 }), []);
  return <group>
    {shops.map((s, i) => {
      const look = looks[i]!;
      return <group key={s.kind} position={[s.door.x, 0, s.door.z]} rotation-y={s.door.yaw}>
        {/* Local +z points out of the wall; the wall is 1.2 m back. */}
        <mesh material={look.sign} position={[0, 3.55, -1.12]}><planeGeometry args={[3.6, 0.9]} /></mesh>
        <mesh material={trim} position={[0, 3.55, -1.17]}><boxGeometry args={[3.8, 1.05, 0.08]} /></mesh>
        <mesh material={look.awning} position={[0, 2.85, -0.55]} rotation-x={0.38} castShadow><boxGeometry args={[3.4, 0.06, 1.3]} /></mesh>
        <mesh material={trim} position={[0, 2.6, 0.04]}><boxGeometry args={[3.4, 0.2, 0.05]} /></mesh>
      </group>;
    })}
  </group>;
}
