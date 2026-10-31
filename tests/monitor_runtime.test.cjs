'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMonitorRuntime, SOUND } = require('../reconstruction/monitor-runtime.cjs');

const session = healthPercent => ({ pid: 777, online: true, stale: false, error: null,
  authExpired: false, ageMs: 0, telemetry: { healthPercent, position: { x: 3320, y: 2264, z: 9 } } });

test('the monitor fires an hp alert sound and publishes its state', () => {
  const sent = [];
  const monitor = createMonitorRuntime({ getSession: () => session(30), send: (channel, value) => sent.push({ channel, value }),
    now: () => 1000, intervalMs: 100000 });
  monitor.set(true, 777, { alerts: { rules: [{ enabled: true, type: 'hp', hpThreshold: 50, name: 'lowhp' }] } });
  monitor.tick();
  assert.ok(sent.some(message => message.channel === 'pka:alert-sound' && message.value.asset === SOUND.hp),
    'hp alert sound');
  assert.ok(sent.some(message => message.channel === 'pka:alert-state' && message.value.monitorEnabled === true),
    'monitor enabled state');
  monitor.close();
});

test('the monitor fires a disconnected alert when the session drops', () => {
  let current = session(100);
  const sent = [];
  const monitor = createMonitorRuntime({ getSession: () => current, send: (channel, value) => sent.push({ channel, value }),
    now: () => 1000, intervalMs: 100000 });
  monitor.set(true, 777, { alerts: { rules: [{ enabled: true, type: 'disconnected', name: 'drop' }] } });
  monitor.tick(); // online, arms
  current = { ...session(100), online: false };
  monitor.tick(); // dropped -> notify
  assert.ok(sent.some(message => message.channel === 'pka:alert-sound' && message.value.asset === SOUND.disconnected));
  monitor.close();
});

test('disabling the monitor stops ticking and republishes state', () => {
  const sent = [];
  const monitor = createMonitorRuntime({ getSession: () => session(10), send: (channel, value) => sent.push({ channel, value }),
    now: () => 1000, intervalMs: 100000 });
  monitor.set(true, 777, { alerts: { rules: [{ enabled: true, type: 'hp', hpThreshold: 50, name: 'hp' }] } });
  assert.deepEqual(monitor.state(), { enabled: true, pid: 777 });
  monitor.set(false, 777, {});
  assert.deepEqual(monitor.state(), { enabled: false, pid: null });
  assert.ok(sent.some(message => message.channel === 'pka:alert-state' && message.value.monitorEnabled === false));
  monitor.close();
});
