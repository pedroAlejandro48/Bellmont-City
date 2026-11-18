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
