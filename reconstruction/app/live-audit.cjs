'use strict';

const fs = require('node:fs');
const path = require('node:path');

function summarizeWalker(samples, afterStart) {
  const positions = entries => new Set(entries.filter(entry => entry.position).map(entry => JSON.stringify(entry.position))).size;
  const firstInput = samples.findIndex(entry => entry.action?.inputAccepted === true);
  const positionChanged = positions(samples) > 1;
  const positionChangedAfterInput = firstInput >= 0 && positions(samples.slice(firstInput)) > 1;
  return { positionChanged, positionChangedAfterInput, inputAccepted: firstInput >= 0,
    status: afterStart?.status === 'error' ? 'error' : firstInput < 0 ? 'start-not-confirmed'
      : positionChangedAfterInput ? 'rpm-movement-observed' : 'movement-not-confirmed' };
}

async function runLiveAudit(window, runtime, getSessions) {
  const root = path.resolve(__dirname, '../..');
  const evaluate = expression => window.webContents.executeJavaScript(expression);
  const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const report = { startedAt: new Date().toISOString(), source: 'live-rpm', simulation: false, tabs: [], walker: { status: 'pending', samples: [] } };
  const capture = () => {
    const session = getSessions()[0];
    return { at: new Date().toISOString(), pid: session?.pid, generatedAt: session?.generatedAt,
      ageMs: session?.ageMs, online: session?.online, position: session?.telemetry?.position,
      action: runtime.last, runtime: runtime.state };
  };
  const sample = () => report.walker.samples.push(capture());
  const controls = () => evaluate('({notice:document.getElementById("notice-text")?.textContent,buttons:[...document.querySelectorAll("#settings button")].map(button=>({text:button.textContent.trim(),disabled:button.disabled})),run:document.getElementById("run-module")?.textContent})');
  await delay(1800);
  const session = getSessions()[0];
  if (!session?.online || session.source !== 'rpm' || session.stale) {
    report.walker = { status: 'blocked', reason: 'Fresh live RPM session required.', samples: [] };
    return report;
  }
  report.pid = session.pid;
  report.initial = capture();
  const tabs = await evaluate('[...document.querySelectorAll("#tabs button")].map(button=>button.textContent.trim())');
  for (const [index, title] of tabs.entries()) {
    await evaluate('document.querySelectorAll("#tabs button")[' + index + '].click();true');
    await delay(250);
    const state = await controls();
    const screenshot = 'live-ui-tab-' + index + '.png';
    fs.writeFileSync(path.join(root, screenshot), (await window.webContents.capturePage()).toPNG());
    report.tabs.push({ title, status: 'ui-rendered-only', screenshot, ...state });
  }
  const walkerIndex = tabs.findIndex(title => /^walker$/i.test(title));
  if (walkerIndex < 0) { report.walker.reason = 'Walker tab missing.'; return report; }
  await evaluate('document.querySelectorAll("#tabs button")[' + walkerIndex + '].click();true');
  await delay(400);
  const start = await evaluate('(()=>{const button=document.querySelector(".walker-start");return button?{disabled:button.disabled,title:button.title}:null})()');
  report.walker.start = start;
  window.show();
  window.focus();
  await delay(150);
  sample();
  const onChange = () => sample();
  runtime.on('change', onChange);
  try {
    if (!start || start.disabled) {
      report.walker.status = 'blocked';
      report.walker.reason = 'Start button absent or disabled.';
    } else {
      await evaluate('document.querySelector(".walker-start").click();true');
      for (let attempt = 0; attempt < 20; attempt++) {
        await delay(100);
        sample();
        if (runtime.state.status === 'error') break;
      }
      report.walker.afterStart = runtime.state;
      if (runtime.state.modules.includes('walker') && !runtime.state.paused) {
        await evaluate('document.getElementById("pause-all").click();true');
        await delay(300);
        report.walker.afterPause = runtime.state;
      }
      await evaluate('document.querySelector(".walker-stop").click();true');
      await delay(300);
      report.walker.afterStop = runtime.state;
      Object.assign(report.walker, summarizeWalker(report.walker.samples, report.walker.afterStart));
    }
    report.walker.ui = await controls();
  } catch (error) {
    report.walker.status = 'error';
    report.walker.error = error.message;
  } finally {
    await runtime.setModules('all', false);
    runtime.off('change', onChange);
  }
  fs.writeFileSync(path.join(root, 'live-ui-walker.png'), (await window.webContents.capturePage()).toPNG());
  report.finishedAt = new Date().toISOString();
  return report;
}

module.exports = { runLiveAudit, summarizeWalker };
