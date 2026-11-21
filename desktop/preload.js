// The bridge between the game's pages and the Windows app (sandboxed: only these few messages).
//   bellmontApp.notify(n)  show a Windows notification (n: { tag, title, body, icon?, link, reply? } — reply: for a chat
//                          message, the friend's id: their new messages collect in one notification)
//   bellmontApp.close(tag) take a notification away (its chat was read)
//   bellmontApp.gameFocused() whether the game's window is in front (then the game shows its own cards instead)
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("bellmontApp", {
  notify: (n) => ipcRenderer.send("bellmont-notify", n),
  close: (tag) => ipcRenderer.send("bellmont-close", tag),
  gameFocused: () => ipcRenderer.sendSync("bellmont-game-focused"),
});
