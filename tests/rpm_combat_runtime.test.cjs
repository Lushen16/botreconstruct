'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RpmCombatRuntime } = require('../reconstruction/rpm-combat-runtime.cjs');
const { projectTarget, createCombatInput } = require('../reconstruction/keyboard-combat.cjs');
const { EXECUTABLE_SHA256, LAYOUT_ID } = require('../reconstruction/item-source.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function captureFixture() {
  const value = fixture();
  value.config.looting = { captureEnabled: true, captureAfterCombat: true, maxCaptureDist: 3,
    captureDelay: 300, captureEntries: [{ corpseId: 4029, ballId: 15650, fallbackBallId: 3156 }] };
  value.transport.captureHotkeys = { '15650': 'B' };
  value.transport.clientConfig = path.join(__dirname, 'fixtures/capture-client.otml');
  value.transport.captureBindingVerification = { source: 'live-confirmation',
    verifiedAt: new Date(1000).toISOString(), useWithActions: [6],
    configSha256: crypto.createHash('sha256').update(fs.readFileSync(value.transport.clientConfig)).digest('hex') };
  const scan = { schemaVersion: 1, pid: 42, generatedAt: value.telemetry.creaturesGeneratedAt,
    processStartedAt: 'session-one', moduleBase: '0x140000000', executableSha256: EXECUTABLE_SHA256,
    layoutId: LAYOUT_ID, complete: true, truncated: false, readErrors: [],
    player: structuredClone(value.telemetry.creaturePlayer),
    itemIdentityProfile: { executableSha256: EXECUTABLE_SHA256, layoutId: LAYOUT_ID },
    items: [{ id: 4029, stack: 2, pos: { x: 101, y: 100, z: 7 }, struct_va: '0x400', tile_va: '0x500' }] };
  value.runtime.itemSource = () => scan;
  return { ...value, scan, refreshItems: () => { scan.generatedAt = value.telemetry.creaturesGeneratedAt; } };
}

test('RPM pipeline waits for combat, dispatches configured ball by corpse ID, then resumes Walker', async () => {
  const value = captureFixture();
  await value.start('walker'); await value.start('target');
  assert.equal((await value.runtime.tick()).action, 'attack');
  assert.equal(value.runtime.state.capture.reason, 'capture-after-combat');
  value.telemetry.creatures = value.telemetry.creatures.filter(creature => creature.creatureType === 3);
  value.advance(); value.refreshItems();
  const index = value.runtime.engine.state.index;
  assert.equal((await value.runtime.tick()).status, 'capture');
  const request = value.events.at(-1).request;
  assert.equal(request.kind, 'useWith'); assert.equal(request.key, 'B');
  assert.equal(request.itemId, 15650); assert.equal(request.targetId, 4029);
  assert.equal(request.x, 432); assert.equal(request.itemGuard.item.struct_va, '0x400');
  assert.equal(value.runtime.engine.state.index, index);
  assert.equal(value.runtime.state.capture.effectVerified, false);
  value.advance(); value.refreshItems(); await value.runtime.tick();
  assert.equal(value.events.filter(event => event.request?.kind === 'useWith').length, 1);
  assert.equal(value.events.at(-1).input[1], 1);
});

test('RPM does not infer a corpse from disappearance, timeouts or failed item reads', async () => {
  for (const modify of [scan => { scan.items = []; }, scan => { scan.complete = false; },
    scan => { scan.pid = 99; }, scan => { scan.generatedAt = new Date(1).toISOString(); },
    scan => { scan.items[0].id = 77; }, scan => { scan.readErrors = ['RPM failed']; }]) {
    const value = captureFixture(); modify(value.scan);
    value.telemetry.creatures = value.telemetry.creatures.filter(creature => creature.creatureType === 3);
    await value.start('target'); await value.runtime.tick();
    assert.equal(value.events.filter(event => event.request).length, 0);
  }
});

