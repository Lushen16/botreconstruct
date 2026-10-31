'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesName } = require('../reconstruction/engines/shared.cjs');
const { createTargetEngine } = require('../reconstruction/engines/target-engine.cjs');
const { createRecorder } = require('../reconstruction/automation.cjs');
const { encodeCommand } = require('../reconstruction/protocol.cjs');
const { createLureEngine } = require('../reconstruction/engines/lure-engine.cjs');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function telemetry(patch = {}) {
  return {
    position: { x: 100, y: 100, z: 7 }, playerName: 'Player', healthPercent: 100,
    pokemonName: 'Charizard', activeSlot: 1, roster: [{ slot: 1, name: 'Charizard', uuid: 'uuid-1' }],
    creatures: [{ id: 7, name: 'Shiny Rat', pos: { x: 101, y: 100, z: 7 }, healthPercent: 100, canAttack: true }],
    ...patch,
  };
}

test('ignored creature patterns match whole names, case-insensitively, with literal punctuation', () => {
  for (const [name, pattern, expected] of [
    ['Shiny Rat', ' SHINY * ', true], ['Rat', '*', true], ['Rat', 'rat', true],
    ['Raticate', 'Rat', false], ['Shiny Rat', '* Rat', true], ['A+B[1].', 'A+B[1].', true],
    ['AAB1x', 'A+B[1].', false], ['', '*', false], ['Rat', '', false],
  ]) assert.equal(matchesName(name, pattern), expected, JSON.stringify({ name, pattern }));
});

test('target ignore field removes wildcard matches from inspection and combat', () => {
  for (const ignoredCreaturesText of ['Shiny *', '*', 'Other; SHINY RAT', 'Other\nShiny *']) {
    const engine = createTargetEngine({ target: { ignoredCreaturesText } });
    const recorder = createRecorder();
    assert.deepEqual(engine.inspect(telemetry()), []);
    assert.equal(engine.step(telemetry(), recorder, 0).action, 'idle');
    assert.deepEqual(recorder.events, []);
  }
});

test('Hoenn ignore patterns also exclude creatures from Target', () => {
  const engine = createTargetEngine({ target: {}, hoenn: { ignoredCreaturesText: 'Shiny *' } });
  assert.deepEqual(engine.inspect(telemetry()), []);
});

test('ignored wildcard creatures do not hold the Luring walker', () => {
  const engine = createLureEngine({ target: { ignoredCreaturesText: 'Shiny *', luring: { enabled: true, maxDistance: 1 } } });
  const result = engine.step(telemetry({ creatures: [
    { ...telemetry().creatures[0], pos: { x: 106, y: 100, z: 7 } },
  ] }), createRecorder(), 0);
  assert.equal(result.state, 'no-monsters');
  assert.equal(result.allowMovement, true);
});

test('native AutoCombo never executes the hidden manual sequence', () => {
  for (const nativeSequence of [undefined, [], ['invalid']]) {
    const engine = createTargetEngine({ target: {
      combo: { enabled: true, useNativeSequence: true, sequenceText: 'm5' },
    } });
    const recorder = createRecorder();
    engine.step(telemetry({ nativeSequence }), recorder, 0);
    assert.deepEqual(recorder.events.map(event => [event.name, event.parameter]),
      [['attack', 7], ['combo', '!autocombo']]);
    for (const [index, event] of recorder.events.entries()) {
      assert.doesNotThrow(() => encodeCommand(index + 1, event.name, event.parameter, event.extra));
    }
  }
});

test('native sequence takes precedence while manual mode ignores native sequence', () => {
  for (const [useNativeSequence, expected] of [[true, 'm2'], [false, 'm5']]) {
    const engine = createTargetEngine({ target: {
      combo: { enabled: true, useNativeSequence, sequenceText: 'm5' },
    } });
    const recorder = createRecorder();
    engine.step(telemetry({ nativeSequence: ['m2'] }), recorder, 0);
    assert.equal(recorder.events.find(event => event.name === 'talk').parameter, expected);
  }
});

test('blocked native hotkey waits for GCD instead of changing to talk or combo', () => {
  for (const nativeSequence of [[], ['m2']]) {
    const engine = createTargetEngine({ target: {
      combo: { enabled: true, useNativeSequence: true, nativeHotkey: 'F5', sequenceText: 'm5' },
    } });
    const recorder = createRecorder();
    const current = telemetry({ nativeSequence });
    engine.step(current, recorder, 0, { hotkeysBlocked: true });
    assert.deepEqual(recorder.events.map(event => [event.name, event.parameter]), [['attack', 7]]);
    engine.step(current, recorder, 250, { hotkeysBlocked: false });
    assert.deepEqual(recorder.events.map(event => [event.name, event.parameter]), [['attack', 7], ['hotkey', 'F5']]);
  }
});

function diagnostics() {
  const context = vm.createContext({});
  for (const filename of ['schema.js', 'messages.js', 'diagnostics.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../Extracted_Source/shared', filename), 'utf8'), context);
  }
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../reconstruction/combat-readiness.js'), 'utf8'), context);
  return context;
}

