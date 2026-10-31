'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

function parseProcesses(output) {
  const pids = new Set();
  for (const line of output.split(/\r?\n/)) {
    const match = /^"PokeAlliance_dx\.exe","([0-9]+)"/i.exec(line.trim());
    if (match && Number.isSafeInteger(Number(match[1])) && Number(match[1]) > 0) pids.add(Number(match[1]));
  }
  return [...pids].sort((left, right) => left - right);
}

function discoverProcesses(run = spawnSync) {
  const result = run('tasklist.exe', ['/FI', 'IMAGENAME eq PokeAlliance_dx.exe', '/FO', 'CSV', '/NH'],
    { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  if (result.error || result.status !== 0) throw Error('Falha ao consultar os clientes abertos.');
  return parseProcesses(result.stdout);
}

function selectPid(pids, requested) {
  if (requested !== undefined && requested !== '') {
    if (!/^[0-9]+$/.test(String(requested)) || !Number.isSafeInteger(Number(requested)) || Number(requested) <= 0) {
      throw Error('PKA_PID invalido. Informe um PID inteiro positivo.');
    }
    const pid = Number(requested);
    if (!pids.includes(pid)) throw Error('O cliente PKA_PID=' + pid + ' nao esta aberto.');
    return pid;
  }
  if (!pids.length) throw Error('Nenhum cliente PokeAlliance_dx.exe aberto.');
  if (pids.length !== 1) throw Error('Mais de um cliente aberto: ' + pids.join(', ') + '. Defina PKA_PID para escolher.');
  return pids[0];
}

function providerOptions(root, environment, pids) {
  const pid = selectPid(pids, environment.PKA_PID);
  const snapshotFile = path.resolve(root, environment.PKA_SESSION_FILE || 'live-snapshot.json');
  const args = ['--watch', '--pid', String(pid), '--output', snapshotFile];
  const playerName = environment.PKA_PLAYER_NAME?.trim();
  if (playerName) args.push('--player-name', playerName);
  return { pid, snapshotFile, args };
}

function assessReadiness(pid, pipes, credentialsConfigured) {
  const pipeAvailable = pipes.some(filename => path.win32.basename(filename) === 'pka-runtime-2-' + pid);
  const blockers = [];
  if (!pipeAvailable) blockers.push('Canal pka-runtime-2-' + pid + ' ausente; o cliente aberto sozinho nao inicia o servidor nativo.');
  if (!credentialsConfigured) blockers.push('Configure a chave do canal em PKA_CHANNEL_KEY ou PKA_CHANNEL_KEY_FILE para este PID.');
  return { pid, pipeAvailable, credentialsConfigured, prerequisitesReady: blockers.length === 0,
    nativeVerified: false, blockers };
}

function useKeyboardWalker(environment, diagnostics = false, simulation = false) {
  if (diagnostics || simulation) return false;
  if (environment.PKA_WALKER_BACKEND) return environment.PKA_WALKER_BACKEND === 'keyboard';
  return !environment.PKA_CHANNEL_KEY && !environment.PKA_CHANNEL_KEY_FILE;
}

module.exports = { parseProcesses, discoverProcesses, selectPid, providerOptions, assessReadiness, useKeyboardWalker };
