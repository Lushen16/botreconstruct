const { MAX_FRAME } = require('./framing.cjs');
const MAX_BUFFERED = 2170888;

class FrameDecoder {
  constructor() { this.reset(); }

  reset() {
    this.header = Buffer.alloc(8);
    this.headerBytes = 0;
    this.payload = null;
    this.payloadBytes = 0;
    this.kind = 0;
    this.failed = false;
    this.closed = false;
  }

  get pendingBytes() { return this.headerBytes + this.payloadBytes; }

  fail(message) {
    this.header.fill(0);
    this.headerBytes = 0;
    this.payload = null;
    this.payloadBytes = 0;
    this.failed = true;
    throw new Error(message);
  }

  push(chunk) {
    if (this.failed) throw Error('Frame decoder failed; reset is required.');
    if (this.closed) throw Error('Frame decoder is closed.');
    if (!Buffer.isBuffer(chunk)) throw new TypeError('Frame chunk must be a Buffer.');
    if (this.pendingBytes + chunk.length > MAX_BUFFERED) this.fail('Frame excedeu o limite.');
    const frames = [];
    let offset = 0;
    while (offset < chunk.length) {
      if (this.headerBytes < 8) {
        const count = Math.min(8 - this.headerBytes, chunk.length - offset);
        chunk.copy(this.header, this.headerBytes, offset, offset + count);
        offset += count;
        this.headerBytes += count;
        if (this.headerBytes < 8) continue;
        const length = this.header.readUInt32LE(0);
        if (length > MAX_FRAME) this.fail('Frame inv\u00e1lido.');
        this.kind = this.header.readUInt32LE(4);
        this.payload = Buffer.alloc(length);
      }
      const count = Math.min(this.payload.length - this.payloadBytes, chunk.length - offset);
      chunk.copy(this.payload, this.payloadBytes, offset, offset + count);
      offset += count;
      this.payloadBytes += count;
      if (this.payloadBytes === this.payload.length) {
        frames.push({ kind: this.kind, payload: this.payload });
        this.headerBytes = 0;
        this.payload = null;
        this.payloadBytes = 0;
      }
    }
    return frames;
  }

  end() {
    if (this.failed) throw Error('Frame decoder failed; reset is required.');
    if (this.pendingBytes) this.fail('Truncated frame.');
    this.closed = true;
  }
}

module.exports = { FrameDecoder, MAX_BUFFERED };
