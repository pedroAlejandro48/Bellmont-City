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

/** The green stairs sign: a figure running down a flight of stairs, EXIT, an arrow down to the right. */
export function stairsTexture() {
  if (STAIRS) return STAIRS;
  const c = document.createElement("canvas"); c.width = 512; c.height = 512;
  const g = c.getContext("2d")!, W = "#f4fbf6";
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 512, 512);
  g.fillStyle = "#0f7f55"; rounded(g, 8, 8, 496, 496, 44); g.fill();
  g.strokeStyle = W; g.lineWidth = 10; rounded(g, 26, 26, 460, 460, 30); g.stroke();
  // EXIT.
  g.fillStyle = W; g.font = "900 120px 'Arial Narrow', Arial, sans-serif"; g.textAlign = "left"; g.textBaseline = "alphabetic";
  g.save(); g.scale(0.85, 1); g.fillText("EXIT", 238 / 0.85, 160); g.restore();
  // The stairs: a line stepping down to the right.
  g.lineWidth = 14; g.lineJoin = "miter"; g.lineCap = "butt";
  g.beginPath(); g.moveTo(50, 300); g.lineTo(150, 300);
  for (let i = 0; i < 4; i++) { g.lineTo(150 + i * 48, 345 + i * 45); g.lineTo(198 + i * 48, 345 + i * 45); }
  g.lineTo(342, 480); g.stroke();
  // The figure, running down: head, body leaning back, arms out, one leg forward down a step, one behind.
  g.lineCap = "round"; g.lineJoin = "round";
  g.beginPath(); g.arc(178, 112, 34, 0, Math.PI * 2); g.fill();
  const limb = (pts: [number, number][], w: number) => { g.lineWidth = w; g.beginPath(); g.moveTo(pts[0]![0], pts[0]![1]); for (const [x, y] of pts.slice(1)) g.lineTo(x, y); g.stroke(); };
  limb([[168, 160], [200, 250]], 44);                          // the body
  limb([[176, 170], [128, 196], [102, 230]], 24);              // the arm behind
  limb([[184, 172], [236, 200], [282, 196]], 24);              // the arm ahead
  limb([[200, 250], [158, 276], [92, 276]], 28);               // the leg behind
  limb([[200, 250], [244, 300], [252, 342]], 28);              // the leg ahead, down a step
  // The arrow, down to the right.
  g.lineCap = "butt"; limb([[320, 300], [420, 400]], 30);
  g.beginPath(); g.moveTo(448, 428); g.lineTo(448, 330); g.lineTo(350, 428); g.closePath(); g.fill();
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
