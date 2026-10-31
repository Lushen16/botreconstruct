'use strict';

const crypto = require('node:crypto');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { frame } = require('./framing.cjs');
const { decodeAck } = require('./protocol.cjs');
const { KIND, MAX_FRAME, pipePath, proof, CLIENT_DOMAIN, SERVER_DOMAIN, parseFrames } = require('./transport.cjs');

const fail = message => { throw new Error(message); };
const pidBuffer = pid => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(pid, 0); return bytes; };

class RuntimeServer extends EventEmitter {
  constructor(options = {}) {
    super();
    if (!Number.isInteger(options.pid) || options.pid <= 0) fail('PID invalido.');
    if (typeof options.key !== 'string' || !options.key) fail('Chave do canal ausente.');
    this.pid = options.pid;
    this.key = options.key;
    this.nonce = options.nonce ? Buffer.from(options.nonce) : crypto.randomBytes(32);
    this.path = options.path || pipePath(options.pid);
    this.server = null;
    this.socket = null;
    this.parser = { buffer: Buffer.alloc(0) };
    this.authenticated = false;
    this.commands = [];
    this.autoAck = options.autoAck !== false;
    this.commandStatus = options.commandStatus ?? 0;
  }

  start() {
    if (this.server) return Promise.resolve(this);
    return new Promise((resolve, reject) => {
      this.server = net.createServer(socket => this.attach(socket));
      this.server.once('error', reject);
      this.server.listen(this.path, () => {
        this.server.removeListener('error', reject);
        this.server.on('error', error => this.emit('error', error));
        resolve(this);
      });
    });
  }

  attach(socket) {
    if (this.socket) { socket.destroy(); return; }
    this.socket = socket;
    this.authenticated = false;
    this.parser = { buffer: Buffer.alloc(0) };
    socket.on('error', error => this.emit('error', error));
    socket.on('close', () => { if (this.socket === socket) { this.socket = null; this.authenticated = false; } this.emit('disconnect'); });
    socket.on('data', chunk => {
      let frames;
      try { frames = parseFrames(this.parser, chunk); }
      catch (error) { this.emit('error', error); socket.destroy(); return; }
      for (const item of frames) {
        try { this.dispatch(item); } catch (error) { this.emit('error', error); socket.destroy(); return; }
      }
    });
    this.write(KIND.challenge, this.nonce);
    this.emit('connection', socket);
  }

  dispatch(item) {
    if (!this.authenticated && item.kind === KIND.authenticate) {
      this.authenticatePayload = Buffer.from(item.payload);
      const expected = proof(CLIENT_DOMAIN, this.key, this.nonce, this.pid);
      if (item.payload.length !== expected.length || !crypto.timingSafeEqual(expected, item.payload)) fail('Prova do cliente invalida.');
      this.authenticated = true;
      this.write(KIND.welcome, Buffer.concat([pidBuffer(this.pid), proof(SERVER_DOMAIN, this.key, this.nonce, this.pid)]));
      this.emit('authenticated');
      return;
    }
    if (!this.authenticated) fail('Canal nao autenticado.');
    if (item.kind === KIND.manual || item.kind === KIND.automation) {
      const record = { kind: item.kind, payload: Buffer.from(item.payload), commandId: item.payload.length >= 8 ? item.payload.readUInt32LE(0) : null };
      this.commands.push(record);
      this.emit('command', record);
      if (this.autoAck && record.commandId !== null) {
        this.ack(record.commandId, item.payload.length >= 8 ? item.payload.readUInt32LE(4) : 0, this.commandStatus);
      }
      return;
    }
    if (item.kind === KIND.startup) { this.emit('startup', item.payload.toString('utf8')); return; }
    this.emit('frame', item);
  }

  write(kind, payload) {
    if (!this.socket) fail('Sem cliente conectado.');
    this.socket.write(frame(kind, payload));
  }

  publishState(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length !== 48) fail('Estado deve ter 48 bytes.');
    this.write(KIND.state, bytes);
  }

  publishTelemetry(value) {
    this.write(KIND.telemetry, Buffer.from(JSON.stringify(value), 'utf8'));
  }

  ack(commandId, type, status = 0) {
    const bytes = Buffer.alloc(12);
    bytes.writeUInt32LE(commandId, 0);
    bytes.writeUInt32LE(type, 4);
    bytes.writeUInt32LE(status, 8);
    this.write(KIND.ack, bytes);
    return decodeAck(bytes);
  }

  revoke(reason) {
    this.write(KIND.automation_revoked, Buffer.from(String(reason || ''), 'utf8'));
  }

  close() {
    try { this.socket?.destroy(); } catch { /* ignore */ }
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    return new Promise(resolve => server.close(() => resolve()));
  }
}

module.exports = { RuntimeServer, MAX_FRAME };
