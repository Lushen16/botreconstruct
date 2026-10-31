const assert = require('node:assert/strict');
const { SettingsStore } = require('../settings.cjs');

async function runSmoke(window, store, showStatus) {
  const evaluate = expression => window.webContents.executeJavaScript(expression);
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw Error('Smoke condition timed out: ' + expression);
  };
  const tabs = [];
  for (let index = 0; index < 8; index++) {
    tabs.push(await evaluate('(() => {const button=document.querySelectorAll("#tabs button")[' + index + '];button.click();return {name:button.textContent,fields:document.querySelectorAll("#settings input,#settings select,#settings textarea").length,text:document.querySelector("#settings").textContent.length};})()'));
  }
  assert(tabs.every(tab => tab.text > 0));
  await evaluate('document.getElementById("profile-name").value="Smoke Integration";document.getElementById("profile-create").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));true');
  await waitFor('document.getElementById("profile-current").textContent==="Smoke Integration"');
  await evaluate('(async()=>{const state=await window.pka.bootstrap();const config=state.settings.profiles.find(profile=>profile.name===state.settings.activeProfile).config;config.target.ignoredCreaturesText="smoke-persistence";await window.pka.autosave(state.settings.activeProfile,config);return true;})()');
  const reloaded = new SettingsStore(store.directory);
  await reloaded.load();
  assert.equal(reloaded.snapshot().activeProfile, 'Smoke Integration');
  assert.equal(reloaded.current().target.ignoredCreaturesText, 'smoke-persistence');
  await window.webContents.reload();
  await waitFor('document.getElementById("profile-current")?.textContent==="Smoke Integration" && !!window.pka');
  assert.equal(await evaluate('(async()=>{const state=await window.pka.bootstrap();return state.settings.profiles.find(profile=>profile.name==="Smoke Integration").config.target.ignoredCreaturesText;})()'), 'smoke-persistence');
  await evaluate('window.pka.select("Default").then(()=>true)');
  await waitFor('document.getElementById("profile-current").textContent==="Default"');
  await evaluate('window.pka.remove("Smoke Integration").then(()=>true)');
  await evaluate('document.querySelector("#tabs button").click();true');
  showStatus();
  return { tabs, profileCreation: true, autosave: true, diskPersistence: true, rendererReload: true, profileSelectAndRemove: true };
}

module.exports = { runSmoke };
