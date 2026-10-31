const { EventEmitter } = require('node:events');

const { isDeepStrictEqual } = require('node:util');

function walkerExecutionConfig(config) {
  const walker = { ...config?.walker };
  delete walker.luaRevision;
  return walker;
}

const nativeUnavailable = 'Motor nativo ainda nao reconstruido. Perfis locais estao disponiveis; nenhum comando foi enviado ao jogo.';

class Controller extends EventEmitter {
  constructor(store, ports = {}) {
    super();
    this.store = store;
    this.ports = ports;
    this.context = 1;
    this.pending = Promise.resolve();
    this.activeModules = [];
    this.isPaused = true;
    this.handlers = new Map([
      ['bootstrap', () => ({ ...this.snapshot(), version: '3.1.9 / reconstrucao local', settings: this.settings() })],
      ['view', () => ({ accepted: true })],
      ['pause', async () => {
        if (this.ports.runtime) {
          await this.ports.runtime.togglePause();
          return this.snapshot();
        }
        this.isPaused = !this.isPaused;
        return this.snapshot();
      }],
      ['save', (name, config, context) => this.change(context, () => this.store.save(name, config))],
      ['select', (name, context) => this.change(context, () => this.store.select(name))],
      ['remove', (name, context) => this.change(context, () => this.store.remove(name))],
      ['autosave', async (name, config, context) => {
        this.requireContext(context);
        const current = this.store.snapshot();
        if (name !== current.activeProfile) throw Error('Perfil ativo mudou; recarregue antes de salvar.');
        const activeConfig = current.profiles.find(profile => profile.name === name)?.config;
        const keepWalker = this.ports.runtime?.state?.backend === 'keyboard-rpm'
          && isDeepStrictEqual(walkerExecutionConfig(activeConfig), walkerExecutionConfig(config));
        if (!keepWalker) await this.ports.runtime?.setModules('all', false);
        await this.store.save(name, config);
        if (keepWalker) this.ports.runtime?.updateConfig?.(config);
        let luaRevision = config.walker?.luaRevision || '';
        const profile = config.walker?.luaProfile;
        if (this.ports.saveRoute && typeof profile === 'string' && profile) {
          const saved = await this.ports.saveRoute(profile, config, { expectedRevision: config.walker.luaRevision });
          if (saved && typeof saved.revision === 'string') luaRevision = saved.revision;
        }
        return { luaProfile: profile || '', luaRevision };
      }],
      ['shortcuts', (tools, context) => {
        this.requireContext(context);
        if (this.ports.shortcuts) return this.ports.shortcuts(tools);
        return { registered: false };
      }],
      ['walkerProfiles', context => {
        this.requireContext(context);
        if (this.ports.walkerProfiles) return this.ports.walkerProfiles();
        return [];
      }],
      ['copyText', text => this.ports.copyText?.(String(text))],
      ['import', async (config, context) => {
        this.requireContext(context);
        const imported = await this.ports.importProfile?.(config);
        if (!imported) return false;
        await this.store.save(this.store.snapshot().activeProfile, imported.config);
        return imported;
      }],
      ['export', (config, context) => { this.requireContext(context); return this.ports.exportProfile?.(config); }],
      ['quit', () => this.ports.quit?.()],
      ['runtime', async (module, enabled, pid, config, context) => {
        this.requireContext(context);
        if (this.ports.runtime) {
          const current = this.store.snapshot();
          const activeConfig = current.profiles.find(profile => profile.name === current.activeProfile).config;
          await this.ports.runtime.setModules(module, enabled, pid, config || activeConfig);
          return this.snapshot();
        }
        if (enabled) throw Error(nativeUnavailable);
        if (module === 'all') {
          this.activeModules = [];
        } else {
          this.activeModules = this.activeModules.filter(m => m !== module);
        }
        return this.snapshot();
      }],
      ['monitor', (enabled, pid, config, context) => {
        this.requireContext(context);
        if (this.ports.monitor) return this.ports.monitor(enabled, pid, config);
        if (enabled) throw Error(nativeUnavailable);
        return this.snapshot();
      }],
    ]);
    for (const name of ['command', 'mapInfo', 'mapRegion', 'openMap', 'resetMap',
      'showLook', 'gmLearning', 'loadWalkerProfile', 'performance']) {
      if (this.ports[name]) {
        this.handlers.set(name, (...args) => this.ports[name](...args));
      } else {
        this.handlers.set(name, () => { throw Error(nativeUnavailable); });
      }
    }
  }

  requireContext(context) {
    if (context !== this.context) throw Error('Contexto do perfil desatualizado. Recarregue o perfil.');
  }

  settings() {
    const liveSessions = this.sessions;
    const charName = liveSessions[0]?.telemetry?.playerName || 'Configuracao local';
    return { ...structuredClone(this.store.snapshot()), context: this.context, character: charName };
  }

  get sessions() {
    const nativeSessions = this.ports.runtime?.sessions || [];
    return nativeSessions.length ? nativeSessions : this.ports.getSessions ? this.ports.getSessions() : [];
  }

  snapshot() {
    const liveSessions = this.sessions;
    const clientPid = liveSessions[0]?.pid || null;
    const modules = this.activeModules || [];
    const paused = this.isPaused !== undefined ? this.isPaused : (modules.length === 0);
    return {
      sessions: liveSessions,
      clientPid: clientPid,
      profileContext: this.context,
      profileReady: true,
      monitor: this.ports.monitorState ? this.ports.monitorState() : { enabled: false, pid: clientPid },
      audioPaused: true,
      runtime: this.ports.runtime ? this.ports.runtime.state : {
        modules: modules,
        pid: clientPid,
        phase: paused ? 'Pausado' : (modules.length ? 'Executando' : (clientPid ? 'Pronto' : 'Motor nativo pendente')),
        phases: {},
        paused: paused
      }
    };
  }

  async change(context, operation) {
    this.requireContext(context);
    await this.ports.runtime?.setModules('all', false);
    await operation();
    this.context++;
    const settings = this.settings();
    this.emit('settings', settings);
    return settings;
  }

  invoke(channel, ...args) {
    if (typeof channel !== 'string' || !channel.startsWith('pka:')) return Promise.reject(Error('Canal IPC invalido.'));
    const handler = this.handlers.get(channel.slice(4));
    if (!handler) return Promise.reject(Error('Canal IPC nao implementado.'));
    const operation = this.pending.then(() => handler(...args));
    this.pending = operation.catch(() => {});
    return operation;
  }

  channels() { return [...new Set(this.handlers.keys())].map(name => 'pka:' + name); }
}

module.exports = { Controller, nativeUnavailable };
