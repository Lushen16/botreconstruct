'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { Transport, proof, CLIENT_DOMAIN, SERVER_DOMAIN } = require('../reconstruction/transport.cjs');
const { RuntimeServer } = require('../reconstruction/runtime-server.cjs');

const KEY = '00112233445566778899aabbccddeeff';
const NONCE = Buffer.from('0123456789abcdef0123456789abcdef');
let nextPid = 47600 + (process.pid % 300);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('original bytecode bridge and independent transport agree on the handshake', { skip: process.versions.electron !== '44.7.2' }, async () => {
  const pid = nextPid++;
  const server = new RuntimeServer({ pid, key: KEY, nonce: NONCE });
  server.on('error', () => {});
  await server.start();
  let original;
  try {
    const { loadOriginalBridge } = require('../tools/load_bridge.cjs');
    original = loadOriginalBridge().bridge;
    const bridge = new original.PipeBridge('C:/tmp');
    bridge.boundPid = pid;
    bridge.key = KEY;
    bridge.isAlive = () => true;
    assert.equal(bridge.requirePid(pid), pid);
    await bridge.ensure();
    for (let attempt = 0; attempt < 100 && !(server.authenticated && bridge.authenticated); attempt += 1) await wait(20);
    assert.equal(server.authenticated, true, 'server must verify the original client proof');
    assert.equal(bridge.authenticated, true, 'original client must verify the server welcome proof');
    assert.deepEqual(server.authenticatePayload, proof(CLIENT_DOMAIN, KEY, NONCE, pid));

    const transport = new Transport({ pid, key: KEY, startupTimeoutMs: 3000 });
    try {
      server.socket.destroy();
      server.authenticated = false;
      await wait(50);
      await transport.connect();
      assert.equal(transport.authenticated, true);
      assert.equal(server.authenticated, true);
      assert.deepEqual(server.authenticatePayload, proof(CLIENT_DOMAIN, KEY, NONCE, pid));
      assert.notDeepEqual(proof(CLIENT_DOMAIN, KEY, NONCE, pid), proof(SERVER_DOMAIN, KEY, NONCE, pid));
    } finally { transport.close(); }
    bridge.close();
  } finally { await server.close(); }
});