test('RPM revalidates the latest item stream and blocks a moved corpse before input', async () => {
  const value = captureFixture(); let reads = 0;
  value.config.looting.captureAfterCombat = false;
  value.runtime.itemSource = () => {
    reads++;
    return reads === 1 ? value.scan : { ...value.scan, items: [] };
  };
  await value.start('walker'); await value.runtime.tick();
  assert.equal(value.events.filter(event => event.request).length, 0);
  assert.equal(value.runtime.state.capture.status, 'blocked');
});

test('RPM uncertain useWith pauses without retry or falsely reporting capture', async () => {
  const value = captureFixture(); let attempts = 0;
  value.config.looting.captureAfterCombat = false;
  value.runtime.combatInput = async () => { attempts++; throw Error('partial: two messages queued'); };
  await value.start('walker');
  assert.equal((await value.runtime.tick()).status, 'error');
  value.advance(); value.refreshItems(); assert.equal(await value.runtime.tick(), null);
  assert.equal(attempts, 1); assert.equal(value.runtime.state.paused, true);
  assert.equal(value.runtime.state.capture.effectVerified, false);
});

test('Walker-only after-combat capture requires independent fresh combat perception', async () => {
  const value = captureFixture(); await value.start('walker');
  await value.runtime.tick();
  assert.equal(value.events.filter(event => event.request?.kind === 'useWith').length, 0);
  assert.equal(value.runtime.state.capture.reason, 'capture-after-combat');
  value.advance(); value.refreshItems();
  value.telemetry.creaturesGeneratedAt = new Date(1).toISOString();
  await value.runtime.tick();
  assert.equal(value.events.filter(event => event.request?.kind === 'useWith').length, 0);
});

test('Adding Walker preserves the shared combat dispatch cooldown', async () => {
  const value = fixture(); await value.start('target');
  await value.runtime.tick(); await value.start('walker');
  assert.equal(await value.runtime.tick(), null);
  assert.equal(value.events.filter(event => event.request).length, 1);
  value.advance(250); await value.runtime.tick();
  assert.equal(value.events.filter(event => event.request).length, 2);
});

function fixture() {
  let clock = 10000;
  const events = [];
  const config = { target: { monsters: [{ name: 'Rat*', priority: 1, range: 7 }],
    combo: { enabled: true, useNativeSequence: false, sequenceText: 'm1 m2', stepDelay: 250 } },
  walker: { loop: false, waypoints: [{ action: 'walk', pos: { x: 103, y: 100, z: 7 } }] } };
  const telemetry = { nativeVerified: false, playerName: 'Ash', position: { x: 100, y: 100, z: 7 },
    creaturesStale: false, creaturesGeneratedAt: new Date(clock).toISOString(),
    creatureIdentityProfile: { executableSha256: '473df25c1edd23e7464ad3ba9b923a603051a8b4ae8004a95c06402f678294e6', typeOffset: '0x186' },
    creaturePlayer: { id: 0x10000001, name: 'Ash', pos: { x: 100, y: 100, z: 7 },
      creatureType: 0, ownershipVerified: true, struct_va: '0x200' },
    creatures: [{ id: 7, name: 'Rattata', pos: { x: 101, y: 100, z: 7 }, healthPercent: 100,
      canAttack: true, creatureType: 1, ownershipVerified: true, struct_va: '0x300' },
    { id: 1003, name: 'Eevee', pos: { x: 100, y: 101, z: 7 }, healthPercent: 100,
      canAttack: false, creatureType: 3, isOwnPokemon: true, ownershipVerified: true, struct_va: '0x100' }] };
  const transport = { bindings: { m1: 'F1', m2: 'F2', '!autocombo': 'C' }, cooldownsMs: {},
    viewport: { width: 800, height: 600, centerX: 400, centerY: 300, tileSize: 32,
      map: { left: 100, top: 100, right: 700, bottom: 500 } } };
  const runtime = new RpmCombatRuntime({ automatic: false, now: () => clock, playerName: 'Ash',
    getSession: () => ({ pid: 42, source: 'rpm', online: true, generatedAt: new Date(clock).toISOString(), telemetry }),
    loadTransport: () => transport,
    input: async (...args) => { events.push({ input: args }); },
    combatInput: async (pid, request) => {
      events.push({ pid, request });
      return { success: true, pid, hwnd: '0x42', eventsSent: 2, foreground: true };
    },
  });
  return { runtime, config, events, telemetry, transport, advance: (ms = 300, fresh = true) => {
    clock += ms; if (fresh) telemetry.creaturesGeneratedAt = new Date(clock).toISOString(); },
    start: module => runtime.setModules(module, true, 42, config),
  };
}

