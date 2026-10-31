'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { WalkerInputRuntime, positionIssue, createKeyboardInput } = require('../reconstruction/walker-input-runtime.cjs');
const { rpmSession } = require('../reconstruction/live-session.cjs');
const { gateReason } = require('../reconstruction/automation.cjs');
const { Controller } = require('../reconstruction/controller.cjs');

function fixture() {
  let clock = 10000;
  const raw = { pid: 42, generatedAt: new Date(clock).toISOString(),
    player: { name: 'Ash', pos: { x: 100, y: 100, z: 7 } } };
  const sent = [];
  const config = { walker: { loop: false, waypoints: [{ action: 'walk', pos: { x: 102, y: 100, z: 7 } }] } };
  const runtime = new WalkerInputRuntime({ getSession: () => rpmSession(raw, clock), playerName: 'Ash', automatic: false,
    now: () => clock, input: async (pid, direction, focus) => { sent.push({ pid, direction, focus }); } });
  const refresh = (time, position) => { clock = time; raw.generatedAt = new Date(time).toISOString(); if (position) raw.player.pos = position; };
  return { runtime, config, sent, raw, refresh, time: value => { clock = value; }, start: () => runtime.setModules('walker', true, 42, config) };
}

test('normal launcher enables RPM Walker only with matching live window identity and pins the character on start', async () => {
  const value = fixture();
  value.runtime.playerName = '';
  assert.equal(value.runtime.sessions[0].capabilities.walkerKeyboard, false);
  value.raw.clientWindowTitle = 'PokeAlliance - Other';
  assert.equal(value.runtime.sessions[0].capabilities.walkerKeyboard, false);
  value.raw.clientWindowTitle = 'PokeAlliance - Ash';
  assert.equal(value.runtime.sessions[0].capabilities.walkerKeyboard, true);
  assert.equal(value.runtime.sessions[0].telemetry.nativeVerified, false);
  await value.start();
  assert.equal(value.runtime.playerName, 'Ash');
  value.raw.player.name = 'Other';
  value.raw.clientWindowTitle = 'PokeAlliance - Other';
  assert.equal(value.runtime.sessions[0].capabilities.walkerKeyboard, false);
  await value.runtime.pause();
});

test('character switching during the background probe cancels Walker before movement', async () => {
  const value = fixture();
  value.runtime.playerName = '';
  value.raw.clientWindowTitle = 'PokeAlliance - Ash';
  value.runtime.input = async () => { value.raw.player.name = 'Other'; value.raw.clientWindowTitle = 'PokeAlliance - Other'; };
  await assert.rejects(value.start(), /Nome do jogador RPM divergente/);
  assert.equal(value.runtime.paused, true);
  assert.deepEqual(value.runtime.modules, []);
});

test('Walker keyboard capability does not impersonate native telemetry or relax the combat gate', () => {
  const value = fixture();
  const session = value.runtime.sessions[0];
  assert.equal(session.capabilities.walkerKeyboard, true);
  assert.equal(session.telemetry.nativeVerified, false);
  assert.equal(gateReason(session), 'native-unverified');
  value.raw.player.name = 'Other';
  assert.equal(value.runtime.sessions[0].capabilities.walkerKeyboard, false);
});

test('position checks reject changed PID, name, invalid coordinates and stale/future timestamps', () => {
  const value = fixture();
  const session = value.runtime.sessions[0];
  assert.equal(positionIssue(session, 42, ' aSH ', 10000), null);
  assert.match(positionIssue(session, 43, 'Ash', 10000), /outro cliente/);
  assert.match(positionIssue(session, 42, '', 10000), /Nome/);
  assert.match(positionIssue(session, 42, 'Ash', 11001), /desatualizada/);
  assert.match(positionIssue(session, 42, 'Ash', 9999), /desatualizada/);
  session.telemetry.position.x = -1;
  assert.match(positionIssue(session, 42, 'Ash', 10000), /invalida/);
});

