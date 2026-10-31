const assert = require('node:assert/strict');
const test = require('node:test');
const { archiveSources, createHarness, probe } = require('../tools/probe_preload.cjs');
const sources = archiveSources();
function harness(responder) {
  return createHarness(sources.find(entry => entry.relative === 'preload.cjs').bytes.toString('utf8'), responder);
}

test('probe uses original preloads without main or native commands', async () => {
  const result = await probe();
  assert.equal(result.preloads.length, 2);
  assert.equal(result.native_commands_sent, false);
  assert.equal(result.original_main_executed, false);
});
test('scoped appends bootstrap context; command does not', async () => {
  const instance = harness(async () => ({ settings: { context: 7 } }));
  await instance.exposed.pka.bootstrap();
  await instance.exposed.pka.save('profile', {});
  await instance.exposed.pka.command('focus', 1, 2);
  assert.deepEqual(instance.calls[1], { operation: 'invoke', channel: 'pka:save', args: ['profile', {}, 7] });
  assert.deepEqual(instance.calls[2], { operation: 'invoke', channel: 'pka:command', args: ['focus', 1, 2] });
});
test('settings rejects stale, fractional and nonnumeric context', async () => {
  const instance = harness(async () => ({ settings: { context: 7 } }));
  const received = [];
  await instance.exposed.pka.bootstrap();
  instance.exposed.pka.onSettings(settings => received.push(settings));
  for (const context of [6, -1, 7.5, '8', 8, 7, 8]) instance.events.emit('pka:settings', {}, { context });
  assert.deepEqual(received.map(settings => settings.context), [8, 8]);
  await instance.exposed.pka.select('profile');
  assert.deepEqual(instance.calls.at(-1).args, ['profile', 8]);
});
test('autosave accepts current context or explicit override', async () => {
  const instance = harness(async () => ({ settings: { context: 3 } }));
  await instance.exposed.pka.bootstrap();
  await instance.exposed.pka.autosave('profile', {});
  await instance.exposed.pka.autosave('profile', {}, 2);
  assert.equal(instance.calls.at(-2).args[2], 3);
  assert.equal(instance.calls.at(-1).args[2], 2);
});
test('showLook uses strict boolean', async () => {
  const instance = harness();
  for (const value of [true, false, 1, 'true', null]) await instance.exposed.pka.showLook('text', value);
  assert.deepEqual(instance.calls.map(call => call.args[1]), [true, false, false, false, false]);
});
test('alert sound filters asset and strips extra properties', () => {
  const instance = harness();
  const received = [];
  const unsubscribe = instance.exposed.pka.onAlertSound(value => received.push(JSON.parse(JSON.stringify(value))));
  for (const asset of ['hp.mp3', '../hp.mp3', 'unknown.mp3', 'beep-default.wav']) {
    instance.events.emit('pka:alert-sound', {}, { asset, extra: 'discarded' });
  }
  assert.deepEqual(received, [{ asset: 'hp.mp3' }, { asset: 'beep-default.wav' }]);
  unsubscribe();
  assert.equal(instance.events.listenerCount('pka:alert-sound'), 0);
});
for (const [method, channel] of Object.entries({ onClosing: 'pka:closing', onSettings: 'pka:settings',
  onGmProfiles: 'pka:gm-profiles', onAlertState: 'pka:alert-state', onSnapshot: 'pka:snapshot', onNotice: 'pka:notice' })) {
  test(method + ' removes only its own listener', () => {
    const instance = harness();
    const other = () => {};
    instance.events.on(channel, other);
    const unsubscribe = instance.exposed.pka[method](() => {});
    assert.equal(instance.events.listenerCount(channel), 2);
    unsubscribe();
    assert.deepEqual(instance.events.listeners(channel), [other]);
  });
}
test('pkaLook invokes copy, sends close and unsubscribes', async () => {
  const instance = createHarness(sources.find(entry => entry.relative === 'look-preload.cjs').bytes.toString('utf8'));
  const received = [];
  const unsubscribe = instance.exposed.pkaLook.onShow(value => received.push(value));
  instance.events.emit('pka-look:show', {}, 'text');
  await instance.exposed.pkaLook.copy('text');
  instance.exposed.pkaLook.close();
  assert.deepEqual(received, ['text']);
  assert.deepEqual(instance.calls, [{ operation: 'invoke', channel: 'pka-look:copy', args: ['text'] },
    { operation: 'send', channel: 'pka-look:close', args: [] }]);
  unsubscribe();
  assert.equal(instance.events.listenerCount('pka-look:show'), 0);
});
