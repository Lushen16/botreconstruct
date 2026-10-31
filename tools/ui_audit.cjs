'use strict';

// Runs the UI audit in a spawned Electron process and reports the result.
//
// It owns only the process it starts: on timeout it kills that exact child and
// never touches unrelated Electron processes. A timeout, a missing report or an
// unreadable report is a failure, not a silent pass.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ASAR;
const reportPath = path.join(root, 'app-audit.json');
fs.rmSync(reportPath, { force: true });

const timeoutMs = Number(process.env.PKA_AUDIT_TIMEOUT_MS) || 150000;
const child = spawn(path.join(root, 'runtime/electron-v44.7.2/electron.exe'),
  [path.join(root, 'reconstruction/app'), '--audit'], { env, cwd: root, stdio: 'inherit' });

let timedOut = false;
const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);

function finish(code) {
  if (timedOut) {
    console.error(JSON.stringify({ audit: false, error: 'timeout sem relatorio' }));
    process.exitCode = 1; return;
  }
  if (!fs.existsSync(reportPath)) {
    console.error(JSON.stringify({ audit: false, error: 'relatorio ausente' }));
    process.exitCode = 1; return;
  }
  let report;
  try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); }
  catch (error) {
    console.error(JSON.stringify({ audit: false, error: 'relatorio ilegivel: ' + error.message }));
    process.exitCode = 1; return;
  }
  const failures = report.failures || [];
  const result = report.report || {};
  const failed = (result.checks || []).filter(check => check.required && !check.passed).map(check => check.name);
  console.log(JSON.stringify({ audit: result.ok === true, ok: result.ok === true,
    missing: result.missing || [], failed, pending: (result.pending || []).map(p => p.name),
    failures, exit: code }));
  process.exitCode = result.ok === true && failures.length === 0 && code === 0 ? 0 : 1;
}

child.on('error', error => { clearTimeout(timer); console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { clearTimeout(timer); finish(code); });
