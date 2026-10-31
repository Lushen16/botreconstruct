const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const settings = require('../reconstruction/settings.cjs');
const schema = require('../readable/shared/schema.js');
const vectors = require('../settings_vectors.json');
async function ownedRoot(context) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pka-settings-test-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
for (const [index, vector] of vectors.cases.entries()) test('original vector ' + index + ': ' + vector.method, () => {
  if (vector.error) assert.throws(() => settings[vector.method](...vector.args), error => error.message === vector.error);
  else assert.deepEqual(settings[vector.method](...vector.args), vector.result);
});
test('original profile lifecycle fixtures with real isolated persistence', async context => {
  const directory = await ownedRoot(context);
  const store = new settings.SettingsStore(directory);
  for (const vector of vectors.trace) {
    if (vector.error) await assert.rejects(store[vector.method](...vector.args), error => error.message === vector.error);
    else assert.deepEqual(await store[vector.method](...vector.args), vector.result);
  }
  const reopened = new settings.SettingsStore(directory);
  assert.deepEqual(await reopened.load(), store.snapshot());
  assert.deepEqual((await fs.readdir(path.join(directory, 'electron'))).sort(), ['settings.json', 'settings.json.bak']);
});
test('snapshot and current are detached; invalid save preserves file', async context => {
  const store = new settings.SettingsStore(await ownedRoot(context));
  await store.save('Profile', schema.createConfig());
  store.snapshot().profiles[0].name = 'Changed';
  store.current().tools.menuHotkey = 'Changed';
  assert.equal(store.current().tools.menuHotkey, 'Insert');
  const before = await fs.readFile(store.filename, 'utf8');
  assert.throws(() => store.save('Bad', {}));
  assert.equal(await fs.readFile(store.filename, 'utf8'), before);
});
test('concurrent instances merge saves under exclusive lock', async context => {
  const directory = await ownedRoot(context);
  const first = new settings.SettingsStore(directory);
  const second = new settings.SettingsStore(directory);
  await Promise.all([first.save('One', schema.createConfig()), second.save('Two', schema.createConfig())]);
  assert.deepEqual((await first.load()).profiles.map(profile => profile.name).sort(), ['Default', 'One', 'Two']);
});
test('reject corrupt or oversized storage without replacing it', async context => {
  const store = new settings.SettingsStore(await ownedRoot(context));
  await fs.mkdir(path.dirname(store.filename));
  await fs.writeFile(store.filename, 'invalid JSON');
  await assert.rejects(store.load(), SyntaxError);
  await assert.rejects(store.save('One', schema.createConfig()), SyntaxError);
  assert.equal(await fs.readFile(store.filename, 'utf8'), 'invalid JSON');
  await fs.writeFile(store.filename, ' '.repeat(settings.MAX_BYTES + 1));
  await assert.rejects(store.load());
});
test('explicit roots and hashed character directory containment', () => {
  assert.throws(() => new settings.SettingsStore());
  assert.throws(() => new settings.SettingsStore('relative'));
  const root = path.resolve(os.tmpdir(), 'pka-settings-contained');
  const result = settings.characterDirectory(root, '../A/B');
  assert.equal(path.dirname(result), path.join(root, 'electron', 'characters'));
  assert.ok(result.endsWith('-' + require('node:crypto').createHash('sha256').update('../a/b').digest('hex').slice(0, 16)));
});
test('initialize and persist accept versioned snapshots', async context => {
  const store = new settings.SettingsStore(await ownedRoot(context));
  const data = { version: 1, activeProfile: 'Imported', profiles: [{ name: 'Imported', config: schema.createConfig() }] };
  assert.deepEqual(await store.initialize(data), data);
  assert.deepEqual(await store.persist(data), data);
});
test('Windows case-only root variations support load, save and persist', { skip: process.platform !== 'win32' }, async context => {
  const directory = await ownedRoot(context);
  const canonical = await fs.realpath(directory);
  const varied = canonical.toUpperCase();
  assert.notEqual(varied, canonical);
  const store = new settings.SettingsStore(varied);
  await store.load();
  await store.save('Case Test', schema.createConfig());
  const snapshot = store.snapshot();
  assert.deepEqual(await store.persist(snapshot), snapshot);
  assert.deepEqual(await new settings.SettingsStore(canonical).load(), snapshot);
  assert.deepEqual(await new settings.SettingsStore(varied).load(), snapshot);
});
for (const redirectedAncestor of [false, true]) test('reject redirected ' + (redirectedAncestor ? 'ancestor' : 'root') + ' on load and persist', async context => {
  const directory = await ownedRoot(context);
  const destination = path.join(directory, 'destination');
  await fs.mkdir(destination);
  const realRoot = redirectedAncestor ? path.join(destination, 'storage') : destination;
  const original = new settings.SettingsStore(realRoot);
  await original.save('Preserved', schema.createConfig());
  const before = await fs.readFile(original.filename, 'utf8');
  const redirect = path.join(directory, 'redirect');
  await fs.symlink(destination, redirect, process.platform === 'win32' ? 'junction' : 'dir');
  const redirectedRoot = redirectedAncestor ? path.join(redirect, 'storage') : redirect;
  const store = new settings.SettingsStore(redirectedRoot);
  await assert.rejects(store.load(), /Unsafe settings directory/);
  await assert.rejects(store.persist(original.snapshot()), /Unsafe settings directory|must not contain symlinks/);
  assert.equal(await fs.readFile(original.filename, 'utf8'), before);
  assert.deepEqual((await fs.readdir(path.dirname(original.filename))).sort(), ['settings.json']);
});