test('RPM target uses real entity schema, queues attack then configured keys with GCD', async () => {
  const value = fixture(); await value.start('target');
  assert.equal(value.runtime.sessions[0].telemetry.nativeVerified, false);
  assert.equal((await value.runtime.tick()).action, 'attack');
  assert.equal(value.events.at(-1).request.x, 432);
  assert.equal(await value.runtime.tick(), null);
  value.advance(249); assert.equal(await value.runtime.tick(), null);
  value.advance(1); assert.equal((await value.runtime.tick()).action, 'talk');
  assert.equal(value.events.at(-1).request.key, 'F1');
  value.advance(); await value.runtime.tick();
  assert.equal(value.events.at(-1).request.key, 'F2');
  assert.equal(value.runtime.state.targetEffectVerified, false);
});

test('RPM sends the configured lure skill while Target luring is enabled', async () => {
  const value = fixture();
  value.config.target.luring = { enabled: true };
  value.config.target.lureSkill = { enabled: true, hpPercent: 50, move: 'm3' };
  value.transport.bindings.m3 = 'F3'; value.telemetry.healthPercent = 100;
  await value.start('target');
  await value.runtime.tick();
  value.advance();
  assert.equal((await value.runtime.tick()).action, 'talk');
  assert.equal(value.events.at(-1).request.key, 'F3');
});

test('RPM ignores the configured lure skill while Target luring is disabled', async () => {
  const value = fixture();
  value.config.target.lureSkill = { enabled: true, hpPercent: 50, move: 'm3' };
  value.transport.bindings.m3 = 'F3'; value.telemetry.healthPercent = 100;
  await value.start('target');
  await value.runtime.tick();
  value.advance();
  assert.equal((await value.runtime.tick()).action, 'talk');
  assert.equal(value.events.at(-1).request.key, 'F1');
});

test('Target activation and deactivation preserve the running Walker and its index', async () => {
  const value = fixture(); await value.start('walker');
  const engine = value.runtime.engine;
  await value.start('target');
  assert.equal(value.runtime.engine, engine);
  assert.deepEqual(value.runtime.modules, ['walker', 'target']);
  await value.runtime.setModules('target', false);
  assert.equal(value.runtime.engine, engine);
  assert.deepEqual(value.runtime.modules, ['walker']);
  assert.equal(value.runtime.paused, false);
  await value.runtime.tick(); assert.equal(value.events.at(-1).input[1], 1);
});

test('combat holds movement, dead targets discard queued skills and release Walker', async () => {
  const value = fixture(); await value.start('walker'); await value.start('target');
  await value.runtime.tick();
  assert.equal(value.events.filter(event => event.input?.[1] !== null && event.input).length, 0);
  value.telemetry.creatures[0].healthPercent = 0;
  value.advance(); await value.runtime.tick();
  assert.equal(value.events.at(-1).input[1], 1);
  assert.equal(value.events.some(event => event.request?.kind === 'key'), false);
});

test('priority selection, player exclusion and conflicting duplicate IDs are honored', async () => {
  const value = fixture();
  value.config.target.monsters = [{ name: 'Priority', priority: 0, range: 7 }, { name: '*', priority: 1, range: 7 }];
  value.telemetry.creatures.push({ ...value.telemetry.creatures[0], id: 8, name: 'Priority', pos: { x: 102, y: 100, z: 7 } },
    { ...value.telemetry.creatures[0], id: 0x10000001, name: 'Priority' },
    { ...value.telemetry.creatures[0], id: 9, name: 'Priority' },
    { ...value.telemetry.creatures[0], id: 9, name: 'Priority', healthPercent: 10 });
  await value.start('target'); await value.runtime.tick();
  assert.equal(value.runtime.state.selectedTargetId, 8);
  assert.ok(!value.runtime.sessions[0].telemetry.creatures.some(creature => creature.id === 9));
});

