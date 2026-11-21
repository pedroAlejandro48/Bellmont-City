// Bellmont City for Windows: a window that opens https://bellmont-city.web.app, so it always runs the latest
// version of the game (this wrapper rarely needs rebuilding). Built by .github/workflows/apps.yml.
const { app, BrowserWindow, dialog, session, shell } = require("electron");
const fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
const { ipcMain } = require("electron");

// Notifications show as "Bellmont City" with the game's icon (Windows matches this id to the installed shortcut).
app.setAppUserModelId("app.bellmont.city");
// The player's answer to "Allow notifications?" (asked once, the first time the app opens), kept with the app's data.
const PREFS = () => path.join(app.getPath("userData"), "prefs.json");
const readPrefs = () => { try { return JSON.parse(fs.readFileSync(PREFS(), "utf8")); } catch { return {}; } };
const savePrefs = (p) => { try { fs.writeFileSync(PREFS(), JSON.stringify(p)); } catch { /* */ } };
// The few words the app itself shows, in the language chosen in the game (read from the page).
const WORDS = {
  en: ["Open Bellmont City", "Quit", "Allow", "Not now", "Allow Bellmont City to send you notifications?", "Get notified when friends add you, accept you or invite you to a room.", "Bellmont City keeps running here, so notifications still reach you."],
  es: ["Abrir Bellmont City", "Salir", "Permitir", "Ahora no", "¿Permitir que Bellmont City te envíe notificaciones?", "Entérate cuando tus amigos te agreguen, te acepten o te inviten a una sala.", "Bellmont City sigue funcionando aquí, así que las notificaciones te siguen llegando."],
  fr: ["Ouvrir Bellmont City", "Quitter", "Autoriser", "Pas maintenant", "Autoriser Bellmont City à t'envoyer des notifications ?", "Sois prévenu quand des amis t'ajoutent, t'acceptent ou t'invitent dans une salle.", "Bellmont City continue de tourner ici, les notifications t'arrivent donc toujours."],
  pt: ["Abrir Bellmont City", "Sair", "Permitir", "Agora não", "Permitir que Bellmont City envie notificações?", "Saiba quando amigos adicionarem, aceitarem ou convidarem você para uma sala.", "Bellmont City continua rodando aqui, então as notificações continuam chegando."],
  ru: ["Открыть Bellmont City", "Выйти", "Разрешить", "Не сейчас", "Разрешить Bellmont City присылать уведомления?", "Узнавайте, когда друзья добавляют вас, принимают заявку или зовут в комнату.", "Bellmont City продолжает работать здесь, поэтому уведомления будут приходить."],
  zh: ["打开 Bellmont City", "退出", "允许", "暂不", "允许 Bellmont City 向你发送通知吗？", "当好友添加你、接受请求或邀请你进房间时收到通知。", "Bellmont City 会在这里继续运行，所以你仍能收到通知。"],
  hi: ["Bellmont City खोलें", "बंद करें", "अनुमति दें", "अभी नहीं", "क्या Bellmont City को सूचनाएँ भेजने दें?", "जब दोस्त आपको जोड़ें, स्वीकार करें या रूम में बुलाएँ तो सूचना पाएँ।", "Bellmont City यहाँ चलता रहता है, इसलिए सूचनाएँ आती रहेंगी।"],
  ar: ["فتح Bellmont City", "إنهاء", "سماح", "ليس الآن", "هل تسمح لـ Bellmont City بإرسال الإشعارات إليك؟", "اعرف عندما يضيفك الأصدقاء أو يقبلونك أو يدعونك إلى غرفة.", "يستمر Bellmont City بالعمل هنا، لذا تصلك الإشعارات."],
  bn: ["Bellmont City খুলুন", "বন্ধ করুন", "অনুমতি দিন", "এখন না", "Bellmont City-কে নোটিফিকেশন পাঠাতে দেবেন?", "বন্ধুরা আপনাকে যোগ করলে, গ্রহণ করলে বা রুমে ডাকলে জানুন।", "Bellmont City এখানে চলতে থাকে, তাই নোটিফিকেশন আসতে থাকবে।"],
  ur: ["Bellmont City کھولیں", "بند کریں", "اجازت دیں", "ابھی نہیں", "کیا Bellmont City کو اطلاعات بھیجنے دیں؟", "جب دوست آپ کو شامل کریں، قبول کریں یا روم میں بلائیں تو اطلاع پائیں۔", "Bellmont City یہاں چلتا رہتا ہے، اس لیے اطلاعات آتی رہیں گی۔"],
};
let lang = "en";
const w = (i) => (WORDS[lang] || WORDS.en)[i];
async function readLang(win) {
  try { const l = await win.webContents.executeJavaScript("localStorage.getItem('bellmont-lang')"); if (l && WORDS[l]) lang = l; } catch { /* */ }
}

