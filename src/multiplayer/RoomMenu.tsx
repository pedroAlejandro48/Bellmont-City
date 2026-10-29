import { useState } from "react";
import { Settings, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { roomLink, ROOM_LIFETIME_DAYS } from "@/platform/rooms";

/** The yellow gear left of "Save & exit": share the room's link, and (for its creator) delete the room. */
export function RoomMenu({ code, canDelete, onDelete }: { code: string; canDelete: boolean; onDelete: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = () => { setOpen((v) => !v); setCopied(false); };
  async function share() {
    try { await navigator.clipboard.writeText(roomLink(code)); setCopied(true); }
    catch { window.prompt("Copy this link to share the room:", roomLink(code)); }
  }
  async function remove() {
    setDeleting(true); setError(null);
    try { await onDelete(); } catch { setError("Could not delete the room. Please try again."); setDeleting(false); }
  }

  return <div className="pointer-events-auto relative">
    <Button size="icon" aria-label="Room settings" aria-expanded={open} onClick={toggle}><Settings aria-hidden /></Button>
    {open && <ul className="hud-panel absolute right-0 top-full z-30 mt-2 w-44 py-1.5 text-sm">
      <li><button type="button" className="w-full px-3 py-2 text-left text-foreground hover:bg-white/5" onClick={() => void share()}>{copied ? "Link copied!" : "Share"}</button></li>
      {canDelete && <li><button type="button" className="w-full px-3 py-2 text-left text-red-500 hover:bg-white/5" onClick={() => { setOpen(false); setConfirming(true); }}>Delete room</button></li>}
    </ul>}
    {confirming && <div role="alertdialog" aria-modal="true" aria-labelledby="delete-room-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="hud-panel w-full max-w-sm space-y-4 p-6 text-center text-foreground">
        <h2 id="delete-room-title" className="font-display text-xl">Are you sure you want to delete this room?</h2>
        <p className="text-sm text-muted-foreground">The action cannot be undone.</p>
        {error && <p className="text-sm text-accent">{error}</p>}
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" disabled={deleting} onClick={() => setConfirming(false)}>No</Button>
          <Button variant="destructive" className="flex-1" disabled={deleting} onClick={() => void remove()}>{deleting ? "…" : "Yes"}</Button>
        </div>
      </div>
    </div>}
  </div>;
}

const HIDE_KEY = "bellmont-hide-room-notice";
export function roomNoticeHidden() {
  try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; }
}

/** Shown after creating a room: the code is the only way back in, and unvisited rooms expire. */
export function RoomCreatedNotice({ code, onClose }: { code: string; onClose: () => void }) {
  const [hide, setHide] = useState(false);
  const close = () => {
    if (hide) { try { localStorage.setItem(HIDE_KEY, "1"); } catch { /* The notice simply shows again next time. */ } }
    onClose();
  };
  return <div role="dialog" aria-modal="true" aria-labelledby="room-notice-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
    <div className="hud-panel w-full max-w-sm space-y-4 p-6 text-foreground">
      <h2 id="room-notice-title" className="flex items-center gap-2 font-display text-xl"><TriangleAlert className="h-5 w-5 text-yellow-400" aria-hidden />Remember your room code</h2>
      <p className="text-center font-display text-3xl tracking-[0.2em]">{code}</p>
      <p className="text-sm text-muted-foreground">This code is the only way you can get back into this world, so write it down or share the room's link from the ⚙ menu.</p>
      <p className="text-sm text-muted-foreground">Rooms are deleted automatically after {ROOM_LIFETIME_DAYS} days with nobody in them.</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} className="h-4 w-4 accent-primary" />Do not show again</label>
      <Button className="w-full" onClick={close}>OK</Button>
    </div>
  </div>;
}
