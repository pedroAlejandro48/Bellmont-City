import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/** Height of the label's text in the world (m), and how far above the player's feet it floats. */
const TEXT_HEIGHT = 0.26;
export const LABEL_HEIGHT = 2.2;
const FONT = '"Special Elite", "Courier New", Courier, monospace';
const PX = 96;

/** The room creator's little yellow crown, drawn with its left edge at x and centred on y. */
function drawCrown(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const w = size, h = size * 0.72, top = y - h / 2, base = y + h / 2;
  ctx.beginPath();
  ctx.moveTo(x, base);
  ctx.lineTo(x, top + h * 0.25);
  ctx.lineTo(x + w * 0.27, top + h * 0.55);
  ctx.lineTo(x + w * 0.5, top);
  ctx.lineTo(x + w * 0.73, top + h * 0.55);
  ctx.lineTo(x + w, top + h * 0.25);
  ctx.lineTo(x + w, base);
  ctx.closePath();
  ctx.fillStyle = "#facc15";
  ctx.fill();
}

/** Every label's image has the same size, so its texture never needs reallocating when the font loads. */
const CANVAS_W = 2048, CANVAS_H = Math.ceil(PX * 1.5);

function drawName(canvas: HTMLCanvasElement, name: string, crown: boolean) {
  const ctx = canvas.getContext("2d")!;
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.font = `${PX}px ${FONT}`;
  const crownSize = PX * 0.8, gap = PX * 0.25;
  // Names up to 24 characters fit; anything wider is scaled down to the image.
  const textWidth = Math.min(Math.ceil(ctx.measureText(name).width), CANVAS_W - PX - (crown ? crownSize + gap : 0));
  const content = textWidth + (crown ? crownSize + gap : 0);
  const width = CANVAS_W;
  // White typewriter text with no background; a faint shadow keeps it readable against a bright sky.
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = PX * 0.08;
  const left = (width - content) / 2, mid = canvas.height / 2;
  if (crown) drawCrown(ctx, left, mid, crownSize);
  ctx.font = `${PX}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(name, left + (crown ? crownSize + gap : 0), mid, textWidth);
  return width / canvas.height;
}

/**
 * Another player's username, floating still above their head and always facing the camera. It is part of the
 * scene, so anything between it and the camera (trees, lamps, vehicles, buildings, benches) hides it.
 */
export function NameLabel({ name, crown = false, follow }: { name: string; crown?: boolean; follow: () => THREE.Object3D | null }) {
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
      const aspect = drawName(canvas, name, crown);
      texture.needsUpdate = true;
      sprite.current?.scale.set(TEXT_HEIGHT * 1.5 * aspect, TEXT_HEIGHT * 1.5, 1);
    };
    paint();
    // Repaint once the typewriter font has loaded (the first paint may use the fallback).
    void document.fonts?.load(`${PX}px ${FONT}`).then(paint, () => {});
    return () => { live = false; };
  }, [name, crown, canvas, texture]);
  useEffect(() => () => { material.dispose(); texture.dispose(); }, [material, texture]);

  useFrame(() => {
    const target = follow(), s = sprite.current;
    if (!s) return;
    s.visible = !!target && target.parent?.visible !== false;
    if (target) s.position.set(target.position.x, target.position.y + LABEL_HEIGHT, target.position.z);
  });

  return <sprite ref={sprite} material={material} renderOrder={1} />;
}
