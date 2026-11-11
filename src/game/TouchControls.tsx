import { useEffect, useRef, useState } from "react";
import type { GameState } from "./state";
import { watchTouchMode } from "./touchMode";

/** The joystick's travel (px from its centre to the edge the knob can reach). */
const REACH = 46;

/**
 * Touchscreen controls: a joystick bottom left (above the health bars when upright, level with them when on its
 * side) and E and Q bottom right. Moving the joystick walks or rides like the arrow keys, its push setting the pace
 * (right to the edge runs); the rest of the screen turns the view with another finger.
 */
export function TouchControls({ state }: { state: GameState }) {
  const [show, setShow] = useState(false);
  useEffect(() => watchTouchMode(setShow), []);
  useEffect(() => { if (!show) state.stick = null; }, [show, state]);
  useEffect(() => () => { state.stick = null; }, [state]);
  if (!show) return null;
  return <>
    <Joystick state={state} />
    <div className="touch-buttons pointer-events-none fixed z-20 flex items-center gap-3" aria-label="Actions">
      <ActionButton label="⤒" title="Jump (Space)" onPress={() => {
        if (state.health === 0 || state.accident) return;
        // Like Space: up from a seat, otherwise a jump (not on the bike).
        if (state.seat || state.script) { state.standQueued = true; return; }
        if (state.bench || state.scooter.riding || state.scooter.action) return;
        state.jumpQueued = true;
      }} />
      <ActionButton label="Q" title="Put down (Q)" onPress={() => { if (state.health > 0 && !state.accident) state.dropQueued = true; }} />
      <ActionButton label="E" title="Interact (E)" primary onPress={() => {
        if (state.health === 0 || state.accident) return;
        // Sitting at a table there's no Space key to get up with: E does it.
        if (state.seat) state.standQueued = true; else state.interactQueued = true;
      }} />
    </div>
  </>;
}

function ActionButton({ label, title, primary, onPress }: { label: string; title: string; primary?: boolean; onPress: () => void }) {
  const [down, setDown] = useState(false);
  return <button type="button" aria-label={title}
    className={`pointer-events-auto flex h-16 w-16 select-none items-center justify-center rounded-full border-2 font-sans text-2xl font-extrabold shadow-lg transition-transform ${primary ? "border-[#ffb547] bg-[#ffb547]/85 text-[#1b1206]" : "border-white/70 bg-black/45 text-white"} ${down ? "scale-90" : ""}`}
    style={{ touchAction: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setDown(true); onPress(); }}
    onPointerUp={() => setDown(false)} onPointerCancel={() => setDown(false)} onPointerLeave={() => setDown(false)}
    onContextMenu={(e) => e.preventDefault()}>{label}</button>;
}

/**
 * The joystick appears right under the finger wherever the bottom-left of the screen is touched (it rests, faded,
 * at its usual spot until then), and follows the finger's push from there.
 */
function Joystick({ state }: { state: GameState }) {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const finger = useRef<number | null>(null);
  const centre = useRef({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const place = (clientX: number, clientY: number) => {
    let dx = clientX - centre.current.x, dy = clientY - centre.current.y;
    const d = Math.hypot(dx, dy);
    if (d > REACH) { dx *= REACH / d; dy *= REACH / d; }
    if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
    state.stick = { x: dx / REACH, y: -dy / REACH };
  };
  const end = () => {
    finger.current = null; state.stick = null; setActive(false);
    const b = base.current;
    if (b) { b.style.left = ""; b.style.top = ""; b.style.bottom = ""; }
    if (knob.current) knob.current.style.transform = "translate(0px, 0px)";
  };
  return <div role="application" aria-label="Movement joystick"
    className="touch-zone pointer-events-auto fixed bottom-0 left-0 z-[5]"
    style={{ touchAction: "none", WebkitUserSelect: "none" }}
    onPointerDown={(e) => {
      if (finger.current !== null || e.pointerType === "mouse" || state.uiLock) return;
      e.preventDefault(); e.stopPropagation();
      if (document.pointerLockElement) document.exitPointerLock();
      finger.current = e.pointerId;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* fine */ }
      // Centred under the finger (kept fully on screen).
      const half = 64, x = Math.max(half + 4, Math.min(window.innerWidth - half - 4, e.clientX)), y = Math.max(half + 4, Math.min(window.innerHeight - half - 4, e.clientY));
      centre.current = { x, y };
      const b = base.current;
      if (b) { b.style.left = `${x - half}px`; b.style.top = `${y - half}px`; b.style.bottom = "auto"; }
      setActive(true);
      place(e.clientX, e.clientY);
    }}
    onPointerMove={(e) => { if (e.pointerId === finger.current) place(e.clientX, e.clientY); }}
    onPointerUp={(e) => { if (e.pointerId === finger.current) end(); }}
    onPointerCancel={(e) => { if (e.pointerId === finger.current) end(); }}
    onLostPointerCapture={(e) => { if (e.pointerId === finger.current) end(); }}>
    <div ref={base} data-stick className={`touch-stick pointer-events-none fixed h-32 w-32 rounded-full border-2 border-white/45 bg-black/30 shadow-lg backdrop-blur-[2px] transition-opacity ${active ? "opacity-100" : "opacity-45"}`}>
      {/* The top half: walk ahead and the camera swings round behind. */}
      <div className="absolute inset-x-3 top-1/2 h-px bg-white/15" />
      <div ref={knob} className="absolute left-1/2 top-1/2 -ml-7 -mt-7 h-14 w-14 rounded-full border-2 border-white/80 bg-white/55 shadow-md" />
    </div>
  </div>;
}
