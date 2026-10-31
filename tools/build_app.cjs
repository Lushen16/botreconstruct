const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readAsar } = require('./prepare.cjs');
const { planAsset } = require('./app-assets.cjs');
const root = path.resolve(__dirname, '..');
const app = path.join(root, 'reconstruction/app');
const bytes = fs.readFileSync(path.resolve(root, '../Shiba_Bots_App/dll/resources/app.asar'));
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
if (digest !== '0cc1cf89ee210714c150ed6270c9f44afc90e1d0bc2a790c6ab7b9eb77438e24') throw Error('ASAR identity changed');
const entries = readAsar(bytes).entries;
const shared = { 'schema.js': 'schema.js', 'messages.js': 'messages.js', 'diagnostics.js': 'diagnostics.js',
  'walker.js': 'walker-model.js', 'hoenn.js': 'hoenn-model.js', 'alerts.js': 'alerts-model.js', 'healer.js': 'healer-model.js' };
const files = [];
let previous = { files: [] };
const manifestPath = path.join(app, 'asset-manifest.json');
if (fs.existsSync(manifestPath)) previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const previousHashes = new Map(previous.files.filter(file => !file.preserved).map(file => [file.path, file.sha256]));
const walkerFlags = fs.readFileSync(path.join(root, 'reconstruction/walker-flags.js'));
const walkerInputUi = fs.readFileSync(path.join(root, 'reconstruction/walker-input-ui.js'));
const combatReadiness = fs.readFileSync(path.join(root, 'reconstruction/combat-readiness.js'));
for (const entry of entries) {
  let target;
  if (entry.relative.startsWith('renderer/')) target = entry.relative.slice('renderer/'.length);
  else if (entry.relative.startsWith('shared/')) target = shared[entry.relative.slice('shared/'.length)];
  else if (entry.relative.startsWith('assets/alerts/')) target = 'alerts-audio/' + entry.relative.slice('assets/alerts/'.length);
  if (!target) continue;
  const output = path.resolve(app, 'ui', target);
  if (!output.startsWith(path.join(app, 'ui') + path.sep)) throw Error('Unsafe output path');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  let generated = entry.bytes;
  if (target === 'diagnostics.js') generated = Buffer.concat([entry.bytes, Buffer.from('\n'), combatReadiness]);
  if (target === 'walker-model.js') generated = Buffer.concat([entry.bytes, Buffer.from('\n'), walkerFlags,
    Buffer.from('\n'), walkerInputUi]);
  if (target === 'walker.js') generated = Buffer.from(entry.bytes.toString('utf8')
    .replace('if(6&a)throw Error', 'if(!window.PkaWalker.canStand(a))throw Error'));
  const asset = planAsset(entry.bytes, generated, fs.existsSync(output) ? fs.readFileSync(output) : null,
    previousHashes.get(target));
  if (!asset.preserved) fs.writeFileSync(output, asset.bytes);
  files.push({ path: target, original: entry.relative, sha256: asset.sha256,
    original_sha256: asset.original_sha256, preserved: asset.preserved });
}
const api = fs.readFileSync(path.join(root, 'reconstruction/renderer-api.cjs'), 'utf8');
const diagnosticsApi = fs.readFileSync(path.join(root, 'reconstruction/diagnostics-api.cjs'), 'utf8');
// Local, non-ASAR overlays that must stay published (e.g. the simulation toggle).
for (const extra of ['sim.js']) {
  const overlay = path.join(app, 'ui', extra);
  if (!fs.existsSync(overlay)) continue;
  files.push({ path: extra, original: null, preserved: true,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(overlay)).digest('hex'),
    original_sha256: null });
}
const preload = "const {contextBridge,ipcRenderer}=require('electron');\n" + api + "\n" + diagnosticsApi +
  "\nconst exposed=createRendererApis(ipcRenderer);\ncontextBridge.exposeInMainWorld('pka',exposed.pka);\n"
  + "if(typeof process!=='undefined'&&Array.isArray(process.argv)&&diagnosticsEnabled(process.env||{},process.argv)){\n"
  + "  contextBridge.exposeInMainWorld('pkaDiag',createDiagnosticApis(ipcRenderer).pkaDiag);\n}\n";
fs.writeFileSync(path.join(app, 'preload.cjs'), preload);
// Preload for the separate "look" overlay window (namespace `pkaLook`).
const lookPreload = "const {contextBridge,ipcRenderer}=require('electron');\n" + api +
  "\nconst exposed=createRendererApis(ipcRenderer);\ncontextBridge.exposeInMainWorld('pkaLook',exposed.pkaLook);\n";
fs.writeFileSync(path.join(app, 'ui', 'look-preload.cjs'), lookPreload);
fs.writeFileSync(path.join(app, 'asset-manifest.json'), JSON.stringify({ archive_sha256: digest, files }, null, 2) + '\n');
console.log(JSON.stringify({ app, copied_original_files: files.length, archive_sha256: digest }));
