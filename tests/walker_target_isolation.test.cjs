'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Controller } = require('../reconstruction/controller.cjs');
const { WalkerInputRuntime } = require('../reconstruction/walker-input-runtime.cjs');

function fixture(ports = {}) {
  let now = 10000;
  const inputs = [];
  let config = { walker: { loop: false, luaProfile: 'wk_A.lua', luaRevision: 'old',
    waypoints: [{ action: 'walk', pos: { x: 102, y: 100, z: 7 } }] },
  target: { shinyPriorityEnabled: false } };
  const runtime = new WalkerInputRuntime({ automatic: false, now: () => now,
    playerName: 'Ash', input: async (...args) => { inputs.push(args); },
    getSession: () => ({ pid: 42, source: 'rpm', online: true, stale: false,
      generatedAt: new Date(now).toISOString(),
      telemetry: { playerName: 'Ash', position: { x: 100, y: 100, z: 7 } } }),
  });
  const store = {
    snapshot: () => ({ activeProfile: 'A', profiles: [{ name: 'A', config: structuredClone(config) }] }),
    save: async (_name, next) => { config = structuredClone(next); },
  };
  const controller = new Controller(store, { runtime, ...ports });
  return { runtime, inputs, controller,
    config: () => structuredClone(config),
    start: () => controller.invoke('pka:runtime', 'walker', true, 42, config, 1),
    save: next => controller.invoke('pka:autosave', 'A', next, 1),
    tick: async () => { now += 300; return runtime.tick(); },
  };
}

test('Target autosave and rejected activation preserve the active keyboard Walker', async () => {
  const value = fixture();
  await value.start();
  const engine = value.runtime.engine;
  const epoch = value.runtime.epoch;
  const changed = value.config();
  changed.target.shinyPriorityEnabled = true;
  await value.save(changed);
  await assert.rejects(value.controller.invoke('pka:runtime', 'target', true, 42, changed, 1), /backend de combate/);
  assert.deepEqual(value.runtime.state.modules, ['walker']);
  assert.equal(value.runtime.state.paused, false);
  assert.equal(value.runtime.engine, engine);
  assert.equal(value.runtime.epoch, epoch);
  assert.equal(value.config().target.shinyPriorityEnabled, true);
  await value.tick();
  assert.equal(value.inputs.at(-1)[1], 1);
});

test('route revision metadata and property order do not stop an unchanged Walker', async () => {
  let revision = 0;
  const value = fixture({ saveRoute: async () => ({ revision: String(++revision) }) });
  await value.start();
  for (const latest of ['new', 'newer']) {
    const changed = { target: { shinyPriorityEnabled: true }, walker: {
      luaRevision: latest, luaProfile: 'wk_A.lua', waypoints: value.config().walker.waypoints, loop: false,
    } };
    const result = await value.save(changed);
    assert.equal(result.luaRevision, String(revision));
    assert.deepEqual(value.runtime.state.modules, ['walker']);
    assert.equal(value.runtime.state.paused, false);
  }
  await value.tick();
  assert.equal(value.inputs.at(-1)[1], 1);
});

test('editing a waypoint, loop or route identity still stops Walker', async () => {
  for (const mutate of [config => { config.walker.waypoints[0].pos.x += 1; },
    config => { config.walker.loop = true; }, config => { config.walker.luaProfile = 'wk_other.lua'; }]) {
    const value = fixture();
    await value.start();
    const changed = value.config();
    mutate(changed);
    await value.save(changed);
    assert.equal(value.runtime.state.paused, true);
    assert.deepEqual(value.runtime.state.modules, []);
    const sent = value.inputs.length;
    await value.tick();
    assert.equal(value.inputs.length, sent);
  }
});

test('wrong profile and stale context reject autosave without interrupting Walker', async () => {
  const value = fixture();
  await value.start();
  await assert.rejects(value.controller.invoke('pka:autosave', 'Other', value.config(), 1), /Perfil ativo mudou/);
  await assert.rejects(value.controller.invoke('pka:autosave', 'A', value.config(), 0), /desatualizado/);
  assert.deepEqual(value.runtime.state.modules, ['walker']);
  assert.equal(value.runtime.state.paused, false);
});

test('runtimes other than keyboard/RPM retain the existing stop-before-save contract', async () => {
  for (const state of [undefined, { backend: 'native' }]) {
    const calls = [];
    const value = fixture({ runtime: { state, setModules: async (...args) => { calls.push(args); } } });
    await value.save(value.config());
    assert.deepEqual(calls, [['all', false]]);
  }
});
