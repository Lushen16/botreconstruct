"use strict";
const {
  contextBridge: contextBridge,
  ipcRenderer: ipcRenderer,
} = require("electron");
let profileContext = 0;
const acceptSettings = (e) => (
    Number.isInteger(e?.context) &&
      e.context >= profileContext &&
      (profileContext = e.context),
    e
  ),
  scoped = (e, ...r) => ipcRenderer.invoke(`pka:${e}`, ...r, profileContext);
contextBridge.exposeInMainWorld("pka", {
  bootstrap: () =>
    ipcRenderer
      .invoke("pka:bootstrap")
      .then((e) => (acceptSettings(e.settings), e)),
  pause: () => ipcRenderer.invoke("pka:pause"),
  view: (e) => ipcRenderer.invoke("pka:view", e),
  performance: () => ipcRenderer.invoke("pka:performance"),
  shortcuts: (e) => scoped("shortcuts", e),
  mapInfo: () => ipcRenderer.invoke("pka:mapInfo"),
  openMap: () => ipcRenderer.invoke("pka:openMap"),
  resetMap: () => ipcRenderer.invoke("pka:resetMap"),
  walkerProfiles: () => scoped("walkerProfiles"),
  loadWalkerProfile: (e, r) => scoped("loadWalkerProfile", e, r),
  mapRegion: (e) => ipcRenderer.invoke("pka:mapRegion", e),
  command: (e, r, o) => ipcRenderer.invoke("pka:command", e, r, o),
  save: (e, r) => scoped("save", e, r),
  autosave: (e, r, o = profileContext) =>
    ipcRenderer.invoke("pka:autosave", e, r, o),
  copyText: (e) => ipcRenderer.invoke("pka:copyText", e),
  showLook: (e, r) => ipcRenderer.invoke("pka:showLook", e, !0 === r),
  quit: () => ipcRenderer.invoke("pka:quit"),
  onClosing: (e) => {
    const r = () => e();
    return (
      ipcRenderer.on("pka:closing", r),
      () => ipcRenderer.removeListener("pka:closing", r)
    );
  },
  select: (e) => scoped("select", e),
  remove: (e) => scoped("remove", e),
  importProfile: (e) => scoped("import", e),
  exportProfile: (e) => scoped("export", e),
  monitor: (e, r, o) => scoped("monitor", e, r, o),
  gmLearning: (e, r) => scoped("gmLearning", e, r),
  onSettings: (e) => {
    const r = (r, o) => {
      !Number.isInteger(o?.context) ||
        o.context < profileContext ||
        (acceptSettings(o), e(o));
    };
    return (
      ipcRenderer.on("pka:settings", r),
      () => ipcRenderer.removeListener("pka:settings", r)
    );
  },
  onGmProfiles: (e) => {
    const r = (r, o) => {
      o &&
        "string" == typeof o.profile &&
        o.alerts &&
        "string" == typeof o.alerts.gmMessageProfilesJson &&
        e(o);
    };
    return (
      ipcRenderer.on("pka:gm-profiles", r),
      () => ipcRenderer.removeListener("pka:gm-profiles", r)
    );
  },
  runtime: (e, r, o, n) => scoped("runtime", e, r, o, n),
  onAlertSound: (e) => {
    const r = new Set([
        "hp.mp3",
        "disconnected.mp3",
        "chat.mp3",
        "creature.mp3",
        "player.mp3",
        "gm_arrow.mp3",
        "gm_message.mp3",
        "hunt_pokemon.mp3",
        "teleport.mp3",
        "camera_viewers.mp3",
        "pokemon_capture.mp3",
        "beep-default.wav",
        "beep-low.wav",
        "beep-high.wav",
        "beep-pulse.wav",
        "beep-urgent.wav",
        "beep-happy.wav",
      ]),
      o = (o, n) => {
        n && r.has(n.asset) && e({ asset: n.asset });
      };
    return (
      ipcRenderer.on("pka:alert-sound", o),
      () => ipcRenderer.removeListener("pka:alert-sound", o)
    );
  },
  onAlertState: (e) => {
    const r = (r, o) => e(o);
    return (
      ipcRenderer.on("pka:alert-state", r),
      () => ipcRenderer.removeListener("pka:alert-state", r)
    );
  },
  onSnapshot: (e) => {
    const r = (r, o) => e(o);
    return (
      ipcRenderer.on("pka:snapshot", r),
      () => ipcRenderer.removeListener("pka:snapshot", r)
    );
  },
  onNotice: (e) => {
    const r = (r, o) => e(o);
    return (
      ipcRenderer.on("pka:notice", r),
      () => ipcRenderer.removeListener("pka:notice", r)
    );
  },
});
