import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/** Height of the label's text in the world (m), and how far above the player's feet it floats. */
const TEXT_HEIGHT = 0.26;
export const LABEL_HEIGHT = 2.2;
const FONT = '"Special Elite", "Courier New", Courier, monospace';
const PX = 96;

function drawName(canvas: HTMLCanvasElement, name: string) {
  const ctx = canvas.getContext("2d")!;
  ctx.font = `${PX}px ${FONT}`;
  const width = Math.ceil(ctx.measureText(name).width) + PX;
  canvas.width = width;
  canvas.height = Math.ceil(PX * 1.5);
  ctx.font = `${PX}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // White typewriter text with no background; a faint shadow keeps it readable against a bright sky.
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = PX * 0.08;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(name, width / 2, canvas.height / 2);
  return width / canvas.height;
}

/**
 * Another player's username, floating still above their head and always facing the camera. It is part of the
 * scene, so anything between it and the camera (trees, lamps, vehicles, buildings, benches) hides it.
 */
export function NameLabel({ name, follow }: { name: string; follow: () => THREE.Object3D | null }) {
  const sprite = useRef<THREE.Sprite>(null);
  const { material, canvas, texture } = useMemo(() => {
    const canvas = document.createElement("canvas");
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false });
    return { material, canvas, texture };
  }, []);

  useEffect(() => {
    let live = true;
    const paint = () => {
      if (!live) return;
      const aspect = drawName(canvas, name);
      texture.needsUpdate = true;
      sprite.current?.scale.set(TEXT_HEIGHT * 1.5 * aspect, TEXT_HEIGHT * 1.5, 1);
    };
    paint();
    // Repaint once the typewriter font has loaded (the first paint may use the fallback).
    void document.fonts?.load(`${PX}px ${FONT}`).then(paint, () => {});
    return () => { live = false; };
  }, [name, canvas, texture]);
  useEffect(() => () => { material.dispose(); texture.dispose(); }, [material, texture]);

  useFrame(() => {
    const target = follow(), s = sprite.current;
    if (!s) return;
    s.visible = !!target && target.parent?.visible !== false;
    if (target) s.position.set(target.position.x, target.position.y + LABEL_HEIGHT, target.position.z);
  });

  return <sprite ref={sprite} material={material} renderOrder={1} />;
}
