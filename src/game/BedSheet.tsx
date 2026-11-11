import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { AptFloor } from "./aptRoom";
import { toLocal } from "./restaurantRoom";
import type { GameState } from "./state";

/** The mattress's top and the pillow (floor-local heights). */
export const MATTRESS_TOP = 0.555, PILLOW_TOP = 0.65;
/** The sheet's grid (across × along the bed), how far it hangs past the open side and the foot, its thickness. */
export const SHEET_NX = 16, SHEET_NZ = 25;
const NX = SHEET_NX, NZ = SHEET_NZ, OVER = 0.3, FOOT = 0.4, THICK = 0.012;
/** How far the sheet sits toward the foot when it covers someone (its top edge at the shoulders). */
const COVER_SHIFT = 0.17;

/**
 * The sheet's shapes: made (flat, hanging over the open side and the foot — never on the wall side), turned (the
 * top corner on the open side folded back diagonally, baring that part of the mattress to sit on) and covering
 * (everything on top of the bed, from the shoulders down, over whoever lies there).
 */
export type SheetShape = "made" | "turned" | "covering";
/** Which part of the sheet moves first when it changes shape (the rest follows in a wave). */
export type SheetLead = "corner" | "top" | "open";
/**
 * What the bed's moves tell the sheet each frame: going from one shape to another (k 0..1), which part leads, how
 * high it lifts on the way (m); and what it tells them back: where every point of it is now (`points`, floor-local
 * x, y, z per grid point, row by row from the top edge).
 */
export type SheetLink = { from: SheetShape; to: SheetShape; k: number; lead: SheetLead; lift: number; points: Float32Array | null };
export const sheetPoint = (link: SheetLink, i: number, j: number): [number, number, number] | null => {
  const p = link.points, k = (j * NX + i) * 3;
  return p ? [p[k]!, p[k + 1]!, p[k + 2]!] : null;
};

/**
 * A bedsheet that moves only as it's handled: its shapes are laid out exactly (no loose cloth physics), and changing
 * from one to another it travels in a smooth wave from the part held, lifted a little on the way. It never goes into
 * the mattress, the pillow or the person (it rises over the body, limbs and feet, so lying under it it takes their
 * shape), and it stays on the bed: pushed toward the wall it bunches up there instead of slipping down. Still unless
 * the bed is being got into, out of or made.
 */
