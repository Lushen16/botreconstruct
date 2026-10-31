'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { check, resolveSetting } = require('../tools/check_decision_rules.cjs');

test('every manifest decision rule is mapped exactly once', () => {
  const result = check();
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.counts.total, 30);
  assert.equal(result.manifestRules.length, 30);
  const mapped = new Set(result.rules.map(rule => rule.id));
  assert.deepEqual([...mapped].sort(), [...new Set(result.manifestRules)].sort());
});

test('status buckets are explicit and evidence exists for covered rules', () => {
  const result = check();
  assert.equal(result.counts.implemented, 13);
  assert.equal(result.counts.partial, 17);
  assert.equal(result.counts.unsupported, 0);
  for (const rule of result.rules) {
    assert.ok(['implemented', 'partial', 'unsupported', 'native-unknown'].includes(rule.status));
    assert.ok(rule.notes.trim().length > 0);
    if (rule.status === 'implemented' || rule.status === 'partial') assert.ok(rule.evidence.length > 0);
  }
});

test('declared configuration keys resolve against the shipped defaults', () => {
  const config = require('../default_config.json');
  for (const dotted of ['hoenn.perfectLure', 'target.luring.maxDistance', 'healer.healHpPercent', 'walker.smartWalking', 'looting.captureDelay']) {
    assert.equal(resolveSetting(config, dotted).ok, true, dotted);
  }
  assert.equal(resolveSetting(config, 'hoenn.doesNotExist').ok, false);
});
