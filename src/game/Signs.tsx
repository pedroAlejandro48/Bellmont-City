// Signs drawn in code (canvas textures, nothing loaded): the red EXIT sign over every building's way out, inside,
// and the green stairs sign over the stairwell's doorway on each apartment floor.
import * as THREE from "three";

let EXIT: THREE.CanvasTexture | null = null, STAIRS: THREE.CanvasTexture | null = null;
const finish = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
function rounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** The red EXIT face: white letters on red, a white chevron either side. */
export function exitTexture() {
  if (EXIT) return EXIT;
  const c = document.createElement("canvas"); c.width = 512; c.height = 300;
  const g = c.getContext("2d")!;
  g.fillStyle = "#d7262b"; g.fillRect(0, 0, 512, 300);
  g.fillStyle = "#fff6f2"; g.font = "900 190px 'Arial Narrow', Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.save(); g.scale(0.82, 1); g.fillText("EXIT", 256 / 0.82, 160); g.restore();
  // The chevrons.
  g.lineWidth = 12; g.strokeStyle = "#fff6f2"; g.lineJoin = "miter";
  g.beginPath(); g.moveTo(52, 125); g.lineTo(28, 160); g.lineTo(52, 195); g.stroke();
  g.beginPath(); g.moveTo(460, 125); g.lineTo(484, 160); g.lineTo(460, 195); g.stroke();
  return (EXIT = finish(c));
}

/** The green stairs sign (3:2): a figure running down to the right — leaning into the run, the leg behind lifted
 * straight back, the leg ahead straight down onto the first of three steps — EXIT, and a block arrow down to the
 * right. */
export function stairsTexture() {
  if (STAIRS) return STAIRS;
  const c = document.createElement("canvas"); c.width = 600; c.height = 400;
  const g = c.getContext("2d")!, W = "#f4fbf6";
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 600, 400);
  g.fillStyle = "#0f7f55"; rounded(g, 6, 6, 588, 388, 36); g.fill();
  g.strokeStyle = W; g.lineWidth = 8; rounded(g, 20, 20, 560, 360, 24); g.stroke();
  // EXIT, top right.
  g.fillStyle = W; g.font = "900 112px 'Arial Narrow', Arial, sans-serif"; g.textAlign = "left"; g.textBaseline = "alphabetic";
  g.save(); g.scale(0.82, 1); g.fillText("EXIT", 300 / 0.82, 135); g.restore();
  // Three steps down to the right from a landing.
  g.lineWidth = 11; g.lineJoin = "miter"; g.lineCap = "butt";
  g.beginPath(); g.moveTo(34, 262); g.lineTo(178, 262);
  for (let i = 0; i < 3; i++) { g.lineTo(178 + i * 62, 262 + (i + 1) * 36); g.lineTo(240 + i * 62, 262 + (i + 1) * 36); }
  g.lineTo(364, 372); g.stroke();
  // The figure.
  const limb = (pts: [number, number][], w: number) => { g.lineCap = "round"; g.lineJoin = "round"; g.lineWidth = w; g.beginPath(); g.moveTo(pts[0]![0], pts[0]![1]); for (const [x, y] of pts.slice(1)) g.lineTo(x, y); g.stroke(); };
  // (Shifted right of the steps' edge: the leg ahead comes down clear of it, onto the first step.)
  const X = 30;
  g.beginPath(); g.arc(196 + X, 66, 27, 0, Math.PI * 2); g.fill();             // the head, ahead of the hips
  const neck: [number, number] = [176 + X, 112], hip: [number, number] = [138 + X, 196];
  limb([neck, hip], 40);                                                         // the body, leaning forward (right)
  limb([[170 + X, 120], [128 + X, 132], [92 + X, 160]], 20);                     // the arm behind
  limb([[178 + X, 122], [218 + X, 150], [262 + X, 146]], 20);                    // the arm ahead
  limb([hip, [100 + X, 222], [60 + X, 238]], 24);                                // the leg behind, lifted back…
  limb([[60 + X, 236], [52 + X, 258]], 17);                                      // …its foot pointing down
  limb([hip, [188 + X, 280]], 24);                                               // the leg ahead, straight…
  limb([[181 + X, 284], [203 + X, 286]], 16);                                    // …its foot flat on the first step
  // The arrow, down to the right: a shaft and a big triangular head.
  g.save(); g.translate(392, 214); g.rotate(Math.PI / 4);
  g.fillRect(0, -15, 96, 30);
  g.beginPath(); g.moveTo(88, -52); g.lineTo(150, 0); g.lineTo(88, 52); g.closePath(); g.fill();
  g.restore();
  return (STAIRS = finish(c));
}

/** A lit EXIT sign box (white housing, the red face toward +z), centred on its origin. */
export function ExitSign(props: { position: [number, number, number]; rotationY?: number }) {
  return <group position={props.position} rotation-y={props.rotationY ?? 0}>
    <mesh><boxGeometry args={[0.52, 0.32, 0.06]} /><meshStandardMaterial color="#f4f4f2" roughness={0.5} /></mesh>
    {/* (Lit from inside: its own colours, whatever the light in the room.) */}
    <mesh position={[0, 0, 0.031]}><planeGeometry args={[0.46, 0.27]} /><meshBasicMaterial map={exitTexture()} toneMapped={false} /></mesh>
  </group>;
}