export function BedSheet({ fl, state, mat, live, link }: { fl: AptFloor; state: GameState; mat: THREE.Material; live: () => boolean; link: SheetLink }) {
  const b = fl.bed;
  const box = useMemo(() => ({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.l / 2, z1: b.z + b.l / 2 }), [b]);
  const pillow = useMemo(() => ({ x0: b.x - (b.w - 0.25) / 2, x1: b.x + (b.w - 0.25) / 2, z0: b.z + b.l / 2 - 0.44, z1: b.z + b.l / 2 - 0.12 }), [b]);
  const top = MATTRESS_TOP + THICK;
  // The flat sheet: from the wall edge to past the open side; from under the pillow's edge to past the foot.
  const flat = useMemo(() => {
    const xa = box.x0 + 0.005, xb = box.x1 + OVER, za = pillow.z0 + 0.04, zb = box.z0 - FOOT;
    const f = new Float32Array(NX * NZ * 2);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const k = (j * NX + i) * 2; f[k] = xa + (xb - xa) * i / (NX - 1); f[k + 1] = za + (zb - za) * j / (NZ - 1); }
    return f;
  }, [box, pillow]);
  // A little roughness: fixed small creases, so it reads as fabric.
  const crease = useMemo(() => Float32Array.from({ length: NX * NZ }, (_, n) => { const i = n % NX, j = Math.floor(n / NX); return 0.004 * Math.sin(i * 1.7 + j * 0.9) * Math.cos(j * 1.3 - i * 0.4); }), []);
  /** The mattress (or the pillow) under a point. */
  const surface = (x: number, z: number) => (x > pillow.x0 - 0.04 && x < pillow.x1 + 0.04 && z > pillow.z0 - 0.06 ? PILLOW_TOP + THICK : top);
  /** Kept on the bed: past the wall or the head it bunches up instead of going over. */
  const keepOn = (x: number, y: number, z: number): [number, number, number] => {
    let over = 0;
    if (x < box.x0 + 0.01) { over += box.x0 + 0.01 - x; x = box.x0 + 0.01; }
    if (x > box.x1 - 0.01) { over += x - (box.x1 - 0.01); x = box.x1 - 0.01; }
    if (z > box.z1 - 0.02) { over += z - (box.z1 - 0.02); z = box.z1 - 0.02; }
    if (z < box.z0 + 0.01) { over += box.z0 + 0.01 - z; z = box.z0 + 0.01; }
    return [x, y + Math.min(0.12, over * 0.6), z];
  };
  /** On top of the bed: what hangs past the open side or the foot is folded back on top (a fold, two layers). */
  const onTop = (i: number, j: number, shift: number): [number, number, number] => {
    const n = j * NX + i;
    let x = flat[n * 2]!, z = flat[n * 2 + 1]! - shift, layers = 1;
    if (x > box.x1) { x = 2 * box.x1 - x; layers += 1; }
    if (z < box.z0) { z = 2 * box.z0 - z; layers += 1; }
    return [x, surface(x, z) + (layers - 1) * THICK * 1.5, z];
  };
  // The turned-down corner: everything nearer the bed's top corner on the open side than the spot it's folded to.
  const C: [number, number] = [box.x1, pillow.z0 + 0.04], T: [number, number] = [box.x1 - 0.45, b.sit[1] - 0.85];
  const shape = (s: SheetShape, i: number, j: number): [number, number, number] => {
    const n = j * NX + i;
    if (s === "made") {
      // Flat on top; past the open side or the foot it hangs straight down.
      let x = flat[n * 2]!, z = flat[n * 2 + 1]!;
      const dx = Math.max(0, x - (box.x1 + THICK)), dz = Math.max(0, box.z0 - THICK - z);
      if (x > box.x1 + THICK) x = box.x1 + THICK;
      if (z < box.z0 - THICK) z = box.z0 - THICK;
      return [x, Math.max(0.03, surface(x, z) - dx - dz) + crease[n]! * 0.5, z];
    }
    if (s === "turned") {
      let [x, y, z] = onTop(i, j, 0);
      const dC = Math.hypot(x - C[0], z - C[1]), dT = Math.hypot(x - T[0], z - T[1]);
      if (dC < dT) {
        // Folded over the line halfway between the corner and where it goes: lying on the rest, upside down.
        const len = Math.hypot(T[0] - C[0], T[1] - C[1]), mx = (C[0] + T[0]) / 2, mz = (C[1] + T[1]) / 2, nx = (T[0] - C[0]) / len, nz = (T[1] - C[1]) / len;
        const d = (x - mx) * nx + (z - mz) * nz;
        x -= 2 * d * nx; z -= 2 * d * nz; y = surface(x, z) + 2 * THICK * 1.5 + 0.015 * Math.max(0, 1 - Math.abs(d) / 0.08);
      }
      return keepOn(x, y + crease[n]!, z);
    }
    const [x, y, z] = onTop(i, j, COVER_SHIFT);
    return keepOn(x, y + crease[n]!, z);
  };
  const leadOf = (lead: SheetLead, i: number, j: number) => {
    if (lead === "top") return j / (NZ - 1);
    if (lead === "open") return 1 - i / (NX - 1);
    const n = j * NX + i;
    return Math.min(1, Math.hypot(flat[n * 2]! - C[0], flat[n * 2 + 1]! - C[1]) / 1.8);
  };

  const pos = useMemo(() => new Float32Array(NX * NZ * 3), []);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(NX * NZ * 3), 3));
    const idx: number[] = [];
    for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) { const a = j * NX + i; idx.push(a, a + NX, a + 1, a + 1, a + NX, a + NX + 1); }
    g.setIndex(idx);
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  const sheetMat = useMemo(() => { const k = (mat as THREE.MeshStandardMaterial).clone(); k.side = THREE.DoubleSide; return k; }, [mat]);
  useEffect(() => () => sheetMat.dispose(), [sheetMat]);

  // The body, as capsules in the floor's frame (only lying or level parts, and the feet: what a sheet goes over).
  const tmp = useMemo(() => Array.from({ length: 16 }, () => new THREE.Vector3()), []);
  const caps = useRef<{ a: THREE.Vector3; b: THREE.Vector3; r: number; drape?: number }[]>([]);
  const bodyTop = (x: number, z: number) => {
    let best = -1;
    for (const c of caps.current) {
      const abx = c.b.x - c.a.x, abz = c.b.z - c.a.z, l2 = abx * abx + abz * abz;
      const t = l2 > 1e-8 ? Math.max(0, Math.min(1, ((x - c.a.x) * abx + (z - c.a.z) * abz) / l2)) : 0;
      // (An upright part, like the feet lying on the back with the toes up: its top counts, so the toes stay under.)
      const upright = l2 < 0.25 * (c.b.y - c.a.y) ** 2;
      const cx = c.a.x + abx * t, cz = c.a.z + abz * t, cy = upright ? Math.max(c.a.y, c.b.y) : c.a.y + (c.b.y - c.a.y) * t, h = Math.hypot(x - cx, z - cz), reach = c.r + (c.drape ?? 0.12);
      // Over the part and draped down off it (never through it).
      if (h < reach) best = Math.max(best, cy + c.r * Math.cos(Math.min(Math.PI / 2, (h / reach) * Math.PI / 2)) + THICK);
    }
    return best;
  };
  const last = useRef("");
  useFrame(() => {
    const on = live();
    link.points = pos;
    // The body (when it's near the bed and on this floor).
    caps.current = [];
    const B = state.avatar.body, f = fl.frame;
    const [px, pz] = toLocal(f, state.pos.x, state.pos.z);
    const near = on && Math.hypot(px - b.x, pz - b.z) < 2.5 && B.length >= 12;
    if (near) {
      const at = (o: THREE.Object3D | undefined, v: THREE.Vector3, lx = 0, ly = 0, lz = 0) => {
        if (!o) return null;
        o.updateWorldMatrix(true, false); o.localToWorld(v.set(lx, ly, lz));
        const [x, z] = toLocal(f, v.x, v.z); return v.set(x, v.y - fl.y, z);
      };
      const level = (a: THREE.Vector3 | null, c: THREE.Vector3 | null, r: number, any = false, drape?: number) => {
        if (!a || !c) return;
        const l = a.distanceTo(c);
        if (any || l < 1e-4 || Math.abs(c.y - a.y) / l < 0.6) caps.current.push({ a: a.clone(), b: c.clone(), r, ...(drape !== undefined ? { drape } : {}) });
      };
      const hip = at(B[1], tmp[0]!), neck = at(B[2], tmp[1]!, 0, 0.55, 0);
      const hl = at(B[4], tmp[2]!), kl = at(B[5], tmp[3]!), al = at(B[5], tmp[4]!, 0, -0.46, 0);
      const hr = at(B[6], tmp[5]!), kr = at(B[7], tmp[6]!), ar = at(B[7], tmp[7]!, 0, -0.46, 0);
      // The foot as drawn: a capsule (radius 0.07) along the foot from 0.01 to 0.11 ahead of the ankle — the sheet
      // rests right on it (a thread over), draping off it only a little, so the feet keep their real size.
      const heelL = at(B[5], tmp[8]!, 0, -0.46, 0.01), toeL = at(B[5], tmp[9]!, 0, -0.46, 0.11), heelR = at(B[7], tmp[10]!, 0, -0.46, 0.01), toeR = at(B[7], tmp[11]!, 0, -0.46, 0.11);
      level(hip, neck, 0.17); level(hl, kl, 0.085); level(kl, al, 0.075); level(hr, kr, 0.085); level(kr, ar, 0.075);
      level(heelL, toeL, 0.073, true, 0.05); level(heelR, toeR, 0.073, true, 0.05);
      // (Only what is over the mattress counts.)
      caps.current = caps.current.filter((c) => Math.min(c.a.y, c.b.y) < MATTRESS_TOP + 0.45 && Math.min(c.a.x, c.b.x) < box.x1 + 0.05);
    }
    // Recomputed only when something changed: the sheet's shapes and progress, or the body under it.
    const key = `${link.from}|${link.to}|${link.k.toFixed(4)}|${link.lead}|${link.lift}|${caps.current.map((c) => `${c.a.x.toFixed(3)},${c.a.y.toFixed(3)},${c.a.z.toFixed(3)},${c.b.x.toFixed(3)},${c.b.y.toFixed(3)},${c.b.z.toFixed(3)}`).join(";")}`;
    if (key === last.current) return;
    last.current = key;
    const K = Math.max(0, Math.min(1, link.k)), S = 0.7;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const n = j * NX + i, k3 = n * 3;
      let p: [number, number, number];
      if (link.from === link.to || K <= 0) p = shape(link.from, i, j);
      else if (K >= 1) p = shape(link.to, i, j);
      else {
        const d = leadOf(link.lead, i, j), raw = Math.max(0, Math.min(1, K * (1 + S) - d * S)), kk = raw * raw * (3 - 2 * raw);
        const a = shape(link.from, i, j), c = shape(link.to, i, j);
        p = [a[0] + (c[0] - a[0]) * kk, a[1] + (c[1] - a[1]) * kk + link.lift * Math.sin(Math.PI * kk) * (1 - 0.45 * d), a[2] + (c[2] - a[2]) * kk];
      }
      // Over the person, never through them.
      if (caps.current.length) { const yb = bodyTop(p[0], p[2]); if (yb > p[1]) p[1] = yb; }
      pos[k3] = p[0]; pos[k3 + 1] = p[1]; pos[k3 + 2] = p[2];
    }
    const attr = geo.getAttribute("position") as THREE.BufferAttribute;
    (attr.array as Float32Array).set(pos); attr.needsUpdate = true;
    geo.computeVertexNormals(); geo.computeBoundingSphere();
  });
  return <mesh geometry={geo} material={sheetMat} castShadow receiveShadow frustumCulled={false} />;
}

/** Grid points the hands hold: the turned-down corner (top row, at the mattress's open edge) and, to make the bed,
 * the open edge near the head and near the foot. */
export function sheetGrips(fl: AptFloor) {
  const b = fl.bed, xa = b.x - b.w / 2 + 0.005, xb = b.x + b.w / 2 + OVER;
  const iEdge = Math.round((b.x + b.w / 2 - xa) / (xb - xa) * (NX - 1));
  const za = b.z + b.l / 2 - 0.44 + 0.04, zb = b.z - b.l / 2 - FOOT, row = (z: number) => Math.round((za - z) / (za - zb) * (NZ - 1));
  const col = (x: number) => Math.max(0, Math.min(NX - 1, Math.round((x - xa) / (xb - xa) * (NX - 1))));
  // Pulling it over oneself lying down: the top edge either side of the body.
  return { corner: [iEdge, 0] as [number, number], head: [iEdge, row(za - 0.12)] as [number, number], foot: [iEdge, row(b.z - b.l / 2 + 0.2)] as [number, number],
    pullL: [col(b.x - 0.2), 0] as [number, number], pullR: [col(b.x + 0.2), 0] as [number, number] };
}