test('stale perception stops both modules before any extra input', async () => {
  const value = fixture(); await value.start('walker'); await value.start('target');
  value.telemetry.creaturesStale = true;
  const count = value.events.length;
  assert.equal((await value.runtime.tick()).status, 'error');
  assert.equal(value.runtime.paused, true);
  assert.equal(value.events.length, count);
});

test('individual configured cooldowns remain effective after reconfiguring Target', async () => {
  const value = fixture(); value.transport.cooldownsMs.f1 = 2000;
  await value.start('target'); await value.runtime.tick(); value.advance(); await value.runtime.tick();
  value.config.target.combo.sequenceText = 'm1';
  value.runtime.updateConfig(value.config); value.advance(); await value.runtime.tick();
  value.advance(); assert.equal(await value.runtime.tick(), null);
  value.advance(2000); await value.runtime.tick();
  assert.equal(value.events.filter(event => event.request?.key === 'F1').length, 2);
});

test('Target-only pause can resume and stop-all cancels its pending rotation', async () => {
  const value = fixture(); await value.start('target'); await value.runtime.tick();
  await value.runtime.togglePause(); assert.equal(value.runtime.paused, true);
  await value.runtime.togglePause(); assert.equal(value.runtime.paused, false);
  await value.runtime.setModules('all', false);
  value.advance(); assert.equal(await value.runtime.tick(), null);
  assert.deepEqual(value.runtime.modules, []);
});

test('projection rejects absent calibration, another floor and off-map targets', () => {
  const value = fixture(); const creature = value.telemetry.creatures[0];
  assert.throws(() => projectTarget(null, value.telemetry.position, creature));
  assert.throws(() => projectTarget(value.transport.viewport, { ...value.telemetry.position, z: 8 }, creature));
  assert.throws(() => projectTarget(value.transport.viewport, value.telemetry.position, { ...creature, pos: { x: 999, y: 100, z: 7 } }));
});

test('Target start revalidates creature freshness after acquiring focus', async () => {
  const value = fixture();
  value.runtime.input = async () => { value.telemetry.creaturesStale = true; };
  await assert.rejects(value.start('target'), /desatualizada/u);
  assert.equal(value.runtime.paused, true);
  assert.deepEqual(value.runtime.modules, []);
});

test('Target resume rejects telemetry that expires during focus acquisition', async () => {
  const value = fixture(); await value.start('target'); await value.runtime.togglePause();
  value.runtime.input = async () => { value.advance(1500); };
  const getSession = value.runtime.getSession;
  const session = getSession();
  value.runtime.getSession = () => session;
  await assert.rejects(value.runtime.togglePause(), /desatualizada/u);
  assert.equal(value.runtime.paused, true);
  assert.deepEqual(value.runtime.modules, ['target']);
});

test('Target resume rejects stale creatures before attempting focus', async () => {
  const value = fixture(); await value.start('target'); await value.runtime.togglePause();
  value.telemetry.creaturesStale = true;
  const count = value.events.length;
  await assert.rejects(value.runtime.togglePause(), /desatualizada/u);
  assert.equal(value.events.length, count);
  assert.equal(value.runtime.paused, true);
});

test('actuator rejection or incomplete events are never reported as combat success', async () => {
  for (const response of [{ success: false, error: 'access denied' }, { success: true, pid: 42, eventsSent: 1, foreground: true },
    { success: true, pid: 43, eventsSent: 2, foreground: true }]) {
    const input = createCombatInput({ execFile: (_exe, _args, _opts, callback) => callback(null, JSON.stringify(response)) });
    await assert.rejects(input(42, { kind: 'key', key: 'F1' }));
  }
});

