const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { bridge, hashes, blockedCalls } = require('./probe_bridge_exports.cjs');
const { buildCases, materialize, describe } = require('./receiver_cases.cjs');

function observe(specification) {
  const receiver = new bridge.PipeBridge('synthetic-no-files');
  receiver.input = Buffer.alloc(0);
  const steps = [];
  for (const chunk of specification.chunks.map(materialize)) {
    const frames = [];
    let next = chunk;
    let error;
    for (;;) {
      const combined = Buffer.concat([receiver.input, next]);
      try { receiver.receive(next); break; }
      catch (failure) {
        if (failure.message !== 'Canal n\u00e3o autenticado.') { error = failure.message; break; }
        const consumed = combined.length - receiver.input.length;
        if (consumed < 8 || consumed !== combined.readUInt32LE(0) + 8) throw Error('Unexpected byte-consumption observation.');
        frames.push({ kind: combined.readUInt32LE(4), payload: describe(combined.subarray(8, consumed)) });
        next = Buffer.alloc(0);
      }
    }
    steps.push({ frames, ...(error ? { error } : { pendingBytes: receiver.input.length }) });
    if (error) break;
  }
  return steps;
}
if (require.main === module) {
  const cases = buildCases().map(specification => ({ ...specification, observed: observe(specification) }));
  if (blockedCalls.length) throw Error('Unexpected external operation attempted.');
  const report = { generatedAt: new Date().toISOString(), authority: 'controlled-receiver-byte-consumption', hashes,
    maximumFrame: bridge.MAX_FRAME, maximumBuffered: 2170888,
    casesSha256: crypto.createHash('sha256').update(JSON.stringify(cases)).digest('hex'), cases,
    connectionsOpened: false, credentialsRead: false, proofFunctionInvoked: false,
    limitations: ['Only framing consumption is projected; the original dispatcher rejects unauthenticated frames.',
      'Synthetic unauthenticated receivers only; no challenge, authenticate or welcome kinds are submitted.',
      'The independent decoder emits envelopes only, not authenticated application messages.',
      'On invalid input the independent decoder discards partial data and requires explicit reset; original residual state is not reproduced.',
      'end/truncation detection is a new local API, not observed original lifecycle behavior.'] };
  fs.writeFileSync(path.resolve(__dirname, '../receiver_vectors.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ vectors: cases.length, blockedCalls: blockedCalls.length }));
}
module.exports = { observe };
