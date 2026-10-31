'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRouteStore, loadWalkerProfile, validRouteId, parseLuaData, serializeLuaRoute } =
  require('../reconstruction/route-store.cjs');

// Real content shape, taken from %LOCALAPPDATA%\OTPbot\wk_*.lua (Extracted evidence).
const ROUTE_LUA = `return {
  waypoints = {
    {pos={x=488,y=1373,z=7}, action="walk", param=""},
    {pos={x=485,y=1373,z=7}, action="walk", param=""},
  },
  labelScripts = {
  },
  flyPokemon = "",
  teleportPokemon = "",
  surfPokemon = "",
  smartWalking = true,
  recordStepDistance = 5,
  comboLureDelay = 300,
  luringEnabled = false,
  luringMaxDistance = 2,
  frontLureEnabled = true,
  frontLureRegroupMargin = 7,
  frontLureRegroupSteps = 2,
  randomLureEnabled = false,
  randomLureMinSeconds = 45,
  randomLureMaxSeconds = 100,
  lureSkillEnabled = true,
  lureSkillMove = "m9",
  lureSkillHpPercent = 90,
  healSkillEnabled = false,
  healSkillMove = "m1",
  healSkillHpPercent = 50,
  guildDailyTier = "wildscape",
  guildDailyElement = "fire",
  guildDailyAutoEnabled = true,
  guildDailyUseTicket = true,
  guildDailyTicketAmount = 10,
}`;

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pka-routes-'));
const config = () => ({ walker: { waypoints: [], smartWalking: false, recordStepDistance: 5 },
  target: { luring: { enabled: true, maxDistance: 3, frontEnabled: false, frontRegroupMargin: 7,
    frontRegroupSteps: 2, randomEnabled: false, randomMinSeconds: 45, randomMaxSeconds: 100 },
  lureSkill: { enabled: false, move: 'm1', hpPercent: 0 },
  healSkill: { enabled: false, move: 'm1', hpPercent: 0 } } });

test('parses the original Lua route format', () => {
  const table = parseLuaData(ROUTE_LUA);
  assert.equal(table.waypoints.length, 2);
  assert.equal(Object.getPrototypeOf(table.waypoints[0].pos), null);
  assert.deepEqual({ ...table.waypoints[0].pos }, { x: 488, y: 1373, z: 7 });
  assert.equal(table.waypoints[0].action, 'walk');
  assert.equal(table.smartWalking, true);
  assert.equal(table.frontLureEnabled, true);
  assert.equal(table.flyPokemon, '');
  assert.deepEqual(table.labelScripts, []);
  assert.equal(table.guildDailyTier, 'wildscape');
});

