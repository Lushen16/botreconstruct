const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { bridge, hashes, blockedCalls } = require('./probe_bridge_exports.cjs');
const { pack } = require('./probe_protocol_vectors.cjs');
const payloads = [Buffer.alloc(0), Buffer.from([0]), Buffer.from('abc'),
  Buffer.alloc(48, 165), Buffer.alloc(255, 255), Buffer.from('a\u00e7\u00e3o', 'utf8'),
  Buffer.from([9, 8, 7, 6, 5]).subarray(1, 4)];
const kinds = [...Object.values(bridge.KIND), 0, 255, 256, 65535, 4294967295,
  '2', null, true, false, 1.5, NaN, undefined, -0];
const cases = kinds.flatMap(kind => payloads.map(payload => ({ kind: pack(kind),
  payloadHex: payload.toString('hex'), observedHex: bridge.frame(kind, payload).toString('hex') })));
if (blockedCalls.length) throw Error('Unexpected external operation attempted.');
const report = { generatedAt: new Date().toISOString(), authority: 'controlled-pure-function-execution',
  hashes, KIND: bridge.KIND, MAX_FRAME: bridge.MAX_FRAME,
  casesSha256: crypto.createHash('sha256').update(JSON.stringify(cases)).digest('hex'), cases,
  originalMainExecuted: false, connectionsOpened: false, proofFunctionInvoked: false,
  credentialsRead: false, limitations: ['Finite Buffer payloads only; no receiver/parser behavior is claimed.',
    'Authentication proof is neither invoked nor reconstructed.',
    'The original frame encoder accepts payloads larger than MAX_FRAME; that constant is not enforced here.',
    'The independent encoder explicitly rejects non-Buffer payloads rather than reproducing incidental original errors.'] };
fs.writeFileSync(path.resolve(__dirname, '../framing_vectors.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ vectors: cases.length, casesSha256: report.casesSha256, blockedCalls: blockedCalls.length }));
