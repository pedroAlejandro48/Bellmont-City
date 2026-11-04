import { useTitleBetweenObeliskAndForm } from "@/lib/fitTitle";
import { QualityPicker } from "@/components/QualityPicker";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { normalizeRoomCode } from "@/platform/rooms";
import type { RoomRequest } from "@/multiplayer/RoomGame";

/** After signing in: your own city, or a shared room (new, or joined by its code). */
export function MainMenu({ username, message, onCity, onRoom, onSignOut }: { username: string | null; message?: string | undefined; onCity: () => void; onRoom: (request: RoomRequest) => void; onSignOut: () => void }) {
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  function join(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (!normalized) { setMsg("Room codes are 6 letters and numbers."); return; }
    onRoom({ mode: "join", code: normalized });
  }

  useTitleBetweenObeliskAndForm();
  return (
    <div className="auth-bg flex min-h-screen items-center justify-center px-4">
      <QualityPicker />
      <div className="auth-split w-full max-w-sm">
        <div className="auth-titles">
          <h1 className="font-display text-center text-5xl tracking-tight text-foreground">Bellmont city</h1>
          <p className="mt-2 text-center text-sm text-muted-foreground">{username ? <>Welcome back, <span className="text-foreground">{username}</span>.</> : "Twenty minutes of sun. Twenty minutes of moon. Real life in a game."}</p>
        </div>
        <div className="auth-box hud-panel mt-8 space-y-4 p-6">
          <Button type="button" className="w-full" onClick={onCity}>Go to my city</Button>
          <div className="flex overflow-hidden rounded-md border border-input">
            <Button type="button" variant="outline" className="flex-1 rounded-none border-0 border-r border-input" onClick={() => onRoom({ mode: "create" })}>Create a room</Button>
            <Button type="button" variant={joining ? "secondary" : "outline"} className="flex-1 rounded-none border-0" aria-expanded={joining} onClick={() => { setJoining((v) => !v); setMsg(null); }}>Join a room</Button>
          </div>
          {joining && <form onSubmit={join} className="flex gap-2">
            <input aria-label="Room code" className="auth-input flex-1 uppercase placeholder:normal-case" autoFocus autoComplete="off" spellCheck={false} maxLength={6} placeholder="Enter the room code" value={code} onChange={(e) => setCode(e.target.value)} />
            <Button type="submit">Join</Button>
          </form>}
          {(msg ?? message) && <p className="text-center text-sm text-accent">{msg ?? message}</p>}
          <button type="button" onClick={onSignOut} className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline">Sign out</button>
        </div>
      </div>
    </div>
  );
}
