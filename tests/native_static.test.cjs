'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const j=p=>JSON.parse(fs.readFileSync(p,'utf8'));
test('RTTI and string xrefs map native init/dispatcher',()=>{
  const x=j('native_xrefs.json');
  const names=x.rtti_names.join('\n');
  for(const n of ['tickBestTile@Runtime@bot@pka','tickHoenn@Runtime@bot@pka','tickRevive@Runtime@bot@pka','plan@TravelLure@bot@pka','comboTick@Runtime@bot@pka']) assert.ok(names.includes(n),n);
  assert.ok(x.xrefs.init_native.length>=1);
  assert.ok(x.xrefs.init_session.length>=1);
  const disp=x.xrefs.dispatch[0];
  assert.match(disp.insn,/lea/);
  assert.equal(disp.func_candidate,'0x7ff85c482c40');
});
test('static function evidence covers validations without inventing thresholds',()=>{
  const e=j('native_static_evidence.json').functions;
  const s=k=>e[k].strings.map(x=>x.string);
  assert.equal(e.native_init.rva,'0x15590');
  assert.equal(e.dispatcher.rva,'0x12c40');
  assert.equal(e.tick_validation.rva,'0x8a756');
  for(const needle of ['PKA-INIT-NATIVE','PKA-INIT-SESSION']) assert.ok(s('native_init').includes(needle));
  for(const needle of ['follow','attack']) assert.ok(s('dispatcher').includes(needle));
  for(const needle of ['Adicione uma criatura ao Target.','healHpPercent','captureEnabled','roster','uuid']) assert.ok(s('tick_validation').includes(needle),needle);
  const hashes=s('native_init').filter(x=>/^[0-9a-f]{64}$/.test(x));
  assert.equal(hashes.length,3);
});
test('native JSON key inventory exposes telemetry fields missing from current code',()=>{
  const keys=j('native_strings_evidence.json').json_keys;
  for(const k of ['alertEvents','alertSignals','guildDailies','guildDailyAutoVersion','performance','inspection','itemCounts','chaseMode','fightMode','identityAvailable','nativeSequence','captureVersion']) assert.ok(keys.includes(k),k);
  assert.ok(keys.length>=85);
});
