'use strict';

// Walker route store — faithful to the recovered original.
//
// Evidence (Extracted_Source):
//   lib/walker-profiles.jsc strings: "^wk_.+\.lua$", "^wk_(?:index|label_scripts)\.lua$",
//     "sha256"/"digest" (revision), "atomicWrite", ".tmp", ".bak", "MAX_BYTES",
//     "O perfil do Walker excedeu 2 MB.", "O perfil precisa ser um arquivo da pasta OTPbot.",
//     "Perfil do Walker invalido.", ": lista de waypoints nao encontrada. A rota atual foi preservada.",
//     " foi alterado fora do bot. Recarregue a rota antes de salvar para preservar as alteracoes",
//     "Use um nome de perfil sem caracteres de caminho.", "Valor incompativel com um perfil Lua."
//   lib/legacy.jsc strings: parseLuaData, "^return\b", "^([a-zA-Z_][\w]*)\s*=",
//     "^(true|false|nil)\b", "Arquivo Lua invalido ou maior que 2 MB."
//   real files (%LOCALAPPDATA%\OTPbot\wk_*.lua): "return {\n  waypoints = {\n    {pos={x=..,y=..,z=..}, action=\"walk\", param=\"\"},\n  },\n  <settings>,\n}"
//   wk_index.lua: "return {\n  \"Name\",\n  ...\n}"
//
// The route file is a Lua data table, not JSON. This module parses/serializes that
// table; the config mapping uses only keys proven present in the original schema.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_BYTES = 2 * 1024 * 1024;
const ROUTE_RE = /^wk_.+\.lua$/u;
const RESERVED = new Set(['wk_index.lua', 'wk_label_scripts.lua']);

const validRouteId = id => typeof id === 'string' && ROUTE_RE.test(id) && !RESERVED.has(id.toLowerCase())
  && !/[\\/]/u.test(id)
  && !/[\u0000-\u001f\u007f]/u.test(id);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// --------------------------------------------------------------------------- #
