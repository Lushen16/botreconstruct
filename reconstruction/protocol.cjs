'use strict';

const STATE_SIZE = 48;
const COMMAND_SIZE = 24;
const ACK_SIZE = 12;
const COMMANDS = { walk: 1, attack: 2, follow: 3, stop: 4, focus: 5, talk: 6, combo: 7, switchPokemon: 8, action: 9, fight: 11, potion: 12, revive: 13, useWith: 14, recallPokemon: 15, order: 16, turn: 17, refreshCombo: 18, chase: 19, hotkey: 20, orderGround: 21, guildDaily: 25 };
const DIRECTIONS = { north: 0, east: 1, south: 2, west: 3, northeast: 4, southeast: 5, southwest: 6, northwest: 7 };
const STATUS = { 0: "Comando enviado.", 1: "Comando inv\u00e1lido", 2: "Cliente offline", 3: "Fun\u00e7\u00f5es do jogo indispon\u00edveis", 4: "A identidade do Pok\u00e9mon mudou; aguardando atualiza\u00e7\u00e3o.", 5: "Cliente ou action bar aguardando cooldown; comando n\u00e3o executado.", 6: "Hotkey/slot sem a a\u00e7\u00e3o de item esperada na action bar." };
const fail = message => { throw new Error(message); };
function uint32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) fail(`${label}: inteiro de 32 bits inv\u00e1lido.`);
  return value;
}
function uuidHash(value) {
  let hash = 2166136261;
  for (const byte of Buffer.from(value)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash;
}
function decodeState(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== STATE_SIZE) fail("Estado IPC deve ter exatamente 48 bytes.");
  const state = { version: bytes.readUInt32LE(0), isOnline: bytes.readUInt32LE(4), healthPercent: bytes.readUInt32LE(8), hp: bytes.readDoubleLE(12), mana: bytes.readDoubleLE(20), cap: bytes.readDoubleLE(28), targetId: bytes.readUInt32LE(36), attackSeqNum: bytes.readUInt32LE(40), protoVersion: bytes.readUInt32LE(44) };
  if (state.healthPercent > 100 || ![state.hp, state.mana, state.cap].every(Number.isFinite)) fail("Estado IPC cont\u00e9m valores inv\u00e1lidos. Confira os offsets da DLL.");
  state.authExpired = false;
  state.online = Boolean(state.isOnline);
  return state;
}
function decodeAck(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== ACK_SIZE) fail("ACK IPC deve ter exatamente 12 bytes.");
  return { commandId: bytes.readUInt32LE(0), type: bytes.readUInt32LE(4), status: bytes.readUInt32LE(8) };
}
const inRange = (value, minimum, maximum) => Number.isInteger(value) && value >= minimum && value <= maximum;
function encodeCommand(commandId, command, parameter = 0, options = {}) {
  uint32(commandId, 'commandId');
  if (commandId === 0) uint32(-1, 'commandId');
  const expectedUuid = options.expectedUuid;
  const type = COMMANDS[command];
  let bytes = Buffer.alloc(COMMAND_SIZE);
  let identityOffset = 12;
  let text;
  if (['talk', 'combo', 'switchPokemon', 'recallPokemon', 'hotkey', 'guildDaily'].includes(command)) {
    if (typeof parameter !== 'string' || /[\x00-\x1f\x7f]/.test(parameter)) fail("Texto do comando inv\u00e1lido.");
    text = Buffer.from(parameter, 'utf8');
    if (text.length < 1 || text.length > 255) fail("Texto deve ter entre 1 e 255 bytes UTF-8.");
    if (command === 'combo' && parameter !== '!autocombo' && !/^!autocombo [^,]+(?:, [^,]+)*$/.test(parameter)) fail("Combo deve usar !autocombo ou uma lista de spellwords separadas por v\u00edrgula e espa\u00e7o.");
    if (command === 'guildDaily') {
      const [tier, element, extra] = parameter.split(':');
      if (extra !== undefined || !['normal', 'wildscape', 'primal'].includes(tier) || !['normal', 'fire', 'fighting', 'water', 'flying', 'grass', 'poison', 'electric', 'ground', 'psychic', 'rock', 'ice', 'bug', 'dragon', 'ghost', 'dark', 'steel', 'fairy'].includes(element)) fail("Escolha um tier e elemento v\u00e1lidos para a daily guild.");
    }
    bytes.writeUInt32LE(text.length, 8);
  } else if (command === 'turn') {
    if (!parameter || !inRange(parameter.direction, 0, 3) || typeof parameter.pokemon !== 'boolean') fail("Dire\u00e7\u00e3o/ator do turn inv\u00e1lido.");
    bytes.writeUInt32LE(parameter.direction, 8);
    bytes.writeUInt32LE(Number(parameter.pokemon), 12);
    identityOffset = 16;
  } else if (['order', 'orderGround', 'useWith'].includes(command)) {
    if (!parameter || !inRange(parameter.x, 0, 65534) || !inRange(parameter.y, 0, 65534) || !inRange(parameter.z, 0, 15)) fail("Posi\u00e7\u00e3o inv\u00e1lida.");
    const offset = command === 'useWith' ? 12 : 8;
    bytes.writeUInt16LE(parameter.x, offset);
    bytes.writeUInt16LE(parameter.y, offset + 2);
    bytes.writeUInt8(parameter.z, offset + 4);
    if (command === 'orderGround') {
      const summonId = uint32(parameter.summonId, 'summonId');
      if (summonId === 0) uint32(-1, 'summonId');
      bytes.writeUInt32LE(summonId, 16);
    }
    if (command === 'useWith') {
      if (!inRange(parameter.itemId, 1, 65535) || !inRange(parameter.targetId, 1, 65535) || !inRange(parameter.stack, 0, 255)) fail("Item ou stack inv\u00e1lido.");
      bytes.writeUInt32LE(parameter.itemId, 8);
      bytes.writeUInt8(parameter.stack, 17);
      bytes.writeUInt32LE(parameter.targetId, 20);
    }
    identityOffset = 20;
  } else {
    uint32(parameter, 'param1');
    const valid = command === 'walk' ? parameter <= 7 : ['attack', 'follow'].includes(command) ? true : ['stop', 'focus', 'refreshCombo'].includes(command) ? parameter === 0 : command === 'action' ? inRange(parameter, 1, 50) : command === 'fight' ? inRange(parameter, 1, 3) : command === 'chase' ? parameter <= 1 : command === 'potion' ? inRange(parameter, 1, 65535) : command === 'revive' ? false : Boolean(type);
    if (!valid) fail("Comando ou par\u00e2metros n\u00e3o suportados pelo IPC.");
    bytes.writeUInt32LE(parameter, 8);
  }
  if (options.expectedUuid !== undefined) {
    if (!['talk', 'combo', 'hotkey', 'action', 'potion', 'chase', 'turn', 'orderGround', 'fight', 'refreshCombo'].includes(command) || typeof expectedUuid !== 'string' || !expectedUuid.length) fail("Prote\u00e7\u00e3o de identidade inv\u00e1lida.");
    bytes.writeUInt32LE(uuidHash(options.expectedUuid), identityOffset);
  }
  if (options.expectedAction !== undefined) {
    if (command !== 'hotkey' || options.expectedAction !== 1) fail("Tipo de a\u00e7\u00e3o da hotkey inv\u00e1lido.");
    bytes.writeUInt32LE(options.expectedAction, 16);
  }
  if (options.attackTargetId !== undefined || options.fightMode !== undefined) {
    if (command !== 'talk' || !options.expectedUuid || !/^m[1-9]\d*$/.test(parameter)) fail("Alvo/postura devem acompanhar uma skill de combo com UUID.");
    if (options.attackTargetId !== undefined) bytes.writeUInt32LE(uint32(options.attackTargetId, 'attackTargetId'), 16);
    if (options.fightMode !== undefined) {
      if (options.fightMode !== 0 && options.fightMode !== 1) fail("Postura do combo inv\u00e1lida.");
      bytes.writeUInt32LE(options.fightMode, 20);
    }
  }
  bytes.writeUInt32LE(commandId, 0);
  bytes.writeUInt32LE(type, 4);
  return text ? Buffer.concat([bytes, text]) : bytes;
}
module.exports = { STATE_SIZE, COMMAND_SIZE, ACK_SIZE, COMMANDS, DIRECTIONS, STATUS, uint32, uuidHash, decodeState, encodeCommand, decodeAck };
