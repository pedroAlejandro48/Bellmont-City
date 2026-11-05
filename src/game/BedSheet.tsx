import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { AptFloor } from "./aptRoom";
import { handWorld } from "./arms";
import { toLocal } from "./restaurantRoom";
import type { GameState } from "./state";

/** The mattress's top and the pillow (floor-local heights). */
export const MATTRESS_TOP = 0.555, PILLOW_TOP = 0.65;
const NX = 16, NZ = 22, OVER = 0.3, THICK = 0.014, ITER = 12;
/** After moving (the hand let go, the body got out), how long the sheet settles before it's still again (s). */
const SETTLE = 2.5;

/** What the apartment's moves and the sheet share: where its held corner is now, and where a hand holds it (or null). */
export type SheetLink = { corner: [number, number, number] | null; pin: [number, number, number] | null; /** Someone is getting in or out of the bed: the sheet moves. */ active: boolean };

/** Links: [a, b, rest length, stiff] — stiff ones (two apart) also resist folding, so it's fabric, not liquid. */
type Cloth = { p: Float32Array; q: Float32Array; links: [number, number, number, boolean][]; pos0: Float32Array };

/**
 * A bedsheet: a cloth (Verlet particles in a grid, kept their distance apart, pulled down by gravity) lying on the
 * mattress and hanging over its sides and foot. It never goes into the mattress, the pillow or the floor, nor into
 * the character (round the body's limbs, torso and head as capsules), so lying under it the sheet takes the body's
 * shape. One top corner (at the bed's open side, by the pillow) can be held: it then follows the hand.
 * It starts made (flat on top, hanging straight at the sides) and stays perfectly still: it only moves while someone
 * gets into or out of the bed, and settles for a moment after.
 */
