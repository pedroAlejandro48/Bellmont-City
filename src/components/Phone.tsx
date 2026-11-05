import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Banknote, Briefcase, CircleUser, ListChecks, Map as MapIcon, X } from "lucide-react";
import { HALF, blockCenter, formatClock, generateCity, timeInfo, BLOCK } from "@/game/config";
import { FINE_DAYS, finesOwed, payFines, GUIDE, JOBS, QUEST_TEXT, SKILLS, SKILL_NAMES, borrow, deposit, levelOf, loanLimit, repay, skillLevel, withdraw, type JobId } from "@/game/life";
import { canStart, quitJob, startJob } from "@/game/jobs";
import { ATMS, BUSK_SPOT, doorOf } from "@/game/places";
import { guideDone, lifeEvent } from "@/game/lifeRuntime";
import { toast, type GameState } from "@/game/state";
import { WEATHER_NAME } from "@/game/weather";
import { SHOPS, shopPlaces } from "@/game/shops";

const money = (n: number) => `$${n.toFixed(2)}`;
const APPS = [
  { id: "bank", name: "Bank", icon: Banknote, color: "#1f5fbf" },
  { id: "jobs", name: "Jobs", icon: Briefcase, color: "#e07a1f" },
  { id: "map", name: "Map", icon: MapIcon, color: "#2e9d5b" },
  { id: "goals", name: "Goals", icon: ListChecks, color: "#d6455d" },
  { id: "profile", name: "Profile", icon: CircleUser, color: "#3a8fb7" },
] as const;

/** The phone is drawn at 360 × 640 (9:16) and scaled: the whole screen's height on a phone held sideways, half the
 * height on a computer or a phone held upright. */
export const PHONE_SIZE = { w: 360, h: 640 };
function usePhoneScale() {
  const pick = () => {
    const touch = window.matchMedia("(pointer: coarse)").matches, sideways = window.innerWidth > window.innerHeight;
    const height = touch && sideways ? window.innerHeight - 16 : window.innerHeight * 0.5;
    return Math.max(0.3, height / PHONE_SIZE.h);
  };
  const [s, setS] = useState(pick);
  useEffect(() => { const on = () => setS(pick()); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, []);
  return s;
}

/**
 * The in-game phone: opened with P (or the phone button), or by walking up to an ATM (the Bank app, with cash).
 * It slides up; each app slides in over the home screen. Everything reads and changes `state` directly, and the
 * phone redraws a few times a second.
 */
export function Phone({ state }: { state: GameState }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick((n) => n + 1), 250); return () => window.clearInterval(id); }, []);
  const ph = state.phone, open = ph.open;
  const close = () => { state.phone = { open: false, app: null, atm: false }; tick((n) => n + 1); };
  const go = (app: string | null) => { state.phone = { ...state.phone, app }; tick((n) => n + 1); };
  const { hours, day } = timeInfo(state.elapsed);
  const app = APPS.find((a) => a.id === ph.app);
  const scale = usePhoneScale();
  return <div className={`phone ${open ? "open" : ""}`} style={{ "--phone-scale": scale } as React.CSSProperties} aria-hidden={!open} role="dialog" aria-label="Phone">
    <div className="phone-status"><span>{formatClock(hours)}</span><span>Day {day} · {WEATHER_NAME[state.weather.kind]}</span><span>{money(state.cash)} cash</span></div>
    <div className="phone-screen">
      <div className={`phone-page phone-home ${ph.app ? "behind" : ""}`}>
        {state.life.guide < GUIDE.length && <button type="button" className="phone-guide" onClick={() => go("goals")}>
          <span className="phone-guide-step">Getting started · {state.life.guide + 1}/{GUIDE.length}</span>
          <span>{GUIDE[state.life.guide]!.text}</span>
        </button>}
        <div className="phone-grid">
          {APPS.map((a) => <button key={a.id} type="button" className="phone-app" onClick={() => go(a.id)}>
            <span className="phone-icon" style={{ background: a.color }}><a.icon size={26} /></span><span>{a.name}</span>
          </button>)}
        </div>
        {state.job && <div className="phone-card"><b>{JOBS[state.job.id].name}</b><span>{state.waypoint?.label ?? ""}</span><button type="button" className="phone-btn ghost" onClick={() => { quitJob(state); tick((n) => n + 1); }}>Quit job</button></div>}
      </div>
      <div className={`phone-page phone-appview ${ph.app ? "in" : ""}`}>
        {app && <>
          <div className="phone-appbar"><button type="button" aria-label="Back" onClick={() => go(null)}><ArrowLeft size={18} /></button><b>{app.name}</b><span /></div>
          <div className="phone-body">
            {ph.app === "bank" && <BankApp state={state} atm={ph.atm} />}
            {ph.app === "jobs" && <JobsApp state={state} onDone={close} />}
            {ph.app === "map" && <MapApp state={state} onPick={close} />}
            {ph.app === "goals" && <GoalsApp state={state} />}
            {ph.app === "profile" && <ProfileApp state={state} />}
          </div>
        </>}
      </div>
    </div>
    <button type="button" className="phone-close" aria-label="Close phone" onClick={close}><X size={18} /></button>
  </div>;
}