// Lua data-table parser (subset used by the route files: return + tables,
// strings, numbers, booleans/nil, comments).
// --------------------------------------------------------------------------- #
function parseLuaData(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    throw Error('Arquivo Lua invalido ou maior que 2 MB.');
  }
  let cursor = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  const fail = () => { throw Error('Somente tabelas Lua de dados sao aceitas (posicao ' + cursor + ').'); };
  const skip = () => {
    for (;;) {
      while (/\s/u.test(text[cursor] || '') && cursor < text.length) cursor += 1;
      if (text.startsWith('--[[', cursor)) {
        const end = text.indexOf(']]', cursor + 4);
        if (end < 0) fail();
        cursor = end + 2;
      } else if (text.startsWith('--', cursor)) {
        while (cursor < text.length && text[cursor] !== '\n') cursor += 1;
      } else break;
    }
  };
  const readString = () => {
    const quote = text[cursor++];
    let output = '';
    const escapes = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', '"': '"', "'": "'" };
    while (cursor < text.length && text[cursor] !== quote) {
      const character = text[cursor++];
      if (character === '\n' || character === '\r') fail();
      if (character !== '\\') { output += character; continue; }
      const escaped = text[cursor++];
      if (Object.hasOwn(escapes, escaped)) output += escapes[escaped];
      else if (/\d/u.test(escaped || '')) {
        let digits = escaped;
        while (digits.length < 3 && /\d/u.test(text[cursor] || '')) digits += text[cursor++];
        if (Number(digits) > 255) fail();
        output += String.fromCharCode(Number(digits));
      } else fail();
    }
    if (text[cursor] !== quote) fail();
    cursor += 1;
    return output;
  };
  const readValue = () => {
    skip();
    if (text[cursor] === '{') {
      cursor += 1;
      const entries = new Map();
      let nextIndex = 1;
      for (;;) {
        skip();
        if (text[cursor] === '}') { cursor += 1; break; }
        if (cursor >= text.length) fail();
        let key;
        const named = /^([a-zA-Z_]\w*)\s*=/u.exec(text.slice(cursor));
        if (named) { key = named[1]; cursor += named[0].length; }
        else if (text[cursor] === '[') {
          cursor += 1;
          key = readValue();
          if (typeof key !== 'string' && !(typeof key === 'number' && Number.isFinite(key))) fail();
          skip();
          if (text[cursor++] !== ']') fail();
          skip();
          if (text[cursor++] !== '=') fail();
        } else key = nextIndex++;
        const normalized = String(key);
        if (['__proto__', 'constructor', 'prototype'].includes(normalized) || entries.has(normalized)) fail();
        entries.set(normalized, readValue());
        skip();
        if (text[cursor] === ',' || text[cursor] === ';') { cursor += 1; continue; }
        if (text[cursor] !== '}') fail();
      }
      if ([...entries.keys()].every((key, index) => key === String(index + 1))) return [...entries.values()];
      return Object.assign(Object.create(null), Object.fromEntries(entries));
    }
    if (text[cursor] === '"' || text[cursor] === "'") return readString();
    const literal = /^(true|false|nil)\b/u.exec(text.slice(cursor));
    if (literal) {
      cursor += literal[0].length;
      return literal[0] === 'nil' ? null : literal[0] === 'true';
    }
    const number = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/u.exec(text.slice(cursor));
    if (!number || !Number.isFinite(Number(number[0]))) fail();
    cursor += number[0].length;
    return Number(number[0]);
  };
  skip();
  if (!/^return\b/u.test(text.slice(cursor))) fail();
  cursor += 6;
  const value = readValue();
  if (!value || typeof value !== 'object') fail();
  skip();
  if (text[cursor] === ';') { cursor += 1; skip(); }
  if (cursor !== text.length) fail();
  return value;
}
function serializeLuaData(value, indent = 0) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return '{}';
    const body = value.map(item => '  '.repeat(indent + 1) + serializeLuaData(item, indent + 1)).join(',\n');
    return '{\n' + body + ',\n' + pad + '}';
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return '{\n' + pad + '}';
    const body = keys.map(key => {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('Valor incompativel com um perfil Lua.');
      const label = /^[a-zA-Z_]\w*$/u.test(key) ? key : '[' + serializeLuaData(key) + ']';
      return '  '.repeat(indent + 1) + label + ' = ' + serializeLuaData(value[key], indent + 1);
    }).join(',\n');
    return '{\n' + body + ',\n' + pad + '}';
  }
  if (typeof value === 'string') {
    return '"' + value.replace(/[\\"\u0000-\u001f]/gu, character => {
      if (character === '\\' || character === '"') return '\\' + character;
      return '\\' + character.charCodeAt(0).toString().padStart(3, '0');
    }) + '"';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw Error('Valor incompativel com um perfil Lua.');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null) return 'nil';
  throw Error('Valor incompativel com um perfil Lua.');
}
const serializeLuaRoute = table => 'return ' + serializeLuaData(table, 0) + '\n';

// --------------------------------------------------------------------------- #
// Route <-> config mapping. Keys proven in the original schema
// (shared/schema.js: luring/lureSkill/healSkill/waypoints/smartWalking/
//  startNearestWaypoint/recordStepDistance/loop/guildDaily*/luaProfile/luaRevision).
// Keys with no schema home (comboLureDelay, fly/teleport/surfPokemon, timer*,
//  consumable*, labelScripts, frontLureMin/MaxDistance, ...) are PRESERVED as-is.
// --------------------------------------------------------------------------- #
const WAYPOINT_ACTIONS = new Set(['walk', 'safespot', 'box', 'stairs', 'wait', 'say']);
function normalizeWaypoint(raw) {
  if (!raw || typeof raw !== 'object' || !raw.pos || !['x', 'y', 'z'].every(k => Number.isInteger(raw.pos[k]))) return null;
  const action = WAYPOINT_ACTIONS.has(raw.action) ? raw.action : 'walk';
  return { action, pos: { x: raw.pos.x, y: raw.pos.y, z: raw.pos.z },
    param: raw.param === undefined || raw.param === null ? '' : String(raw.param),
    stairCheckMonsters: raw.stairCheckMonsters === true };
}