test('native keyboard AutoCombo maps the client binding instead of hidden manual steps', async () => {
  const value = fixture(); value.config.target.combo.useNativeSequence = true;
  await value.start('target'); await value.runtime.tick(); value.advance();
  await value.runtime.tick();
  assert.equal(value.events.at(-1).request.key, 'C');
  assert.equal(value.events.some(event => event.request?.key === 'F1'), false);
});

test('dynamic type protects own Pokemon while allowing a wild namesake', async () => {
  const value = fixture();
  value.config.target.monsters = [{ name: '*', priority: 1, range: 7 }];
  value.telemetry.creatures[0].name = 'Charmander';
  value.telemetry.creatures[1].name = 'Charmander';
  value.telemetry.creatures.push(
    { ...value.telemetry.creatures[0], id: 9, name: 'Owned', is_owned: true, healthPercent: 1 });
  await value.start('target'); await value.runtime.tick();
  assert.equal(value.runtime.state.selectedTargetId, 7);
  assert.deepEqual(value.runtime.sessions[0].telemetry.creatures.map(creature => creature.id), [7]);
});

test('missing, stale or ambiguous ownership prevents combat before any command', async () => {
  for (const change of [value => { delete value.telemetry.creatureIdentityProfile; },
    value => value.advance(501, false), value => { value.telemetry.creatures.pop(); },
    value => value.telemetry.creatures.push({ ...value.telemetry.creatures[1], id: 1004 })]) {
    const value = fixture(); change(value);
    await assert.rejects(value.start('target'));
    assert.equal(value.events.some(event => event.request), false);
  }
});

test('ownership change cancels queued skills and never attacks the new own entity', async () => {
  const value = fixture(); await value.start('target'); await value.runtime.tick();
  const sent = value.events.filter(event => event.request).length;
  value.advance(); value.telemetry.creatures[0].creatureType = 3;
  await value.runtime.tick();
  assert.equal(value.events.filter(event => event.request).length, sent);
  assert.deepEqual(value.runtime.queue, []);
  assert.equal(value.runtime.paused, true);
});

test('every attack and skill carries fresh player, own and target identity', async () => {
  const value = fixture(); await value.start('target'); await value.runtime.tick();
  value.advance(); await value.runtime.tick();
  for (const event of value.events.filter(event => event.request)) {
    assert.equal(event.request.targetGuard.target.id, 7);
    assert.equal(event.request.targetGuard.own.id, 1003);
    assert.equal(event.request.targetGuard.player.id, 0x10000001);
    assert.equal(event.request.targetGuard.pid, 42);
  }
});

test('moving target rejection waits for a new snapshot and reprojects without pausing Walker', async () => {
  const value = fixture(); await value.start('walker'); await value.start('target');
  const engine = value.runtime.engine;
  const acceptedInput = value.runtime.combatInput;
  value.runtime.combatInput = async () => { throw Object.assign(Error('moved'), { code: 'COMBAT_TARGET_MOVED' }); };
  assert.equal((await value.runtime.tick()).status, 'retrying');
  assert.equal(value.runtime.paused, false);
  assert.equal(value.runtime.engine, engine);
  assert.deepEqual(value.runtime.modules, ['walker', 'target']);
  value.runtime.combatInput = acceptedInput;
  assert.equal(await value.runtime.tick(), null);
  value.telemetry.creatures[0].pos = { x: 102, y: 100, z: 7 };
  value.advance();
  assert.equal((await value.runtime.tick()).action, 'attack');
  assert.equal(value.events.at(-1).request.x, 464);
  assert.equal(value.events.at(-1).request.targetGuard.target.id, 7);
  assert.equal(value.events.some(event => event.request?.key), false);
});

