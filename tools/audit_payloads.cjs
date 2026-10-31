const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const desktop = path.join(process.env.USERPROFILE, 'Desktop');
const selected = [
  path.resolve(root, '../Shiba_Bots_App/libs/d3d9.dll'),
  ...['2.6.3', '2.6.6'].map(version => path.join(desktop, 'Shiba Bots - Poke Alliance v' + version, 'dll/shiba_bots.dll')),
];
const count = (bytes, pattern) => {
  let total = 0;
  let offset = 0;
  for (;;) {
    const found = bytes.indexOf(pattern, offset);
    if (found < 0) return total;
    total++;
    offset = found + pattern.length;
  }
};
const observations = selected.map(filename => {
  if (!fs.existsSync(filename)) return { path: filename, status: 'missing' };
  const bytes = fs.readFileSync(filename);
  const peOffset = bytes.length >= 64 ? bytes.readUInt32LE(60) : null;
  return { path: filename, size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    firstBytes: bytes.subarray(0, 16).toString('hex'),
    peOffset, peOffsetBytes: bytes.subarray(60, 64).toString('hex'),
    peOffsetInFile: peOffset !== null && peOffset <= bytes.length - 4,
    peSignatures: count(bytes, Buffer.from([80, 69, 0, 0])),
    zeroBytes: count(bytes, Buffer.from([0])),
    spaceBytes: count(bytes, Buffer.from([32])),
    utf8ReplacementSequences: count(bytes, Buffer.from([239, 191, 189])),
    targetExecuted: false, sourceModified: false };
});
const report = { generatedAt: new Date().toISOString(), observations,
  limitations: ['Byte patterns do not identify who transformed the files.',
    'Replacement bytes do not preserve the discarded original values.',
    'Do not replace spaces with zero bytes or substitute an older protocol.'] };
fs.writeFileSync(path.join(root, 'native-payload-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
