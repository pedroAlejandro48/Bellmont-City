// The bridge between the game's pages and the Windows app (sandboxed: only these few messages).
//   bellmontApp.notify(n)  show a Windows notification (n: { tag, title, body, icon?, link, reply?, you? } — reply: the
//                          friend's id, for a text box to answer a message right from the notification)
//   bellmontApp.close(tag) take a notification away (its chat was read)
//   bellmontApp.onReply(f) f({ friend, text }) when the player answers from a notification
//   bellmontApp.gameFocused() whether the game's window is in front (then the game shows its own cards instead)
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("bellmontApp", {
  notify: (n) => ipcRenderer.send("bellmont-notify", n),
  close: (tag) => ipcRenderer.send("bellmont-close", tag),
  onReply: (f) => ipcRenderer.on("bellmont-reply", (_e, r) => f(r)),
  gameFocused: () => ipcRenderer.sendSync("bellmont-game-focused"),
});