function BankApp({ state, atm }: { state: GameState; atm: boolean }) {
  const [, tick] = useState(0), life = state.life, day = timeInfo(state.elapsed).day;
  const refresh = () => tick((n) => n + 1);
  const limit = loanLimit(life);
  return <>
    <div className="bank-card"><span>Bellmont Bank · Checking</span><b>{money(life.bank)}</b><span>Cash on you: {money(state.cash)}</span></div>
    {atm ? <>
      <p className="phone-label">ATM</p>
      <div className="phone-row">{[20, 50, 100].map((a) => <button key={a} type="button" className="phone-btn" disabled={life.bank < 0.01} onClick={() => { state.cash = withdraw(life, state.cash, a, day).cash; refresh(); }}>Take {money(a)}</button>)}</div>
      <div className="phone-row">
        <button type="button" className="phone-btn ghost" disabled={state.cash < 0.01} onClick={() => { state.cash = deposit(life, state.cash, state.cash, day).cash; refresh(); }}>Deposit all cash</button>
      </div>
    </> : <p className="phone-note">For cash, use an ATM (they're on the park's sidewalks; see the Map).</p>}
    {life.fines.length > 0 && <>
      <p className="phone-label">Tickets</p>
      <div className="phone-stat"><span>{life.fines.length} unpaid (due within {FINE_DAYS} days)</span><b className="bad">{money(finesOwed(life))}</b></div>
      <button type="button" className="phone-btn" disabled={life.bank < finesOwed(life)} onClick={() => { if (payFines(life, day)) toast(state, "Fines paid", "money"); refresh(); }}>Pay all tickets</button>
    </>}
    <p className="phone-label">Credit and loans</p>
    <div className="phone-stat"><span>Credit score</span><b className={life.credit >= 700 ? "good" : life.credit < 580 ? "bad" : ""}>{life.credit}</b></div>
    <div className="phone-stat"><span>Loan</span><b>{money(life.loan)}</b></div>
    <div className="phone-stat"><span>You can borrow up to</span><b>{money(Math.max(0, limit - life.loan))}</b></div>
    <div className="phone-row">
      <button type="button" className="phone-btn ghost" disabled={limit - life.loan < 50} onClick={() => { if (borrow(life, 100, day)) toast(state, "Loan approved", "money", "Repay soon: 2% interest a day."); refresh(); }}>Borrow $100</button>
      <button type="button" className="phone-btn ghost" disabled={life.loan <= 0 || life.bank <= 0} onClick={() => { repay(life, life.loan, day); refresh(); }}>Repay</button>
    </div>
    <p className="phone-label">Recent</p>
    <ul className="phone-list">{life.ledger.slice(0, 12).map((t, i) => <li key={i}><span>{t.label}<small>Day {t.day}</small></span><b className={t.amount >= 0 ? "good" : "bad"}>{t.amount >= 0 ? "+" : "−"}{money(Math.abs(t.amount))}</b></li>)}
      {life.ledger.length === 0 && <li className="phone-note">Nothing yet.</li>}</ul>
  </>;
}

