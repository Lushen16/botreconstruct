'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

function readBindings(filename) {
  const text = fs.readFileSync(filename, 'utf8');
  const profiles = text.match(/^  hotkeyProfile_\d+:/gm) || [];
  if (profiles.length !== 1) throw Error('Selecao de perfil de hotkeys ambigua no cliente.');
  const bindings = {};
  for (const match of text.matchAll(/^      (ACTION_\d+|ACTION_BAR_AUTOCOMBO):\r?\n([\s\S]*?)(?=^      \S|^    \S|^\S|$(?![\s\S]))/gm)) {
    const keys = [...match[2].matchAll(/^              key: ([^\r\n]+)/gm)].map(value => value[1].trim());
    const key = keys.find(value => /^(?:F(?:[1-9]|1[0-2])|[A-Z0-9])$/iu.test(value));
    if (key) bindings[match[1] === 'ACTION_BAR_AUTOCOMBO' ? '!autocombo' : 'm' + match[1].slice(7)] = key;
  }
  return bindings;
}

function projectTarget(view, player, creature) {
  if (!view || ![view.width, view.height, view.centerX, view.centerY, view.tileSize].every(Number.isFinite)
      || view.width <= 0 || view.height <= 0 || view.tileSize <= 0 || player.z !== creature.pos.z) {
    throw Error('Calibracao do viewport ausente ou invalida.');
  }
  const x = Math.round(view.centerX + (creature.pos.x - player.x) * view.tileSize);
  const y = Math.round(view.centerY + (creature.pos.y - player.y) * view.tileSize);
  if (!view.map || x < view.map.left || x >= view.map.right || y < view.map.top || y >= view.map.bottom) {
    throw Error('Alvo fora do viewport calibrado.');
  }
  return { kind: 'attack', x, y, width: view.width, height: view.height };
}

function createCombatInput(options = {}) {
  const run = options.execFile || execFile;
  return (pid, request) => new Promise((resolve, reject) => {
    run(options.python || process.env.PKA_PYTHON || 'python',
      [path.resolve(__dirname, '../tools/combat_actuator.py'), String(pid), '--request', JSON.stringify(request)],
      { windowsHide: true, timeout: 3000, maxBuffer: 16384 }, (error, stdout, stderr) => {
        let result;
        try { result = JSON.parse(stdout); } catch {
          const detail = String(stderr || '').trim().split(/\r?\n/).filter(Boolean).pop();
          reject(Error('Atuador de combate sem resposta JSON valida.' + (detail ? ' ' + detail : '')));
          return;
        }
        if (error || result.success !== true || result.pid !== pid || result.eventsSent !== 2 || result.foreground !== true) {
          const failure = Error(result.error || 'Atuador de combate rejeitou o envio.');
          if (result.success === false && result.pid === pid && result.errorCode === 'WALKER_FOCUS_LOST' && result.eventsSent === 0) failure.code = 'WALKER_FOCUS_LOST';
          if (result.success === false && result.pid === pid && result.errorCode === 'COMBAT_TARGET_MOVED' && result.eventsSent === 0) failure.code = 'COMBAT_TARGET_MOVED';
          reject(failure); return;
        }
        resolve(result);
      });
  });
}

module.exports = { readBindings, projectTarget, createCombatInput };
