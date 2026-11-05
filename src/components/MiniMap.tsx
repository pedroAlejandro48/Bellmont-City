import { useEffect, useRef, useState } from "react";
import { BLOCK, HALF, blockCenter, blockIndex } from "@/game/config";
import { routeTarget, routeTo } from "@/game/route";
import type { GameState } from "@/game/state";
import { watchTouchMode } from "@/game/touchMode";

/** How many metres the round map shows from its centre to its edge. */
const REACH = 95;

/**
 * While a place is marked: a round map (above the touch buttons, or bottom right) turned the way the camera looks,
 * you as a white arrow in the middle, and the fastest way there as a blue line — straight on foot (through anything),
 * along the streets on a vehicle. It goes away once you're there (the waypoint is cleared on arrival).
 */
export function MiniMap({ state }: { state: GameState }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [touch, setTouch] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => watchTouchMode(setTouch), []);
  useEffect(() => {
    let id = 0, route: { key: string; pts: [number, number][] } | null = null, last = 0;
    const draw = (now: number) => {
      id = requestAnimationFrame(draw);
      const w = state.waypoint, on = !!w && !state.home;
      setShown((s) => (s === on ? s : on));
      const c = canvas.current;
      if (!on || !w || !c || now - last < 66) return;
      last = now;
      const g = c.getContext("2d");
      if (!g) return;
      const vehicle = state.scooter.riding, p = state.pos;
      // The route, worked out again every half second (or when the target or the way of travelling changes).
      const key = `${w.x},${w.z},${vehicle}`;
      if (!route || route.key !== key || now % 500 < 70) route = { key, pts: routeTo([p.x, p.z], [w.x, w.z], vehicle) };
      const pts = route.pts.slice(); pts[0] = [p.x, p.z];
      const S = c.width, R = S / 2, k = R / REACH;
      // Turned so the camera's forward is up.
      const fx = -Math.sin(state.camYaw), fz = -Math.cos(state.camYaw), turn = -Math.PI / 2 - Math.atan2(fz, fx);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, S, S);
      g.save();
      g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2); g.clip();
      g.fillStyle = "#2b2f37"; g.fillRect(0, 0, S, S);
      g.translate(R, R); g.rotate(turn); g.scale(k, k); g.translate(-p.x, -p.z);
      // The blocks round about (the park green), the streets between them.
      const bi = blockIndex(p.x), bj = blockIndex(p.z);
      for (let i = bi - 3; i <= bi + 3; i++) for (let j = bj - 3; j <= bj + 3; j++) {
        if (Math.abs(i) > HALF || Math.abs(j) > HALF) continue;
        const cx = blockCenter(i), cz = blockCenter(j);
        g.fillStyle = "#8d94a0"; g.fillRect(cx - BLOCK / 2, cz - BLOCK / 2, BLOCK, BLOCK);
        g.fillStyle = i === 0 && j === 0 ? "#4f8f52" : "#5d636e"; g.fillRect(cx - BLOCK / 2 + 4, cz - BLOCK / 2 + 4, BLOCK - 8, BLOCK - 8);
      }
      // The route.
      g.strokeStyle = "#2f7bff"; g.lineWidth = 5 / k; g.lineJoin = "round"; g.lineCap = "round";
      g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z))); g.stroke();
      const [tx, tz] = routeTarget(w.x, w.z, vehicle);
      g.fillStyle = "#ffffff"; g.beginPath(); g.arc(tx, tz, 6 / k, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#2f7bff"; g.beginPath(); g.arc(tx, tz, 4 / k, 0, Math.PI * 2); g.fill();
      g.restore();
      // You: a white arrow in the middle, pointing the way you face.
      const yaw = vehicle ? state.scooter.yaw : state.rotY, hx = Math.sin(yaw), hz = Math.cos(yaw);
      const a = Math.atan2(hz, hx) + turn + Math.PI / 2;
      g.save(); g.translate(R, R); g.rotate(a);
      g.fillStyle = "#ffffff"; g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 8); g.lineTo(0, 3); g.lineTo(-8, 8); g.closePath(); g.fill(); g.stroke();
      g.restore();
      g.strokeStyle = "rgba(255,255,255,0.85)"; g.lineWidth = 3; g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2); g.stroke();
    };
    id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [state]);
  return <canvas ref={canvas} width={256} height={256} className={`minimap ${touch ? "touch" : ""} ${shown ? "on" : ""}`} aria-label="Route map" />;
}
