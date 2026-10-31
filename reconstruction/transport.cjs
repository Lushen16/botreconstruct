'use strict';

const crypto = require('node:crypto');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { frame } = require('./framing.cjs');
const { encodeCommand, decodeAck, decodeState, STATUS } = require('./protocol.cjs');
const { decodeTelemetry } = require('./telemetry.cjs');

const KIND = Object.freeze({
  challenge: 1, authenticate: 2, welcome: 3, state: 4, telemetry: 5, automation: 6,
  startup: 7, automation_revoked: 8, manual: 9, ack: 10, automation_control: 11, automation_lease: 12,
});
const MAX_FRAME = 2105344;
const CLIENT_DOMAIN = 'PKA2/client\0';
const SERVER_DOMAIN = 'PKA2/server\0';

const fail = message => { throw new Error(message); };
const pipePath = pid => `\\\\.\\pipe\\pka-runtime-2-${pid}`;
const pidBuffer = pid => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(pid, 0); return bytes; };

function proof(domain, key, nonce, pid) {
  if (!Buffer.isBuffer(nonce)) fail('Nonce invalido.');
  return crypto.createHmac('sha256', key).update(Buffer.concat([Buffer.from(domain, 'utf8'), nonce, pidBuffer(pid)])).digest();
}

function parseFrames(state, chunk) {
  state.buffer = Buffer.concat([state.buffer, chunk]);
  const frames = [];
  for (;;) {
    if (state.buffer.length < 8) break;
    const length = state.buffer.readUInt32LE(0);
    if (length > MAX_FRAME) fail('Frame excedeu o limite.');
    if (state.buffer.length < 8 + length) break;
    frames.push({ kind: state.buffer.readUInt32LE(4), payload: state.buffer.subarray(8, 8 + length) });
    state.buffer = state.buffer.subarray(8 + length);
  }
  return frames;
}

class Transport extends EventEmitter {
  constructor(options = {}) {
    super();
    if (!Number.isInteger(options.pid) || options.pid <= 0) fail('PID invalido.');
    if (typeof options.key !== 'string' || !options.key) fail('Chave do canal ausente (PKA_CHANNEL_KEY).');
    this.pid = options.pid;
    this.key = options.key;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 5000;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 5000;
    this.connectFactory = options.connect || (path => net.connect(path));
    this.path = options.path || pipePath(options.pid);
    this.socket = null;
    this.authenticated = false;
    this.nonce = null;
    this.parser = { buffer: Buffer.alloc(0) };
    this.nextCommandId = 1;
    this.pending = new Map();
    this.closed = false;
  }

  connect() {
    if (this.socket) return Promise.resolve(this);
    return new Promise((resolve, reject) => {
      const socket = this.connectFactory(this.path);
      this.socket = socket;
      const timer = setTimeout(() => { this.destroy(new Error('Handshake expirou.')); }, this.startupTimeoutMs);
      let settled = false;
      const settle = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.settle = null;
        if (error) reject(error); else resolve(this);
      };
      this.settle = settle;
      socket.on('connect', () => this.emit('connect'));
      socket.on('error', error => { this.emit('error', error); settle(error); });
      socket.on('close', () => {
        this.closed = true;
        settle(new Error('Conexao encerrada durante o handshake.'));
        this.emit('close');
        this.rejectAll(new Error('Conexao encerrada.'));
      });
      socket.on('data', chunk => {
        let frames;
        try { frames = parseFrames(this.parser, chunk); } catch (error) { this.destroy(error); return; }
        for (const item of frames) {
          try { this.dispatch(item); } catch (error) { this.destroy(error); return; }
        }
        if (this.authenticated) settle(null);
      });
    });
  }

  dispatch(item) {
    if (item.kind === KIND.challenge) {
      if (item.payload.length < 16 || item.payload.length > 64) fail('Desafio invalido.');
      this.nonce = Buffer.from(item.payload);
      const response = proof(CLIENT_DOMAIN, this.key, this.nonce, this.pid);
      this.write(KIND.authenticate, response);
      return;
    }
    if (item.kind === KIND.welcome) {
      if (!this.nonce) fail('Welcome sem desafio.');
      if (item.payload.length !== 36) fail('Welcome invalido.');
      const pid = item.payload.readUInt32LE(0);
      if (pid !== this.pid) fail('Welcome de outro PID.');
      const expected = proof(SERVER_DOMAIN, this.key, this.nonce, this.pid);
      const received = item.payload.subarray(4);
      if (!crypto.timingSafeEqual(expected, received)) fail('Prova do servidor invalida.');
      this.authenticated = true;
      this.emit('ready');
      return;
    }
    if (item.kind === KIND.state) {
      const state = decodeState(item.payload);
      this.emit('state', state);
      return;
    }
    if (item.kind === KIND.telemetry) {
      const telemetry = decodeTelemetry(item.payload);
      this.emit('telemetry', telemetry);
      return;
    }
    if (item.kind === KIND.ack) {
      const ack = decodeAck(item.payload);
      const pending = this.pending.get(ack.commandId);
      if (pending) {
        this.pending.delete(ack.commandId);
        clearTimeout(pending.timer);
        pending.resolve({ ...ack, message: STATUS[ack.status] ?? null });
      }
      this.emit('ack', ack);
      return;
    }
    if (item.kind === KIND.automation_revoked) {
      this.emit('automation-revoked', item.payload.toString('utf8'));
      return;
    }
    if (item.kind === KIND.startup) {
      this.emit('startup', item.payload.toString('utf8'));
      return;
    }
    this.emit('frame', item);
  }

  write(kind, payload) {
    if (this.closed) fail('Canal fechado.');
    if (!this.socket) fail('Canal nao conectado.');
    this.socket.write(frame(kind, payload));
  }

  sendFrame(kind, payload) {
    if (!this.authenticated) fail('Canal nao autenticado.');
    this.write(kind, payload);
  }

  sendCommand(name, parameter, options = {}) {
    if (!this.authenticated) return Promise.reject(new Error('Canal nao autenticado.'));
    const commandId = this.nextCommandId;
    this.nextCommandId = (this.nextCommandId + 1) >>> 0 || 1;
    let bytes;
    try { bytes = encodeCommand(commandId, name, parameter, options); }
    catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        reject(new Error('ACK expirou para ' + name + '.'));
      }, this.commandTimeoutMs);
      this.pending.set(commandId, { resolve, reject, timer, name });
      try { this.write(KIND.manual, bytes); }
      catch (error) { clearTimeout(timer); this.pending.delete(commandId); reject(error); }
    });
  }

  close() {
    this.closed = true;
    this.rejectAll(new Error('Canal encerrado.'));
    try { this.socket?.destroy(); } catch { /* ignore */ }
  }

  destroy(error) {
    this.emit('error', error);
    this.settle?.(error);
    this.close();
  }

  rejectAll(error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

module.exports = { Transport, KIND, MAX_FRAME, pipePath, proof, parseFrames, CLIENT_DOMAIN, SERVER_DOMAIN };