test('starting Walker probes the chosen client without movement until tick', async () => {
  const value = fixture();
  await value.start();
  assert.deepEqual(value.sent, [{ pid: 42, direction: null, focus: true }]);
  assert.deepEqual(value.runtime.state.modules, ['walker']);
  assert.equal(value.runtime.state.backend, 'keyboard-rpm');
  const result = await value.runtime.tick();
  assert.equal(result.action, 'move');
  assert.equal(value.sent.at(-1).direction, 1);
  assert.equal(value.runtime.sessions[0].telemetry.position.x, 100);
});

test('keyboard Walker decomposes diagonal waypoints into arrows without changing the saved route', async () => {
  for (const pos of [{ x: 102, y: 102, z: 7 }, { x: 98, y: 102, z: 7 },
    { x: 98, y: 98, z: 7 }, { x: 102, y: 98, z: 7 }]) {
    const value = fixture();
    value.config.walker.smartWalking = false;
    value.config.walker.waypoints = [{ action: 'walk', pos }];
    const saved = structuredClone(value.config);
    await value.start();
    await value.runtime.tick();
    assert.equal(value.sent.at(-1).direction, pos.x > 100 ? 1 : 3);
    value.refresh(10300, { x: pos.x, y: 100, z: 7 });
    await value.runtime.tick();
    assert.equal(value.sent.at(-1).direction, pos.y > 100 ? 2 : 0);
    value.refresh(10600, pos);
    assert.equal((await value.runtime.tick()).status, 'done');
    assert.ok(value.sent.filter(event => event.direction !== null).every(event => event.direction <= 3));
    assert.deepEqual(value.config, saved);
  }
});

test('a waypoint completes only after the RPM coordinate reaches it', async () => {
  const value = fixture();
  await value.start();
  await value.runtime.tick();
  assert.equal(value.runtime.engine.state.finished, false);
  value.refresh(10300, { x: 102, y: 100, z: 7 });
  assert.equal((await value.runtime.tick()).status, 'done');
  assert.equal(value.runtime.paused, true);
  assert.deepEqual(value.runtime.modules, []);
  assert.equal(value.sent.filter(event => event.direction !== null).length, 1);
});

test('identical snapshots and the 250ms throttle prevent repeated inputs', async () => {
  const value = fixture();
  await value.start();
  await value.runtime.tick();
  value.time(10250);
  assert.equal(await value.runtime.tick(), null);
  value.refresh(10249);
  assert.equal(await value.runtime.tick(), null);
  assert.equal(value.sent.length, 2);
  value.refresh(10250, { x: 101, y: 100, z: 7 });
  await value.runtime.tick();
  assert.equal(value.sent.length, 3);
});

test('stale RPM stops execution without dispatch and requires a new start', async () => {
  const value = fixture();
  await value.start();
  value.time(11001);
  assert.equal((await value.runtime.tick()).status, 'error');
  assert.equal(value.sent.length, 1);
  assert.equal(value.runtime.paused, true);
  await assert.rejects(value.runtime.togglePause(), /Inicie/);
});

test('changed PID stops the backend while a floor change keeps the route (z-agnostic)', async () => {
  const pidChange = fixture();
  await pidChange.start();
  pidChange.raw.pid = 99;
  assert.equal((await pidChange.runtime.tick()).status, 'error');
  assert.equal(pidChange.sent.length, 1);
  const floorChange = fixture();
  await floorChange.start();
  floorChange.refresh(10300, { x: 100, y: 100, z: 8 });
  assert.equal((await floorChange.runtime.tick()).status, 'walking');
  assert.equal(floorChange.runtime.paused, false);
});

test('a walk route declared on another floor is accepted (z-agnostic)', async () => {
  const value = fixture();
  value.config.walker.waypoints = [{ action: 'walk', pos: { x: 100, y: 100, z: 8 } }];
  await value.start();
  assert.deepEqual(value.runtime.state.modules, ['walker']);
});

