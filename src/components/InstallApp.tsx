import { useEffect, useState } from "react";
import { Share, SquarePlus, X } from "lucide-react";

// Installing the game as an app from the browser. Android browsers built on Chrome (Chrome, Brave, Edge, Samsung
// Internet…) offer it straight away: the button opens their install dialog. iPhones and iPads have no such dialog
// for any website (Apple doesn't allow one): the app is added from the browser's Share menu ("Add to Home Screen"),
// so the button shows exactly where to tap.

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
/** Kept from the start (the browser offers it once, early): call before the page renders. */
export function listenForInstall() {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as InstallEvent; listeners.forEach((f) => f()); });
  window.addEventListener("appinstalled", () => { deferred = null; listeners.forEach((f) => f()); });
}

const ua = () => navigator.userAgent;
export const isIOS = () => /iPhone|iPad|iPod/.test(ua()) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isMobile = () => isIOS() || /Android|Mobi/i.test(ua());
const installed = () => window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches || (navigator as { standalone?: boolean }).standalone === true;
/** Which iPhone browser: Safari (or one that looks like it, such as Brave), Chrome, Firefox, Edge. */
function iosBrowser() {
  const u = ua();
  if (/CriOS/.test(u)) return "chrome";
  if (/FxiOS/.test(u)) return "firefox";
  if (/EdgiOS/.test(u)) return "edge";
  return "safari";
}

/** "Install app" at the bottom of the home pages on a phone or tablet (not once it's installed). */
export function InstallApp() {
  const [, tick] = useState(0);
  const [help, setHelp] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { const f = () => tick((n) => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  const show = isMobile() && !installed();
  useEffect(() => { document.body.classList.toggle("has-install", show); return () => document.body.classList.remove("has-install"); }, [show]);
  if (!show) return null;

  const install = async () => {
    if (deferred) {
      const e = deferred;
      await e.prompt().catch(() => {});
      const choice = await e.userChoice.catch(() => ({ outcome: "dismissed" }));
      if (choice.outcome === "accepted") deferred = null;
      tick((n) => n + 1);
      return;
    }
    setHelp(true);
  };
  const ios = isIOS(), browser = ios ? iosBrowser() : null;
  const copy = async () => { try { await navigator.clipboard.writeText(window.location.origin); setCopied(true); } catch { /* shown below anyway */ } };

  return <>
    <button type="button" className="install-app" onClick={() => void install()}><SquarePlus size={20} /> Install app</button>
    {help && <div className="install-help" role="dialog" aria-label="Install the app" onClick={() => setHelp(false)}>
      <div className="install-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="install-x" aria-label="Close" onClick={() => setHelp(false)}><X size={18} /></button>
        <b>Install Bellmont City</b>
        {ios ? <>
          <ol>
            {browser === "chrome" ? <li>Tap <Share size={16} className="inline" /> <b>Share</b> in the address bar (top right).</li>
              : browser === "edge" || browser === "firefox" ? <li>Tap the menu <b>☰</b> at the bottom, then <Share size={16} className="inline" /> <b>Share</b>.</li>
              : <li>Tap <Share size={16} className="inline" /> <b>Share</b> in the toolbar at the bottom of the screen.</li>}
            <li>Scroll down and tap <b>Add to Home Screen</b> <SquarePlus size={16} className="inline" />.</li>
            <li>Tap <b>Add</b>. Bellmont opens from your home screen like an app.</li>
          </ol>
          <p className="install-note">No “Add to Home Screen” in this browser? Open the game in <b>Safari</b> and do it there (Safari always has it).</p>
          <button type="button" className="install-copy" onClick={() => void copy()}>{copied ? "Link copied — paste it in Safari" : "Copy the link for Safari"}</button>
        </> : <ol>
          <li>Tap the browser's menu <b>⋮</b> (top or bottom right).</li>
          <li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li>
          <li>Tap <b>Install</b>.</li>
        </ol>}
      </div>
      {ios && browser === "safari" && <div className="install-arrow" aria-hidden>↓</div>}
    </div>}
  </>;
}