function routeToConfig(table, config) {
  const source = config && typeof config === 'object' ? config : {};
  const walker = { ...(source.walker || {}) };
  const target = { ...(source.target || {}) };
  if (Array.isArray(table.waypoints)) {
    walker.waypoints = table.waypoints.map(normalizeWaypoint).filter(Boolean);
  }
  for (const key of ['smartWalking', 'startNearestWaypoint', 'loop']) {
    if (typeof table[key] === 'boolean') walker[key] = table[key];
  }
  if (Number.isInteger(table.recordStepDistance)) walker.recordStepDistance = table.recordStepDistance;
  for (const key of ['guildDailyTier', 'guildDailyElement', 'guildDailyAutoEnabled',
    'guildDailyUseTicket', 'guildDailyTicketHotkey', 'guildDailyTicketAmount']) {
    if (table[key] !== undefined) walker[key] = table[key];
  }
  const luring = { ...(target.luring || {}) };
  if ('luringEnabled' in table) luring.enabled = table.luringEnabled === true;
  if ('luringMaxDistance' in table) luring.maxDistance = table.luringMaxDistance;
  if ('frontLureEnabled' in table) luring.frontEnabled = table.frontLureEnabled === true;
  if ('frontLureRegroupMargin' in table) luring.frontRegroupMargin = table.frontLureRegroupMargin;
  if ('frontLureRegroupSteps' in table) luring.frontRegroupSteps = table.frontLureRegroupSteps;
  if ('randomLureEnabled' in table) luring.randomEnabled = table.randomLureEnabled === true;
  if ('randomLureMinSeconds' in table) luring.randomMinSeconds = table.randomLureMinSeconds;
  if ('randomLureMaxSeconds' in table) luring.randomMaxSeconds = table.randomLureMaxSeconds;
  const lureSkill = { ...(target.lureSkill || {}) };
  if ('lureSkillEnabled' in table) lureSkill.enabled = table.lureSkillEnabled === true;
  if ('lureSkillMove' in table) lureSkill.move = table.lureSkillMove;
  if ('lureSkillHpPercent' in table) lureSkill.hpPercent = table.lureSkillHpPercent;
  const healSkill = { ...(target.healSkill || {}) };
  if ('healSkillEnabled' in table) healSkill.enabled = table.healSkillEnabled === true;
  if ('healSkillMove' in table) healSkill.move = table.healSkillMove;
  if ('healSkillHpPercent' in table) healSkill.hpPercent = table.healSkillHpPercent;
  const combo = { ...(target.combo || {}) };
  if (Number.isFinite(table.comboLureDelay)) combo.lureDelay = table.comboLureDelay;
  return { walker, target: { ...target, combo, luring, lureSkill, healSkill } };
}

function configToRoute(table, config) {
  const walker = (config && config.walker) || {};
  const target = (config && config.target) || {};
  const luring = target.luring || {};
  const lureSkill = target.lureSkill || {};
  const healSkill = target.healSkill || {};
  table.waypoints = (Array.isArray(walker.waypoints) ? walker.waypoints : []).map(point => ({
    pos: { x: point.pos.x, y: point.pos.y, z: point.pos.z },
    action: point.action, param: point.param === undefined ? '' : String(point.param) }));
  table.smartWalking = walker.smartWalking === true;
  table.startNearestWaypoint = walker.startNearestWaypoint === true;
  if (typeof walker.loop === 'boolean') table.loop = walker.loop;
  if (Number.isFinite(target.combo?.lureDelay)) table.comboLureDelay = target.combo.lureDelay;
  table.recordStepDistance = Number.isInteger(walker.recordStepDistance) ? walker.recordStepDistance : 5;
  for (const key of ['guildDailyTier', 'guildDailyElement', 'guildDailyAutoEnabled',
    'guildDailyUseTicket', 'guildDailyTicketHotkey', 'guildDailyTicketAmount']) {
    if (walker[key] !== undefined) table[key] = walker[key];
  }
  table.luringEnabled = luring.enabled === true;
  table.luringMaxDistance = luring.maxDistance ?? 2;
  table.frontLureEnabled = luring.frontEnabled === true;
  table.frontLureRegroupMargin = luring.frontRegroupMargin ?? 7;
  table.frontLureRegroupSteps = luring.frontRegroupSteps ?? 2;
  table.randomLureEnabled = luring.randomEnabled === true;
  table.randomLureMinSeconds = luring.randomMinSeconds ?? 45;
  table.randomLureMaxSeconds = luring.randomMaxSeconds ?? 100;
  table.lureSkillEnabled = lureSkill.enabled === true;
  table.lureSkillMove = lureSkill.move ?? '';
  table.lureSkillHpPercent = lureSkill.hpPercent ?? 0;
  table.healSkillEnabled = healSkill.enabled === true;
  table.healSkillMove = healSkill.move ?? '';
  table.healSkillHpPercent = healSkill.hpPercent ?? 0;
  return table;
}

