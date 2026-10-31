'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { OtmmReader, encodeOtmm, paletteRgb, BACKGROUND, BLOCK_SIZE, BLOCK_BYTES } = require('../reconstruction/otmm.cjs');

function block(x, y, z, fill) {
  const tiles = new Array(BLOCK_SIZE * BLOCK_SIZE);
  for (let i = 0; i < tiles.length; i++) tiles[i] = fill(i);
  return { x, y, z, tiles };
}

function writeTemp(buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pka-otmm-'));
  const file = path.join(dir, 'map.otmm');
  fs.writeFileSync(file, buffer);
  return file;
}

function rawBlockOtmm(x, y, z, compressed) {
  const base = encodeOtmm([]);
  const header = base.subarray(0, base.length - 5);
  const sentinel = base.subarray(base.length - 5);
  const record = Buffer.alloc(7);
  record.writeUInt16LE(x, 0);
  record.writeUInt16LE(y, 2);
  record.writeUInt8(z, 4);
  record.writeUInt16LE(compressed.length, 5);
  return Buffer.concat([header, record, compressed, sentinel]);
}

const GAME_MAP = path.join(os.homedir(), 'AppData', 'Roaming', 'PokeAlliance', 'PokeAllianceV3', 'minimap854.otmm');

test('palette matches the recovered 6x6x6 cube', () => {
  assert.deepEqual(paletteRgb(0), [0, 0, 0, 255]);
  assert.deepEqual(paletteRgb(186), [255, 51, 0, 255]);
  assert.deepEqual(paletteRgb(86), [102, 102, 102, 255]);
  assert.deepEqual(paletteRgb(215), [255, 255, 255, 255]);
  assert.deepEqual(paletteRgb(216), BACKGROUND);
  assert.deepEqual(paletteRgb(255), BACKGROUND);
});

test('reads header, blocks, floors and first position', () => {
  const file = writeTemp(encodeOtmm([
    block(64, 128, 3, () => [1, 100, 10]),
    block(192, 256, 7, () => [5, 186, 20]),
  ]));
  const map = new OtmmReader(file);
  assert.equal(map.filename, 'map.otmm');
  assert.equal(map.index.size, 2);
  assert.deepEqual([...map.floors].sort((a, b) => a - b), [3, 7]);
  assert.deepEqual(map.first, { x: 96, y: 160, z: 3 });
  assert.equal(map.info().blocks, 2);
});

test('tile flags follow the client bit semantics', () => {
  const expected = {
    0: [false, false], 1: [true, true], 2: [false, false], 3: [true, false],
    4: [false, false], 5: [true, false], 6: [false, false], 7: [true, false],
    8: [false, false], 9: [true, true], 10: [false, false], 11: [true, false],
    12: [false, false], 13: [true, false], 14: [false, false], 15: [true, false],
  };
  for (const [flags, pair] of Object.entries(expected)) {
    const map = new OtmmReader(writeTemp(encodeOtmm([block(0, 0, 0, () => [Number(flags), 100, 10])])));
    const tile = map.tile({ x: 5, y: 6, z: 0 });
    assert.deepEqual([tile.seen, tile.walkable], pair, 'flags ' + flags);
    assert.equal(tile.flags, Number(flags));
  }
});

test('tile returns null outside a stored block and rejects invalid positions', () => {
  const map = new OtmmReader(writeTemp(encodeOtmm([block(0, 0, 0, () => [1, 100, 10])])));
  assert.equal(map.tile({ x: 63, y: 63, z: 0 }).flags, 1);
  assert.equal(map.tile({ x: 64, y: 0, z: 0 }), null);
  assert.equal(map.tile({ x: 0, y: 0, z: 1 }), null);
  assert.equal(map.tile({ x: -1, y: 0, z: 0 }), null);
  assert.equal(map.tile({ x: 1.5, y: 0, z: 0 }), null);
});

