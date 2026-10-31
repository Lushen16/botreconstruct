const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const active = path.join(process.env.LOCALAPPDATA, 'ShibaLauncher/Apps/a497a7a52bf97c5bcc5fad69c7958ce6/current/Shiba Bots - Poke Alliance v3.1.9');
const previous = path.resolve(root, '../Shiba_Bots_App');
function hash(filename, length = fs.statSync(filename).size) {
  const descriptor = fs.openSync(filename, 'r');
  const digest = crypto.createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  let position = 0;
  try {
    while (position < length) {
      const read = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, length - position), position);
      if (!read) throw Error('File changed or truncated during inspection.');
      digest.update(buffer.subarray(0, read));
      position += read;
    }
    return digest.digest('hex');
  } finally { fs.closeSync(descriptor); }
}
const relatives = ['dll/resources/app.asar', 'dll/PKA Tools.exe',
  'a497a7a52bf97c5bcc5fad69c7958ce6.exe',
  ...fs.readdirSync(path.join(active, 'libs')).filter(name => name.endsWith('.dll')).map(name => 'libs/' + name)];
const comparisons = relatives.map(relative => {
  const filename = path.join(active, relative);
  const old = path.join(previous, relative);
  const sha256 = hash(filename);
  const previousSha256 = fs.existsSync(old) ? hash(old) : null;
  return { relative, size: fs.statSync(filename).size, sha256, previousSha256,
    byteIdentical: previousSha256 === null ? null : sha256 === previousSha256 };
});
const originalExecutable = path.join(active, 'dll/PKA Tools.exe');
const originalSize = fs.statSync(originalExecutable).size;
const originalDigest = hash(originalExecutable);
const temporaryExecutables = fs.readdirSync(path.join(active, 'dll')).filter(name => name.endsWith('.exe.tmp')).map(name => {
  const filename = path.join(active, 'dll', name);
  const size = fs.statSync(filename).size;
  return { name, size, extraBytes: size - originalSize,
    originalPrefixMatches: size >= originalSize && hash(filename, originalSize) === originalDigest,
    suffixRead: false, suffixMeaning: 'unknown; may contain session-specific data' };
});
const report = { generatedAt: new Date().toISOString(), activeRoot: active,
  previousRoot: previous, comparisons, temporaryExecutables,
  originalsModified: false, executablesLaunched: false, credentialsRead: false,
  limitations: ['Hashes compare on-disk files only, not process memory or native behavior.',
    'The d3d9.dll identity does not establish that it is the native automation payload.',
    'Matching installed and copied DLLs does not identify the cause of their malformed bytes.',
    'Appended executable bytes were not read or interpreted.'] };
fs.writeFileSync(path.join(root, 'active-installation-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