test('unsupported modules, empty routes and unsupported actions are rejected before probe', async () => {
  for (const module of ['target', 'healer', 'all']) {
    const value = fixture();
    await assert.rejects(value.runtime.setModules(module, true, 42, value.config), /somente Walker/);
    assert.equal(value.sent.length, 0);
  }
  for (const route of [[], [{ action: 'say', pos: { x: 100, y: 100, z: 7 }, param: 'text' }],
    [{ action: 'wait', pos: { x: 100, y: 100, z: 7 }, param: 'bad' }]]) {
    const value = fixture();
    value.config.walker.waypoints = route;
    await assert.rejects(value.start());
    assert.equal(value.sent.length, 0);
  }
});

test('Wait uses the existing engine and sends no keyboard input', async () => {
  const value = fixture();
  value.config.walker.waypoints = [{ action: 'wait', pos: { x: 100, y: 100, z: 7 }, param: 500 }];
  await value.start();
  assert.equal((await value.runtime.tick()).reason, 'wait');
  value.refresh(10499);
  assert.equal((await value.runtime.tick()).action, 'hold');
  value.refresh(10500);
  assert.equal((await value.runtime.tick()).status, 'done');
  assert.equal(value.sent.length, 1);
});

test('keyboard failure or lost focus stops without reporting movement success', async () => {
  const value = fixture();
  await value.start();
  value.runtime.input = async () => { throw Error('Cliente sem foco'); };
  const result = await value.runtime.tick();
  assert.equal(result.status, 'error');
  assert.match(result.error, /sem foco/);
  assert.equal(value.runtime.paused, true);
  assert.equal(value.raw.player.pos.x, 100);
});

test('overlapping ticks do not duplicate sends and stop waits for the in-flight tap', async () => {
  const value = fixture();
  await value.start();
  let release;
  let calls = 0;
  value.runtime.input = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const tick = value.runtime.tick();
  assert.equal(await value.runtime.tick(), null);
  const stopped = value.runtime.setModules('walker', false);
  assert.equal(value.runtime.paused, true);
  release();
  await Promise.all([tick, stopped]);
  assert.equal(calls, 1);
  assert.deepEqual(value.runtime.modules, []);
});

test('pause or close during background probe cancels a pending start', async () => {
  const value = fixture();
  let release;
  value.runtime.input = () => new Promise(resolve => { release = resolve; });
  const starting = value.start();
  await new Promise(resolve => setImmediate(resolve));
  await value.runtime.close();
  release();
  await assert.rejects(starting, /cancelado/);
  assert.equal(value.runtime.paused, true);
});

test('a stalled route reports error instead of silently skipping the waypoint', async () => {
  const value = fixture();
  await value.start();
  for (let index = 0; index < 7; index++) {
    value.refresh(10000 + index * 300);
    await value.runtime.tick();
  }
  assert.equal(value.runtime.state.status, 'error');
  assert.match(value.runtime.state.error, /stuck/);
  assert.equal(value.raw.player.pos.x, 100);
});

test('controller pka:runtime connects the existing Walker start/stop contract to this backend', async () => {
  const value = fixture();
  const store = { snapshot: () => ({ activeProfile: 'A', profiles: [{ name: 'A', config: value.config }] }) };
  const controller = new Controller(store, { runtime: value.runtime });
  const started = await controller.invoke('pka:runtime', 'walker', true, 42, value.config, 1);
  assert.equal(started.runtime.backend, 'keyboard-rpm');
  assert.equal(started.sessions[0].telemetry.nativeVerified, false);
  await value.runtime.tick();
  assert.equal(value.sent.at(-1).direction, 1);
  const stopped = await controller.invoke('pka:runtime', 'walker', false, 42, undefined, 1);
  assert.deepEqual(stopped.runtime.modules, []);
  await assert.rejects(controller.invoke('pka:command', 42, 'attack', 1), /Motor nativo/);
});

