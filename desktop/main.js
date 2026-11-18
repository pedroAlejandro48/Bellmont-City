// Bellmont City for Windows: a window that opens https://bellmont-city.web.app, so it always runs the latest
// version of the game (this wrapper rarely needs rebuilding). Built by .github/workflows/apps.yml.
const { app, BrowserWindow, dialog, session, shell } = require("electron");
const fs = require("fs"), path = require("path");

// Notifications show as "Bellmont City" with the game's icon (Windows matches this id to the installed shortcut).
app.setAppUserModelId("app.bellmont.city");
// The player's answer to "Allow notifications?" (asked once, the first time the app opens), kept with the app's data.
const PREFS = () => path.join(app.getPath("userData"), "prefs.json");
const readPrefs = () => { try { return JSON.parse(fs.readFileSync(PREFS(), "utf8")); } catch { return {}; } };
const savePrefs = (p) => { try { fs.writeFileSync(PREFS(), JSON.stringify(p)); } catch { /* */ } };
async function askNotifications(win) {
  const { response } = await dialog.showMessageBox(win, {
    type: "question", buttons: ["Allow", "Not now"], defaultId: 0, cancelId: 1, noLink: true, title: "Bellmont City",
    message: "Allow Bellmont City to send you notifications?",
    detail: "Get notified when friends add you, accept you or invite you to a room.",
    icon: path.join(__dirname, "icon.png"),
  });
  const notifications = response === 0 ? "granted" : "denied";
  savePrefs({ ...readPrefs(), notifications });
  return notifications === "granted";
}

const HOME = "https://bellmont-city.web.app/";
// (Google's sign-in refuses apps that say they're Electron: it sees an ordinary Chrome.)
const UA = (ua) => ua.replace(/\s?Electron\/\S+/, "").replace(/\s?bellmont-city\/\S+/i, "");

function open() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 640, minHeight: 400,
    fullscreen: true, backgroundColor: "#0b1231", autoHideMenuBar: true, title: "Bellmont City", icon: __dirname + "/icon.png",
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.webContents.setUserAgent(UA(win.webContents.getUserAgent()));
  // Always full screen (F11 or Esc can't take it out); Exit in the account menu closes the app.
  // (Exit: the page closes its window, or — as a fallback — asks for /?app-exit=1, which quits.)
  win.webContents.on("will-navigate", (e, url) => { if (url.includes("app-exit=1")) { e.preventDefault(); app.quit(); } });
  win.on("leave-full-screen", () => setTimeout(() => win.setFullScreen(true), 50));
  // The game's own pages and Google's sign-in stay in the app; anything else opens in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(accounts\.google\.com|bellmont-city\.(web\.app|firebaseapp\.com))\//.test(url)) return { action: "allow" };
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("did-create-window", (child) => child.webContents.setUserAgent(UA(child.webContents.getUserAgent())));
  // Notifications: whatever the player answered (the page's own request asks again only if never answered).
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler((_wc, permission) => permission !== "notifications" || readPrefs().notifications === "granted");
  ses.setPermissionRequestHandler((_wc, permission, done) => {
    if (permission !== "notifications") return done(true);
    const p = readPrefs().notifications;
    if (p) return done(p === "granted");
    void askNotifications(win).then(done);
  });
  if (!readPrefs().notifications) win.webContents.once("did-finish-load", () => setTimeout(() => void askNotifications(win), 1200));
  win.loadURL(HOME + "?app=windows"); // (the game hides "Install app" inside the app)
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(open);
  app.on("window-all-closed", () => app.quit());
}