test('region paints palette, background and flags like the client', () => {
  const colors = [186, 86, 216, 255, 1, 2];
  const flags = [1, 1, 1, 1, 0, 5];
  const map = new OtmmReader(writeTemp(encodeOtmm([block(0, 0, 4, i => {
    const index = i % colors.length;
    return [flags[index], colors[index], 10];
  })])));
  const region = map.getRegion(0, 0, 4, 6, 1);
  assert.equal(region.width, 6);
  assert.equal(region.height, 1);
  assert.equal(region.pixels.length, 6 * 4);
  assert.ok(region.pixels instanceof Uint8ClampedArray);
  assert.ok(region.flags instanceof Uint8Array);
  assert.deepEqual(Array.from(region.pixels.slice(0, 4)), [255, 51, 0, 255]);
  assert.deepEqual(Array.from(region.pixels.slice(4, 8)), [102, 102, 102, 255]);
  assert.deepEqual(Array.from(region.pixels.slice(8, 12)), BACKGROUND);
  assert.deepEqual(Array.from(region.pixels.slice(12, 16)), BACKGROUND);
  assert.deepEqual(Array.from(region.pixels.slice(16, 20)), BACKGROUND);
  assert.deepEqual(Array.from(region.pixels.slice(20, 24)), [0, 0, 102, 255]);
  assert.deepEqual(Array.from(region.flags), [1, 1, 1, 1, 0, 5]);
});

test('preserves flags for seen tiles whose color is outside the palette', () => {
  const cases = [
    { color: 216, flags: 1 },
    { color: 255, flags: 1 },
    { color: 254, flags: 3 },
    { color: 255, flags: 5 },
    { color: 217, flags: 7 },
    { color: 255, flags: 8 },
    { color: 40, flags: 0 },
    { color: 186, flags: 1 },
  ];
  const tiles = new Array(BLOCK_SIZE * BLOCK_SIZE).fill([0, 0, 0]);
  cases.forEach((tile, index) => { tiles[index] = [tile.flags, tile.color, 10]; });
  const map = new OtmmReader(writeTemp(encodeOtmm([{ x: 0, y: 0, z: 0, tiles }])));
  const region = map.getRegion(0, 0, 0, cases.length, 1);
  assert.deepEqual(Array.from(region.flags), cases.map(tile => tile.flags));
  cases.forEach((tile, index) => {
    const expected = tile.flags & 1 ? paletteRgb(tile.color) : BACKGROUND;
    assert.deepEqual(Array.from(region.pixels.slice(index * 4, index * 4 + 4)), expected, JSON.stringify(tile));
  });
});

test('block-wise region matches tile lookups across block boundaries', () => {
  const blocks = [];
  for (let by = 0; by < 2; by++) {
    for (let bx = 0; bx < 2; bx++) {
      blocks.push({
        x: bx * BLOCK_SIZE,
        y: by * BLOCK_SIZE,
        z: 2,
        tiles: Array.from({ length: BLOCK_SIZE * BLOCK_SIZE }, (_, i) => {
          const gx = bx * BLOCK_SIZE + (i % BLOCK_SIZE);
          const gy = by * BLOCK_SIZE + Math.floor(i / BLOCK_SIZE);
          return [[0, 1, 3, 5, 7, 8][(gx * 3 + gy) % 6], (gx * 7 + gy * 13) % 256, 10];
        }),
      });
    }
  }
  const map = new OtmmReader(writeTemp(encodeOtmm(blocks)));
  const regions = [
    [30, 30, 70, 70],
    [0, 0, 64, 64],
    [63, 63, 2, 2],
    [64, 0, 64, 128],
    [1, 100, 126, 28],
    [0, 0, 128, 128],
  ];
  for (const [rx, ry, width, height] of regions) {
    const region = map.getRegion(rx, ry, 2, width, height);
    const expectedPixels = [];
    const expectedFlags = [];
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const tile = map.tile({ x: rx + col, y: ry + row, z: 2 });
        expectedFlags.push(tile ? tile.flags : 0);
        if (tile && tile.seen && tile.color < 216) expectedPixels.push(...paletteRgb(tile.color));
        else expectedPixels.push(...BACKGROUND);
      }
    }
    assert.deepEqual(Array.from(region.pixels), expectedPixels, `pixels ${rx},${ry} ${width}x${height}`);
    assert.deepEqual(Array.from(region.flags), expectedFlags, `flags ${rx},${ry} ${width}x${height}`);
  }
});

test('region defaults to background for missing blocks and invalid floors', () => {
  const map = new OtmmReader(writeTemp(encodeOtmm([block(0, 0, 0, () => [1, 100, 10])])));
  const region = map.getRegion(1000, 1000, 0, 2, 2);
  assert.deepEqual(Array.from(region.pixels), [
    ...BACKGROUND, ...BACKGROUND,
    ...BACKGROUND, ...BACKGROUND,
  ]);
  assert.deepEqual(Array.from(region.flags), [0, 0, 0, 0]);
  assert.throws(() => map.getRegion(0, 0, 16, 2, 2), /invalida/);
  assert.throws(() => map.getRegion(0, 0, 0, 0, 2), /invalida/);
});

