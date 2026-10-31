'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const TargetEngine = require('../target-engine.cjs');
const { createAutomation, createRecorder } = require('../reconstruction/automation.cjs');
const { createHuntDaemon } = require('../tools/hunt_daemon.cjs');

const root = path.resolve(__dirname, '..');
const scanner = path.join(root, 'tools', 'scan_creatures.py');

function python() {
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const executable of candidates) {
    const probe = spawnSync(executable, ['-c', 'print(1)'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return executable;
  }
  return null;
}

test('scan_creatures parses the confirmed layout and feeds TargetEngine', async t => {
  const interpreter = python();
  if (!interpreter) {
    t.skip('python is not available');
    return;
  }
  const output = path.join(os.tmpdir(), `scan_creatures_${process.pid}.json`);
  const run = spawnSync(interpreter, [scanner, '--selftest', '--output', output],
    { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const snapshot = JSON.parse(fs.readFileSync(output, 'utf8'));
  fs.rmSync(output, { force: true });

  assert.equal(snapshot.schema, 2);
  assert.equal(snapshot.creatures.length, 1);
  const [creature] = snapshot.creatures;
  assert.equal(creature.id, 1001);
  assert.equal(creature.name, 'Charizard');
  assert.deepEqual(creature.pos, { x: 123, y: 456, z: 7 });
  assert.equal(creature.healthPercent, 87);
  assert.equal(creature.canAttack, true);
  assert.equal(creature.is_player, false);
  assert.equal(snapshot.layout.id_offset, '0x5c');
  assert.equal(snapshot.layout.hp_offset, '0xc0');
  assert.equal(snapshot.layout.canattack_offset, '0xc4');
  assert.deepEqual(snapshot.layout.confirmed, ['pos', 'name', 'id', 'healthPercent', 'canAttack']);
  assert.equal(creature.hp, creature.healthPercent);

  const engine = new TargetEngine({ monsters: ['Dragonite', 'Charizard', '*'], maxDistance: 8 });
  const player = { x: 120, y: 456, z: 7, name: 'Player' };
  assert.equal(engine.selectTarget(player, snapshot.creatures).id, 1001);
  assert.equal(engine.isFighting(), true);
  assert.deepEqual(engine.getCombatAction(player, { skills: [{ key: 'f1' }] }),
    { type: 'key', key: 'f1', targetId: 1001 });

  let now = Date.now();
  const automation = createAutomation({ target: { monsters: ['Charizard'],
    skills: [{ key: 'F1', minDistance: 3, maxDistance: 3 }] } },
  { now: () => now, creatureSource: () => snapshot });
  const session = { pid: snapshot.pid, online: true, ageMs: 0,
    telemetry: { nativeVerified: true, pulseVersion: 3, position: { x: 120, y: 456, z: 7 },
      playerName: 'Player', healthPercent: 100, creatures: [] } };
  const recorder = createRecorder();
  assert.deepEqual(automation.tick(session, recorder).emitted,
    [['attack', 1001], ['hotkey', 'f1']]);
  now += 249;
  assert.deepEqual(automation.tick(session, recorder).emitted, []);
  now += 1;
  assert.deepEqual(automation.tick(session, recorder).emitted, [['hotkey', 'f1']]);

  const daemon = createHuntDaemon({ target: { monsters: ['Charizard'], maxDistance: 8,
    skills: [{ key: 'f1' }] }, healer: {}, hoenn: {}, walker: { waypoints: [] } },
  { pid: snapshot.pid, intervalMs: 200, maxAgeMs: 1000, healBelow: 80, resumeAbove: 80 },
  { now: () => now, readSession: async () => ({ ...session,
    generatedAt: new Date(now).toISOString() }), readCreatures: async () => snapshot,
  log: () => {} });
  const result = await daemon.tick();
  assert.equal(result.fight.targetId, 1001);
  assert.deepEqual(result.emitted, [['attack', 1001], ['hotkey', 'f1']]);
});