test('Target readiness explains keyboard-only capability and retains configuration issues', () => {
  const context = diagnostics();
  const config = context.PkaSchema.createConfig();
  config.target.monsters = [];
  const session = { source: 'rpm', capabilities: { walkerKeyboard: true }, online: true,
    stale: false, ageMs: 10, telemetry: { nativeVerified: false } };
  const issues = context.PkaDiagnostics.targetStartIssues(config, session);
  assert.match(issues[0].message, /Backend teclado\/RPM ativo/u);
  assert.ok(issues.some(issue => issue.path === 'target.monsters'));
  assert.equal(session.telemetry.nativeVerified, false);
});

test('Target readiness preserves offline, stale, profile and native diagnostics', () => {
  const context = diagnostics();
  const config = context.PkaSchema.createConfig();
  const base = { source: 'rpm', capabilities: { walkerKeyboard: true }, online: true,
    stale: false, ageMs: 10, telemetry: { nativeVerified: false } };
  for (const [patch, options] of [
    [{ online: false }, {}], [{ stale: true }, {}], [{ ageMs: 1001 }, {}],
    [{ source: 'native' }, {}], [{ error: 'test-error' }, {}], [{ authExpired: true }, {}],
    [{ telemetryError: 'Criaturas inválidas.' }, {}], [{}, { blocked: true }], [{}, { apiAvailable: false }],
  ]) {
    const issues = context.PkaDiagnostics.targetStartIssues(config, { ...base, ...patch }, options);
    assert.ok(!issues.some(issue => issue.message.includes('Backend teclado/RPM ativo')));
    assert.ok(issues.some(issue => issue.action === 'connection' || issue.action === 'profiles'));
  }
});

test('published diagnostics includes the keyboard-only Target explanation after build', () => {
  const model = require('../reconstruction/app/ui/diagnostics.js');
  const schema = require('../reconstruction/app/ui/schema.js');
  const session = { source: 'rpm', capabilities: { walkerKeyboard: true }, online: true,
    stale: false, ageMs: 0, telemetry: { nativeVerified: false } };
  assert.match(model.targetStartIssues(schema.createConfig(), session)[0].message, /Backend teclado\/RPM ativo/u);
});

test('RPM combat readiness removes only the connection blocker without claiming native verification', () => {
  const context = diagnostics();
  const config = context.PkaSchema.createConfig(); config.target.monsters = [];
  const session = { source: 'rpm', capabilities: { walkerKeyboard: true, targetKeyboard: true },
    online: true, stale: false, ageMs: 10, telemetry: { nativeVerified: false } };
  const issues = context.PkaDiagnostics.targetStartIssues(config, session);
  assert.equal(issues.some(issue => issue.action === 'connection'), false);
  assert.ok(issues.some(issue => issue.path === 'target.monsters'));
  assert.equal(session.telemetry.nativeVerified, false);
  const offline = context.PkaDiagnostics.targetStartIssues(config, { ...session, online: false });
  assert.ok(offline.some(issue => issue.action === 'connection'));
});

test('RPM combat readiness surfaces the real scanner error instead of missing native authentication', () => {
  const context = diagnostics();
  const session = { source: 'rpm', capabilities: { walkerKeyboard: true, targetKeyboard: false,
    targetKeyboardIssue: 'Initial discovery pending' }, online: true, stale: false, ageMs: 10,
    telemetry: { nativeVerified: false } };
  const issues = context.PkaDiagnostics.targetStartIssues(context.PkaSchema.createConfig(), session);
  assert.match(issues[0].message, /Initial discovery pending/u);
});

test('RPM combat readiness surfaces scanner identity errors even without a Walker position', () => {
  const context = diagnostics();
  const session = { source: 'rpm', capabilities: { walkerKeyboard: false, targetKeyboard: false,
    targetKeyboardIssue: 'Nome do jogador RPM divergente.' }, online: true, stale: false, ageMs: 10,
    telemetry: { nativeVerified: false } };
  const issues = context.PkaDiagnostics.targetStartIssues(context.PkaSchema.createConfig(), session);
  assert.match(issues[0].message, /divergente/u);
  assert.ok(!issues.some(issue => issue.message.includes('Backend teclado/RPM ativo')));
});

test('RPM combat readiness skips Medicine, PokeStop and Revive requirements the runtime does not execute', () => {
  const context = diagnostics();
  const config = context.PkaSchema.createConfig();
  config.target.monsters = [];
  config.target.combo.enabled = true;
  config.target.combo.useMedicine = true;
  config.target.autoRevive.enabled = true;
  const base = { capabilities: { walkerKeyboard: true, targetKeyboard: true },
    online: true, stale: false, ageMs: 10, telemetry: { nativeVerified: false } };
  const rpmIssues = context.PkaDiagnostics.targetStartIssues(config, { ...base, source: 'rpm' });
  assert.ok(rpmIssues.some(issue => issue.path === 'target.monsters'));
  const nativeIssues = context.PkaDiagnostics.targetStartIssues(config, { ...base, source: 'native' });
  for (const issuePath of ['target.combo.medicineHotkey', 'target.autoRevive.hotkey']) {
    assert.equal(rpmIssues.some(issue => issue.path === issuePath), false);
    assert.ok(nativeIssues.some(issue => issue.path === issuePath));
  }
});
