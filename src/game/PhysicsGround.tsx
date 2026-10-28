import { BallCollider, CuboidCollider, RigidBody } from "@react-three/rapier";
import { BLOCK, SIDEWALK_H, PARK_OBELISK_HEIGHT, PARK_BENCHES, PARK_ARCH, type City } from "./config";

export function PhysicsGround({ city, x, z }: { city: City; x: number; z: number }) {
  return <RigidBody type="fixed" colliders={false}>
    <CuboidCollider args={[500, 0.5, 500]} position={[x, -0.5, z]} friction={1.2} />
    {city.blocks.map((b) => <CuboidCollider key={`p${b.x}:${b.z}`} args={[BLOCK / 2, SIDEWALK_H / 2, BLOCK / 2]} position={[b.x, SIDEWALK_H / 2, b.z]} />)}
    {city.buildings.map((b) => <CuboidCollider key={`b${b.x}:${b.z}`} args={[b.w / 2, b.h / 2, b.d / 2]} position={[b.x, b.h / 2 + SIDEWALK_H, b.z]} />)}
    {city.trees.map((t) => <CuboidCollider key={`t${t.x}:${t.z}`} args={[0.25, 2, 0.25]} position={[t.x, 2, t.z]} />)}
    {city.lamps.map((l) => <CuboidCollider key={`l${l.x}:${l.z}`} args={[0.15, 3, 0.15]} position={[l.x, 3, l.z]} />)}
    {city.blocks.some((b) => b.x === 0 && b.z === 0) && <>
      {PARK_BENCHES.map((b, i) => <CuboidCollider key={`bench${i}`} args={[1.3, 0.7, 0.4]} position={[b.x, 0.85, b.z]} rotation={[0, b.rot, 0]} />)}
      {[-1, 1].map((s) => <CuboidCollider key={`arch${s}`} args={[(PARK_ARCH.outer - PARK_ARCH.inner) / 2, PARK_ARCH.spring / 2, PARK_ARCH.depth / 2]} position={[s * (PARK_ARCH.outer + PARK_ARCH.inner) / 2, SIDEWALK_H + PARK_ARCH.spring / 2, PARK_ARCH.z]} />)}
      {Array.from({ length: 17 }, (_, i) => { const angle = i / 16 * Math.PI, radius = (PARK_ARCH.outer + PARK_ARCH.inner) / 2; return <BallCollider key={`arc${i}`} args={[0.32]} position={[Math.cos(angle) * radius, SIDEWALK_H + PARK_ARCH.spring + Math.sin(angle) * radius, PARK_ARCH.z]} />; })}
      <CuboidCollider args={[1.25, 0.2, 1.25]} position={[0, 0.35, 0]} />
    </>}
    {city.blocks.some((b) => b.x === 0 && b.z === 0) && <CuboidCollider args={[0.65, PARK_OBELISK_HEIGHT / 2, 0.65]} position={[0, PARK_OBELISK_HEIGHT / 2, 0]} />}
  </RigidBody>;
}