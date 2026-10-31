'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const { Transport, KIND, pipePath, proof, CLIENT_DOMAIN, SERVER_DOMAIN } = require('../reconstruction/transport.cjs');
const { RuntimeServer } = require('../reconstruction/runtime-server.cjs');
const { encodeCommand, decodeAck } = require('../reconstruction/protocol.cjs');

const KEY = '00112233445566778899aabbccddeeff';
const NONCE = Buffer.from('0123456789abcdef0123456789abcdef');
let nextPid = 46000 + (process.pid % 500);

function pair() {
  const pid = nextPid++;
  const server = new RuntimeServer({ pid, key: KEY, nonce: NONCE });
  const transport = new Transport({ pid, key: KEY, startupTimeoutMs: 4000, commandTimeoutMs: 2000 });
  return { pid, server, transport };
}

const telemetryBody = (patch = {}) => ({
  schema: 2, nativeVerified: true, pulseVersion: 3, tick: 1, playerId: 1, fightMode: 0, chaseMode: 0,
  clockMs: 0, position: { x: 10, y: 20, z: 7 }, activeSlot: 0, moves: [], nativeSequence: [],
  pokemonName: 'X', comboPokemonName: 'X', conditionEvents: true, conditionsKnown: false,
  conditions: [], roster: [], creatures: [], items: [], tiles: [], ...patch,
});

const stateBytes = (patch = {}) => {
  const bytes = Buffer.alloc(48);
  bytes.writeUInt32LE(1, 0);
  bytes.writeUInt32LE(1, 4);
  bytes.writeUInt32LE(patch.healthPercent ?? 90, 8);
  bytes.writeDoubleLE(patch.hp ?? 100, 12);
  bytes.writeDoubleLE(patch.mana ?? 50, 20);
  bytes.writeDoubleLE(patch.cap ?? 150, 28);
  bytes.writeUInt32LE(patch.targetId ?? 0, 36);
  bytes.writeUInt32LE(patch.attackSeqNum ?? 0, 40);
  bytes.writeUInt32LE(patch.protoVersion ?? 1, 44);
  return bytes;
};

test('pipe path matches the observed runtime channel', () => {
  assert.equal(pipePath(32084), '\\\\.\\pipe\\pka-runtime-2-32084');
});

test('handshake authenticates both directions and uses the observed proof', async () => {
  const { pid, server, transport } = pair();
  await server.start();
  try {
    const ready = new Promise(resolve => transport.once('ready', resolve));
    await transport.connect();
    await ready;
    assert.equal(transport.authenticated, true);
    assert.equal(server.authenticated, true);
    assert.equal(proof(CLIENT_DOMAIN, KEY, NONCE, pid).length, 32);
    assert.equal(proof(SERVER_DOMAIN, KEY, NONCE, pid).length, 32);
    assert.notEqual(proof(CLIENT_DOMAIN, KEY, NONCE, pid).toString('hex'), proof(SERVER_DOMAIN, KEY, NONCE, pid).toString('hex'));
  } finally { transport.close(); await server.close(); }
});

test('server publishes state and telemetry that the transport decodes', async () => {
  const { server, transport } = pair();
  await server.start();
  try {
    await transport.connect();
    const stateSeen = new Promise(resolve => transport.once('state', resolve));
    const telemetrySeen = new Promise(resolve => transport.once('telemetry', resolve));
    server.publishState(stateBytes({ healthPercent: 87, targetId: 5 }));
    server.publishTelemetry(telemetryBody({ position: { x: 11, y: 21, z: 7 } }));
    const state = await stateSeen;
    const telemetry = await telemetrySeen;
    assert.equal(state.healthPercent, 87);
    assert.equal(state.targetId, 5);
    assert.deepEqual(telemetry.position, { x: 11, y: 21, z: 7 });
    assert.equal(telemetry.pulseVersion, 3);
  } finally { transport.close(); await server.close(); }
});

test('commands are encoded, written and resolved by the ACK', async () => {
  const { server, transport } = pair();
  await server.start();
  try {
    await transport.connect();
    const received = new Promise(resolve => server.once('command', resolve));
    const ack = await transport.sendCommand('attack', 42);
    const command = await received;
    assert.equal(ack.commandId, 1);
    assert.equal(ack.status, 0);
    assert.equal(command.kind, KIND.manual);
    assert.equal(command.payload.readUInt32LE(0), 1);
    assert.equal(command.payload.readUInt32LE(4), 2);
    assert.equal(command.payload.readUInt32LE(8), 42);
  } finally { transport.close(); await server.close(); }
});

test('server status codes surface through the ACK message', async () => {
  const pid = nextPid++;
  const server = new RuntimeServer({ pid, key: KEY, nonce: NONCE, commandStatus: 5 });
  const transport = new Transport({ pid, key: KEY });
  await server.start();
  try {
    await transport.connect();
    const ack = await transport.sendCommand('stop', 0);
    assert.equal(ack.status, 5);
    assert.match(ack.message, /cooldown/u);
  } finally { transport.close(); await server.close(); }
});

test('a wrong channel key aborts the handshake', async () => {
  const pid = nextPid++;
  const server = new RuntimeServer({ pid, key: KEY, nonce: NONCE });
  server.on('error', () => {});
  const transport = new Transport({ pid, key: 'ffffffffffffffffffffffffffffffff', startupTimeoutMs: 1500 });
  await server.start();
  try {
    await assert.rejects(transport.connect(), /Prova do servidor invalida|Handshake|Conexao encerrada/u);
    assert.equal(transport.authenticated, false);
    assert.equal(server.authenticated, false);
  } finally { transport.close(); await server.close(); }
});

test('commands are rejected before authentication', async () => {
  const { server, transport } = pair();
  await assert.rejects(transport.sendCommand('attack', 1), /nao autenticado/u);
  await server.close();
});

test('oversized frames fail closed', async () => {
  const pid = nextPid++;
  const server = new RuntimeServer({ pid, key: KEY, nonce: NONCE });
  const transport = new Transport({ pid, key: KEY });
  await server.start();
  try {
    await transport.connect();
    const failure = new Promise(resolve => transport.once('error', resolve));
    const header = Buffer.alloc(8);
    header.writeUInt32LE(2105345, 0);
    header.writeUInt32LE(4, 4);
    server.socket.write(header);
    assert.match(String((await failure).message), /limite/u);
  } finally { transport.close(); await server.close(); }
});

test('ack decoding keeps commandId, type and status', () => {
  const bytes = Buffer.alloc(12);
  bytes.writeUInt32LE(7, 0); bytes.writeUInt32LE(11, 4); bytes.writeUInt32LE(3, 8);
  assert.deepEqual(decodeAck(bytes), { commandId: 7, type: 11, status: 3 });
  const command = encodeCommand(7, 'walk', 1);
  assert.equal(command.readUInt32LE(0), 7);
});
