'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCreatureSource } = require('../tools/creature_bridge.cjs');

test('stream retains fresh snapshots only on transient read failures', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'creature-stream-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'live-creatures.json');
  let now = 2000;
  const source = createCreatureSource(file, { now: () => now, pid: 10 });
  const snapshot = { schema: 2, pid: 10, generatedAt: new Date(1800).toISOString(), creatures: [] };
  fs.writeFileSync(file, JSON.stringify(snapshot));
  assert.deepEqual(source(), snapshot);
  fs.writeFileSync(file, '{');
  assert.deepEqual(source(), snapshot);
  for (const changes of [{ pid: 11 }, { error: 'read failed' },
    { generatedAt: new Date(1700).toISOString() }, { diagnostics: { limit_reached: true } }]) {
    fs.writeFileSync(file, JSON.stringify(snapshot));
    source();
    fs.writeFileSync(file, JSON.stringify({ ...snapshot, ...changes }));
    assert.throws(source);
  }
  now = 2801;
  fs.unlinkSync(file);
  assert.throws(source);
});

test('daemon preserves lock across atomic updates and read gaps, releases on death', async t => {
  const { createHuntDaemon } = require('../tools/hunt_daemon.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'creature-lock-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'live-creatures.json');
  let now = 1000;
  const first = { id: 7, name: 'Wild', canAttack: true, healthPercent: 100,
    pos: { x: 102, y: 100, z: 7 } };
  const second = { ...first, id: 8, pos: { x: 101, y: 100, z: 7 } };
  const publish = creatures => {
    fs.writeFileSync(file + '.tmp', JSON.stringify({ schema: 2, pid: 10,
      generatedAt: new Date(now).toISOString(), creatures }));
    fs.renameSync(file + '.tmp', file);
  };
  const config = { target: { monsters: ['*'], maxDistance: 8 },
    walker: { waypoints: [{ action: 'walk', pos: { x: 105, y: 100, z: 7 } }] } };
  const daemon = createHuntDaemon(config,
    { pid: 10, creatures: file, maxAgeMs: 1000, healBelow: 80, resumeAbove: 80 },
    { now: () => now, log() {}, readSession: async () => ({ pid: 10,
      generatedAt: new Date(now).toISOString(), ageMs: 0, online: true,
      telemetry: { nativeVerified: true, pulseVersion: 3, healthPercent: 100,
        position: { x: 100, y: 100, z: 7 }, creatures: [] } }) });
  publish([first]);
  assert.equal((await daemon.tick()).fight.targetId, 7);
  now = 1200;
  fs.writeFileSync(file, '{');
  assert.equal((await daemon.tick()).fight.targetId, 7);
  publish([second, first]);
  assert.equal((await daemon.tick()).fight.targetId, 7);
  publish([second, { ...first, healthPercent: 0 }]);
  assert.equal((await daemon.tick()).fight.targetId, 8);
  publish([{ ...second, canAttack: false }]);
  assert.equal((await daemon.tick()).status, 'walking');
  publish([first]);
  assert.equal((await daemon.tick()).fight.targetId, 7);
  now = 2301;
  fs.unlinkSync(file);
  assert.equal((await daemon.tick()).status, 'blocked');
});