async function askNotifications(win) {
  await readLang(win);
  const { response } = await dialog.showMessageBox(win, {
    type: "question", buttons: [w(2), w(3)], defaultId: 0, cancelId: 1, noLink: true, title: "Bellmont City",
    message: w(4),
    detail: w(5),
    icon: path.join(__dirname, "icon.png"),
  });
  const notifications = response === 0 ? "granted" : "denied";
  savePrefs({ ...readPrefs(), notifications });
  return notifications === "granted";
}

const HOME = "https://bellmont-city.web.app/";
// (Google's sign-in refuses apps that say they're Electron: it sees an ordinary Chrome.)
const UA = (ua) => ua.replace(/\s?Electron\/\S+/, "").replace(/\s?bellmont-city\/\S+/i, "");

/*
 * Two windows: the game (shown, full screen) and a hidden one that only listens for notifications (the game's page
 * with ?bg=1: it draws nothing, just follows the signed-in player's friends and chats and shows Windows
 * notifications). Closing the game (Exit, or Alt+F4) closes only its window: the hidden one keeps running — and starts
 * with Windows — so notifications reach the player even with the game closed, like any other app's. Clicking one
 * opens the game there (the hidden page asks for /?app-open=<link>).
 */
let main = null, bg = null;

function openMain(link) {
  const chat = link ? new URL(link, HOME).searchParams.get("chat") : null;
  if (main && !main.isDestroyed()) {
    if (main.isMinimized()) main.restore();
    main.show(); main.focus();
    if (chat) void main.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent("bellmont-open-chat", { detail: ${JSON.stringify(chat)} }))`).catch(() => {});
    return;
  }
  const win = main = new BrowserWindow({
    width: 1280, height: 800, minWidth: 640, minHeight: 400,
    fullscreen: true, backgroundColor: "#0b1231", autoHideMenuBar: true, title: "Bellmont City", icon: __dirname + "/icon.png",
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, "preload.js") },
  });
  win.on("closed", () => { if (main === win) main = null; });
  win.webContents.setUserAgent(UA(win.webContents.getUserAgent()));
  // Always full screen (F11 or Esc cannot take it out); Exit closes the game's window.
  // (Exit: the page closes its window, or — as a fallback — asks for /?app-exit=1.)
  win.webContents.on("will-navigate", (e, url) => {
    if (url.includes("app-exit=1")) { e.preventDefault(); win.close(); }
    else if (url.includes("app-show=1")) { win.show(); win.focus(); }
  });
  win.webContents.on("did-finish-load", () => void readLang(win));
  win.on("leave-full-screen", () => setTimeout(() => { if (!win.isDestroyed()) win.setFullScreen(true); }, 50));
  // The game's own pages and Google's sign-in stay in the app; anything else opens in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(accounts\.google\.com|bellmont-city\.(web\.app|firebaseapp\.com))\//.test(url)) return { action: "allow" };
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("did-create-window", (child) => child.webContents.setUserAgent(UA(child.webContents.getUserAgent())));
  if (!readPrefs().notifications) win.webContents.once("did-finish-load", () => setTimeout(() => void askNotifications(win), 1200));
  const url = new URL(link && link.startsWith("/") ? link : "/", HOME);
  url.searchParams.set("app", "windows"); // (the game hides "Install app" inside the app)
  win.loadURL(url.toString());
}

function openBackground() {
  if (bg && !bg.isDestroyed()) return;
  const win = bg = new BrowserWindow({ show: false, skipTaskbar: true, width: 400, height: 300, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.js") } });
  win.webContents.setUserAgent(UA(win.webContents.getUserAgent()));
  win.webContents.on("will-navigate", (e, url) => {
    const link = new URL(url).searchParams.get("app-open");
    if (link !== null) { e.preventDefault(); openMain(link || "/"); }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // (If it ever stops, it starts again.)
  win.webContents.on("render-process-gone", () => setTimeout(() => { if (!win.isDestroyed()) win.reload(); }, 5000));
  win.on("closed", () => { if (bg === win) bg = null; });
  win.loadURL(HOME + "?app=windows&bg=1");
}

/*
 * Windows notifications, shown by the app itself (SnoreToast, through node-notifier) so a message's can have a text
 * box: what's typed there is answered to that friend right away (the hidden page, which is signed in, sends it).
 * Clicking one opens the game there. While the game's window is in front, the game shows its own cards instead.
 */
// What happened to each notification (for finding problems): %APPDATA%\\Bellmont City\\notifications.log, last 200 lines.
function logLine(...parts) {
  try {
    const file = path.join(app.getPath("userData"), "notifications.log");
    const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").slice(-200) : [];
    old.push(`${new Date().toISOString()} ${parts.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}`);
    fs.writeFileSync(file, old.join("\n"));
  } catch { /* */ }
}
let toaster = null;
function getToaster() {
  if (toaster) return toaster;
  try {
    const { WindowsToaster } = require("node-notifier");
    const exe = path.join(path.dirname(require.resolve("node-notifier")), "vendor", "snoreToast", `snoretoast-${process.arch === "ia32" ? "x86" : "x64"}.exe`);
    const real = exe.replace("app.asar", "app.asar.unpacked");
    logLine("toaster", real, fs.existsSync(real) ? "exists" : "MISSING");
    toaster = new WindowsToaster({ withFallback: false, customPath: real });
  } catch (e) { logLine("toaster failed", String(e)); toaster = null; }
  return toaster;
}
const toastIds = new Map(); // tag → number
const toastId = (tag) => { if (!toastIds.has(tag)) toastIds.set(tag, 1 + (crypto.createHash("md5").update(tag).digest().readUInt32BE(0) % 2000000000)); return toastIds.get(tag); };
/** A picture from the page (a data: URL) as a file the notification can show. */
function iconFile(icon) {
  try {
    if (typeof icon !== "string" || !icon.startsWith("data:image/png;base64,")) return path.join(__dirname, "icon.png");
    const buf = Buffer.from(icon.slice(22), "base64");
    const file = path.join(os.tmpdir(), `bellmont-${crypto.createHash("md5").update(buf).digest("hex")}.png`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
    return file;
  } catch { return path.join(__dirname, "icon.png"); }
}
ipcMain.on("bellmont-game-focused", (e) => { e.returnValue = !!(main && !main.isDestroyed() && main.isVisible() && main.isFocused()); if (e.returnValue) logLine("game in front: in-game card only"); });
ipcMain.on("bellmont-notify", (_e, n) => {
  if (!n || typeof n.title !== "string") return;
  const t = getToaster();
  const fallback = () => { try { new (require("electron").Notification)({ title: n.title, body: n.body || "", icon: iconFile(n.icon) }).on("click", () => openMain(n.link)).show(); } catch { /* */ } };
  logLine("notify", { tag: n.tag, reply: !!n.reply, toaster: !!t, version: app.getVersion() });
  if (!t) return fallback();
  t.notify({
    title: n.title, message: n.body || " ", icon: iconFile(n.icon), appID: "app.bellmont.city", id: toastId(n.tag || n.title),
    wait: true, ...(n.reply ? { tb: true } : {}),
  }, (err, response, meta) => {
    logLine("result", { tag: n.tag, err: err ? String(err) : null, response, meta });
    if (err) return;
    const text = meta && typeof meta.text === "string" ? meta.text : "";
    if (n.reply && (response === "textentered" || meta?.action === "textEntered") && text.trim()) {
      if (bg && !bg.isDestroyed()) bg.webContents.send("bellmont-reply", { friend: n.reply, text });
    } else if (response === "activate" || response === "click") openMain(n.link);
  });
});
ipcMain.on("bellmont-close", (_e, tag) => { const t = getToaster(); if (t && typeof tag === "string") t.notify({ close: toastId(tag), appID: "app.bellmont.city" }, () => {}); });

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => openMain());
  app.whenReady().then(() => {
    // Notifications: whatever the player answered (the page's own request asks again only if never answered).
    const ses = session.defaultSession;
    ses.setPermissionCheckHandler((_wc, permission) => permission !== "notifications" || readPrefs().notifications === "granted");
    ses.setPermissionRequestHandler((_wc, permission, done) => {
      if (permission !== "notifications") return done(true);
      const p = readPrefs().notifications;
      if (p) return done(p === "granted");
      if (main && !main.isDestroyed()) void askNotifications(main).then(done); else done(false);
    });
    // Starts with Windows, hidden (just the notification listener).
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, args: ["--hidden"] });
    openBackground();
    if (!process.argv.includes("--hidden")) openMain();
  });
  // (The hidden listener stays when the game's window closes.)
  app.on("window-all-closed", () => {});
}