test('movement rejection during a skill reselects before resuming the pending skill and GCD', async () => {
  const value = fixture(); await value.start('target'); await value.runtime.tick(); value.advance();
  const acceptedInput = value.runtime.combatInput;
  value.runtime.combatInput = async () => { throw Object.assign(Error('moved'), { code: 'COMBAT_TARGET_MOVED' }); };
  assert.equal((await value.runtime.tick()).status, 'retrying');
  value.runtime.combatInput = acceptedInput;
  value.telemetry.creatures[0].pos = { x: 102, y: 100, z: 7 }; value.advance();
  assert.equal((await value.runtime.tick()).action, 'attack');
  assert.equal(await value.runtime.tick(), null);
  value.advance();
  assert.equal((await value.runtime.tick()).action, 'talk');
  assert.equal(value.events.at(-1).request.key, 'F1');
});

test('target loss after a movement rejection cancels pending skills without stale clicks', async () => {
  for (const change of [creature => { creature.healthPercent = 0; },
    creature => { creature.pos.z = 8; }, creature => { creature.id = 8; creature.healthPercent = 0; }]) {
    const value = fixture(); await value.start('target');
    const acceptedInput = value.runtime.combatInput;
    value.runtime.combatInput = async () => { throw Object.assign(Error('moved'), { code: 'COMBAT_TARGET_MOVED' }); };
    await value.runtime.tick(); value.runtime.combatInput = acceptedInput;
    change(value.telemetry.creatures[0]); value.advance(); await value.runtime.tick();
    assert.equal(value.events.some(event => event.request), false);
    assert.deepEqual(value.runtime.queue, []);
  }
});

test('only PID-bound zero-event movement errors receive the recoverable transport code', async () => {
  for (const response of [
    { success: false, pid: 42, eventsSent: 0, errorCode: 'COMBAT_TARGET_MOVED', error: 'moved' },
    { success: false, pid: 43, eventsSent: 0, errorCode: 'COMBAT_TARGET_MOVED', error: 'moved' },
    { success: false, pid: 42, eventsSent: 1, errorCode: 'COMBAT_TARGET_MOVED', error: 'moved' },
  ]) {
    const input = createCombatInput({ execFile: (_exe, _args, _opts, callback) => callback(Error('exit 1'), JSON.stringify(response)) });
    await assert.rejects(input(42, { kind: 'attack' }), error => {
      assert.equal(error.code, response.pid === 42 && response.eventsSent === 0 ? 'COMBAT_TARGET_MOVED' : undefined);
      return true;
    });
  }
});

test('combat focus loss pauses both modules without discarding the Walker route', async () => {
  const value = fixture(); await value.start('walker'); await value.start('target');
  const engine = value.runtime.engine;
  value.runtime.combatInput = async () => { throw Object.assign(Error('focus lost'), { code: 'WALKER_FOCUS_LOST' }); };
  assert.equal((await value.runtime.tick()).status, 'paused');
  assert.equal(value.runtime.engine, engine);
  assert.deepEqual(value.runtime.modules, ['walker', 'target']);
  assert.equal(value.runtime.paused, true);
  assert.deepEqual(value.runtime.queue, []);
});

test('Walker steps continuously in idle combat without waiting for new creature timestamps', async () => {
  const value = fixture();
  // Only own Pokemon in sight (no hostiles)
  value.telemetry.creatures = [value.telemetry.creatures[1]];
  await value.start('walker');
  await value.start('target');
  assert.deepEqual(value.runtime.modules, ['walker', 'target']);

  // First step of Walker
  const tick1 = await value.runtime.tick();
  assert.equal(tick1?.status, 'walking');
  assert.equal(value.events.at(-1).input[1], 1); // Right arrow

  // Player position updates, 300ms pass, but creature scanner has NOT updated its timestamp (fresh = false)
  value.advance(300, false);
  value.telemetry.position = { x: 101, y: 100, z: 7 };
  value.telemetry.creaturePlayer.pos = { x: 101, y: 100, z: 7 };

  // Second step must advance without stalling on the unchanged creaturesGeneratedAt
  const tick2 = await value.runtime.tick();
  assert.equal(tick2?.status, 'walking');
  assert.equal(value.events.at(-1).input[1], 1);
});
