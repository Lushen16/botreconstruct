'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const schema = require('../readable/shared/schema.js');
const messages = require('../reconstruction/app/ui/messages.js');
const { validateConfig } = require('../reconstruction/settings.cjs');
const { WalkerInputRuntime } = require('../reconstruction/walker-input-runtime.cjs');

test('native AutoCombo UI preserves the original form without an unsupported hotkey', () => {
  const published = fs.readFileSync(path.join(__dirname, '../reconstruction/app/ui/target.js'), 'utf8');
  const original = fs.readFileSync(path.join(__dirname, '../../Extracted_Source/renderer/target.js'), 'utf8');
  assert.equal(published.trimEnd(), original.trimEnd());
  assert.doesNotMatch(published, /nativeHotkey|Hotkey AutoCombo|T_nat/u);
});

test('native AutoCombo saves and reloads using only fields of the original schema', () => {
  const config = schema.createConfig();
  config.target.combo.enabled = true;
  config.target.combo.useNativeSequence = true;
  const saved = validateConfig(config);
  const reloaded = validateConfig(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(reloaded.target.combo, config.target.combo);
  assert.equal(Object.hasOwn(reloaded.target.combo, 'nativeHotkey'), false);
});

test('keyboard-only module error remains specific in both banner and Target diagnostics', async () => {
  const runtime = new WalkerInputRuntime({ automatic: false });
  for (const module of ['target', 'healer']) {
    let reason;
    try { await runtime.setModules(module, true, 42, schema.createConfig()); }
    catch (error) { reason = error.message; }
    assert.match(reason, /falta integrar o backend de combate/u);
    assert.equal(messages.message(reason, 'error'), reason);
    assert.equal(messages.details(reason, 'error').message, reason);
    assert.deepEqual(runtime.state.modules, []);
    assert.equal(runtime.state.paused, true);
  }
});
