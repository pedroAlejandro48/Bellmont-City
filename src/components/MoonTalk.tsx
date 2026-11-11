import { useEffect, useRef, useState } from "react";
import { timeInfo } from "@/game/config";
import { ROUNDS, blushFor, choices, goodbye, greeting, moonFor, say, stageOf, startTalk, type Line, type Mood } from "@/game/moon";
import { drawMoonFace } from "@/game/moonFace";
import type { GameState } from "@/game/state";

/** Outside at night, on foot (or sat on a bench), nothing else open: the moon is there to talk to. */
function canTalk(s: GameState) {
  const ti = timeInfo(s.elapsed);
  return !ti.isDay && ti.darkness > 0.55 && !s.interior && !s.level && !s.scooter.riding && !s.scooter.action && !s.accident && s.health > 0
    && !s.phone.open && !s.shop && !s.foodUi.open && !s.inventoryOpen && (!s.uiLock || s.uiLock === "moon") && !s.seat;
}

/**
 * Talking to the moon (M, or the 🌙 button at night outdoors): the camera looks up at her past you, her face shows
 * on the moon, and you choose what to say; she answers and reacts. Three things a night — then she wants you back
 * tomorrow. A woman's moon is a man (Lucio); anyone else's is a woman (Luna).
 */
export function MoonTalk({ state }: { state: GameState }) {
  const [, tick] = useState(0);
  const [open, setOpen] = useState(false);
  const [line, setLine] = useState("");
  const [mood, setMood] = useState<Mood>("neutral");
  const [opts, setOpts] = useState<Line[]>([]);
  const [done, setDone] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const face = useRef<HTMLCanvasElement>(null);
  const who = moonFor(state.gender), bond = state.life.moon;
  const r = Math.random;

  useEffect(() => { const id = window.setInterval(() => tick((n) => n + 1), 250); return () => window.clearInterval(id); }, []);
  const available = canTalk(state);

  // The camera: from behind and below you, up at her; you turn to face her.
  const frame = () => {
    const d = state.moonDir, p = state.pos, h = Math.hypot(d.x, d.z) || 1, bx = -d.x / h, bz = -d.z / h;
    state.rotY = Math.atan2(d.x, d.z);
    // (Aimed a little to the moon's right and below it, so she shows up and to the left of the talk panel.)
    const wide = window.innerWidth > 700, rx = -bz, rz = bx, side = wide ? 11 : 0, down = wide ? 6 : 10;
    state.camLock = { pos: [p.x + bx * 2.6, p.y + 1.05, p.z + bz * 2.6], at: [p.x + d.x * 40 - rx * side, p.y + 1.6 + d.y * 40 - down, p.z + d.z * 40 - rz * side], by: "moon" };
  };
  const show = (m: Mood, aff: number) => { setMood(m); state.moonFace = { mood: m, blush: blushFor(aff, m), until: Infinity }; };
  const start = () => {
    if (!canTalk(state)) return;
    const b = startTalk(state.life.moon, timeInfo(state.elapsed).day);
    state.life.moon = b;
    state.uiLock = "moon"; state.keys.clear();
    frame();
    setOpen(true); setSaid(null);
    if (b.talkedTonight >= ROUNDS) { setLine("It's late… come and see me tomorrow night."); show(stageOf(b.affection) === "cool" ? "neutral" : "smile", b.affection); setOpts([]); setDone(true); return; }
    setLine(greeting(b, r)); show(stageOf(b.affection) === "cool" ? "neutral" : "smile", b.affection); setOpts(choices(state.gender, r)); setDone(false);
  };
  const close = () => {
    setOpen(false);
    if (state.uiLock === "moon") state.uiLock = null;
    if (state.camLock?.by === "moon") state.camLock = null;
    if (state.moonFace) state.moonFace = { ...state.moonFace, until: state.simulationTime + 12 };
  };
  const choose = (l: Line) => {
    const res = say(state.life.moon, l, r);
    const b = { ...res.bond, talkedTonight: res.bond.talkedTonight + 1 };
    state.life.moon = b;
    setSaid(l.text); setLine(res.reply); show(res.mood, b.affection);
    if (b.talkedTonight >= ROUNDS) { setOpts([]); setDone(true); window.setTimeout(() => setLine((x) => `${x}\n\n${goodbye(b)}`), 1400); }
    else setOpts(choices(state.gender, r));
  };

  // M opens it (and closes it); Escape closes it.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === "KeyM" && !e.repeat) { if (open) close(); else if (canTalk(state)) start(); }
      if (e.code === "Escape" && open) close();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  // Day breaks, or something takes over: the talk ends.
  useEffect(() => { if (open && !canTalk(state)) close(); });
  // Her face in the panel.
  useEffect(() => {
    const c = face.current, g = c?.getContext("2d");
    if (c && g) drawMoonFace(g, c.width, mood, blushFor(state.life.moon.affection, mood), who.she, true);
  });

  const hearts = Math.round(bond.affection / 20);
  return <>
    {available && !open && <button type="button" className="moon-button" onClick={start} aria-label={`Talk to ${who.name}`}>🌙 <span>Talk to the moon</span> <kbd>M</kbd></button>}
    {open && <div className="moon-talk" role="dialog" aria-label={`Talking to ${who.name}`}>
      <div className="moon-head">
        <canvas ref={face} width={128} height={128} className="moon-face" />
        <div>
          <b>{who.name}</b>
          <div className="moon-hearts" aria-label={`Bond ${Math.round(bond.affection)} of 100`}>{Array.from({ length: 5 }, (_, i) => <span key={i} className={i < hearts ? "on" : ""}>♥</span>)}</div>
        </div>
        <button type="button" className="moon-close" onClick={close} aria-label="Close">✕</button>
      </div>
      {said && <p className="moon-said">“{said}”</p>}
      <p className="moon-line">{line}</p>
      {!done && <div className="moon-options">{opts.map((o, i) => <button key={i} type="button" onClick={() => choose(o)}>{o.text}</button>)}</div>}
      {done && <button type="button" className="moon-bye" onClick={close}>Goodnight</button>}
    </div>}
  </>;
}
