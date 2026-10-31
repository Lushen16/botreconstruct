'use strict';

// Local alerts monitor for the reconstruction menu.
//
// Runs the verified alerts engine over the live session telemetry and forwards
// notifications to the renderer as `pka:alert-sound` / `pka:alert-state` events.
// It performs no game I/O: the "pause" actions only ask the runtime to stop the
// configured module(s), exactly like pressing pause in the menu.

const { createAlertsEngine } = require('./engines/alerts-engine.cjs');

const SOUND = Object.freeze({
  hp: 'hp.mp3',
  disconnected: 'disconnected.mp3',
  chat: 'chat.mp3',
  creature: 'creature.mp3',
  hunt_pokemon: 'hunt_pokemon.mp3',
  teleport: 'teleport.mp3',
});

function createMonitorRuntime({ getSession, send, onPause, now = () => Date.now(), intervalMs = 500 } = {}) {
  let engine = null;
  let enabled = false;
  let pid = null;
  let timer = null;

  function state() {
    return { enabled, pid: enabled ? pid : null };
  }

  function publish(runtimePaused) {
    send?.('pka:alert-state', { paused: false, runtimePaused: Boolean(runtimePaused), monitorEnabled: enabled });
  }

  function tick() {
    if (!enabled || !engine) return;
    const session = getSession?.();
    if (!session) return;
    let result;
    try {
      result = engine.step(session, session.telemetry, now());
    } catch {
      return;
    }
    let runtimePaused = false;
    for (const action of result.actions) {
      if (action.action === 'notify') {
        const asset = SOUND[action.type];
        if (asset) send?.('pka:alert-sound', { asset });
      } else if (action.action === 'pause') {
        runtimePaused = true;
        onPause?.(action.target);
      }
    }
    if (runtimePaused) publish(true);
  }

  function set(nextEnabled, nextPid, config) {
    enabled = nextEnabled === true;
    pid = Number.isInteger(nextPid) ? nextPid : null;
    if (enabled) {
      engine = createAlertsEngine(config);
      if (!timer) {
        timer = setInterval(tick, intervalMs);
        timer.unref?.();
      }
      publish(false); // announce the enabled state to the renderer
    } else {
      engine = null;
      if (timer) { clearInterval(timer); timer = null; }
      publish(false);
    }
    return state();
  }

  function close() {
    if (timer) { clearInterval(timer); timer = null; }
    engine = null;
    enabled = false;
  }

  return { set, state, tick, close };
}

module.exports = { createMonitorRuntime, SOUND };
