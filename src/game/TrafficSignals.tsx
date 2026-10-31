import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CROSSWALK, SIGNALLED, SIGNAL_POLE, SIGNAL_POLES, crosswalks, signalState, stopLineFrom, streetHalfWidth } from "./config";
import { makeGlow } from "./textures";
import type { GameState } from "./state";

const tmp = new THREE.Object3D();
const place = (x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1, flat = false) => {
  tmp.position.set(x, y, z); tmp.rotation.set(flat ? -Math.PI / 2 : 0, yaw, 0, flat ? "YXZ" : "XYZ"); tmp.scale.set(sx, sy, sz); tmp.updateMatrix();
  return tmp.matrix.clone();
};

function Instances({ geometry, material, items, refOut }: { geometry: THREE.BufferGeometry; material: THREE.Material; items: THREE.Matrix4[]; refOut?: (m: THREE.InstancedMesh | null) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  return <instancedMesh ref={(m) => { ref.current = m; refOut?.(m); }} args={[geometry, material, items.length]} />;
}

/** Each light's colour when lit and when dark. */
/** A light that is on: a bright, vibrant colour, as bright at night as by day (like a lit window). */
const LIT = { red: new THREE.Color("#ff2414"), yellow: new THREE.Color("#ffc414"), green: new THREE.Color("#1dff64") };
/** A light that is off: its coloured plastic still shows, but dark and greyed. */
const DARK = { red: new THREE.Color("#4a2c2a"), yellow: new THREE.Color("#4a4430"), green: new THREE.Color("#2c4434") };
const NO_HALO = new THREE.Color("#000000");

/** The soft glow around a lit signal light: a bright centre fading to nothing. */
function makeHalo() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(255,255,255,0.9)"); r.addColorStop(0.25, "rgba(255,255,255,0.5)"); r.addColorStop(0.6, "rgba(255,255,255,0.12)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Traffic lights at every signalled intersection (where avenues meet every third street): a pole on each
 * corner with a lamp out over the road and red, yellow and green lights hung under it, left to right as the
 * driver sees them; plus the zebra crossings and stop lines on the road. Drawn city-wide (they are few).
 */
export function TrafficSignals({ state }: { state: GameState }) {
  const assets = useMemo(() => {
    const iron = new THREE.MeshStandardMaterial({ color: "#2b2f33", roughness: 0.45, metalness: 0.6 });
    const housing = new THREE.MeshStandardMaterial({ color: "#151719", roughness: 0.6 });
    const lamp = new THREE.MeshStandardMaterial({ color: "#fff3d6", emissive: new THREE.Color("#ffcf80"), emissiveIntensity: 0, fog: false });
    const glow = new THREE.MeshBasicMaterial({ map: makeGlow(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false });
    const paint = new THREE.MeshStandardMaterial({ color: "#e9ece6", roughness: 0.8 });
    const bulb = new THREE.MeshBasicMaterial({ color: "#ffffff", fog: false, toneMapped: false });
    const poles = SIGNAL_POLES.map((s) => place(s.x, SIGNAL_POLE.height / 2, s.z));
    // The arm runs from the pole back over the road (against the right-hand direction).
    const arms = SIGNAL_POLES.map((s) => place((s.x + s.tipX) / 2 - s.rx * 0.4, SIGNAL_POLE.height - 0.15, (s.z + s.tipZ) / 2 - s.rz * 0.4, Math.atan2(s.rx, s.rz), 1, 1, s.reach + 0.8));
    const lamps = SIGNAL_POLES.map((s) => place(s.tipX - s.rx * 0.4, SIGNAL_POLE.height - 0.32, s.tipZ - s.rz * 0.4, Math.atan2(s.rx, s.rz)));
    const glows = SIGNAL_POLES.map((s) => place(s.tipX, 0.03, s.tipZ, 0, 14, 14, 1, true));
    // The light housing lies across the lanes; its lights face the oncoming traffic.
    const facing = (s: (typeof SIGNAL_POLES)[number]) => Math.atan2(-s.fx, -s.fz);
    const housings = SIGNAL_POLES.map((s) => place(s.tipX - s.fx * 0.05, SIGNAL_POLE.head, s.tipZ - s.fz * 0.05, facing(s)));
    const hangers = SIGNAL_POLES.map((s) => place(s.tipX, (SIGNAL_POLE.head + SIGNAL_POLE.height) / 2 - 0.1, s.tipZ));
    // Red on the driver's left (-right), yellow in the middle, green on the right.
    // The lights sit on the housing's front face (it is 0.34 deep, centred 0.05 behind the arm's tip), their
    // glows just in front of them.
    const bulbAt = (offset: number, out = 0.235) => SIGNAL_POLES.map((s) => place(s.tipX + s.rx * offset - s.fx * out, SIGNAL_POLE.head, s.tipZ + s.rz * offset - s.fz * out, facing(s)));
    const halo = new THREE.MeshBasicMaterial({ map: makeHalo(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.4, fog: false, toneMapped: false });
    const stripes: THREE.Matrix4[] = [], stops: THREE.Matrix4[] = [];
    for (const [cx, cz] of SIGNALLED) {
      for (const c of crosswalks(cx, cz)) {
        // Bars run with the traffic, spaced across the road.
        const acrossZ = c.across === "z", span = acrossZ ? c.hz : c.hx;
        for (let a = -span + 0.6; a <= span - 0.3; a += 1.1) stripes.push(place(acrossZ ? c.x : c.x + a, 0.024, acrossZ ? c.z + a : c.z, acrossZ ? 0 : Math.PI / 2, CROSSWALK.width, 1, 0.55));
      }
      for (const axis of ["x", "z"] as const) for (const dir of [1, -1] as const) {
        const cross = axis === "x" ? cx : cz, road = axis === "x" ? cz : cx, half = streetHalfWidth(road);
        const along = cross - dir * (stopLineFrom(cross) - 0.2), lateral = road + (axis === "x" ? dir : -dir) * half / 2;
        stops.push(place(axis === "x" ? along : lateral, 0.024, axis === "x" ? lateral : along, axis === "x" ? 0 : Math.PI / 2, 0.4, 1, half));
      }
    }
    return {
      iron, housing, lamp, glow, paint, bulb, poles, arms, lamps, glows, housings, hangers, stripes, stops,
      bulbs: { red: bulbAt(-0.36), yellow: bulbAt(0), green: bulbAt(0.36) },
      halo, halos: { red: bulbAt(-0.36, 0.26), yellow: bulbAt(0, 0.26), green: bulbAt(0.36, 0.26) },
      geo: {
        pole: new THREE.CylinderGeometry(0.11, 0.15, SIGNAL_POLE.height, 10), arm: new THREE.BoxGeometry(0.12, 0.12, 1),
        lamp: new THREE.BoxGeometry(0.6, 0.18, 0.35), plane: new THREE.PlaneGeometry(1, 1), housing: new THREE.BoxGeometry(1.15, 0.42, 0.34),
        hanger: new THREE.BoxGeometry(0.05, SIGNAL_POLE.height - SIGNAL_POLE.head - 0.25, 0.05), bulb: new THREE.CircleGeometry(0.13, 20), halo: new THREE.PlaneGeometry(0.75, 0.75), paint: new THREE.BoxGeometry(1, 0.02, 1),
      },
    };
  }, []);
  const bulbs = useRef<Record<"red" | "yellow" | "green", THREE.InstancedMesh | null>>({ red: null, yellow: null, green: null });
  const halos = useRef<Record<"red" | "yellow" | "green", THREE.InstancedMesh | null>>({ red: null, yellow: null, green: null });
  const shown = useRef("");
  useFrame(() => {
    const d = state.darkness;
    assets.lamp.emissiveIntensity = d * 4;
    assets.glow.opacity = d * 0.5;
    // The glow round a lit light is always there, and shows more at night.
    assets.halo.opacity = 0.35 + d * 0.6;
    const x = signalState("x", state.elapsed), z = signalState("z", state.elapsed), key = `${x}${z}`;
    if (key === shown.current && bulbs.current.red?.instanceColor && halos.current.red?.instanceColor) return;
    shown.current = key;
    for (const colour of ["red", "yellow", "green"] as const) {
      const mesh = bulbs.current[colour];
      if (!mesh) continue;
      const glow = halos.current[colour];
      SIGNAL_POLES.forEach((s, i) => {
        const on = (s.axis === "x" ? x : z) === colour;
        mesh.setColorAt(i, on ? LIT[colour] : DARK[colour]);
        glow?.setColorAt(i, on ? LIT[colour] : NO_HALO);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (glow?.instanceColor) glow.instanceColor.needsUpdate = true;
    }
  });
  const { geo } = assets;
  return <>
    <Instances geometry={geo.pole} material={assets.iron} items={assets.poles} />
    <Instances geometry={geo.arm} material={assets.iron} items={assets.arms} />
    <Instances geometry={geo.lamp} material={assets.lamp} items={assets.lamps} />
    <Instances geometry={geo.plane} material={assets.glow} items={assets.glows} />
    <Instances geometry={geo.housing} material={assets.housing} items={assets.housings} />
    <Instances geometry={geo.hanger} material={assets.iron} items={assets.hangers} />
    {(["red", "yellow", "green"] as const).map((c) => <Instances key={c} geometry={geo.bulb} material={assets.bulb} items={assets.bulbs[c]} refOut={(m) => { bulbs.current[c] = m; }} />)}
    {(["red", "yellow", "green"] as const).map((c) => <Instances key={`halo${c}`} geometry={geo.halo} material={assets.halo} items={assets.halos[c]} refOut={(m) => { halos.current[c] = m; }} />)}
    <Instances geometry={geo.paint} material={assets.paint} items={assets.stripes} />
    <Instances geometry={geo.paint} material={assets.paint} items={assets.stops} />
    <RigidBody type="fixed" colliders={false}>
      {SIGNAL_POLES.map((s, i) => <CuboidCollider key={i} args={[0.15, SIGNAL_POLE.height / 2, 0.15]} position={[s.x, SIGNAL_POLE.height / 2, s.z]} />)}
    </RigidBody>
  </>;
}
