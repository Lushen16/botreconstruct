'use strict';

const crypto = require('node:crypto');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function planAsset(original, generated, existing, previousHash) {
  const originalHash = digest(original);
  const existingHash = existing === null ? null : digest(existing);
  const preserved = existingHash !== null && existingHash !== originalHash && existingHash !== previousHash;
  const bytes = preserved ? existing : generated;
  return { bytes, preserved, sha256: digest(bytes), original_sha256: originalHash };
}

module.exports = { planAsset };