test('rejects invalid OTMM headers and truncated blocks', () => {
  assert.throws(() => new OtmmReader(writeTemp(Buffer.alloc(8))), /Assinatura ou tamanho/);
  const wrongMagic = encodeOtmm([block(0, 0, 0, () => [1, 100, 10])]);
  wrongMagic.write('XXXX', 0, 'latin1');
  assert.throws(() => new OtmmReader(writeTemp(wrongMagic)), /Assinatura ou tamanho/);
  const wrongVersion = encodeOtmm([block(0, 0, 0, () => [1, 100, 10])]);
  wrongVersion.writeUInt16LE(2, 6);
  assert.throws(() => new OtmmReader(writeTemp(wrongVersion)), /Versao\/cabecalho/);
  const empty = encodeOtmm([]);
  assert.throws(() => new OtmmReader(writeTemp(empty)), /sem blocos/);
  const truncated = encodeOtmm([block(0, 0, 0, () => [1, 100, 10])]);
  truncated.writeUInt16LE(0xffff, 27);
  assert.throws(() => new OtmmReader(writeTemp(truncated)), /truncado/);
});

test('rejects blocks that inflate past a single block', () => {
  const compressed = zlib.deflateSync(Buffer.alloc(1024 * 1024));
  assert.ok(compressed.length < 0xffff);
  const map = new OtmmReader(writeTemp(rawBlockOtmm(0, 0, 0, compressed)));
  assert.throws(() => map.getBlock(0, 0, 0), /tamanho invalido/);
});

test('block cache keeps more than the old 256-block cap', () => {
  const blocks = [];
  for (let by = 0; by < 15; by++) {
    for (let bx = 0; bx < 20; bx++) {
      blocks.push(block(bx * BLOCK_SIZE, by * BLOCK_SIZE, 0, () => [1, 86, 10]));
    }
  }
  const map = new OtmmReader(writeTemp(encodeOtmm(blocks)));
  for (const entry of blocks) map.getBlock(entry.x, entry.y, entry.z);
  assert.equal(map.cache.size, 300);
  assert.equal(map.getBlock(0, 0, 0).length, BLOCK_BYTES);
  assert.equal(map.cache.size, 300);
});

test('block-wise region stays fast on a dense map', () => {
  const tiles = Array.from({ length: BLOCK_SIZE * BLOCK_SIZE }, (_, i) => [1, i % 216, 10]);
  const blocks = [];
  for (let by = 0; by < 8; by++) {
    for (let bx = 0; bx < 8; bx++) {
      blocks.push({ x: bx * BLOCK_SIZE, y: by * BLOCK_SIZE, z: 0, tiles });
    }
  }
  const map = new OtmmReader(writeTemp(encodeOtmm(blocks)));
  const samples = [];
  for (let run = 0; run < 5; run++) {
    const start = process.hrtime.bigint();
    const region = map.getRegion(0, 0, 0, 512, 512);
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
    assert.equal(region.pixels.length, 512 * 512 * 4);
    assert.equal(region.flags.length, 512 * 512);
  }
  samples.sort((a, b) => a - b);
  assert.ok(samples[2] < 80, `512x512 median ${samples[2].toFixed(1)} ms`);
});

test('accepts the shipped game map when it exists', { skip: !fs.existsSync(GAME_MAP) }, () => {
  const map = new OtmmReader(GAME_MAP);
  assert.equal(map.index.size, 34119);
  assert.deepEqual([...map.floors].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
});

test('renders shipped map regions fast and retains a large cache', { skip: !fs.existsSync(GAME_MAP) }, () => {
  const map = new OtmmReader(GAME_MAP);
  const measure = (x, y, z, width, height) => {
    const samples = [];
    for (let run = 0; run < 5; run++) {
      const start = process.hrtime.bigint();
      const region = map.getRegion(x, y, z, width, height);
      samples.push(Number(process.hrtime.bigint() - start) / 1e6);
      assert.equal(region.pixels.length, width * height * 4);
      assert.equal(region.flags.length, width * height);
    }
    samples.sort((a, b) => a - b);
    return samples[2];
  };
  const small = measure(512, 2048, 7, 381, 261);
  assert.ok(small < 25, `381x261 median ${small.toFixed(1)} ms`);
  const wide = measure(512, 2048, 7, 951, 501);
  assert.ok(wide < 60, `951x501 median ${wide.toFixed(1)} ms`);
  const huge = measure(512, 2048, 7, 2048, 2048);
  assert.ok(huge < 250, `2048x2048 median ${huge.toFixed(1)} ms`);
  assert.ok(map.cache.size >= 512, `cache kept ${map.cache.size} blocks`);
});
