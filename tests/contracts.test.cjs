'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { check, checkTelemetryInput, TELEMETRY_FIELDS } = require('../tools/check_contracts.cjs');

test('contracts cover the remaining unsupported rules and the closed ones', () => {
  const result = check();
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.summary.unsupported, 0);
  assert.equal(result.summary.rules, 16);
  assert.equal(result.summary.closed, 16);
  const blocked = result.ids.filter(id => result.unsupported.includes(id)).sort();
  assert.deepEqual(blocked, [...result.unsupported].sort());
});

test('contracts separate implementable rules from blocked ones', () => {
  const result = check();
  assert.equal(result.summary.implementable, 16);
  assert.equal(result.summary.blocked, 0);
  assert.equal(result.summary.unsupported, 0);
});

test('invented telemetry inputs are rejected', () => {
  const errors = [];
  for (const input of ['telemetry.connected', 'telemetry.creatures.isPlayer', 'creature.isDead', 'creature.canCapture']) {
    checkTelemetryInput(input, errors, 'test');
  }
  assert.equal(errors.length, 4);
  const ok = [];
  checkTelemetryInput('telemetry.position', ok, 'test');
  checkTelemetryInput('telemetry.creatures', ok, 'test');
  checkTelemetryInput('session.online', ok, 'test');
  assert.deepEqual(ok, []);
  assert.equal(TELEMETRY_FIELDS.has('position'), true);
  assert.equal(TELEMETRY_FIELDS.has('connected'), false);
});

test('blocked rules name what is missing', () => {
  const result = check();
  const blocked = result.ids.filter(id => {
    const rule = require('../reconstruction/spec/alerts-v1.json').rules.find(entry => entry.id === id)
      || require('../reconstruction/spec/capture-v1.json').rules.find(entry => entry.id === id)
      || require('../reconstruction/spec/remaining-rules-v1.json').rules.find(entry => entry.id === id);
    return rule.status === 'blocked';
  });
  assert.equal(blocked.length, 0);
});

test('capture closure is local and partial, retaining native residual unknowns', () => {
  const contract = require('../reconstruction/spec/capture-v1.json');
  const matrix = require('../reconstruction/spec/decision-rules-v1.json');
  for (const id of ['CaptureRank', 'CaptureApproach']) {
    const rule = contract.rules.find(entry => entry.id === id);
    assert.equal(rule.status, 'implementable');
    assert.equal(rule.coverage, 'partial');
    assert.ok(rule.residualUnknowns.length > 0);
    assert.ok(rule.evidence.includes('native_capture_evidence.json'));
    assert.equal(matrix.rules.find(entry => entry.id === id).status, 'partial');
  }
});

