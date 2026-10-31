'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CaptureRuntime } = require('../reconstruction/capture-runtime.cjs');
const { EngineRuntime } = require('../reconstruction/engine-runtime.cjs');
const { COMMANDS } = require('../reconstruction/protocol.cjs');

function fixture() {
  const config = { looting: { captureEnabled: true, captureAfterCombat: true, maxCaptureDist: 4,
    captureDelay: 300, captureEntries: [{ name: 'Rattata', corpseId: 4029, ballId: 15650, fallbackBallId: 3156 }] } };
  const telemetry = { position: { x: 100, y: 100, z: 7 }, captureVersion: 1, itemInspectorAvailable: true,
    items: [{ id: 4029, stack: 2, pos: { x: 101, y: 100, z: 7 }, container: true }],
    itemCounts: [{ id: 15650, count: 1 }, { id: 3156, count: 2 }] };
  return { config, telemetry, capture: new CaptureRuntime() };
}

test('Capture consumes observed corpse IDs, never a disappearing or unreadable creature', () => {
  const value = fixture();
  assert.equal(value.capture.plan({ ...value.telemetry, items: [] }, value.config, 1000, { inCombat: false }), null);
  assert.equal(value.capture.plan({ ...value.telemetry, items: null }, value.config, 1000, { inCombat: false }), null);
  const candidate = value.capture.plan(value.telemetry, value.config, 1000, { inCombat: false });
  assert.equal(candidate.item.id, 4029);
  assert.equal(candidate.ball.ballId, 15650);
  assert.deepEqual(value.capture.revalidate(candidate, value.telemetry, value.config).parameter,
    { x: 101, y: 100, z: 7, itemId: 15650, targetId: 4029, stack: 2 });
});

test('Capture honors enabled, version, completeness, combat, floor and range gates', () => {
  const value = fixture();
  for (const patch of [{ captureVersion: 0 }, { itemInspectorAvailable: false }, { itemsComplete: false },
    { position: { x: 100, y: 100, z: 8 } }, { position: { x: 120, y: 100, z: 7 } }]) {
    assert.equal(value.capture.plan({ ...value.telemetry, ...patch }, value.config, 1000, { inCombat: false }), null);
  }
  assert.equal(value.capture.plan(value.telemetry, value.config, 1000, { inCombat: true }), null);
  value.config.looting.captureAfterCombat = false;
  assert.ok(value.capture.plan(value.telemetry, value.config, 1000, { inCombat: true }));
});

test('Capture chooses configured fallback only when primary inventory count is zero', () => {
  const value = fixture(); value.telemetry.itemCounts[0].count = 0;
  const candidate = value.capture.plan(value.telemetry, value.config, 1000, { inCombat: false });
  assert.equal(candidate.ball.ballId, 3156);
  value.telemetry.itemCounts[1].count = 0;
  assert.equal(value.capture.revalidate(candidate, value.telemetry, value.config).reason, 'capture-ball-updated');
  assert.equal(value.capture.plan(value.telemetry, value.config, 1000, { inCombat: false }), null);
});

test('Capture revalidates identity, stack, position and configuration immediately before dispatch', () => {
  const value = fixture(); const candidate = value.capture.plan(value.telemetry, value.config, 1000, { inCombat: false });
  for (const patch of [{ id: 99 }, { stack: 3 }, { pos: { x: 102, y: 100, z: 7 } }]) {
    assert.equal(value.capture.revalidate(candidate, { ...value.telemetry,
      items: [{ ...value.telemetry.items[0], ...patch }] }, value.config).state, 'BLOCKED');
  }
  value.config.looting.captureEntries[0].ballId = 4;
  assert.equal(value.capture.revalidate(candidate, value.telemetry, value.config).reason, 'capture-config-changed');
});

test('Capture never repeats an accepted instance and resumes when no pending corpse remains', () => {
  const value = fixture(); const candidate = value.capture.plan(value.telemetry, value.config, 1000, { inCombat: false });
  assert.equal(value.capture.record(candidate, value.config, 1000, true).effectVerified, false);
  assert.equal(value.capture.plan(value.telemetry, value.config, 1400, { inCombat: false }), null);
  assert.equal(value.capture.last.status, 'idle');
  value.capture.plan({ ...value.telemetry, items: [] }, value.config, 1500, { inCombat: false });
  assert.ok(value.capture.plan(value.telemetry, value.config, 1600, { inCombat: false }));
});

test('Capture rejects ambiguous duplicate rows and invalid stacks', () => {
  const value = fixture(); value.telemetry.items.push(structuredClone(value.telemetry.items[0]));
  assert.equal(value.capture.plan(value.telemetry, value.config, 1000, { inCombat: false }), null);
  assert.equal(value.capture.last.reason, 'capture-item-ambiguous');
  value.telemetry.items.pop(); value.telemetry.items[0].stack = 256;
  assert.equal(value.capture.plan(value.telemetry, value.config, 1000, { inCombat: false }), null);
});

test('Continuous mode retries a still-observed corpse only after configured delay', () => {
  const value = fixture(); value.config.looting.captureAfterCombat = false;
  const candidate = value.capture.plan(value.telemetry, value.config, 1000, { inCombat: false });
  value.capture.record(candidate, value.config, 1000, true);
  assert.equal(value.capture.plan(value.telemetry, value.config, 1299, { inCombat: false }), null);
  assert.ok(value.capture.plan(value.telemetry, value.config, 1300, { inCombat: false }));
});

test('Electron native runtime pipeline dispatches useWith then returns to Walker without claiming capture', async context => {
  const value = fixture(); let clock = 1000; const commands = [];
  const snapshot = { pid: 42, online: true, ageMs: 0, telemetry: { ...value.telemetry,
    nativeVerified: true, pulseVersion: 3, creatures: [], roster: [], healthPercent: 100 } };
  const runtime = new EngineRuntime({ automatic: false, now: () => clock,
    openAdapter: async () => ({ supportedCommands: Object.keys(COMMANDS), getSnapshot: () => snapshot,
      command: async (name, parameter) => { commands.push({ name, parameter }); return true; },
      pauseWalker: async () => true, close: async () => {} }) });
  context.after(() => runtime.close());
  value.config.walker = { loop: false, waypoints: [{ action: 'walk', pos: { x: 103, y: 100, z: 7 } }] };
  await runtime.setModules('walker', true, 42, value.config);
  assert.equal((await runtime.tick()).status, 'capture');
  assert.equal(commands[0].name, 'useWith');
  assert.equal(commands[0].parameter.targetId, 4029);
  assert.equal(runtime.state.capture.effectVerified, false);
  clock += 350;
  assert.equal((await runtime.tick()).status, 'walking');
  assert.equal(commands[1].name, 'walk');
});

test('Native useWith rejection faults the runtime and is not retried', async context => {
  const value = fixture(); let calls = 0;
  const runtime = new EngineRuntime({ automatic: false, now: () => 1000,
    openAdapter: async () => ({ supportedCommands: Object.keys(COMMANDS), getSnapshot: () => ({ pid: 42,
      online: true, ageMs: 0, telemetry: { ...value.telemetry, nativeVerified: true, pulseVersion: 3, creatures: [] } }),
      command: async () => { calls++; return false; }, pauseWalker: async () => true, close: async () => {} }) });
  context.after(() => runtime.close());
  await runtime.setModules('target', true, 42, value.config);
  assert.equal((await runtime.tick()).status, 'error');
  assert.equal(await runtime.tick(), null);
  assert.equal(calls, 1);
});
