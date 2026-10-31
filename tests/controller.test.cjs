const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Controller } = require('../reconstruction/controller.cjs');

function fixture(ports) {
  const state = { activeProfile: 'Default', profiles: [{ name: 'Default', config: { walker: {} } }] };
  const store = {
    snapshot: () => structuredClone(state),
    async save(name, config) {
      const existing = state.profiles.find(profile => profile.name === name);
      if (existing) existing.config = structuredClone(config);
      else state.profiles.push({ name, config: structuredClone(config) });
      state.activeProfile = name;
    },
    async select(name) {
      if (!state.profiles.some(profile => profile.name === name)) throw Error('Missing profile');
      state.activeProfile = name;
    },
    async remove(name) {
      if (state.profiles.length < 2) throw Error('Last profile');
      state.profiles = state.profiles.filter(profile => profile.name !== name);
      state.activeProfile = state.profiles[0].name;
    },
  };
  return new Controller(store, ports);
}

test('bootstrap exposes offline state, not fabricated clients or running engines', async () => {
  const controller = fixture();
  const result = await controller.invoke('pka:bootstrap');
  assert.deepEqual(result.sessions, []);
  assert.deepEqual(result.runtime.modules, []);
  assert.equal(result.runtime.paused, true);
  assert.equal(result.settings.context, 1);
  assert.equal(result.settings.activeProfile, 'Default');
  result.settings.profiles[0].name = 'changed';
  assert.equal(controller.settings().profiles[0].name, 'Default');
});
test('a live flag alone never reports an engine as running', async () => {
  const controller = fixture({ allowLiveRuntime: true });
  await assert.rejects(controller.invoke('pka:runtime', 'target', true, 10, {}, 1), /Motor nativo/);
  assert.deepEqual(controller.snapshot().runtime.modules, []);
});
test('controller covers all recovered pka invocation channels', () => {
  const contracts = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../ipc_contracts.json')));
  const expected = contracts.apis.filter(api => api.namespace === 'pka')
    .flatMap(api => api.channels.filter(channel => channel.operation === 'invoke').map(channel => channel.channel));
  assert.deepEqual(fixture().channels().sort(), [...new Set(expected)].sort());
});
test('recovered channels delegate to their injected ports', async () => {
  const calls = [];
  const controller = fixture({
    showLook: (look, pinned) => { calls.push(['showLook', look, pinned]); return { shown: true }; },
    walkerProfiles: () => [{ id: 'wk_A.lua', name: 'A' }],
    loadWalkerProfile: (id, config) => ({ config, warnings: [], id }),
    shortcuts: tools => ({ registered: true, tools }),
    saveRoute: (id, waypoints) => { calls.push(['saveRoute', id, waypoints]); return true; },
  });
  assert.deepEqual(await controller.invoke('pka:showLook', { id: 5 }, true), { shown: true });
  assert.deepEqual(calls[0], ['showLook', { id: 5 }, true]);
  assert.deepEqual(await controller.invoke('pka:walkerProfiles', 1), [{ id: 'wk_A.lua', name: 'A' }]);
  assert.deepEqual((await controller.invoke('pka:loadWalkerProfile', 'wk_A.lua', { walker: {} }, 1)).id, 'wk_A.lua');
  assert.equal((await controller.invoke('pka:shortcuts', { menuHotkey: 'F1' }, 1)).registered, true);
  await controller.invoke('pka:autosave', 'Default', { walker: { luaProfile: 'wk_A.lua', luaRevision: '', waypoints: [] } }, 1);
  assert.deepEqual(calls[1][0], 'saveRoute');
  assert.equal(calls[1][1], 'wk_A.lua');
  assert.equal(calls[1][2].walker.luaProfile, 'wk_A.lua');
});
test('save changes context and emits complete settings', async () => {
  const controller = fixture();
  let event;
  controller.on('settings', settings => { event = settings; });
  const result = await controller.invoke('pka:save', 'Hunt', { walker: {} }, 1);
  assert.equal(result.activeProfile, 'Hunt');
  assert.equal(result.context, 2);
  assert.deepEqual(event, result);
  await assert.rejects(controller.invoke('pka:select', 'Default', 1), /desatualizado/);
  assert.equal((await controller.invoke('pka:select', 'Default', 2)).context, 3);
});
test('autosave preserves current context and rejects wrong active profile', async () => {
  const controller = fixture();
  const result = await controller.invoke('pka:autosave', 'Default', { walker: { luaProfile: 'route' } }, 1);
  assert.equal(result.luaProfile, 'route');
  assert.equal(controller.settings().context, 1);
  await assert.rejects(controller.invoke('pka:autosave', 'Other', {}, 1), /Perfil ativo mudou/);
});
test('queued writes prevent stale concurrent changes and recover after failures', async () => {
  const controller = fixture();
  const operations = await Promise.allSettled([
    controller.invoke('pka:save', 'First', {}, 1), controller.invoke('pka:save', 'Second', {}, 1),
  ]);
  assert.deepEqual(operations.map(operation => operation.status), ['fulfilled', 'rejected']);
  assert.equal((await controller.invoke('pka:bootstrap')).settings.activeProfile, 'First');
});
test('native commands and enabling modules explicitly fail; stopping succeeds', async () => {
  const controller = fixture();
  for (const channel of ['command', 'mapInfo', 'mapRegion', 'openMap', 'resetMap', 'showLook',
    'gmLearning', 'loadWalkerProfile', 'performance']) {
    await assert.rejects(controller.invoke('pka:' + channel), /Motor nativo ainda nao reconstruido/);
  }
  await assert.rejects(controller.invoke('pka:runtime', 'target', true, 1, {}, 1), /Motor nativo/);
  await assert.rejects(controller.invoke('pka:monitor', true, 1, {}, 1), /Motor nativo/);
  assert.deepEqual((await controller.invoke('pka:runtime', 'all', false, null, null, 1)).runtime.modules, []);
  assert.equal((await controller.invoke('pka:monitor', false, null, null, 1)).monitor.enabled, false);
});
test('import/export and clipboard use injected ports, cancellation changes nothing', async () => {
  const controller = fixture({ importProfile: async () => false, exportProfile: async config => config, copyText: text => text });
  assert.equal(await controller.invoke('pka:import', {}, 1), false);
  assert.equal(controller.settings().activeProfile, 'Default');
  assert.deepEqual(await controller.invoke('pka:export', { value: 1 }, 1), { value: 1 });
  assert.equal(await controller.invoke('pka:copyText', 'text'), 'text');
});
test('unknown channels and stale scoped operations are rejected', async () => {
  const controller = fixture();
  for (const channel of ['other:bootstrap', 'pka:constructor', 'pka:__proto__', null]) {
    await assert.rejects(controller.invoke(channel), /Canal IPC/);
  }
  await assert.rejects(controller.invoke('pka:shortcuts', {}, 0), /desatualizado/);
});
