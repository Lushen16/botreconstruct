'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isExpectedHealCommand } = require('../reconstruction/app/audit.cjs');

test('UI heal audit accepts only the configured mN skill', () => {
  assert.equal(isExpectedHealCommand({ name: 'talk', parameter: 'm2' }, 2), true);
  for (const command of [null, {}, { name: 'talk', parameter: 'm1' },
    { name: 'talk', parameter: '!autocombo' }, { name: 'combo', parameter: 'm2' },
    { name: 'hotkey', parameter: 'F2' }, { name: 'talk', parameter: 'm2 trailing' }]) {
    assert.equal(isExpectedHealCommand(command, 2), false);
  }
});

test('UI heal audit rejects slots outside the recovered schema bounds', () => {
  for (const moveSlot of [0, -1, 101, 1.5, NaN, Infinity, '1', null]) {
    assert.equal(isExpectedHealCommand({ name: 'talk', parameter: 'm' + moveSlot }, moveSlot), false);
  }
  assert.equal(isExpectedHealCommand({ name: 'talk', parameter: 'm100' }, 100), true);
});
