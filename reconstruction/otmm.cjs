'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const MAGIC = 'OTMM';
const HEADER_SIZE = 22;
const SIGNATURE = 'OTMM 1.0';
const BLOCK_SIZE = 64;
const TILE_BYTES = 3;
const BLOCK_BYTES = BLOCK_SIZE * BLOCK_SIZE * TILE_BYTES;
const BACKGROUND = Object.freeze([26, 32, 40, 255]);
const WALKABLE_MASK = 0x6;
const SEEN_FLAG = 0x1;
const CACHE_LIMIT = 1024;

function paletteRgb(color) {
  if (!Number.isInteger(color) || color < 0 || color > 215) return BACKGROUND;
  const r = Math.floor(color / 36);
  const g = Math.floor((color % 36) / 6);
  const b = color % 6;
  return [r * 51, g * 51, b * 51, 255];
}

// Palette bytes are laid out in RGBA order and viewed as uint32, so the LUT
// stays correct regardless of the host byte order.
const COLOR_LUT = (() => {
  const bytes = new Uint8ClampedArray(256 * 4);
  for (let color = 0; color < 256; color++) {
    const offset = color * 4;
    if (color >= 216) {
      bytes[offset] = BACKGROUND[0];
      bytes[offset + 1] = BACKGROUND[1];
      bytes[offset + 2] = BACKGROUND[2];
      bytes[offset + 3] = BACKGROUND[3];
      continue;
    }
    bytes[offset] = Math.floor(color / 36) * 51;
    bytes[offset + 1] = Math.floor((color % 36) / 6) * 51;
    bytes[offset + 2] = (color % 6) * 51;
    bytes[offset + 3] = 255;
  }
  return new Uint32Array(bytes.buffer);
})();
const BACKGROUND_PIXEL = COLOR_LUT[255];

function isTilePosition(pos) {
  return !!pos && [pos.x, pos.y, pos.z].every(Number.isInteger) &&
    pos.x >= 0 && pos.x < 65535 && pos.y >= 0 && pos.y < 65535 &&
    pos.z >= 0 && pos.z < 16;
}

class OtmmReader {
  constructor(filePath) {
    this.filePath = filePath;
    this.filename = path.basename(filePath);
    this.buffer = fs.readFileSync(filePath);
    this.index = new Map();
    this.cache = new Map();
    this.floors = new Set();
    this.first = null;
    this._lastBlockKey = '';
    this._lastBlock = null;
    this._parse();
  }

  _parse() {
    const buffer = this.buffer;
    if (buffer.length < HEADER_SIZE) throw Error('Assinatura ou tamanho OTMM invalido.');
    if (buffer.toString('latin1', 0, 4) !== MAGIC) throw Error('Assinatura ou tamanho OTMM invalido.');
    const headerSize = buffer.readUInt16LE(4);
    const version = buffer.readUInt16LE(6);
    if (version !== 1) throw Error('Versao/cabecalho OTMM nao suportado.');
    if (headerSize < HEADER_SIZE || headerSize > buffer.length) throw Error('Versao/cabecalho OTMM nao suportado.');
    const signatureLength = buffer.readUInt16LE(12);
    if (signatureLength > 64 || 14 + signatureLength > headerSize) {
      throw Error('Versao/cabecalho OTMM nao suportado.');
    }
    const signature = buffer.toString('latin1', 14, 14 + signatureLength);
    if (signature && signature !== SIGNATURE) throw Error('Versao/cabecalho OTMM nao suportado.');

    let pos = headerSize;
    while (pos + 7 <= buffer.length) {
      const x = buffer.readUInt16LE(pos);
      const y = buffer.readUInt16LE(pos + 2);
      const z = buffer.readUInt8(pos + 4);
      if (x === 0xffff && y === 0xffff && z === 0xff) break;
      const length = buffer.readUInt16LE(pos + 5);
      pos += 7;
      if (length === 0 || pos + length > buffer.length) throw Error('Bloco OTMM invalido ou truncado.');
      if (z >= 16) throw Error('Bloco OTMM invalido ou truncado.');
      const key = x + ',' + y + ',' + z;
      this.index.set(key, { offset: pos, length, x, y, z });
      this.floors.add(z);
      if (!this.first) this.first = { x: x + BLOCK_SIZE / 2, y: y + BLOCK_SIZE / 2, z };
      pos += length;
    }
    if (!this.index.size) throw Error('OTMM sem blocos de mapa.');
  }

  getBlock(bx, by, bz) {
    const key = bx + ',' + by + ',' + bz;
    if (key === this._lastBlockKey) return this._lastBlock;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      // Refresh recency: Map iteration order is the LRU order.
      this.cache.delete(key);
      this.cache.set(key, cached);
      this._lastBlockKey = key;
      this._lastBlock = cached;
      return cached;
    }
    const entry = this.index.get(key);
    if (!entry) return null;
    let block;
    try {
      block = zlib.inflateSync(this.buffer.subarray(entry.offset, entry.offset + entry.length), {
        maxOutputLength: BLOCK_BYTES,
      });
    } catch {
      throw Error('Bloco OTMM descompactado com tamanho invalido.');
    }
    if (block.length !== BLOCK_BYTES) throw Error('Bloco OTMM descompactado com tamanho invalido.');
    this.cache.set(key, block);
    if (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this._lastBlockKey = key;
    this._lastBlock = block;
    return block;
  }