test('UI allows only explicitly marked fresh RPM Walker sessions, leaving unmarked RPM blocked', () => {
  const model = require('../reconstruction/app/ui/walker-model.js');
  const context = { module: { exports: { ...model } } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../reconstruction/walker-input-ui.js'), 'utf8'), context);
  const currentPosition = context.module.exports.currentPosition;
  const value = fixture();
  assert.equal(currentPosition(value.runtime.sessions[0]).x, 100);
  assert.throws(() => currentPosition(rpmSession(value.raw, 10000)), /Aguardando/);
  value.time(11001);
  assert.throws(() => currentPosition(value.runtime.sessions[0]), /Aguardando/);
});

test('input helper passes PID without shell interpolation and rejects malformed or failed responses', async () => {
  let captured;
  const input = createKeyboardInput({ execFile: (executable, args, options, callback) => {
    captured = { executable, args, options };
    callback(null, JSON.stringify({ success: true, pid: 42, eventsSent: 2, foreground: false,
      transport: 'PostMessageW', effectVerified: false }));
  } });
  await input(42, 1);
  assert.deepEqual(captured.args.slice(1), ['--pid', '42', '--direction', '1']);
  assert.equal(captured.options.shell, undefined);
  assert.equal(captured.options.timeout, 2000);
  for (const response of ['bad', '{"success":false,"error":"no focus"}', '{"success":true,"pid":99}',
    '{"success":true,"pid":42,"eventsSent":0,"foreground":true}',
    '{"success":true,"pid":42,"eventsSent":2,"transport":"SendInput"}']) {
    const rejected = createKeyboardInput({ execFile: (_exe, _args, _options, callback) => callback(null, response) });
    await assert.rejects(rejected(42, 1));
  }
  await assert.rejects(input(0, 1), /invalida/);
  await assert.rejects(input(42, 8), /invalida/);
  for (const direction of [4, 5, 6, 7]) await assert.rejects(input(42, direction), /invalida/);
});

test('legacy explicit focus rejection remains compatible and resumes only on request', async () => {
  const value = fixture();
  await value.start();
  const engine = value.runtime.engine;
  const input = value.runtime.input;
  value.runtime.input = createKeyboardInput({ execFile: (_exe, _args, _options, callback) => {
    callback(Error('exit 1'), JSON.stringify({ success: false, pid: 42, error: 'Rejeicao legada',
      errorCode: 'WALKER_FOCUS_LOST', eventsSent: 0 }));
  } });
  const result = await value.runtime.tick();
  assert.equal(result.status, 'paused');
  assert.equal(result.inputAccepted, false);
  assert.equal(value.runtime.engine, engine);
  assert.deepEqual(value.runtime.state.modules, ['walker']);
  assert.equal(value.runtime.paused, true);
  assert.equal(await value.runtime.tick(), null);
  assert.equal(value.sent.length, 1);
  value.runtime.input = input;
  value.refresh(10300);
  await value.runtime.togglePause();
  assert.equal(value.runtime.paused, false);
  assert.equal(value.runtime.engine, engine);
  assert.equal(value.sent.at(-1).focus, true);
  await value.runtime.tick();
  assert.equal(value.sent.at(-1).direction, 1);
});

test('focus error classification requires explicit rejection and zero emitted events', async () => {
  for (const result of [
    { success: false, eventsSent: 1 }, { success: false }, { success: true, eventsSent: 0 },
  ]) {
    const input = createKeyboardInput({ execFile: (_exe, _args, _options, callback) => {
      callback(Error('exit 1'), JSON.stringify({ errorCode: 'WALKER_FOCUS_LOST', ...result }));
    } });
    await assert.rejects(input(42, 1), error => error.code !== 'WALKER_FOCUS_LOST');
  }
});
