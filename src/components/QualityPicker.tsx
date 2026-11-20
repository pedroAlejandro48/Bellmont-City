import { useRef, useState } from "react";
import { ChevronDown, Gauge } from "lucide-react";
import { QUALITIES, readQuality, saveQuality, softwareRendering, type Quality } from "@/game/quality";

const LABEL: Record<Quality, string> = { low: "Low", medium: "Medium", high: "High" };
const HINT: Record<Quality, string> = {
  low: "Low: lower resolution and fewer details, for slower phones and computers (uses less memory).",
  medium: "Medium: good looks that run smoothly on most devices.",
  high: "High: the sharpest picture and finest shadows, for fast devices.",
};

/** "Device speed" on the pages before the game: Low, Medium or High graphics, kept in this browser. */
export function QualityPicker() {
  const [quality, setQuality] = useState<Quality>(readQuality);
  const [software] = useState(softwareRendering);
  // On a phone: a button (the icon and "Device speed") in the top right corner that drops the three choices down;
  // picking one lights it up, then they fold back up.
  const [compact] = useState(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);
  const [open, setOpen] = useState(false);
  const closing = useRef<number | undefined>(undefined);
  const choices = <div className="flex overflow-hidden rounded-md border border-input" role="radiogroup" aria-label="Device speed">
    {QUALITIES.map((q, i) => <button key={q} type="button" role="radio" aria-checked={quality === q} title={HINT[q]}
      onClick={() => { saveQuality(q); setQuality(q); if (compact) { window.clearTimeout(closing.current); closing.current = window.setTimeout(() => setOpen(false), 380); } }}
      className={`px-2.5 py-1 text-xs font-semibold transition-colors ${i > 0 ? "border-l border-input" : ""} ${quality === q ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-white/5"}`}>{LABEL[q]}</button>)}
  </div>;
  return <div className={`quality-picker fixed right-3 top-3 z-30 flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-1.5 ${compact ? "compact" : ""}`}>
  {compact ? <>
    <button type="button" className="hud-panel flex items-center gap-2 px-2.5 py-1.5 text-foreground" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
      <Gauge className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="whitespace-nowrap text-xs text-muted-foreground">Device speed</span>
      <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
    </button>
    <div className={`quality-drop hud-panel p-1.5 ${open ? "open" : ""}`} aria-hidden={!open}>{choices}</div>
  </> : <div className="hud-panel flex items-center gap-2 px-2.5 py-1.5 text-foreground">
    <Gauge className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    <span className="whitespace-nowrap text-xs text-muted-foreground">Device speed</span>
    {choices}
  </div>}
  {software && <p className="gpu-warning hud-panel px-2.5 py-1.5 text-[11px] leading-snug text-foreground">This browser isn't using your graphics card, so the game will be slow. In Chrome or Edge: <b>Settings → System → “Use graphics acceleration when available”</b>, then restart the browser.</p>}
  </div>;
}
