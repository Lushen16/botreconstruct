'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const walkerModel = require('../reconstruction/app/ui/walker-model.js');

test('canStand accepts seen walkable and NotPathable tiles', () => {
  assert.equal(walkerModel.canStand(0b001), true);
  assert.equal(walkerModel.canStand(0b011), true);
});

test('canStand rejects NotWalkable and out-of-map tiles', () => {
  assert.equal(walkerModel.canStand(0b101), false);
  assert.equal(walkerModel.canStand(0b111), false);
  assert.equal(walkerModel.canStand(0b000), false);
  assert.equal(walkerModel.canStand(0b010), false);
  assert.equal(walkerModel.canStand(0b1000), false);
});

test('canRoute keeps NotPathable tiles out of automatic routes', () => {
  assert.equal(walkerModel.canRoute(0b001), true);
  assert.equal(walkerModel.canRoute(0b011), false);
  assert.equal(walkerModel.canRoute(0b101), false);
  assert.equal(walkerModel.canRoute(0b111), false);
  assert.equal(walkerModel.canRoute(0b000), false);
  assert.equal(walkerModel.canRoute(0b1000), false);
});
