import { Billboard, Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { SCOOTER_PROMPT_FADE_SECONDS } from "./config";

/** A floating key hint ("E" by default; `label` shows a word instead, such as "CLOSED"). */
export function InteractionPrompt({ sample }: { sample: () => { visible: boolean; x: number; y: number; z: number; time: number; label?: string | undefined } }) {
  const group = useRef<THREE.Group>(null), label = useRef<HTMLDivElement>(null), alpha = useRef(0);
  useFrame((_, dt) => {
    const p = sample(), target = Number(p.visible);
    alpha.current += Math.sign(target - alpha.current) * Math.min(Math.abs(target - alpha.current), dt / SCOOTER_PROMPT_FADE_SECONDS);
    if (p.visible) group.current?.position.set(p.x, p.y + Math.sin(p.time * 2.6) * 0.06, p.z);
    const el = label.current;
    if (el) {
      el.style.opacity = String(alpha.current); el.style.visibility = alpha.current ? "visible" : "hidden";
      if (p.visible) {
        const text = p.label ?? "E";
        if (el.textContent !== text) { el.textContent = text; el.classList.toggle("wide", text.length > 1); el.setAttribute("aria-label", text === "E" ? "Press E to interact" : text); }
      }
    }
  });
  return <group ref={group}><Billboard><Html center distanceFactor={7} zIndexRange={[9, 0]}><div ref={label} className="scooter-key" aria-label="Press E to interact">E</div></Html></Billboard></group>;
}
