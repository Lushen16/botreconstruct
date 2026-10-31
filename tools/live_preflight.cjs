'use strict';

const fs = require('node:fs');
const path = require('node:path');
const nativeAdapter = require('../reconstruction/native-adapter.cjs');
const { gateReason } = require('../reconstruction/automation.cjs');
const { discoverProcesses, selectPid, assessReadiness } = require('../reconstruction/live-client.cjs');

async function main() {
  const report = { generatedAt: new Date().toISOString(), pids: [], commandsSent: 0, nativeVerified: false };
  let adapter;
  try {
    report.pids = discoverProcesses();
    const pid = selectPid(report.pids, process.env.PKA_PID);
    let credentialsConfigured = false;
    try { credentialsConfigured = Boolean(nativeAdapter.channelKey(pid)); } catch {}
    const pipeDirectory = String.fromCharCode(92, 92, 46, 92) + 'pipe' + String.fromCharCode(92);
    Object.assign(report, assessReadiness(pid, fs.readdirSync(pipeDirectory), credentialsConfigured));
    if (report.prerequisitesReady && process.argv.includes('--verify')) {
      adapter = await nativeAdapter.open({ pid });
      const deadline = Date.now() + 3000;
      do {
        const snapshot = adapter.getSnapshot();
        if (snapshot && !gateReason(snapshot)) {
          report.nativeVerified = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      } while (Date.now() < deadline);
      if (!report.nativeVerified) report.blockers.push('Handshake concluido, mas falta telemetria valida para os motores.');
    }
    report.status = report.nativeVerified ? 'verified' : report.prerequisitesReady ? 'unverified' : 'blocked';
  } catch {
    report.status = 'blocked';
    report.blockers = ['Selecao, descoberta ou verificacao nativa falhou; confira PKA_PID, o canal e sua configuracao.'];
    if (report.pids.length > 1 && !process.env.PKA_PID) report.blockers = ['Defina PKA_PID: clientes abertos ' + report.pids.join(', ') + '.'];
  } finally {
    await adapter?.close();
  }
  fs.writeFileSync(path.resolve(__dirname, '../live-preflight.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === 'verified' ? 0 : 2;
}

void main().catch(() => { console.error('Falha ao gravar o diagnostico de prontidao.'); process.exitCode = 1; });