  tile(pos) {
    if (!isTilePosition(pos)) return null;
    const bx = pos.x - (pos.x % BLOCK_SIZE);
    const by = pos.y - (pos.y % BLOCK_SIZE);
    const block = this.getBlock(bx, by, pos.z);
    if (!block) return null;
    const index = ((pos.y % BLOCK_SIZE) * BLOCK_SIZE + (pos.x % BLOCK_SIZE)) * TILE_BYTES;
    const flags = block[index];
    return {
      flags,
      color: block[index + 1],
      speed: block[index + 2],
      seen: (flags & 1) === 1,
      walkable: (flags & 1) === 1 && (flags & WALKABLE_MASK) === 0,
    };
  }

  getRegion(x, y, z, width, height) {
    if (![x, y, z, width, height].every(Number.isInteger) || width < 1 || height < 1 || width > 2048 || height > 2048) {
      throw Error('Regiao de mapa invalida.');
    }
    if (z < 0 || z > 15 || x < 0 || y < 0 || x + width > 65535 || y + height > 65535) {
      throw Error('Regiao de mapa invalida.');
    }
    const pixels = new Uint8ClampedArray(width * height * 4);
    const px32 = new Uint32Array(pixels.buffer);
    const flags = new Uint8Array(width * height);
    px32.fill(BACKGROUND_PIXEL);

    const bx0 = x - (x % BLOCK_SIZE);
    const by0 = y - (y % BLOCK_SIZE);
    const endX = x + width - 1;
    const endY = y + height - 1;
    for (let by = by0; by <= endY; by += BLOCK_SIZE) {
      const ly0 = Math.max(y, by);
      const ly1 = Math.min(endY, by + BLOCK_SIZE - 1);
      for (let bx = bx0; bx <= endX; bx += BLOCK_SIZE) {
        const block = this.getBlock(bx, by, z);
        if (!block) continue;
        const lx0 = Math.max(x, bx);
        const lx1 = Math.min(endX, bx + BLOCK_SIZE - 1);
        for (let ty = ly0; ty <= ly1; ty++) {
          let src = ((ty - by) * BLOCK_SIZE + (lx0 - bx)) * TILE_BYTES;
          let dst = (ty - y) * width + (lx0 - x);
          for (let tx = lx0; tx <= lx1; tx++, src += TILE_BYTES, dst++) {
            const tileFlags = block[src];
            flags[dst] = tileFlags;
            if (tileFlags & SEEN_FLAG) px32[dst] = COLOR_LUT[block[src + 1]];
          }
        }
      }
    }
    return { x, y, z, width, height, pixels, flags };
  }

  info() {
    return {
      filename: this.filename,
      filePath: this.filePath,
      blocks: this.index.size,
      floors: [...this.floors].sort((a, b) => a - b),
      first: this.first,
      custom: false,
    };
  }
}

function encodeOtmm(blocks) {
  const header = Buffer.alloc(HEADER_SIZE);
  header.write(MAGIC, 0, 'latin1');
  header.writeUInt16LE(HEADER_SIZE, 4);
  header.writeUInt16LE(1, 6);
  header.writeUInt32LE(0, 8);
  header.writeUInt16LE(SIGNATURE.length, 12);
  header.write(SIGNATURE, 14, 'latin1');
  const parts = [header];
  for (const block of blocks || []) {
    const raw = Buffer.alloc(BLOCK_BYTES);
    const tiles = block.tiles;
    for (let i = 0; i < BLOCK_SIZE * BLOCK_SIZE; i++) {
      const tile = tiles && tiles[i];
      if (tile) {
        raw[i * TILE_BYTES] = tile[0] & 0xff;
        raw[i * TILE_BYTES + 1] = tile[1] & 0xff;
        raw[i * TILE_BYTES + 2] = tile[2] & 0xff;
      } else {
        raw[i * TILE_BYTES] = 0;
        raw[i * TILE_BYTES + 1] = 255;
        raw[i * TILE_BYTES + 2] = 0;
      }
    }
    const compressed = zlib.deflateSync(raw);
    if (compressed.length > 0xffff) throw Error('Bloco OTMM comprimido excede o limite.');
    const record = Buffer.alloc(7);
    record.writeUInt16LE(block.x, 0);
    record.writeUInt16LE(block.y, 2);
    record.writeUInt8(block.z, 4);
    record.writeUInt16LE(compressed.length, 5);
    parts.push(record, compressed);
  }
  parts.push(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]));
  return Buffer.concat(parts);
}

module.exports = { OtmmReader, encodeOtmm, paletteRgb, BACKGROUND, BLOCK_SIZE, BLOCK_BYTES };
