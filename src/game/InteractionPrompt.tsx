import { Billboard, Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { SCOOTER_PROMPT_FADE_SECONDS } from "./config";

/**
 * What a sign says: only the key (E, Q…). The few signs with words: an apartment door's LOCKED / UNLOCKED, the
 * elevator COMING, and a delivery's PICK UP / DROP OFF. Anything else that's only words (no key) isn't shown.
 */
export function signText(label: string | undefined): string | null {
  if (label === undefined) return "E";
  const t = label.trim();
  const key = /^([A-Z0-9])(\s+|$)/.exec(t)?.[1] ?? null;
  const kept = /\b(UNLOCKED|LOCKED|COMING|PICK UP|DROP OFF)$/.exec(t)?.[1];
  if (kept) return key ? `${key}  ${kept}` : kept;
  return key;
}
/** A key hint (still, not bobbing) ("E" by default; `label` shows a word instead, such as "CLOSED"), always the same size on screen however near or far (first person too). */
export function InteractionPrompt({ sample }: { sample: () => { visible: boolean; x: number; y: number; z: number; time: number; label?: string | undefined } }) {
  const group = useRef<THREE.Group>(null), label = useRef<HTMLDivElement>(null), alpha = useRef(0);
  useFrame((_, dt) => {
    const p0 = sample(), shown = p0.visible ? signText(p0.label) : null, p = { ...p0, visible: p0.visible && shown !== null, label: shown ?? undefined }, target = Number(p.visible);
    alpha.current += Math.sign(target - alpha.current) * Math.min(Math.abs(target - alpha.current), dt / SCOOTER_PROMPT_FADE_SECONDS);
    if (p.visible) group.current?.position.set(p.x, p.y, p.z);
    const el = label.current;
    if (el) {
      el.style.opacity = String(alpha.current); el.style.visibility = alpha.current ? "visible" : "hidden";
      if (p.visible) {
        const text = p.label ?? "E";
        if (el.textContent !== text) { el.textContent = text; el.classList.toggle("wide", text.length > 1); el.setAttribute("aria-label", text === "E" ? "Press E to interact" : text); }
      }
    }
  });
  return <group ref={group}><Billboard><Html center zIndexRange={[9, 0]}><div ref={label} className="scooter-key" aria-label="Press E to interact">E</div></Html></Billboard></group>;
}
