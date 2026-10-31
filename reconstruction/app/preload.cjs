const {contextBridge,ipcRenderer}=require('electron');
const alertAssets = new Set(['hp.mp3', 'disconnected.mp3', 'chat.mp3', 'creature.mp3',
  'player.mp3', 'gm_arrow.mp3', 'gm_message.mp3', 'hunt_pokemon.mp3', 'teleport.mp3',
  'camera_viewers.mp3', 'pokemon_capture.mp3', 'beep-default.wav', 'beep-low.wav',
  'beep-high.wav', 'beep-pulse.wav', 'beep-urgent.wav', 'beep-happy.wav']);

function createRendererApis(transport) {
  let profileContext = 0;
  const acceptSettings = settings => {
    if (Number.isInteger(settings?.context) && settings.context >= profileContext) profileContext = settings.context;
    return settings;
  };
  const subscribe = (channel, handler) => {
    transport.on(channel, handler);
    return () => transport.removeListener(channel, handler);
  };
  const pka = {};
  const direct = { pause: 0, view: 1, performance: 0, mapInfo: 0, openMap: 0, resetMap: 0,
    mapRegion: 1, command: 3, copyText: 1, quit: 0 };
  const scoped = { shortcuts: [1], walkerProfiles: [0], loadWalkerProfile: [2], save: [2],
    select: [1], remove: [1], importProfile: [1, 'import'], exportProfile: [1, 'export'],
    monitor: [3], gmLearning: [2], runtime: [4] };
  for (const [method, arity] of Object.entries(direct)) {
    pka[method] = (...args) => transport.invoke('pka:' + method,
      ...Array.from({ length: arity }, (_, index) => args[index]));
  }
  for (const [method, [arity, channel = method]] of Object.entries(scoped)) {
    pka[method] = (...args) => transport.invoke('pka:' + channel,
      ...Array.from({ length: arity }, (_, index) => args[index]), profileContext);
  }
  pka.bootstrap = () => transport.invoke('pka:bootstrap').then(result => {
    acceptSettings(result.settings);
    return result;
  });
  pka.autosave = (profile, settings, context = profileContext) =>
    transport.invoke('pka:autosave', profile, settings, context);
  pka.showLook = (text, pinned) => transport.invoke('pka:showLook', text, pinned === true);
  pka.onClosing = callback => subscribe('pka:closing', () => callback());
  pka.onSettings = callback => subscribe('pka:settings', (event, settings) => {
    if (Number.isInteger(settings?.context) && settings.context >= profileContext) {
      acceptSettings(settings);
      callback(settings);
    }
  });
  pka.onGmProfiles = callback => subscribe('pka:gm-profiles', (event, value) => {
    if (value && typeof value.profile === 'string' && value.alerts &&
        typeof value.alerts.gmMessageProfilesJson === 'string') callback(value);
  });
  pka.onAlertSound = callback => subscribe('pka:alert-sound', (event, value) => {
    if (value && alertAssets.has(value.asset)) callback({ asset: value.asset });
  });
  for (const [method, channel] of Object.entries({ onAlertState: 'alert-state',
    onSnapshot: 'snapshot', onNotice: 'notice' })) {
    pka[method] = callback => subscribe('pka:' + channel, (event, value) => callback(value));
  }
  const pkaLook = {
    onShow: callback => subscribe('pka-look:show', (event, value) => callback(value)),
    copy: text => transport.invoke('pka-look:copy', text),
    close: () => transport.send('pka-look:close'),
  };
  return { pka, pkaLook };
}

module.exports = { createRendererApis };

'use strict';

// Diagnostics-only surface for the reconstruction menu.
//
// It is deliberately kept out of `renderer-api.cjs` so the recovered `pka`
// namespace stays exactly the original contract. The preload exposes it as the
// separate global `pkaDiag`, and only when the app runs in diagnostics mode
// (CLI `--pka-diagnostics` or env `PKA_DIAGNOSTICS=1`). The main process only
// registers its handler in the same mode, so it does not exist in a normal run.
//
// `simulate` starts the local simulation runtime, which is a diagnostic aid: it
// never talks to the game and must not be read as proof the bot works in-game.

function diagnosticsEnabled(env = {}, argv = []) {
  return Array.isArray(argv) && argv.includes('--pka-diagnostics')
    || Boolean(env) && env.PKA_DIAGNOSTICS === '1';
}

function createDiagnosticApis(transport) {
  const pkaDiag = {
    simulate: (enabled, options) => transport.invoke('pka-diag:simulate', enabled === true,
      options && typeof options === 'object' ? options : undefined),
    status: () => transport.invoke('pka-diag:status'),
  };
  return { pkaDiag };
}

module.exports = { createDiagnosticApis, diagnosticsEnabled };

const exposed=createRendererApis(ipcRenderer);
contextBridge.exposeInMainWorld('pka',exposed.pka);
if(typeof process!=='undefined'&&Array.isArray(process.argv)&&diagnosticsEnabled(process.env||{},process.argv)){
  contextBridge.exposeInMainWorld('pkaDiag',createDiagnosticApis(ipcRenderer).pkaDiag);
}
