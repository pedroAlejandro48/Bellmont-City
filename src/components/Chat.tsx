import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Check, ChevronLeft, Send } from "lucide-react";
import type { Account } from "@/platform/account";
import { Avatar } from "@/components/Avatar";
import { LiveName } from "@/platform/liveNames";
import { MAX_MESSAGE, OPEN_RENEW_MS, markOpen, markSeen, sendMessage, unsendMessage, watchChat, type ChatMessage } from "@/platform/chat";
import type { Friend } from "@/platform/friends";
import { notifySeen, setOpenChat } from "@/platform/push";
import { serverNow } from "@/lib/serverTime";

/** Copies text to the clipboard (with an older way for browsers without the Clipboard API). */
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* below */ }
  const t = document.createElement("textarea");
  t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
  document.body.appendChild(t); t.select();
  try { document.execCommand("copy"); } catch { /* */ }
  t.remove();
}

/** How long a finger must stay on a message to pick it. */
const HOLD_MS = 450;

/**
 * A private chat with one friend, in place of the friends list: ‹ back, their picture and name on top; the messages
 * (yours on the right, theirs on the left, each in a bubble with its little tail at the bottom corner); a text box
 * and the paper plane at the bottom (only with something typed).
 *
 * Pressing and holding a message (right click on a computer) picks it: everything else in the box goes 50% darker
 * and its options appear near the bottom, on its side: Copy, Forward (to other friends, ticked in a list) and, for
 * your own, Unsend (asks first; deletes it for both of you).
 */
