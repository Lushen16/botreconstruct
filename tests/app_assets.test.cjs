'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planAsset } = require('../tools/app-assets.cjs');

test('build preserves local asset modifications instead of overwriting them', () => {
  const original = Buffer.from('original');
  const local = Buffer.from('local edits');
  const asset = planAsset(original, Buffer.from('generated'), local, 'previous digest');
  assert.equal(asset.preserved, true);
  assert.equal(asset.bytes.toString(), 'local edits');
});

test('build updates previous generated assets and never duplicates overlays', () => {
  const original = Buffer.from('original');
  const first = planAsset(original, Buffer.from('generated v1'), null);
  const second = planAsset(original, Buffer.from('generated v2'), first.bytes, first.sha256);
  assert.equal(second.preserved, false);
  assert.equal(second.bytes.toString(), 'generated v2');
  const repeated = planAsset(original, second.bytes, second.bytes, second.sha256);
  assert.equal(repeated.sha256, second.sha256);
});

test('build applies local overlays to pristine extracted assets', () => {
  const original = Buffer.from('original');
  const asset = planAsset(original, Buffer.from('original + overlay'), original);
  assert.equal(asset.preserved, false);
  assert.equal(asset.bytes.toString(), 'original + overlay');
  assert.notEqual(asset.sha256, asset.original_sha256);
});