export function BedSheet({ fl, state, mat, live, link }: { fl: AptFloor; state: GameState; mat: THREE.Material; live: () => boolean; link: SheetLink }) {
  const b = fl.bed;
  const box = useMemo(() => ({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.l / 2, z1: b.z + b.l / 2 }), [b]);
  // The pillow (its box, floor-local).
  const pillow = useMemo(() => ({ x0: b.x - (b.w - 0.25) / 2, x1: b.x + (b.w - 0.25) / 2, z0: b.z + b.l / 2 - 0.44, z1: b.z + b.l / 2 - 0.12 }), [b]);
  const cloth = useMemo<Cloth>(() => {
    // From under the pillow down past the foot; wider than the mattress by OVER each side.
    const xa = box.x0 - OVER, xb = box.x1 + OVER, za = pillow.z0 + 0.04, zb = box.z0 - 0.14;
    const p = new Float32Array(NX * NZ * 3);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const k = (j * NX + i) * 3;
      p[k] = xa + (xb - xa) * i / (NX - 1); p[k + 1] = MATTRESS_TOP + 0.05; p[k + 2] = za + (zb - za) * j / (NZ - 1);
    }
    const links: [number, number, number, boolean][] = [];
    const d = (a: number, c: number) => Math.hypot(p[a * 3]! - p[c * 3]!, p[a * 3 + 1]! - p[c * 3 + 1]!, p[a * 3 + 2]! - p[c * 3 + 2]!);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const a = j * NX + i;
      if (i < NX - 1) links.push([a, a + 1, d(a, a + 1), false]);
      if (j < NZ - 1) links.push([a, a + NX, d(a, a + NX), false]);
      if (i < NX - 1 && j < NZ - 1) { links.push([a, a + NX + 1, d(a, a + NX + 1), false]); links.push([a + 1, a + NX, d(a + 1, a + NX), false]); }
      // Bending (two apart) keeps it from crumpling: it holds its shape a little, like a real sheet.
      if (i < NX - 2) links.push([a, a + 2, d(a, a + 2), true]);
      if (j < NZ - 2) links.push([a, a + 2 * NX, d(a, a + 2 * NX), true]);
    }
    // Made: flat on the mattress (over the pillow's edge), hanging straight down the sides and the foot.
    const top = MATTRESS_TOP + THICK;
    for (let n = 0; n < NX * NZ; n++) {
      const k = n * 3;
      let x = p[k]!, z = p[k + 2]!;
      const dx = Math.max(0, x - (box.x1 + THICK), box.x0 - THICK - x), dz = Math.max(0, box.z0 - THICK - z);
      if (x > box.x1 + THICK) x = box.x1 + THICK; else if (x < box.x0 - THICK) x = box.x0 - THICK;
      if (z < box.z0 - THICK) z = box.z0 - THICK;
      const onPillow = x > pillow.x0 && x < pillow.x1 && z > pillow.z0 && z < pillow.z1;
      p[k] = x; p[k + 1] = Math.max(0.02, (onPillow ? PILLOW_TOP + THICK : top) - dx - dz); p[k + 2] = z;
    }
    return { p, q: p.slice(), links, pos0: p.slice() };
  }, [box, pillow]);
  /** The held corner: the top one on the open side (+x). */
  const CORNER = NX - 1;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(cloth.p.slice(), 3));
    const idx: number[] = [];
    for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) { const a = j * NX + i; idx.push(a, a + NX, a + 1, a + 1, a + NX, a + NX + 1); }
    g.setIndex(idx);
    const uv = new Float32Array(NX * NZ * 2);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { uv[(j * NX + i) * 2] = i / (NX - 1); uv[(j * NX + i) * 2 + 1] = j / (NZ - 1); }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    return g;
  }, [cloth]);
  useEffect(() => () => geo.dispose(), [geo]);
  const caps = useRef<{ a: THREE.Vector3; b: THREE.Vector3; r: number }[]>([]);
  /** Below this (sat on, under the hips), the sheet is under the person: upright limbs leave it be. */
  const seatY = useRef(-1);
  const tmp = useMemo(() => Array.from({ length: 14 }, () => new THREE.Vector3()), []);

  const collide = (k: number) => {
    const P = cloth.p;
    let x = P[k]!, y = P[k + 1]!, z = P[k + 2]!;
    if (y < 0.01) y = 0.01;
    // The mattress (and the bed under it): out by the nearest face (the top, a side, the foot).
    const top = MATTRESS_TOP + THICK;
    if (x > box.x0 - THICK && x < box.x1 + THICK && z > box.z0 - THICK && z < box.z1 && y < top) {
      const dTop = top - y, dL = x - (box.x0 - THICK), dR = box.x1 + THICK - x, dF = z - (box.z0 - THICK);
      const m = Math.min(dTop, dL, dR, dF);
      if (m === dTop) y = top; else if (m === dL) x = box.x0 - THICK; else if (m === dR) x = box.x1 + THICK; else z = box.z0 - THICK;
    }
    if (x > pillow.x0 && x < pillow.x1 && z > pillow.z0 && z < pillow.z1 && y < PILLOW_TOP + THICK) y = PILLOW_TOP + THICK;
    // The body: never inside a limb, the torso or the head — the sheet is lifted over it (never shoved sideways
    // off the bed): it lies on top of whoever is under it, in their shape.
    let touching = y <= top + 0.002 && x > box.x0 && x < box.x1 && z > box.z0 && z < box.z1;
    for (const c of caps.current) {
      const ab = tmp[12]!.subVectors(c.b, c.a), ap = tmp[13]!.set(x - c.a.x, y - c.a.y, z - c.a.z);
      const t = Math.max(0, Math.min(1, ap.dot(ab) / Math.max(1e-6, ab.lengthSq())));
      const cx = c.a.x + ab.x * t, cy = c.a.y + ab.y * t, cz = c.a.z + ab.z * t;
      const r = c.r + THICK, len = ab.length(), steep = len > 1e-4 && Math.abs(ab.y) / len > 0.55;
      if (steep && y < seatY.current) continue;
      if (steep) {
        // An upright limb (standing, sitting up): out sideways (never down), so the sheet can't climb it.
        let dx = x - cx, dy = Math.max(0, y - cy), dz = z - cz;
        const d = Math.hypot(x - cx, y - cy, z - cz);
        if (d < r) { const l = Math.hypot(dx, dy, dz) || 1; if (l < 1e-4) { dx = 1; dy = 0; dz = 0; } const k2 = r / (Math.hypot(dx, dy, dz) || 1); x = cx + dx * k2; y = Math.max(y, cy + dy * k2); z = cz + dz * k2; touching = true; }
      } else {
        // Lying (or a level thigh): the sheet goes over it, in its shape.
        const h = Math.hypot(x - cx, z - cz);
        if (h < r) { const lift = cy + Math.sqrt(r * r - h * h); if (y < lift && y > cy - r) { y = lift; touching = true; } }
      }
    }
    // Pushed out of something: moved, not thrown (no speed added); resting on it: friction (no sliding off).
    const Q = cloth.q, mx = x - P[k]!, my = y - P[k + 1]!, mz = z - P[k + 2]!;
    if (mx || my || mz) { Q[k] = Q[k]! + mx; Q[k + 1] = Q[k + 1]! + my; Q[k + 2] = Q[k + 2]! + mz; }
    if (touching) { Q[k] = Q[k]! + (x - Q[k]!) * 0.93; Q[k + 2] = Q[k + 2]! + (z - Q[k + 2]!) * 0.93; if (Q[k + 1]! < y) Q[k + 1] = y; }
    P[k] = x; P[k + 1] = y; P[k + 2] = z;
  };
  const step = (dt: number) => {
    const P = cloth.p, Q = cloth.q, n = NX * NZ, g = -9.8 * dt * dt;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      for (let a = 0; a < 3; a++) {
        const v = Math.max(-0.04, Math.min(0.04, (P[k + a]! - Q[k + a]!) * 0.95));
        Q[k + a] = P[k + a]!;
        P[k + a] = P[k + a]! + v + (a === 1 ? g : 0);
      }
    }
    const pin = link.pin;
    for (let it = 0; it < ITER; it++) {
      for (const [a, c, rest, stiff] of cloth.links) {
        const ka = a * 3, kc = c * 3, dx = P[kc]! - P[ka]!, dy = P[kc + 1]! - P[ka + 1]!, dz = P[kc + 2]! - P[ka + 2]!;
        const d = Math.hypot(dx, dy, dz) || 1e-6, diff = (d - rest) / d * (d < rest ? 0.15 : 0.5);
        // Pulled taut; pushed together only resisted (a little) by the stiff links — cloth bunches, it doesn't flow.
        if (d < rest && !stiff) continue;
        P[ka] = P[ka]! + dx * diff; P[ka + 1] = P[ka + 1]! + dy * diff; P[ka + 2] = P[ka + 2]! + dz * diff;
        P[kc] = P[kc]! - dx * diff; P[kc + 1] = P[kc + 1]! - dy * diff; P[kc + 2] = P[kc + 2]! - dz * diff;
      }
      if (pin) { const k = CORNER * 3; P[k] = pin[0]; P[k + 1] = pin[1]; P[k + 2] = pin[2]; }
      if (it % 2 === 1 || it === ITER - 1) for (let i = 0; i < n; i++) collide(i * 3);
    }
    if (pin) { const k = CORNER * 3; Q[k] = P[k] = pin[0]; Q[k + 1] = P[k + 1] = pin[1]; Q[k + 2] = P[k + 2] = pin[2]; }
  };
  /** Until when the sheet still moves (it settles a moment after someone gets in or out, then is still). */
  const movingUntil = useRef(-1);

  const mesh = useRef<THREE.Mesh>(null);
  // Seen from both sides (it folds and hangs).
  const sheetMat = useMemo(() => { const k = (mat as THREE.MeshStandardMaterial).clone(); k.side = THREE.DoubleSide; return k; }, [mat]);
  useEffect(() => () => sheetMat.dispose(), [sheetMat]);
  useFrame((_, raw) => {
    const on = live();
    const P = cloth.p;
    { const k = CORNER * 3; link.corner = [P[k]!, P[k + 1]!, P[k + 2]!]; }
    if (!on) return;
    // Still unless someone is getting into or out of the bed (and a moment after, while it settles).
    const now = state.simulationTime;
    if (link.active || link.pin) movingUntil.current = now + SETTLE;
    if (now > movingUntil.current) return;
    // The body as capsules, in the floor's frame.
    const B = state.avatar.body, f = fl.frame;
    const at = (o: THREE.Object3D | undefined, v: THREE.Vector3, lx = 0, ly = 0, lz = 0) => {
      if (!o) return null;
      o.updateWorldMatrix(true, false);
      o.localToWorld(v.set(lx, ly, lz));
      const [x, z] = toLocal(f, v.x, v.z); v.set(x, v.y - fl.y, z);
      return v;
    };
    const near = Math.hypot(...((): [number, number] => { const [x, z] = toLocal(f, state.pos.x, state.pos.z); return [x - b.x, z - b.z]; })()) < 3.5;
    caps.current = [];
    if (B.length >= 12 && near) {
      const hip = at(B[1], tmp[0]!), neck = at(B[2], tmp[1]!, 0, 0.55, 0), head = at(B[3], tmp[2]!);
      const hl = at(B[4], tmp[3]!), kl = at(B[5], tmp[4]!), fl2 = at(B[5], tmp[5]!, 0, -0.46, 0.05);
      const hr = at(B[6], tmp[6]!), kr = at(B[7], tmp[7]!), fr = at(B[7], tmp[8]!, 0, -0.46, 0.05);
      const sl = at(B[8], tmp[9]!), el = at(B[9], tmp[10]!), hdl = B[9] ? (() => { const v = handWorld(B[9]!, tmp[11]!); const [x, z] = toLocal(f, v.x, v.z); return v.set(x, v.y - fl.y, z); })() : null;
      if (hip && neck) caps.current.push({ a: hip, b: neck, r: 0.17 });
      seatY.current = hip ? hip.y + 0.06 : -1;
      if (head) caps.current.push({ a: head, b: head, r: 0.15 });
      if (hl && kl) caps.current.push({ a: hl, b: kl, r: 0.085 });
      if (kl && fl2) caps.current.push({ a: kl, b: fl2, r: 0.075 });
      if (hr && kr) caps.current.push({ a: hr, b: kr, r: 0.085 });
      if (kr && fr) caps.current.push({ a: kr, b: fr, r: 0.075 });
      if (sl && el) caps.current.push({ a: sl, b: el, r: 0.065 });
      if (el && hdl) caps.current.push({ a: el, b: hdl, r: 0.06 });
    }
    const dt = Math.min(raw, 1 / 30);
    step(dt / 2); step(dt / 2);
    const attr = geo.getAttribute("position") as THREE.BufferAttribute;
    (attr.array as Float32Array).set(P);
    attr.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  });
  useEffect(() => { const attr = geo.getAttribute("position") as THREE.BufferAttribute; (attr.array as Float32Array).set(cloth.p); attr.needsUpdate = true; geo.computeVertexNormals(); }, [geo, cloth]);
  return <mesh ref={mesh} geometry={geo} material={sheetMat} castShadow receiveShadow frustumCulled={false} />;
}
