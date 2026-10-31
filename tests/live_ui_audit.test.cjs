'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeWalker } = require('../reconstruction/app/live-audit.cjs');
const sample = (x, inputAccepted = false) => ({ position: { x, y: 100, z: 7 }, action: { inputAccepted } });

test('manual movement does not validate a rejected Walker start', () => {
  const result = summarizeWalker([sample(100), sample(101)], { status: 'idle', modules: [] });
  assert.equal(result.positionChanged, true);
  assert.equal(result.inputAccepted, false);
  assert.equal(result.status, 'start-not-confirmed');
});

test('movement before the first accepted input does not validate the actuator', () => {
  const result = summarizeWalker([sample(100), sample(101, true), sample(101)], { status: 'walking' });
  assert.equal(result.status, 'movement-not-confirmed');
});

test('live audit requires accepted input followed by an observed coordinate change', () => {
  const result = summarizeWalker([sample(100), sample(100, true), sample(101)], { status: 'walking' });
  assert.equal(result.positionChangedAfterInput, true);
  assert.equal(result.status, 'rpm-movement-observed');
});

test('runtime error takes precedence over movement observations', () => {
  assert.equal(summarizeWalker([sample(100, true), sample(101)], { status: 'error' }).status, 'error');
});