export function Chat({ account, friend, friends, onBack }: { account: Account; friend: Friend; friends: Friend[]; onBack: () => void }) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<ChatMessage | null>(null);
  const [sure, setSure] = useState(false);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const log = useRef<HTMLDivElement>(null), box = useRef<HTMLTextAreaElement>(null);
  const atEnd = useRef(true);
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  useEffect(() => watchChat(account, friend.uid, setMsgs), [account, friend.uid]);
  // While it's open, everything in it counts as seen (and once more on leaving).
  const newest = msgs.length ? msgs[msgs.length - 1]!.at : 0;
  useEffect(() => { markSeen(account, friend.uid, serverNow()); }, [account, friend.uid, newest]);
  // While the chat is on screen, it's marked open (renewed); hidden or closed, not.
  useEffect(() => {
    const tick = () => markOpen(account, friend.uid, document.visibilityState === "visible");
    tick();
    const timer = window.setInterval(tick, OPEN_RENEW_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); markOpen(account, friend.uid, false); };
  }, [account, friend.uid]);
  // Opening the chat takes its notifications away on the player's phones (and computers watch "seen" themselves).
  useEffect(() => { setOpenChat(friend.uid); notifySeen(friend.uid); return () => { setOpenChat(null); markSeen(account, friend.uid); }; }, [account, friend.uid]);
  // (Kept at the newest message, unless the player scrolled up to read.)
  useLayoutEffect(() => { const el = log.current; if (el && atEnd.current) el.scrollTop = el.scrollHeight; }, [msgs, forwarding]);
  // The text box grows with what's typed, up to five lines (no scroll bar of its own).
  useLayoutEffect(() => { const el = box.current; if (!el) return; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 120)}px`; }, [text, forwarding]);
  // On a computer the text box is ready to type in as soon as the chat opens (and on coming back from Forward); on a
  // touch screen the keyboard stays down until the box is tapped.
  useEffect(() => {
    if (forwarding || matchMedia("(pointer: coarse)").matches) return;
    box.current?.focus({ preventScroll: true });
  }, [friend.uid, forwarding]);
  // A held message is moved up above its options if they'd cover it (room is made under the messages while held).
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!picked) return;
    const el = log.current, m = menu.current, bubble = el?.querySelector<HTMLElement>(".chat-bubble.picked");
    if (!el || !m || !bubble) return;
    const over = bubble.getBoundingClientRect().bottom - (m.getBoundingClientRect().top - 10);
    if (over > 0) el.scrollTop += over;
  }, [picked, sure]);
  // A picked message that gets unsent (by its sender) is let go.
  useEffect(() => { if (picked && !msgs.some((m) => m.id === picked.id)) { setPicked(null); setSure(false); } }, [msgs, picked]);
  const ok = text.trim().length > 0;
  function send(e?: FormEvent) {
    e?.preventDefault();
    if (!ok) return;
    const t = text;
    setText(""); setFailed(false); atEnd.current = true;
    sendMessage(account, friend.uid, t).catch(() => { setFailed(true); setText((now) => now || t); });
    box.current?.focus({ preventScroll: true }); // (still in the box, ready for the next one)
  }
  // Enter sends (Shift+Enter: a new line); on touch screens Enter is a new line and the plane sends.
  function key(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); send(); }
  }
  const pick = (m: ChatMessage) => { setPicked(m); setSure(false); (document.activeElement as HTMLElement | null)?.blur?.(); };
  const close = () => { setPicked(null); setSure(false); };
  const down = (m: ChatMessage, e: ReactPointerEvent) => {
    if (e.pointerType === "mouse") return; // (a mouse uses the right button)
    const timer = window.setTimeout(() => { hold.current = null; pick(m); navigator.vibrate?.(15); }, HOLD_MS);
    hold.current = { timer, x: e.clientX, y: e.clientY };
  };
  const move = (e: ReactPointerEvent) => { const h = hold.current; if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 8) { window.clearTimeout(h.timer); hold.current = null; } };
  const up = () => { if (hold.current) { window.clearTimeout(hold.current.timer); hold.current = null; } };

  if (forwarding) return <Forward account={account} msg={forwarding} friends={friends.filter((f) => f.uid !== friend.uid)} onDone={() => setForwarding(null)} />;

  const mine = picked?.from === account.id;
  return <div className={`chat${picked ? " picking" : ""}`}>
    <div className="chat-head">
      <button type="button" className="chat-back" aria-label="Back to your friends" onClick={onBack}><ChevronLeft size={22} strokeWidth={2.6} /></button>
      <Avatar uid={friend.uid} photo={friend.photo} name={friend.name} size={30} />
      <b><LiveName uid={friend.uid} fallback={friend.name} /></b>
    </div>
    <div className="chat-log" ref={log} onScroll={(e) => { const el = e.currentTarget; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
      {!msgs.length && <p className="chat-empty">No messages yet. Say hi!</p>}
      {msgs.map((m) => <div key={m.id}
        className={`chat-bubble ${m.from === account.id ? "mine" : "theirs"}${picked?.id === m.id ? " picked" : ""}`}
        onContextMenu={(e) => { e.preventDefault(); up(); pick(m); }}
        onPointerDown={(e) => down(m, e)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up}>
        {m.fwd && <span className="chat-fwd">Forwarded</span>}
        <span data-no-translate>{m.text}</span>
      </div>)}
    </div>
    {failed && <p className="chat-failed">Could not send. Please try again.</p>}
    <form className="chat-send" onSubmit={send}>
      <textarea ref={box} rows={1} aria-label="Message" placeholder="Message" maxLength={MAX_MESSAGE} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={key} />
      {/* (Pressing it doesn't take the focus from the text box: the cursor stays, and a phone's keyboard stays up.) */}
      <button type="submit" aria-label="Send" disabled={!ok} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}><Send size={19} strokeWidth={2.3} /></button>
    </form>
    {picked && <>
      <div className="chat-dim" onClick={close} onContextMenu={(e) => { e.preventDefault(); close(); }} />
      <div ref={menu} className={`chat-menu ${mine ? "right" : "left"}`} role="menu">
        {sure ? <>
          <p>Are you sure?</p>
          <div className="chat-sure">
            <button type="button" onClick={() => setSure(false)}>No</button>
            <button type="button" className="red" onClick={() => { const m = picked; close(); void unsendMessage(account, friend.uid, m.id).catch(() => {}); }}>Yes</button>
          </div>
        </> : <>
          <button type="button" role="menuitem" onClick={() => { void copyText(picked.text); close(); }}>Copy</button>
          <button type="button" role="menuitem" onClick={() => { setForwarding(picked); close(); }}>Forward</button>
          {mine && <button type="button" role="menuitem" className="red" onClick={() => setSure(true)}>Unsend</button>}
        </>}
      </div>
    </>}
  </div>;
}

/** Forwarding a message: tick friends (picture and name, a box on the left); Send stays at the bottom. */
function Forward({ account, msg, friends, onDone }: { account: Account; msg: ChatMessage; friends: Friend[]; onDone: () => void }) {
  const [to, setTo] = useState<Set<string>>(new Set());
  const toggle = (uid: string) => setTo((s) => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  return <div className="chat">
    <div className="chat-head">
      <button type="button" className="chat-back" aria-label="Back" onClick={onDone}><ChevronLeft size={22} strokeWidth={2.6} /></button>
      <b>Forward to…</b>
    </div>
    <ul className="chat-forward">
      {friends.map((f) => <li key={f.uid}>
        <button type="button" role="checkbox" aria-checked={to.has(f.uid)} onClick={() => toggle(f.uid)}>
          <span className={`chat-check${to.has(f.uid) ? " on" : ""}`}>{to.has(f.uid) && <Check size={14} strokeWidth={3.2} />}</span>
          <Avatar uid={f.uid} photo={f.photo} name={f.name} size={30} />
          <b><LiveName uid={f.uid} fallback={f.name} /></b>
        </button>
      </li>)}
      {!friends.length && <li className="chat-empty">No other friends yet.</li>}
    </ul>
    <div className="chat-forward-send">
      <button type="button" disabled={!to.size} onClick={() => { for (const uid of to) void sendMessage(account, uid, msg.text, true).catch(() => {}); onDone(); }}>
        <Send size={17} strokeWidth={2.3} aria-hidden /> Send
      </button>
    </div>
  </div>;
}
