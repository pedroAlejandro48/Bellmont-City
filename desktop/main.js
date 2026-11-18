// Bellmont City for Windows: a window that opens https://bellmont-city.web.app, so it always runs the latest
// version of the game (this wrapper rarely needs rebuilding). Built by .github/workflows/apps.yml.
const { app, BrowserWindow, Menu, Tray, dialog, session, shell } = require("electron");
const fs = require("fs"), path = require("path");

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

// The system tray: Exit (or closing the window) hides the app there instead of quitting, so notifications still
// arrive; the tray icon brings it back, and its menu's Quit really ends it.
let tray = null, quitting = false;
function makeTray(win) {
  if (tray) return;
  tray = new Tray(path.join(__dirname, "icon.png"));
  tray.setToolTip("Bellmont City");
  const menu = () => Menu.buildFromTemplate([
    { label: w(0), click: () => show(win) },
    { type: "separator" },
    { label: w(1), click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu());
  tray.on("click", () => show(win));
  tray.on("right-click", () => { void readLang(win).then(() => tray.setContextMenu(menu())); });
}
function show(win) { if (win.isMinimized()) win.restore(); win.show(); win.setFullScreen(true); win.focus(); }
let toldTray = false;
function hideToTray(win) {
  win.hide();
  // (Back to the menu, so no game keeps running unseen; the menu still watches for notifications.)
  if (!win.webContents.getURL().endsWith("/?app=windows")) win.loadURL(HOME + "?app=windows");
  if (!toldTray && tray) { toldTray = true; tray.displayBalloon?.({ title: "Bellmont City", content: w(6), iconType: "info" }); }
}

function open() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 640, minHeight: 400,
    fullscreen: true, backgroundColor: "#0b1231", autoHideMenuBar: true, title: "Bellmont City", icon: __dirname + "/icon.png",
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.webContents.setUserAgent(UA(win.webContents.getUserAgent()));
  // Always full screen (F11 or Esc cannot take it out); Exit hides the app to the system tray (see hideToTray).
  // (Exit: the page closes its window, or — as a fallback — asks for /?app-exit=1, which quits.)
  win.webContents.on("will-navigate", (e, url) => {
    if (url.includes("app-exit=1")) { e.preventDefault(); hideToTray(win); }
    else if (url.includes("app-show=1")) show(win); // (a notification was clicked)
  });
  win.on("close", (e) => { if (!quitting) { e.preventDefault(); hideToTray(win); } });
  win.webContents.on("did-finish-load", () => void readLang(win));
  makeTray(win);
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
  app.on("second-instance", () => { const win = BrowserWindow.getAllWindows()[0]; if (win) show(win); });
  app.on("before-quit", () => { quitting = true; });
  app.whenReady().then(open);
  app.on("window-all-closed", () => { if (quitting) app.quit(); });
}
