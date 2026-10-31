const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { readAsar } = require('./prepare.cjs');

function archiveSources() {
  return readAsar(fs.readFileSync(path.resolve(__dirname,
    '../../Shiba_Bots_App/dll/resources/app.asar'))).entries
    .filter(entry => ['preload.cjs', 'look-preload.cjs'].includes(entry.relative));
}

function createHarness(source, responder = async () => ({})) {
  const events = new EventEmitter();
  const calls = [];
  const exposed = {};
  const electron = { contextBridge: { exposeInMainWorld(name, api) { exposed[name] = api; } },
    ipcRenderer: {
      invoke(channel, ...args) {
        calls.push({ operation: 'invoke', channel, args });
        return Promise.resolve().then(() => responder(channel, ...args));
      },
      send(channel, ...args) { calls.push({ operation: 'send', channel, args }); },
      on: events.on.bind(events), removeListener: events.removeListener.bind(events),
    } };
  const context = vm.createContext({ require(name) {
    if (name !== 'electron') throw new Error('Unexpected dependency: ' + name);
    return electron;
  } });
  new vm.Script(source).runInContext(context, { timeout: 1000 });
  return { exposed, calls, events };
}

async function probe() {
  const preloads = [];
  for (const entry of archiveSources()) {
    const instance = createHarness(entry.bytes.toString('utf8'), async channel =>
      channel === 'pka:bootstrap' ? { settings: { context: 7 } } : {});
    const namespace = Object.keys(instance.exposed)[0];
    const api = instance.exposed[namespace];
    if (namespace === 'pka') {
      await api.bootstrap();
      await api.save('probe', {});
      await api.command('probe', 0, 0);
      await api.autosave('probe', {});
    } else { await api.copy('probe'); api.close(); }
    preloads.push({ path: entry.relative, sha256: entry.sha256, namespace,
      members: Object.keys(api), calls: instance.calls });
  }
  return { authority: 'isolated-preload-probe', original_main_executed: false,
    native_commands_sent: false, preloads,
    limitations: ['IPC is an in-memory recorder; main and native behavior remain unverified.'] };
}

if (require.main === module) probe().then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { archiveSources, createHarness, probe };
