import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { appKind } from "@/lib/appKind";
import { Download, Share, SquarePlus, X, LogOut } from "lucide-react";

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
const IN_APP = appKind() !== null;
/** Inside the Android or Windows app. */
export const inApp = () => IN_APP;
/** Inside the Windows app (where Exit closes the app: it runs full screen, without a title bar). */
export const inWindowsApp = () => appKind() === "windows";
/** The game as an app on a phone or tablet: the Android app, or installed to the home screen (iPhone, iPad, Android). */
export const inMobileApp = () => appKind() === "android" || (isMobile() && window.matchMedia("(display-mode: standalone)").matches) || (navigator as { standalone?: boolean }).standalone === true;
export const installed = () => IN_APP || window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches || (navigator as { standalone?: boolean }).standalone === true;
/** Which iPhone browser: Safari (or one that looks like it, such as Brave), Chrome, Firefox, Edge. */
function iosBrowser() {
  const u = ua();
  if (/CriOS/.test(u)) return "chrome";
  if (/FxiOS/.test(u)) return "firefox";
  if (/EdgiOS/.test(u)) return "edge";
  return "safari";
}

/** The computer's browser: Safari on a Mac, Firefox, or one built on Chrome (Chrome, Edge, Brave, Opera…). */
function desktopBrowser() {
  const u = ua();
  if (/Firefox\//.test(u)) return "firefox";
  if (/Edg\//.test(u)) return "edge";
  if (/Safari\//.test(u) && !/Chrome|Chromium/.test(u)) return "safari";
  return "chrome";
}

/** "Install app" on the home pages, in any browser (not once it's installed): in the top row on a phone or tablet
 * (left of Device speed; on the menu between your picture and it), in the top-right corner on a computer (the
 * device-speed picker moves left for it). */
const RELEASE = "https://github.com/pedroAlejandro48/Bellmont-City/releases/download/latest";
const APK_URL = `${RELEASE}/Bellmont-City.apk`, EXE_URL = `${RELEASE}/Bellmont-City-Setup.exe`;

export function InstallApp() {
  const [, tick] = useState(0);
  const [help, setHelp] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { const f = () => tick((n) => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  const mobile = isMobile(), show = !installed();
  useEffect(() => {
    document.body.classList.toggle("has-install-pc", show && !mobile);
    return () => { document.body.classList.remove("has-install-pc"); };
  }, [show, mobile]);
  // Phones and tablets: in the top row, as tall as Device speed — just left of it (sign-in pages), or halfway between
  // your picture and it (the menu).
  const btn = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!show || !mobile) return;
    const place = () => {
      const el = btn.current, qp = document.querySelector(".quality-toggle")?.getBoundingClientRect();
      if (!el || !qp || !qp.width) return;
      const w = el.offsetWidth, pic = document.querySelector(".account-menu")?.getBoundingClientRect();
      let left = qp.left - 8 - w;
      if (pic && pic.width) left = Math.min(left, Math.max(pic.right + 8, (pic.right + qp.left - w) / 2));
      el.style.left = `${Math.max(8, left)}px`;
      el.style.top = `${qp.top}px`;
      el.style.height = `${qp.height}px`;
      el.style.visibility = "visible";
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(document.body);
    const q = document.querySelector(".quality-toggle"), a = document.querySelector(".account-menu");
    if (q) ro.observe(q);
    if (a) ro.observe(a);
    const timers = [100, 400, 1200].map((ms) => window.setTimeout(place, ms));
    window.addEventListener("resize", place);
    return () => { ro.disconnect(); timers.forEach(clearTimeout); window.removeEventListener("resize", place); };
  });
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
  // Android phones and Windows computers get the real app: the button downloads its file (the APK / the installer).
  const download = /Android/i.test(ua()) ? APK_URL : !mobile && /Windows/.test(ua()) ? EXE_URL : null;
  const copy = async () => { try { await navigator.clipboard.writeText(window.location.origin); setCopied(true); } catch { /* shown below anyway */ } };

  return <>
    {download
      ? <a ref={(e) => { btn.current = e; }} className={`install-app ${mobile ? "top" : "pc"}`} href={download} download><Download size={16} /> Download app</a>
      : <button ref={(e) => { btn.current = e; }} type="button" className={`install-app ${mobile ? "top" : "pc"}`} onClick={() => void install()}><SquarePlus size={16} /> Install app</button>}
    {help && <div className="install-help" role="dialog" aria-label="Install the app" onClick={() => setHelp(false)}>
      <div className="install-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="install-x" aria-label="Close" onClick={() => setHelp(false)}><X size={18} /></button>
        <b>Install Bellmont City</b>
        {!mobile ? (() => { const b = desktopBrowser(); return b === "safari" ? <ol>
          <li>In the menu bar, open <b>File</b>.</li>
          <li>Choose <b>Add to Dock…</b>, then <b>Add</b>. Bellmont opens from the Dock like an app.</li>
        </ol> : b === "firefox" ? <>
          <p className="install-note" style={{ marginTop: 0 }}>Firefox can't install websites as apps. Open the game in <b>Chrome</b>, <b>Edge</b> or <b>Brave</b> and press Install app there.</p>
          <button type="button" className="install-copy" onClick={() => void copy()}>{copied ? "Link copied" : "Copy the link"}</button>
        </> : <ol>
          <li>Click the install icon at the right end of the address bar, or open the browser's menu <b>⋮</b> (<b>…</b> in Edge).</li>
          <li>Choose <b>Install Bellmont City</b> (in some browsers under <b>Cast, save and share</b> or <b>Apps</b>).</li>
          <li>Click <b>Install</b>.</li>
        </ol>; })() : ios ? <>
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

/** Closes the Windows app (window.close(), or — as a fallback — /?app-exit=1, which the app turns into quitting). */
export function exitApp() { window.close(); setTimeout(() => { location.href = "/?app-exit=1"; }, 300); }
/** The Exit button in the top-left corner of the sign-in page — only inside the Windows app (full screen there). */
export function ExitAppButton() {
  if (!inWindowsApp()) return null;
  return <button type="button" className="exit-app" onClick={exitApp}><LogOut size={16} aria-hidden />Exit</button>;
}
