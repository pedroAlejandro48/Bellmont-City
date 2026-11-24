// Which app the game is running in: the Android app (it opens the site with ?app=android, and Android also says so
// in the referrer — remembered for the session only, since that app shares the phone browser's storage) or the
// Windows app (?app=windows — its storage is its own, so remembered for good); null in an ordinary browser.
export type AppKind = "android" | "windows";
function detect(): AppKind | null {
  try {
    const q = new URLSearchParams(location.search).get("app");
    if (q === "windows") localStorage.setItem("bellmont-app", "windows");
    if (q === "android" || document.referrer.startsWith("android-app://")) sessionStorage.setItem("bellmont-app", "android");
    if (localStorage.getItem("bellmont-app") === "windows") return "windows";
    if (sessionStorage.getItem("bellmont-app") === "android") return "android";
  } catch { /* */ }
  return null;
}
const KIND = typeof window === "undefined" ? null : detect();
export const appKind = () => KIND;
/** The Windows app's hidden page (?bg=1): it only listens for notifications (desktop/main.js). */
const BG = typeof window !== "undefined" && KIND === "windows" && new URLSearchParams(location.search).get("bg") === "1";
export const backgroundPage = () => BG;
/** The Android app's notification address (FCM token), which it passes in when opening the game (?fcm=…). */
function detectFcm(): string | null {
  try {
    const t = new URLSearchParams(location.search).get("fcm");
    if (t) sessionStorage.setItem("bellmont-fcm", t);
    return sessionStorage.getItem("bellmont-fcm");
  } catch { return null; }
}
const FCM = typeof window === "undefined" ? null : detectFcm();
export const fcmToken = () => FCM;
/** Browser notifications only on Windows (in a browser or the Windows app); the Android app has its own. */
export const browserNotifications = () => typeof navigator !== "undefined" && appKind() !== "android" && /Windows/.test(navigator.userAgent);
/** The Android app's navigation bar (?nav=b48 buttons / g24 gesture line, in dp): how much higher the chat's text box
 *  must sit than the keyboard's reported height says, since the buttons' bar under the keyboard isn't counted. */
function detectNav(): number {
  try {
    const q = new URLSearchParams(location.search).get("nav");
    if (q) localStorage.setItem("bellmont-nav", q);
    const v = q ?? localStorage.getItem("bellmont-nav") ?? "";
    const m = /^([bg])(\d{1,3})$/.exec(v);
    return m && m[1] === "b" ? Math.max(0, Number(m[2]) - 6) : 0;
  } catch { return 0; }
}
const NAV = typeof window === "undefined" ? 0 : detectNav();
export const keyboardNavExtra = () => NAV;