function JobsApp({ state, onDone }: { state: GameState; onDone: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const { level } = levelOf(state.life.xp);
  return <>
    {state.job && <div className="phone-card"><b>Now: {JOBS[state.job.id].name}</b><span>{state.waypoint?.label}</span><button type="button" className="phone-btn ghost" onClick={() => { quitJob(state); setMsg(null); }}>Quit job</button></div>}
    {(Object.keys(JOBS) as JobId[]).map((id) => {
      const j = JOBS[id], why = canStart(state, id);
      return <div key={id} className="phone-job">
        <div><b>{j.name}</b> <small>{j.code}</small><p>{j.blurb}</p>{j.minLevel > level && <small className="bad">Unlocks at level {j.minLevel}</small>}</div>
        <button type="button" className="phone-btn" disabled={!!why} title={why ?? ""} onClick={() => { const r = startJob(state, id); if (r) setMsg(r); else onDone(); }}>Start</button>
      </div>;
    })}
    {msg && <p className="phone-note bad">{msg}</p>}
    <p className="phone-note">Pay goes into your bank, after 10% income tax. Tips are cash.</p>
  </>;
}

/** The city from above: blocks, the park, restaurants, ATMs, home, the busking spot; tap anywhere for a route. */
function MapApp({ state, onPick }: { state: GameState; onPick: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const city = useMemo(() => generateCity(state.worldSeed, 0, 0), [state.worldSeed]);
  const shops = useMemo(() => shopPlaces(state.worldSeed), [state.worldSeed]);
  const span = blockCenter(4) + BLOCK / 2 + 10;
  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const draw = () => {
      const g = c.getContext("2d")!, W = c.width, H = c.height, s = W / (2 * span);
      const X = (x: number) => W / 2 + x * s, Y = (z: number) => H / 2 + z * s;
      g.fillStyle = "#2a2d33"; g.fillRect(0, 0, W, H);
      for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
        const cx = blockCenter(i), cz = blockCenter(j);
        g.fillStyle = i === 0 && j === 0 ? "#3f7a43" : "#4a4f58";
        g.fillRect(X(cx - BLOCK / 2), Y(cz - BLOCK / 2), BLOCK * s, BLOCK * s);
      }
      const dot = (x: number, z: number, color: string, r = 4) => { g.fillStyle = color; g.beginPath(); g.arc(X(x), Y(z), r, 0, Math.PI * 2); g.fill(); };
      city.buildings.filter((b) => b.restaurant).forEach((b) => dot(b.x, b.z, "#ff9f43", 5));
      ATMS.forEach((a) => dot(a.x, a.z, "#4fb3ff", 3.5));
      dot(BUSK_SPOT.x, BUSK_SPOT.z, "#ffd166", 3.5);
      shops.forEach((s) => { dot(s.door.x, s.door.z, "#ffffff", 5); dot(s.door.x, s.door.z, SHOPS[s.kind].color === "#ffffff" ? "#d62f3a" : SHOPS[s.kind].color, 3.6); });
      // The apartment buildings (purple), and the one with your home ringed.
      city.buildings.filter((b) => b.venue === "apartments").forEach((b) => { const d = doorOf(b); dot(d.x, d.z, "#b388ff", 4.5); if (state.life.home?.building === `${b.x}:${b.z}`) { g.strokeStyle = "#ffffff"; g.lineWidth = 2; g.beginPath(); g.arc(X(d.x), Y(d.z), 8, 0, Math.PI * 2); g.stroke(); } });
      const w = state.waypoint;
      if (w) { g.strokeStyle = "#5ec8ff"; g.lineWidth = 2; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(X(state.pos.x), Y(state.pos.z)); g.lineTo(X(w.x), Y(w.z)); g.stroke(); g.setLineDash([]); dot(w.x, w.z, "#5ec8ff", 6); }
      // You: an arrow the way you face.
      const a = state.rotY; g.save(); g.translate(X(state.pos.x), Y(state.pos.z)); g.rotate(-a + Math.PI);
      g.fillStyle = "#ffffff"; g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.restore();
    };
    draw();
    const id = window.setInterval(draw, 300);
    return () => window.clearInterval(id);
  }, [city, shops, span, state]);
  const pick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), s = r.width / (2 * span);
    const x = (e.clientX - r.left - r.width / 2) / s, z = (e.clientY - r.top - r.height / 2) / s;
    if (Math.abs(x) > HALF * 60 || Math.abs(z) > HALF * 60) return;
    state.waypoint = { x, z, label: "Marked place" };
    onPick();
  };
  return <>
    <canvas ref={canvas} className="phone-map" width={600} height={600} onPointerDown={pick} />
    <div className="phone-legend"><span><i style={{ background: "#ff9f43" }} />Restaurants</span><span><i style={{ background: "#4fb3ff" }} />ATMs</span><span><i style={{ background: "#b388ff" }} />Apartments</span><span><i style={{ background: "#ffd166" }} />Busking</span><span><i style={{ background: "#fff", boxShadow: "inset 0 0 0 3px #2e9d5b" }} />Shops</span></div>
    <p className="phone-note">Tap the map to set a route. </p>
    {state.waypoint && <button type="button" className="phone-btn ghost" onClick={() => { state.waypoint = null; }}>Clear route</button>}
  </>;
}

