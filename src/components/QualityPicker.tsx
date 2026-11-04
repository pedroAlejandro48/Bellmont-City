import { useState } from "react";
import { Gauge } from "lucide-react";
import { QUALITIES, readQuality, saveQuality, type Quality } from "@/game/quality";

const LABEL: Record<Quality, string> = { low: "Low", medium: "Medium", high: "High" };
const HINT: Record<Quality, string> = {
  low: "Low: lower resolution and fewer details, for slower phones and computers (uses less memory).",
  medium: "Medium: good looks that run smoothly on most devices.",
  high: "High: the sharpest picture and finest shadows, for fast devices.",
};

/** "Device speed" on the pages before the game: Low, Medium or High graphics, kept in this browser. */
export function QualityPicker() {
  const [quality, setQuality] = useState<Quality>(readQuality);
  return <div className="quality-picker hud-panel fixed right-3 top-3 z-30 flex items-center gap-2 px-2.5 py-1.5 text-foreground" role="radiogroup" aria-label="Device speed">
    <Gauge className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    <span className="whitespace-nowrap text-xs text-muted-foreground">Device speed</span>
    <div className="flex overflow-hidden rounded-md border border-input">
      {QUALITIES.map((q, i) => <button key={q} type="button" role="radio" aria-checked={quality === q} title={HINT[q]}
        onClick={() => { saveQuality(q); setQuality(q); }}
        className={`px-2.5 py-1 text-xs font-semibold transition-colors ${i > 0 ? "border-l border-input" : ""} ${quality === q ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-white/5"}`}>{LABEL[q]}</button>)}
    </div>
  </div>;
}
