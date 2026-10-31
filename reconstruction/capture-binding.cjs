'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function verifyCaptureBinding(transport, itemId, key) {
  const filename = transport.clientConfig || (process.env.APPDATA
    && path.join(process.env.APPDATA, 'PokeAlliance', 'PokeAllianceV3', 'config.otml'));
  const verification = transport.captureBindingVerification;
  if (!filename || verification?.source !== 'live-confirmation'
      || !Number.isFinite(Date.parse(verification.verifiedAt))
      || !Array.isArray(verification.useWithActions) || !verification.useWithActions.length
      || !verification.useWithActions.every(value => Number.isInteger(value) && value >= 0)) {
    throw Error('Capture: associacao bola/hotkey/modo useWith ainda nao confirmada no cliente.');
  }
  const stat = fs.statSync(filename);
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw Error('Configuracao do cliente invalida.');
  const bytes = fs.readFileSync(filename);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (verification.configSha256 !== digest) throw Error('Capture: configuracao mudou apos confirmacao de useWith.');
  const text = bytes.toString('utf8');
  if ([...text.matchAll(/^  hotkeyProfile_\d+:/gm)].length !== 1) throw Error('Capture: perfil de hotkeys ambiguo.');
  const section = text.match(/^actionBarSettings:\r?\n([\s\S]*?)(?=^\S|$(?![\s\S]))/m)?.[1];
  if (!section) throw Error('Capture: actionBarSettings ausente.');
  const candidates = [];
  for (const match of section.matchAll(/^  (ACTION_BAR_\d+):\r?\n([\s\S]*?)(?=^  \S|$(?![\s\S]))/gm)) {
    const id = Number(match[2].match(/^    itemId: (\d+)\r?$/m)?.[1]);
    const action = Number(match[2].match(/^    action: (\d+)\r?$/m)?.[1]);
    if (id !== itemId || !verification.useWithActions.includes(action)) continue;
    const blocks = [...text.matchAll(/^      (ACTION_BAR_\d+):\r?\n([\s\S]*?)(?=^      \S|^    \S|^\S|$(?![\s\S]))/gm)]
      .filter(block => block[1] === match[1]);
    if (blocks.length !== 1) continue;
    let modesValid = true;
    for (const mode of ['chatDisabled', 'chatEnabled']) {
      const modes = [...blocks[0][2].matchAll(/^          (chatDisabled|chatEnabled):\r?\n([\s\S]*?)(?=^          \S|^        \S|$(?![\s\S]))/gm)]
        .filter(value => value[1] === mode);
      const modeKeys = modes.length === 1
        ? [...modes[0][2].matchAll(/^              key: ([^\r\n]*)/gm)].map(value => value[1].trim().toUpperCase()).filter(Boolean)
        : [];
      if (!modeKeys.length || !modeKeys.every(value => value === key.toUpperCase())) modesValid = false;
    }
    if (!modesValid) continue;
    const keys = [...blocks[0][2].matchAll(/^              key: ([^\r\n]+)/gm)]
      .map(value => value[1].trim().toUpperCase()).filter(Boolean);
    if (keys.length && keys.every(value => value === key.toUpperCase())) candidates.push({ action, slot: match[1] });
  }
  if (candidates.length !== 1) throw Error('Capture: bola, tecla ou modo divergem da actionbar confirmada.');
  for (const block of text.matchAll(/^      ([A-Z0-9_]+):\r?\n([\s\S]*?)(?=^      \S|^    \S|^\S|$(?![\s\S]))/gm)) {
    if (block[1] !== candidates[0].slot && [...block[2].matchAll(/^              key: ([^\r\n]+)/gm)]
      .some(value => value[1].trim().toUpperCase() === key.toUpperCase())) {
      throw Error('Capture: tecla compartilhada com outra acao do cliente.');
    }
  }
  for (const [otherId, otherKey] of Object.entries(transport.captureHotkeys || {})) {
    if (Number(otherId) !== itemId && typeof otherKey === 'string' && otherKey.toUpperCase() === key.toUpperCase()) {
      throw Error('Capture: a mesma tecla foi atribuida a bolas diferentes.');
    }
  }
  return { configFile: path.resolve(filename), configSha256: digest, itemId, key,
    action: candidates[0].action, slot: candidates[0].slot, mode: 'useWith', source: verification.source };
}

module.exports = { verifyCaptureBinding };