test('serializes back to Lua that round-trips exactly', () => {
  const table = parseLuaData(ROUTE_LUA);
  const text = serializeLuaRoute(table);
  assert.match(text, /^return \{/);
  assert.deepEqual(parseLuaData(text), table);
});

test('loadWalkerProfile maps proven keys into the config', () => {
  const dir = temporary();
  try {
    const store = createRouteStore(dir);
    fs.writeFileSync(path.join(dir, 'wk_Arcanine.lua'), ROUTE_LUA);
    const loaded = loadWalkerProfile(store, 'wk_Arcanine.lua', { walker: { loop: true }, target: {} });
    assert.equal(loaded.config.walker.waypoints.length, 2);
    assert.equal(loaded.config.walker.smartWalking, true);
    assert.equal(loaded.config.walker.luaProfile, 'wk_Arcanine.lua');
    assert.equal(loaded.config.walker.luaRevision, store.revision('wk_Arcanine.lua'));
    assert.equal(loaded.config.walker.loop, true); // untouched profile setting
    assert.equal(loaded.config.target.luring.frontEnabled, true);
    assert.equal(loaded.config.target.luring.maxDistance, 2);
    assert.equal(loaded.config.target.lureSkill.enabled, true);
    assert.equal(loaded.config.target.lureSkill.move, 'm9');
    assert.equal(loaded.config.target.healSkill.hpPercent, 50);
    assert.equal(loaded.config.target.combo.lureDelay, 300);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('save writes the Lua format atomically, keeps .bak and preserves unknown keys', () => {
  const dir = temporary();
  try {
    const store = createRouteStore(dir);
    fs.writeFileSync(path.join(dir, 'wk_Arcanine.lua'), ROUTE_LUA);
    const saved = store.save('wk_Arcanine.lua', config(), { expectedRevision: store.revision('wk_Arcanine.lua') });
    assert.equal(typeof saved.revision, 'string');
    assert.ok(fs.existsSync(path.join(dir, 'wk_Arcanine.lua.bak')));
    assert.ok(!fs.existsSync(path.join(dir, 'wk_Arcanine.lua.tmp')));
    const back = parseLuaData(fs.readFileSync(path.join(dir, 'wk_Arcanine.lua'), 'utf8'));
    assert.equal(back.waypoints.length, 0);
    assert.equal(back.luringEnabled, true);
    assert.equal(back.frontLureEnabled, false);
    assert.equal(back.flyPokemon, ''); // unknown key preserved
    assert.equal(back.guildDailyTier, 'wildscape');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('save rejects a stale revision', () => {
  const dir = temporary();
  try {
    const store = createRouteStore(dir);
    fs.writeFileSync(path.join(dir, 'wk_A.lua'), ROUTE_LUA);
    assert.throws(() => store.save('wk_A.lua', config(), { expectedRevision: 'deadbeef' }),
      /alterado fora do bot/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('reserved names and unsafe ids are rejected', () => {
  assert.equal(validRouteId('wk_folder/route.lua'), false);
  assert.equal(validRouteId('wk_folder\\route.lua'), false);
  assert.equal(validRouteId('wk_INDEX.lua'), false);
  assert.equal(validRouteId('wk_index.lua'), false);
  assert.equal(validRouteId('wk_label_scripts.lua'), false);
  assert.equal(validRouteId('wk_A.lua'), true);
  assert.equal(validRouteId('..\\evil.lua'), false);
  const dir = temporary();
  try {
    const store = createRouteStore(dir);
    assert.throws(() => store.save('../evil.lua', config()), /caracteres de caminho/);
    assert.equal(store.revision('wk_index.lua'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Lua parser preserves empty and mixed tables and requires complete data input', () => {
  assert.deepEqual(parseLuaData('return {}'), []);
  assert.deepEqual(parseLuaData('return {x=1,2}'), Object.assign(Object.create(null), { 1: 2, x: 1 }));
  assert.deepEqual(parseLuaData('return {[1]=42,["title"]="A"}'), Object.assign(Object.create(null), { 1: 42, title: 'A' }));
  assert.deepEqual(parseLuaData('return {a=1; b=2}; --end'), Object.assign(Object.create(null), { a: 1, b: 2 }));
  for (const source of ['{}', 'return {a=1} trailing', 'return {a=1 b=2}',
    'return {a=1,a=2}', 'return {a=1e999}', 'return {__proto__={polluted=true}}']) {
    assert.throws(() => parseLuaData(source), /tabelas Lua/);
  }
});

test('route listing excludes directories and reserved names and sorts profiles', () => {
  const dir = temporary();
  try {
    for (const name of ['wk_B.lua', 'wk_a.lua', 'wk_INDEX.lua', 'WK_C.LUA']) {
      fs.writeFileSync(path.join(dir, name), 'return {}');
    }
    fs.mkdirSync(path.join(dir, 'wk_directory.lua'));
    assert.deepEqual(createRouteStore(dir).list(), [{ id: 'wk_a.lua', name: 'a' }, { id: 'wk_B.lua', name: 'B' }]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Lua serialization preserves mixed keys and rejects non-finite settings', () => {
  const table = { waypoints: [], custom: { 'two words': 'value', 2: 'numbered' },
    text: 'line\nreturn\rtab\tzero\u0000quote"slash\\' };
  assert.deepEqual(JSON.parse(JSON.stringify(parseLuaData(serializeLuaRoute(table)))), table);
  assert.throws(() => serializeLuaRoute({ invalid: Infinity }), /incompativel/);
});

test('original bytecode agrees with Lua parser and profile loading in compatible Electron',
  { skip: process.versions.electron !== '44.7.2' }, async () => {
    const crypto = require('node:crypto');
    const originalRoot = path.resolve(__dirname, '../../Extracted_Source');
    for (const [filename, sha256] of [
      ['legacy.jsc', '155d1aed676e0416c0feb352c789393702248e41e60594431ae47810c58150df'],
      ['walker-profiles.jsc', 'c2176e31714360212cead743da27095d86e1847df4ba2452971b325a6cc1d455'],
    ]) {
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(originalRoot, 'lib', filename))).digest('hex'), sha256);
    }
    require(path.join(originalRoot, 'bytecode-runtime.cjs'));
    const original = require(path.join(originalRoot, 'lib/legacy.cjs'));
    const { WalkerProfiles } = require(path.join(originalRoot, 'lib/walker-profiles.cjs'));
    for (const source of [ROUTE_LUA, 'return {}', 'return {1,2}', 'return {x=1,2}',
      'return {[1]=42,["title"]="A"}', 'return {a=1; b=2}; --end',
      'return {a="\\065"}', 'return {a=1e2}']) {
      assert.deepEqual(parseLuaData(source), original.parseLuaData(source), source);
    }
    for (const source of ['{}', 'return {a=1} trailing', 'return {a=1 b=2}',
      'return {a=1,a=2}', 'return {a=1e999}', 'return {constructor=1}']) {
      assert.throws(() => original.parseLuaData(source));
      assert.throws(() => parseLuaData(source));
    }
    const dir = temporary();
    try {
      fs.writeFileSync(path.join(dir, 'wk_A.lua'), ROUTE_LUA);
      const base = require(path.join(originalRoot, 'shared/schema.js')).createConfig();
      const expected = await new WalkerProfiles(dir).load('wk_A.lua', base);
      const actual = loadWalkerProfile(createRouteStore(dir), 'wk_A.lua', base);
      assert.deepEqual(actual.config, expected.config);
      assert.deepEqual(actual.warnings, expected.warnings);
      assert.deepEqual(createRouteStore(dir).list(), await new WalkerProfiles(dir).list());
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
