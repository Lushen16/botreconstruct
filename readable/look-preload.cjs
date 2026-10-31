"use strict";
const {
  contextBridge: contextBridge,
  ipcRenderer: ipcRenderer,
} = require("electron");
contextBridge.exposeInMainWorld("pkaLook", {
  onShow: (e) => {
    const o = (o, r) => e(r);
    return (
      ipcRenderer.on("pka-look:show", o),
      () => ipcRenderer.removeListener("pka-look:show", o)
    );
  },
  copy: (e) => ipcRenderer.invoke("pka-look:copy", e),
  close: () => ipcRenderer.send("pka-look:close"),
});
