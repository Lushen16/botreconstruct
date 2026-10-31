const KIND = Object.freeze({ challenge: 1, authenticate: 2, welcome: 3, state: 4,
  telemetry: 5, automation: 6, startup: 7, automation_revoked: 8, manual: 9,
  ack: 10, automation_control: 11, automation_lease: 12 });
const MAX_FRAME = 2105344;

function frame(kind, payload) {
  if (!Buffer.isBuffer(payload)) throw new TypeError('Frame payload must be a Buffer.');
  const result = Buffer.alloc(payload.length + 8);
  result.writeUInt32LE(payload.length, 0);
  result.writeUInt32LE(kind, 4);
  payload.copy(result, 8);
  return result;
}

module.exports = { KIND, MAX_FRAME, frame };