function GoalsApp({ state }: { state: GameState }) {
  const life = state.life;
  return <>
    <p className="phone-label">Today</p>
    {life.quests.map((q, i) => <div key={i} className={`phone-quest ${q.done ? "done" : ""}`}>
      <span>{QUEST_TEXT[q.id](q)}</span><small>+${q.reward} · 25 XP</small>
      <div className="phone-bar"><i style={{ width: `${(100 * q.progress) / q.goal}%` }} /></div>
    </div>)}
    {life.guide < GUIDE.length && <>
      <p className="phone-label">Getting started</p>
      <ol className="phone-steps">{GUIDE.map((g, i) => <li key={i} className={i < life.guide ? "done" : i === life.guide ? "now" : ""}><b>{g.text}</b>{i === life.guide && <small>{g.hint}</small>}</li>)}</ol>
    </>}
  </>;
}

function ProfileApp({ state }: { state: GameState }) {
  const life = state.life, lv = levelOf(life.xp);
  return <>
    <div className="profile-level"><div className="ring" style={{ background: `conic-gradient(#ffb547 ${lv.progress * 360}deg, rgba(255,255,255,0.12) 0)` }}><b>{lv.level}</b></div>
      <div><b>Level {lv.level}</b><small>{Math.round(lv.into)} / {lv.need} XP to the next</small></div></div>
    <p className="phone-label">Skills</p>
    {SKILLS.map((s) => { const pts = life.skills[s], l = skillLevel(pts), next = 25 * (l + 1) ** 2, prev = 25 * l * l; return <div key={s} className="phone-quest">
      <span>{SKILL_NAMES[s]} <small>level {l}</small></span>
      <div className="phone-bar"><i style={{ width: `${l >= 10 ? 100 : (100 * (pts - prev)) / (next - prev)}%` }} /></div>
    </div>; })}
    <p className="phone-label">Record</p>
    <div className="phone-stat"><span>Earned from work</span><b>{money(life.earned)}</b></div>
    <div className="phone-stat"><span>Jobs done</span><b>{life.jobsDone}</b></div>
    <div className="phone-stat"><span>Credit score</span><b>{life.credit}</b></div>
    <div className="phone-stat"><span>Criminal record</span><b className={life.record ? "bad" : "good"}>{life.record || "Clean"}</b></div>
    <div className="phone-stat"><span>Health plan</span><b>{life.insured ? "On" : "None"}</b></div>
  </>;
}

/** Messages at the top of the screen: they slide in, wait a moment and slide away. */
export function Toasts({ state }: { state: GameState }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => { const now = performance.now(); state.toasts = state.toasts.filter((t) => now - t.at < 4600); tick((n) => n + 1); }, 200); return () => window.clearInterval(id); }, [state]);
  return <div className="toasts" aria-live="polite">{state.toasts.map((t) => <div key={t.id} className={`toast ${t.kind} ${performance.now() - t.at > 4100 ? "out" : ""}`}><b>{t.title}</b>{t.body && <span>{t.body}</span>}</div>)}</div>;
}

/** Where the GPS route goes: an arrow that turns with the camera, and how far. */
export function RouteHint({ state }: { state: GameState }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick((n) => n + 1), 120); return () => window.clearInterval(id); }, []);
  const w = state.waypoint;
  if (!w || state.home) return null;
  const dx = w.x - state.pos.x, dz = w.z - state.pos.z, d = Math.hypot(dx, dz);
  // The camera looks along camYaw + π: angle of the target relative to straight ahead on screen.
  const ang = Math.atan2(dx, dz) - (state.camYaw + Math.PI);
  return <div className="route-hint"><span className="route-arrow" style={{ transform: `rotate(${-ang}rad)` }}>▲</span><span><b>{d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`}</b> {w.label}</span></div>;
}

/** The level badge beside the cash: the level, with the progress to the next as a ring. */
export function LevelBadge({ state }: { state: GameState }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick((n) => n + 1), 500); return () => window.clearInterval(id); }, []);
  const lv = levelOf(state.life.xp);
  return <div className="hud-panel hud-square level-badge" aria-label={`Level ${lv.level}`}>
    <div className="ring" style={{ background: `conic-gradient(#ffb547 ${lv.progress * 360}deg, rgba(255,255,255,0.14) 0)` }}><b>{lv.level}</b></div>
  </div>;
}

void lifeEvent;
