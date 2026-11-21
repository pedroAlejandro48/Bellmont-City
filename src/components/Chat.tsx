import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ChevronLeft, Send } from "lucide-react";
import type { Account } from "@/platform/account";
import { Avatar } from "@/components/Avatar";
import { LiveName } from "@/platform/liveNames";
import { MAX_MESSAGE, sendMessage, watchChat, type ChatMessage } from "@/platform/chat";
import type { Friend } from "@/platform/friends";

/**
 * A private chat with one friend, in place of the friends list: ‹ back, their picture and name on top; the messages
 * (yours on the right, theirs on the left, each in a bubble with its little tail at the bottom corner); a text box
 * and the paper plane at the bottom (only with something typed).
 */
export function Chat({ account, friend, onBack }: { account: Account; friend: Friend; onBack: () => void }) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [failed, setFailed] = useState(false);
  const log = useRef<HTMLDivElement>(null), box = useRef<HTMLTextAreaElement>(null);
  const atEnd = useRef(true);
  useEffect(() => watchChat(account, friend.uid, setMsgs), [account, friend.uid]);
  // (Kept at the newest message, unless the player scrolled up to read.)
  useLayoutEffect(() => { const el = log.current; if (el && atEnd.current) el.scrollTop = el.scrollHeight; }, [msgs]);
  // The text box grows with what's typed, up to five lines.
  useLayoutEffect(() => { const el = box.current; if (!el) return; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 120)}px`; }, [text]);
  const ok = text.trim().length > 0;
  function send(e?: FormEvent) {
    e?.preventDefault();
    if (!ok) return;
    const t = text;
    setText(""); setFailed(false); atEnd.current = true;
    sendMessage(account, friend.uid, t).catch(() => { setFailed(true); setText((now) => now || t); });
    box.current?.focus();
  }
  // Enter sends (Shift+Enter: a new line); on touch screens Enter is a new line and the plane sends.
  function key(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); send(); }
  }
  return <div className="chat">
    <div className="chat-head">
      <button type="button" className="chat-back" aria-label="Back to your friends" onClick={onBack}><ChevronLeft size={22} strokeWidth={2.6} /></button>
      <Avatar uid={friend.uid} photo={friend.photo} name={friend.name} size={30} />
      <b><LiveName uid={friend.uid} fallback={friend.name} /></b>
    </div>
    <div className="chat-log" ref={log} onScroll={(e) => { const el = e.currentTarget; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
      {!msgs.length && <p className="chat-empty">No messages yet. Say hi!</p>}
      {msgs.map((m) => <div key={m.id} className={`chat-bubble ${m.from === account.id ? "mine" : "theirs"}${m.pending ? " pending" : ""}`} data-no-translate>{m.text}</div>)}
    </div>
    {failed && <p className="chat-failed">Could not send. Please try again.</p>}
    <form className="chat-send" onSubmit={send}>
      <textarea ref={box} rows={1} aria-label="Message" placeholder="Message" maxLength={MAX_MESSAGE} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={key} />
      <button type="submit" aria-label="Send" disabled={!ok}><Send size={19} strokeWidth={2.3} /></button>
    </form>
  </div>;
}
