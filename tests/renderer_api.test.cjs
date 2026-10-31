const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { archiveSources, createHarness } = require('../tools/probe_preload.cjs');
const { createRendererApis } = require('../reconstruction/renderer-api.cjs');
const originalSources = archiveSources();

function pair(namespace) {
  const responder = async channel => channel === 'pka:bootstrap' ? { settings: { context: 9 } } : { ok: true };
  const original = createHarness(originalSources.find(entry => entry.relative ===
    (namespace === 'pka' ? 'preload.cjs' : 'look-preload.cjs')).bytes.toString('utf8'), responder);
  const events = new EventEmitter();
  const calls = [];
  const transport = { on: events.on.bind(events), removeListener: events.removeListener.bind(events),
    invoke(channel, ...args) { calls.push({ operation: 'invoke', channel, args }); return responder(channel, ...args); },
    send(channel, ...args) { calls.push({ operation: 'send', channel, args }); } };
  return { original, rebuilt: { api: createRendererApis(transport)[namespace], events, calls } };
}

test('independent API exposes exactly the recovered 34 members', () => {
  for (const namespace of ['pka', 'pkaLook']) {
    const { original, rebuilt } = pair(namespace);
    assert.deepEqual(Object.keys(rebuilt.api).sort(), Object.keys(original.exposed[namespace]).sort());
  }
});

const methods = ['bootstrap', 'pause', 'view', 'performance', 'shortcuts', 'mapInfo', 'openMap',
  'resetMap', 'walkerProfiles', 'loadWalkerProfile', 'mapRegion', 'command', 'save', 'autosave',
  'copyText', 'showLook', 'quit', 'select', 'remove', 'importProfile', 'exportProfile', 'monitor',
  'gmLearning', 'runtime'];
for (const method of methods) {
  test('differential arguments/results: pka.' + method, async () => {
    const { original, rebuilt } = pair('pka');
    await original.exposed.pka.bootstrap();
    await rebuilt.api.bootstrap();
    for (const args of [[], ['profile'], ['profile', {}, 2, 3, 'extra'], [undefined, null, false, 0]]) {
      const expected = await original.exposed.pka[method](...args);
      assert.deepEqual(await rebuilt.api[method](...args), expected);
    }
    assert.deepEqual(rebuilt.calls, original.calls);
  });
}

for (const [method, channel] of Object.entries({ onSettings: 'pka:settings', onGmProfiles: 'pka:gm-profiles',
  onAlertSound: 'pka:alert-sound', onClosing: 'pka:closing', onSnapshot: 'pka:snapshot',
  onNotice: 'pka:notice', onAlertState: 'pka:alert-state' })) {
  test('differential event filtering and cleanup: ' + method, async () => {
    const { original, rebuilt } = pair('pka');
    await original.exposed.pka.bootstrap(); await rebuilt.api.bootstrap();
    const originalValues = [];
    const rebuiltValues = [];
    const originalOff = original.exposed.pka[method]((...args) => originalValues.push(args));
    const rebuiltOff = rebuilt.api[method]((...args) => rebuiltValues.push(args));
    const values = [undefined, null, {}, { context: 8 }, { context: 10 }, { context: 9 },
      { context: 10.5 }, { context: '11' }, { asset: 'hp.mp3', extra: true },
      { asset: '../hp.mp3' }, { profile: 'profile', alerts: { gmMessageProfilesJson: '{}' } },
      { profile: 42, alerts: { gmMessageProfilesJson: '{}' } }];
    for (const value of values) {
      original.events.emit(channel, {}, value); rebuilt.events.emit(channel, {}, value);
    }
    assert.deepEqual(JSON.parse(JSON.stringify(rebuiltValues)), JSON.parse(JSON.stringify(originalValues)));
    originalOff(); rebuiltOff();
    assert.equal(rebuilt.events.listenerCount(channel), original.events.listenerCount(channel));
    await original.exposed.pka.select('profile'); await rebuilt.api.select('profile');
    assert.deepEqual(rebuilt.calls, original.calls);
  });
}

test('differential pkaLook operations and event', async () => {
  const { original, rebuilt } = pair('pkaLook');
  const received = [];
  const off = rebuilt.api.onShow(value => received.push(value));
  rebuilt.events.emit('pka-look:show', {}, 'text');
  assert.deepEqual(received, ['text']); off();
  await original.exposed.pkaLook.copy('text'); await rebuilt.api.copy('text');
  original.exposed.pkaLook.close(); rebuilt.api.close();
  assert.deepEqual(rebuilt.calls, original.calls);
  assert.equal(rebuilt.events.listenerCount('pka-look:show'), 0);
});
