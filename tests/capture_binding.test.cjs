'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyCaptureBinding } = require('../reconstruction/capture-binding.cjs');

function fixture() {
  const clientConfig = path.join(__dirname, 'fixtures/capture-client.otml');
  return { clientConfig, captureHotkeys: { '15650': 'B' }, captureBindingVerification: {
    source: 'live-confirmation', verifiedAt: new Date(1000).toISOString(), useWithActions: [6],
    configSha256: crypto.createHash('sha256').update(fs.readFileSync(clientConfig)).digest('hex') } };
}

test('capture binding resolves the configured ball to its current confirmed actionbar key', () => {
  const result = verifyCaptureBinding(fixture(), 15650, 'B');
  assert.equal(result.itemId, 15650); assert.equal(result.slot, 'ACTION_BAR_6');
  assert.equal(result.source, 'live-confirmation'); assert.equal(result.mode, 'useWith');
});

test('capture binding blocks missing proof, changed settings, wrong key/item/mode and conflicting mappings', () => {
  const transport = fixture();
  assert.throws(() => verifyCaptureBinding({ ...transport, captureBindingVerification: null }, 15650, 'B'));
  for (const patch of [{ configSha256: 'changed' }, { useWithActions: [] }, { useWithActions: [2] },
    { source: 'guessed' }, { verifiedAt: 'unknown' }]) {
    assert.throws(() => verifyCaptureBinding({ ...transport,
      captureBindingVerification: { ...transport.captureBindingVerification, ...patch } }, 15650, 'B'));
  }
  assert.throws(() => verifyCaptureBinding(transport, 15650, 'F1'));
  assert.throws(() => verifyCaptureBinding(transport, 3156, 'B'));
  transport.captureHotkeys['3156'] = 'B';
  assert.throws(() => verifyCaptureBinding(transport, 15650, 'B'));
});
