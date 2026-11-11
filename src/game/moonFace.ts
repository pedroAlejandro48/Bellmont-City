import type { Mood } from "./moon";

/**
 * The moon's face, drawn on a canvas (transparent round it): eyes, brows, mouth and — once she's fond of you —
 * pink cheeks. Used both on the moon in the sky and in the talk panel. `she`: lashes and softer brows; he gets
 * straighter, thicker brows.
 */
export function drawMoonFace(g: CanvasRenderingContext2D, S: number, mood: Mood, blush: number, she: boolean, withDisc = false) {
  g.clearRect(0, 0, S, S);
  const c = S / 2, u = S / 100;
  if (withDisc) {
    // The moon itself (for the panel): pale, a few soft craters.
    const grd = g.createRadialGradient(c - 12 * u, c - 14 * u, 6 * u, c, c, 48 * u);
    grd.addColorStop(0, "#fbfaf2"); grd.addColorStop(1, "#cfcabb");
    g.fillStyle = grd; g.beginPath(); g.arc(c, c, 46 * u, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(150,145,130,0.22)";
    for (const [x, y, r] of [[30, 30, 7], [70, 26, 5], [74, 66, 8], [26, 70, 5], [52, 82, 4]] as const) { g.beginPath(); g.arc(x * u, y * u, r * u, 0, Math.PI * 2); g.fill(); }
  }
  const ink = "rgba(70,62,58,0.92)";
  g.strokeStyle = ink; g.fillStyle = ink; g.lineCap = "round"; g.lineJoin = "round";
  // Cheeks.
  if (blush > 0.01) {
    for (const x of [28, 72]) {
      const grd = g.createRadialGradient(x * u, 62 * u, 0, x * u, 62 * u, 12 * u);
      grd.addColorStop(0, `rgba(255,105,140,${0.75 * blush})`); grd.addColorStop(1, "rgba(255,105,140,0)");
      g.fillStyle = grd; g.beginPath(); g.arc(x * u, 62 * u, 12 * u, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = ink;
    // Very red: little blush lines too.
    if (blush > 0.6) { g.lineWidth = 1.4 * u; for (const x of [24, 68]) for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo((x + i * 4) * u, 60 * u); g.lineTo((x + i * 4 - 2) * u, 64 * u); g.stroke(); } }
  }
  // Eyes: closed happy arcs when smiling, laughing or blushing hard; open otherwise (looking down when sad).
  g.lineWidth = 3 * u;
  const happyEyes = mood === "laugh" || (mood === "blush" && blush > 0.5) || mood === "smile";
  for (const x of [36, 64]) {
    if (happyEyes) { g.beginPath(); g.arc(x * u, 46 * u, 6 * u, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
    else if (mood === "surprised") { g.beginPath(); g.arc(x * u, 44 * u, 4.5 * u, 0, Math.PI * 2); g.fill(); }
    else { g.beginPath(); g.ellipse(x * u, (mood === "sad" ? 47 : 45) * u, 3.2 * u, 4.2 * u, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = "#fff"; g.beginPath(); g.arc((x + 1.2) * u, 43.5 * u, 1.1 * u, 0, Math.PI * 2); g.fill(); g.fillStyle = ink; }
    // Lashes for her.
    if (she && !happyEyes) { g.lineWidth = 1.6 * u; for (const d of [-1, 0, 1]) { g.beginPath(); g.moveTo((x + d * 3) * u, 40.5 * u); g.lineTo((x + d * 4.5) * u, 37.5 * u); g.stroke(); } g.lineWidth = 3 * u; }
  }
  // Brows.
  g.lineWidth = (she ? 2 : 3.4) * u;
  for (const [x, side] of [[36, -1], [64, 1]] as const) {
    const tilt = mood === "annoyed" ? -side * 4 : mood === "sad" ? side * 4 : mood === "surprised" ? 0 : 0;
    const y = mood === "surprised" ? 32 : 35;
    g.beginPath(); g.moveTo((x - 6) * u, (y - tilt * 0.5 * -side) * u); g.quadraticCurveTo(x * u, (y - (she ? 2.5 : 1)) * u, (x + 6) * u, (y + tilt * 0.5 * -side) * u); g.stroke();
  }
  // Mouth.
  g.lineWidth = 3 * u;
  g.beginPath();
  if (mood === "laugh") { g.moveTo(40 * u, 64 * u); g.quadraticCurveTo(50 * u, 80 * u, 60 * u, 64 * u); g.closePath(); g.fillStyle = "rgba(150,60,70,0.85)"; g.fill(); g.stroke(); g.fillStyle = ink; }
  else if (mood === "smile" || mood === "blush") { g.moveTo(41 * u, 65 * u); g.quadraticCurveTo(50 * u, 73 * u, 59 * u, 65 * u); g.stroke(); }
  else if (mood === "surprised") { g.ellipse(50 * u, 68 * u, 4 * u, 5.5 * u, 0, 0, Math.PI * 2); g.stroke(); }
  else if (mood === "annoyed") { g.moveTo(42 * u, 69 * u); g.lineTo(58 * u, 67 * u); g.stroke(); }
  else if (mood === "sad") { g.moveTo(42 * u, 71 * u); g.quadraticCurveTo(50 * u, 64 * u, 58 * u, 71 * u); g.stroke(); }
  else { g.moveTo(44 * u, 67 * u); g.quadraticCurveTo(50 * u, 69 * u, 56 * u, 67 * u); g.stroke(); }
}
