'use strict';

// Headless UI audit (`electron reconstruction/app --audit`).
//
// Runs in diagnostics mode and drives the menu against the LOCAL SIMULATION. It
// only approves a check when it observes the resulting effect (movement, target
// selection, switch confirmation, a heal cast, monitor state), never merely a
// button label. A timeout, an exception or a missing effect fails the check with
// a diagnostic. Scenarios it did not exercise are listed as PENDING, never as
// approved. `ok` is true only when every required check passed and the renderer
// raised no error.
//
// It does NOT validate the bot in the real game: the simulation is a diagnostic
// aid and is not evidence of in-game behaviour.
const REQUIRED = [
  'surface.separation', 'simulate', 'session', 'manual.move', 'walker.move',
  'target.select', 'target.comboUiContract', 'healer.healCommand', 'healer.switchConfirm', 'monitor.state',
  'performance', 'errors',
];
const PENDING = [
  { name: 'healer.healthRecovery', reason: 'o simulador registra a skill; nao modela recuperacao de HP nem confirma efeito no jogo' },
  { name: 'monitor.notification', reason: 'nao disparado na UI; coberto no motor por tests/monitor_runtime.test.cjs (hp e disconnected)' },
  { name: 'target.kill', reason: 'nao exercitado na UI; coberto por tests/local_runtime.test.cjs (kill loop com creatureDamage)' },
  { name: 'combat.revive', reason: 'nao exercitado na UI; coberto por tests/local_runtime.test.cjs (combo -> hotkey Revive)' },
  { name: 'game.realChannel', reason: 'sem canal pka-runtime-2-<pid>; apenas simulacao nesta execucao' },
];

function isExpectedHealCommand(command, moveSlot) {
  return Number.isInteger(moveSlot) && moveSlot >= 1 && moveSlot <= 100
    && command?.name === 'talk' && command.parameter === 'm' + moveSlot;
}