function createRouteStore(directory) {
  const file = id => path.join(directory, id);
  return {
    list() {
      if (!fs.existsSync(directory)) return [];
      return fs.readdirSync(directory, { withFileTypes: true })
        .filter(entry => entry.isFile() && validRouteId(entry.name))
        .map(entry => entry.name)
        .sort((left, right) => left.localeCompare(right))
        .map(name => ({ id: name, name: name.slice(3, -4) }));
    },
    revision(id) {
      if (!validRouteId(id) || !fs.existsSync(file(id))) return null;
      return digest(fs.readFileSync(file(id)));
    },
    read(id) {
      if (!validRouteId(id)) throw Error('Use um nome de perfil sem caracteres de caminho.');
      if (!fs.existsSync(file(id))) throw Error('O perfil precisa ser um arquivo da pasta OTPbot.');
      const bytes = fs.readFileSync(file(id));
      if (bytes.length > MAX_BYTES) throw Error('O perfil do Walker excedeu 2 MB.');
      return { table: parseLuaData(bytes.toString('utf8')), revision: digest(bytes) };
    },
    // Writes atomically (temp + rename) keeping a .bak, like the original.
    save(id, config, options = {}) {
      if (!validRouteId(id)) throw Error('Use um nome de perfil sem caracteres de caminho.');
      let table = {};
      if (fs.existsSync(file(id))) {
        const current = fs.readFileSync(file(id));
        if (current.length > MAX_BYTES) throw Error('O perfil do Walker excedeu 2 MB.');
        if (options.expectedRevision && digest(current) !== options.expectedRevision) {
          throw Error(id + ' foi alterado fora do bot. Recarregue a rota antes de salvar para preservar as alteracoes.');
        }
        table = parseLuaData(current.toString('utf8'));
        fs.writeFileSync(file(id) + '.bak', current);
      }
      configToRoute(table, config);
      const bytes = Buffer.from(serializeLuaRoute(table), 'utf8');
      if (bytes.length > MAX_BYTES) throw Error('O perfil do Walker excedeu 2 MB.');
      fs.mkdirSync(directory, { recursive: true });
      const temporary = file(id) + '.tmp';
      fs.writeFileSync(temporary, bytes);
      fs.renameSync(temporary, file(id));
      return { revision: digest(bytes) };
    },
  };
}

function loadWalkerProfile(store, id, config) {
  const { table, revision } = store.read(id);
  if (!Array.isArray(table.waypoints)) {
    throw Error(id + ': lista de waypoints nao encontrada. A rota atual foi preservada.');
  }
  const merged = routeToConfig(table, config);
  const supported = new Set(['waypoints', 'smartWalking', 'startNearestWaypoint', 'loop',
    'recordStepDistance', 'comboLureDelay', 'guildDailyTier', 'guildDailyElement',
    'guildDailyAutoEnabled', 'guildDailyUseTicket', 'guildDailyTicketHotkey', 'guildDailyTicketAmount',
    'luringEnabled', 'luringMaxDistance', 'frontLureEnabled', 'frontLureRegroupMargin',
    'frontLureRegroupSteps', 'randomLureEnabled', 'randomLureMinSeconds', 'randomLureMaxSeconds',
    'lureSkillEnabled', 'lureSkillMove', 'lureSkillHpPercent', 'healSkillEnabled', 'healSkillMove', 'healSkillHpPercent']);
  const warnings = Object.keys(table).filter(key => !supported.has(key))
    .map(key => 'walker.' + key + ': sem campo equivalente; consulte o arquivo original.');
  return { config: { ...config, walker: { ...merged.walker, luaProfile: id, luaRevision: revision },
    target: merged.target }, warnings, luaRevision: revision };
}

module.exports = { createRouteStore, loadWalkerProfile, validRouteId, parseLuaData,
  serializeLuaRoute, serializeLuaData, MAX_BYTES, ROUTE_RE, RESERVED };
