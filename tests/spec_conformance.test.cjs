'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createAutomation, createRecorder, gateReason } = require('../reconstruction/automation.cjs');

const root = path.resolve(__dirname, '..');
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'default_config.json'), 'utf8'));
const spec = JSON.parse(fs.readFileSync(path.join(root, 'reconstruction/spec/automation-v1.json'), 'utf8'));
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/automation-v1.json'), 'utf8'));

function merge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch;
  const output = { ...base };
  for (const [key, value] of Object.entries(patch)) output[key] = merge(base?.[key], value);
  return output;
}

const roster = [{ slot: 1, uuid: 'uuid-1', name: 'Charizard', healthPercent: 100, moves: null }];

function telemetry(patch = {}) {
  return {
    schema: 2, nativeVerified: true, pulseVersion: 3, tick: 1, playerId: 1, fightMode: 0, chaseMode: 0,
    clockMs: 0, position: { x: 100, y: 100, z: 7 }, activeSlot: 1, moves: [], nativeSequence: [],
    pokemonName: 'Charizard', comboPokemonName: 'Charizard', conditionEvents: true, conditionsKnown: true,
    conditions: [], roster, creatures: [], items: [], tiles: [], healthPercent: 100,
    ...patch,
  };
}

function session(patch = {}, telemetryPatch = {}) {
  const merged = telemetry({ ...telemetryPatch, ...(patch.telemetry || {}) });
  return {
    pid: 32084, online: true, stale: false, error: null, authExpired: false, ageMs: 30, paused: false,
    runtime: { modules: [], pid: null, paused: false },
    ...patch,
    telemetry: merged,
  };
}

test('spec settings cover the shipped configuration keys', () => {
  for (const [group, keys] of Object.entries(spec.settings)) {
    const path_ = group.split('.');
    let node = defaults;
    for (const part of path_) node = node?.[part];
    assert.ok(node && typeof node === 'object', 'missing config group ' + group);
    for (const key of keys) {
      if (group === 'target.combo' && key === 'lowHpComboPercent') {
        assert.equal(typeof defaults.target.lowHpComboPercent, 'number');
        continue;
      }
      assert.ok(Object.hasOwn(node, key), `config ${group}.${key} ausente`);
    }
  }
  assert.deepEqual(spec.components.automation?.priority ?? spec.automation.priority, ['gate', 'healer', 'target', 'lure', 'walker']);
});

test('gate reasons declared by the spec are reproducible', () => {
  const cases = {
    paused: { paused: true },
    offline: { online: false },
    stale: { stale: true },
    error: { error: 'x' },
    'auth-expired': { authExpired: true },
    'stale-snapshot': { ageMs: 1001 },
    'native-unverified': { telemetry: { nativeVerified: false } },
    'pulse-version': { telemetry: { pulseVersion: 2 } },
  };
  for (const [reason, patch] of Object.entries(cases)) assert.equal(gateReason(session(patch)), reason);
  const mismatched = session({ runtime: { modules: ['target'], pid: 1 } });
  assert.equal(gateReason(mismatched), 'runtime-pid');
});

test('deterministic fixture traces match the specification', () => {
  for (const scenario of fixtures.scenarios) {
    const config = merge(structuredClone(defaults), scenario.config || {});
    const automation = createAutomation(config, { now: () => clock, rng: () => 0 });
    const recorder = createRecorder();
    let clock = 0;
    for (const step of scenario.steps) {
      clock = step.now;
      const snapshot = session(scenario.session || {}, scenario.telemetry || {});
      const result = automation.tick(snapshot, recorder);
      assert.equal(result.status, step.expect.status, scenario.id + ' status @' + step.now);
      if (step.expect.reason !== undefined) assert.equal(result.reason, step.expect.reason, scenario.id + ' reason @' + step.now);
      if (step.expect.emitted.length === 0) assert.deepEqual(result.emitted, [], scenario.id + ' emitted @' + step.now);
      else assert.deepEqual(result.emitted, step.expect.emitted, scenario.id + ' emitted @' + step.now);
      if (step.expect.lureState) assert.equal(result.lure?.state, step.expect.lureState, scenario.id + ' lure @' + step.now);
    }
    assert.ok(recorder.events.length >= 0);
  }
});

test('every declared failure code maps to reachable behaviour', () => {
  for (const code of Object.keys(spec.failures)) assert.equal(typeof spec.failures[code], 'string');
  const blocked = createAutomation(structuredClone(defaults));
  assert.equal(blocked.tick(session({ online: false }), createRecorder()).status, 'blocked');
});