async function runAudit(window) {
  const evaluate = expression => window.webContents.executeJavaScript(expression);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (expression, ms = 6000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await evaluate(expression)) return true;
      await sleep(50);
    }
    return false;
  };

  const checks = [];
  const record = (name, passed, detail) => {
    checks.push({ name, required: true, passed: passed === true, detail });
    return passed === true;
  };
  const status = () => evaluate('window.pkaDiag.status()');
  const clickTab = index => evaluate(`document.querySelectorAll("#tabs button")[${index}].click();true`);
  const clickButton = regex => evaluate(
    '(()=>{const b=[...document.querySelectorAll("button")].find(n=>' + regex + '.test(n.textContent));if(!b)return null;b.click();return b.textContent.trim();})()');
  // Starts the module only if it is not already running (the auto-healer may have
  // started it), so a click never accidentally pauses it.
  const startModule = async () => {
    const text = await evaluate('document.getElementById("run-module").textContent.trim()');
    if (text.startsWith('Pausar')) return true;
    await evaluate('document.getElementById("run-module").click();true');
    return true;
  };
  const setLabelNumber = (labelText, value) => evaluate(
    '(()=>{const l=[...document.querySelectorAll("#settings label")].find(n=>n.textContent.includes('
    + JSON.stringify(labelText) + '));const i=l&&l.querySelector("input");if(!i)return false;i.value='
    + JSON.stringify(String(value)) + ';i.dispatchEvent(new Event("input",{bubbles:true}));return true;})()');
  const setIdValue = (id, value) => evaluate(
    '(()=>{const i=document.getElementById(' + JSON.stringify(id) + ');if(!i)return false;i.value='
    + JSON.stringify(String(value)) + ';i.dispatchEvent(new Event("input",{bubbles:true}));return true;})()');
  const simulate = (options) => evaluate('window.pkaDiag.simulate(true,' + JSON.stringify(options || {}) + ')');

  await evaluate('window.__auditErrors=[];'
    + 'window.addEventListener("error",e=>window.__auditErrors.push(String(e.message)));'
    + 'window.addEventListener("unhandledrejection",e=>window.__auditErrors.push(String((e.reason&&e.reason.message)||e.reason)));true');
  await evaluate('document.querySelector(".live-panel").open=true;true');

  try {
    // 1. The diagnostics surface is separate from the recovered pka namespace.
    const surface = await evaluate('({pkaHasSim:"simulate" in window.pka,diag:typeof window.pkaDiag,diagSim:typeof (window.pkaDiag&&window.pkaDiag.simulate)})');
    record('surface.separation', surface.pkaHasSim === false && surface.diag === 'object' && surface.diagSim === 'function', surface);

    // 2. Session from the simulation.
    const started = await simulate({ health: 40, creatures: [
      { id: 9001, name: 'Pidgey', type: 1, is_player: false, canAttack: true, healthPercent: 100,
        pos: { x: 3321, y: 2264, z: 9 } }] });
    record('simulate', started && started.enabled === true, started);
    const hasSession = await waitFor('document.getElementById("client").value!==""');
    record('session', hasSession, { clientValue: await evaluate('document.getElementById("client").value') });

    // 3. Manual movement is observable in the snapshot.
    const before = (await status()).position;
    await evaluate('document.querySelector("[data-direction=\\"1\\"]").click();true');
    let after = before;
    for (let attempt = 0; attempt < 25 && after.x <= before.x; attempt += 1) { await sleep(150); after = (await status()).position; }
    record('manual.move', after.x > before.x, { from: before, to: after });

    // 4. Walker: record a point, walk away, start, expect convergence.
    await clickTab(3);
    await sleep(300);
    await clickButton('/Gravar|Parar grava/');
    await sleep(400);
    await clickButton('/Gravar|Parar grava/');
    await sleep(1300);
    const away = await (async () => {
      let position = await status();
      for (let attempt = 0; attempt < 25 && position.position.x < 3325; attempt += 1) {
        await evaluate('document.querySelector("[data-direction=\\"1\\"]").click();true');
        await sleep(250);
        position = await status();
      }
      return position.position;
    })();
    await clickTab(3);
    await sleep(200);
    const walkerEnabled = await evaluate('!document.getElementById("run-module").disabled');
    let walkerOk = false;
    if (walkerEnabled) {
      await startModule();
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const state = await status();
        if (state.position.x <= 3322) { walkerOk = true; break; }
        await sleep(150);
      }
    }
    record('walker.move', walkerOk && away.x >= 3325, { away, end: (await status()).position, walkerEnabled });

    // 5. Target selection: the profile holds until minWilds (perfect lure), so
    //    feed enough wilds; start Target and observe the chosen target id.
    const wilds = Array.from({ length: 8 }, (_, index) => ({
      id: 9001 + index, name: 'Wild', type: 1, is_player: false, canAttack: true, healthPercent: 100,
      pos: { x: 3318 + (index % 4), y: 2262 + Math.floor(index / 4), z: 9 } }));
    await simulate({ health: 100, creatures: wilds });
    await clickTab(1);
    await sleep(300);
    const comboUi = await evaluate('(()=>{const mode=document.querySelector(".combo-mode.selected")?.dataset.mode;const native=document.querySelector(".combo-mode[data-mode=native]");native?.click();const result={nativeSelected:native?.getAttribute("aria-checked")==="true",unsupportedHotkey:!!document.querySelector("[data-setting-path=\\"target.combo.nativeHotkey\\"]"),undefinedInputs:[...document.querySelectorAll("#settings input")].filter(input=>input.value==="undefined").length};document.querySelector(".combo-mode[data-mode="+mode+"]")?.click();return result;})()');
    record('target.comboUiContract', comboUi.nativeSelected && !comboUi.unsupportedHotkey && comboUi.undefinedInputs === 0, comboUi);
    let targetReady = await evaluate('!document.getElementById("run-module").disabled');
    if (!targetReady) {
      await evaluate('(()=>{const b=[...document.querySelectorAll("#settings button")].find(n=>/Adicionar/.test(n.textContent));if(b)b.click();return !!b;})()');
      await sleep(700);
      targetReady = await waitFor('!document.getElementById("run-module").disabled', 4000);
    }
    let targetId = null;
    if (targetReady) {
      await startModule();
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const state = await status();
        if (typeof state.targetId === 'number' && state.targetId >= 9001 && state.targetId <= 9008) { targetId = state.targetId; break; }
        await sleep(150);
      }
    }
    record('target.select', targetId !== null,
      { targetReady, targetId, dom: await evaluate('document.getElementById("target-id").textContent') });

    // 6. Heal cast: low HP + configured healer -> a heal skill is accepted.
    await simulate({ health: 100 });
    await clickTab(2);
    await sleep(300);
    await setLabelNumber('Curar abaixo de', 80);
    const healMoveSlot = 1;
    const healConfigured = await setLabelNumber('Skill de cura (m)', healMoveSlot);
    const resetConfigured = await setLabelNumber('Slot de reset', 0);
    await setIdValue('healer-healPokemonName', 'Blastoise');
    await setIdValue('healer-returnPokemonName', 'Charizard');
    await sleep(1200); // autosave settles
    await simulate({ health: 40 });
    await clickTab(2);
    await sleep(200);
    const healReady = await evaluate('!document.getElementById("run-module").disabled');
    let healCast = null;
    if (healReady) {
      await startModule();
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const state = await status();
        if (isExpectedHealCommand(state.lastCommand, healMoveSlot)) { healCast = state.lastCommand; break; }
        await sleep(150);
      }
    }
    record('healer.healCommand', healConfigured && resetConfigured && isExpectedHealCommand(healCast, healMoveSlot),
      { healReady, healConfigured, resetConfigured, expectedCommand: 'm' + healMoveSlot, healCast });

    // 7. Switch confirmation: switch out, healer switches back, client confirms it.
    await simulate({ health: 100, activeSlot: 1 });
    await clickTab(2);
    await sleep(300);
    await setLabelNumber('Curar abaixo de', 0);
    await setIdValue('healer-returnPokemonName', 'Charizard');
    await setIdValue('healer-healPokemonName', 'Blastoise');
    await sleep(1200);
    const pid = Number(await evaluate('document.getElementById("client").value'));
    await evaluate('window.pka.command(' + pid + ',"switchPokemon","Blastoise")');
    let switchedOut = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if ((await status()).activeSlot === 2) { switchedOut = true; break; }
      await sleep(150);
    }
    await clickTab(2);
    await sleep(200);
    const switchReady = await evaluate('!document.getElementById("run-module").disabled');
    let switchBack = false;
    if (switchReady) {
      await startModule();
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if ((await status()).activeSlot === 1) { switchBack = true; break; }
        await sleep(150);
      }
    }
    record('healer.switchConfirm', switchedOut && switchBack, { switchedOut, switchBack, end: (await status()).pokemonName });

    // 8. Alerts monitor reaches the enabled state (observable event).
    await evaluate('window.__auditAlertState=[];try{window.pka.onAlertState(function(v){window.__auditAlertState.push(v);});}catch(e){}true');
    await clickTab(5);
    await sleep(300);
    const monitorReady = await evaluate('!document.getElementById("monitor").disabled');
    if (monitorReady) {
      await evaluate('document.getElementById("monitor").click();true');
      await waitFor('(window.__auditAlertState||[]).some(v=>v&&v.monitorEnabled===true)', 4000);
      await evaluate('document.getElementById("monitor").click();true');
      await sleep(200);
    }
    const alertStates = await evaluate('window.__auditAlertState||[]');
    record('monitor.state', monitorReady && Array.isArray(alertStates) && alertStates.some(v => v && v.monitorEnabled === true),
      { monitorReady, states: alertStates });

    // 9. Performance mode resolves.
    const performance = await evaluate('(async()=>{try{return await window.pka.performance();}catch(e){return {error:String(e.message||e)};}})()');
    record('performance', performance && performance.accepted === true, performance);

    // 10. No renderer errors.
    const errors = await evaluate('window.__auditErrors||[]');
    record('errors', Array.isArray(errors) && errors.length === 0, errors);

    await evaluate('(async()=>{try{await window.pka.runtime("all",false,777);}catch(e){}try{await window.pkaDiag.simulate(false);}catch(e){}return true;})()');
  } catch (error) {
    checks.push({ name: 'audit.crash', required: true, passed: false, detail: String(error && error.message || error) });
  }

  const byName = new Map(checks.map(check => [check.name, check]));
  const missing = REQUIRED.filter(name => !byName.has(name));
  const ok = missing.length === 0 && REQUIRED.every(name => byName.get(name)?.passed === true);
  return {
    ok,
    required: REQUIRED,
    pending: PENDING,
    missing,
    checks,
    note: 'Auditoria da INTERFACE sobre a simulacao local; nao prova funcionamento no jogo.',
  };
}

module.exports = { runAudit, isExpectedHealCommand };
