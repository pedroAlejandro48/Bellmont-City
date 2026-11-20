import { useEffect, useState } from "react";
import { ChevronDown, Users } from "lucide-react";
import { LiveName } from "@/platform/liveNames";
import { Avatar } from "@/components/Avatar";
import type { Account } from "@/platform/account";
import { deleteRoom, discardRoom, findRoom, membersOf, stillMine, type Member } from "@/platform/rooms";
import { forgetRoom, onSavedRooms, savedRooms, type SavedRoom } from "@/platform/savedRooms";

/**
 * Your rooms (every one you created or joined), under "Join a room": a picture of where you last were in it, its
 * code (tap either to go in), who else has it (the people button drops their pictures and names), and on the far
 * right Discard room — or, when you're the only one left with it, Delete room (after "Are you sure?").
 */
export function SavedRooms({ account, onJoin }: { account: Account; onJoin: (code: string) => void }) {
  const [rooms, setRooms] = useState<SavedRoom[]>(() => savedRooms(account.id));
  useEffect(() => onSavedRooms(() => setRooms(savedRooms(account.id))), [account.id]);
  const [members, setMembers] = useState<Record<string, Member[]>>({});
  // Rooms that are gone (deleted, expired) or that you were kicked from leave your list.
  useEffect(() => {
    let live = true;
    for (const r of savedRooms(account.id)) {
      void stillMine(r.code, account.id).then(async (st) => {
        if (!live) return;
        if (st !== "yes") { forgetRoom(account.id, r.code); return; }
        const list = await membersOf(r.code);
        if (live) setMembers((m) => ({ ...m, [r.code]: list }));
      }).catch(() => {});
    }
    return () => { live = false; };
  }, [account.id]);
  const [open, setOpen] = useState<string | null>(null), [sure, setSure] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null);
  if (!rooms.length) return null;

  async function discard(code: string, alone: boolean) {
    setBusy(code);
    try {
      if (alone) { const room = await findRoom(code); if (room) await deleteRoom(room); }
      else await discardRoom(code, account);
      forgetRoom(account.id, code);
    } catch { /* (stays in the list: try again) */ }
    setBusy(null); setSure(null);
  }

  return <ul className="saved-rooms">
    {rooms.map((r) => {
      const ms = members[r.code], alone = !!ms && ms.filter((m) => m.uid !== account.id).length === 0;
      return <li key={r.code}>
        <div className="saved-room">
          <button type="button" className="saved-room-go" onClick={() => onJoin(r.code)} aria-label={`Join room ${r.code}`}>
            {r.thumb ? <img src={r.thumb} alt="" /> : <span className="saved-room-blank" />}
            <b data-no-translate>{r.code}</b>
          </button>
          <button type="button" className="saved-room-people" aria-expanded={open === r.code} aria-label="Who has this room" onClick={() => setOpen((v) => (v === r.code ? null : r.code))}>
            <Users size={15} aria-hidden /><span className="tabular-nums">{ms ? ms.length : "…"}</span><ChevronDown size={13} className={open === r.code ? "rotate-180" : ""} aria-hidden />
          </button>
          <button type="button" className="pill red" disabled={busy === r.code || !ms} onClick={() => (alone ? setSure(r.code) : void discard(r.code, false))}>{alone ? "Delete room" : "Discard room"}</button>
        </div>
        {sure === r.code && <div className="friend-actions">
          <span>Are you sure?</span>
          <button type="button" className="pill grey" onClick={() => setSure(null)}>No</button>
          <button type="button" className="pill red" onClick={() => void discard(r.code, true)}>Yes</button>
        </div>}
        {open === r.code && ms && <ul className="saved-room-members">
          {ms.map((m) => <li key={m.uid}><Avatar uid={m.uid} photo={m.photo} name={m.name || "?"} size={22} /><LiveName uid={m.uid} fallback={m.name || "Player"} />{m.uid === account.id && <span className="text-muted-foreground"> (you)</span>}</li>)}
        </ul>}
      </li>;
    })}
  </ul>;
}
