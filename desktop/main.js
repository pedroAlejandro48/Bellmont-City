// Bellmont City for Windows: a window that opens https://bellmont-city.web.app, so it always runs the latest
// version of the game (this wrapper rarely needs rebuilding). Built by .github/workflows/apps.yml.
const { app, BrowserWindow, shell } = require("electron");

const HOME = "https://bellmont-city.web.app/";
// (Google's sign-in refuses apps that say they're Electron: it sees an ordinary Chrome.)
const UA = (ua) => ua.replace(/\s?Electron\/\S+/, "").replace(/\s?bellmont-city\/\S+/i, "");

function open() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 640, minHeight: 400,
    backgroundColor: "#0b1231", autoHideMenuBar: true, title: "Bellmont City", icon: __dirname + "/icon.png",
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.webContents.setUserAgent(UA(win.webContents.getUserAgent()));
  // The game's own pages and Google's sign-in stay in the app; anything else opens in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(accounts\.google\.com|bellmont-city\.(web\.app|firebaseapp\.com))\//.test(url)) return { action: "allow" };
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("did-create-window", (child) => child.webContents.setUserAgent(UA(child.webContents.getUserAgent())));
  win.loadURL(HOME + "?app=windows"); // (the game hides "Install app" inside the app)
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(open);
  app.on("window-all-closed", () => app.quit());
}
