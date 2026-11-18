import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { firestore } from "@/platform/firebase";
import { AVATARS } from "@/platform/account";

// Profile pictures: the Google one, or one of the game's ten. Older friend entries don't carry a picture, so it is
// looked up once from the player's profile (players/<uid>.photo).
const cache = new Map<string, Promise<string | null>>();
function lookup(uid: string) {
  let p = cache.get(uid);
  if (!p) { p = getDoc(doc(firestore, "players", uid)).then((d) => { const v = d.data()?.["photo"]; return typeof v === "string" ? v : null; }).catch(() => null); cache.set(uid, p); }
  return p;
}

/** A round picture (or the name's first letter on a colour, without one). */
export function Avatar({ uid, photo, name, size = 28 }: { uid?: string | undefined; photo?: string | null | undefined; name: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(photo ?? null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
    if (photo) { setUrl(photo); return; }
    if (!uid) { setUrl(null); return; }
    let live = true;
    void lookup(uid).then((v) => { if (live) setUrl(v); });
    return () => { live = false; };
  }, [uid, photo]);
  const style = { width: size, height: size, minWidth: size };
  if (url && !broken) return <img className="avatar" src={url} alt="" style={style} referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return <span className="avatar avatar-letter" style={{ ...style, background: `hsl(${hue} 55% 42%)`, fontSize: size * 0.45 }} aria-hidden>{(name[0] ?? "?").toUpperCase()}</span>;
}

/** Choosing a profile picture (accounts without a Google one): the game's ten things. */
export function AvatarPicker({ current, onPick, onClose }: { current: string | null; onPick: (url: string) => void; onClose?: (() => void) | undefined }) {
  return <div className="install-help" role="dialog" aria-label="Choose your profile picture" onClick={onClose}>
    <div className="install-card" onClick={(e) => e.stopPropagation()}>
      {onClose && <button type="button" className="install-x" aria-label="Close" onClick={onClose}><X size={18} /></button>}
      <b>Choose your profile picture</b>
      <div className="avatar-grid">
        {AVATARS.map((a) => <button key={a} type="button" className={`avatar-choice ${current === a ? "on" : ""}`} onClick={() => onPick(a)} aria-label={a.split("/").pop()!.replace(".png", "")}>
          <img src={a} alt="" />
        </button>)}
      </div>
    </div>
  </div>;
}
