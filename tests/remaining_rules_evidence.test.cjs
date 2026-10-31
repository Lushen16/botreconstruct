'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const crypto=require('node:crypto');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const j=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const ev='native_remaining_rules_evidence.json';
const text='dumps/msftedit_text_32336.bin';
const base=0x7ff85c470000;
function bytesAt(rva,len){ const off=rva-0x1000; return fs.readFileSync(text).slice(off,off+len); }
test('remaining-rules evidence binds the stomped .text hash',()=>{
  const e=j(ev);
  assert.equal(e.source_sha256,hash(text));
  assert.equal(e.base_va,'0x7ff85c470000');
  assert.equal(e.verification.all_anchors_byte_exact,true);
  for(const id of ['BestTileScore','NextTeam','ComboBuffDone','HealerDeployReady']) assert.ok(e.rules[id],id);
});
test('HealerDeployReady predicate anchors are byte-exact',()=>{
  const c=j(ev).rules.HealerDeployReady;
  const anchors={
    '0x9d2b3':'f20f5cc8',
    '0x9d2b7':'f20f103dc1fc0400',
    '0x9d2bf':'f20f5ff7',
    '0x9d2c3':'660f2fce',
    '0x9d2c7':'0f86a2000000',
  };
  for(const [rva,bytes] of Object.entries(anchors)) assert.equal(bytesAt(parseInt(rva,16),bytes.length/2).toString('hex'),bytes,rva);
  const clamp=c.constants.find(x=>x.rva==='0x9d2b7');
  assert.equal(clamp.value,1000);
  assert.match(c.predicate,/max\(pokeReadyTimeoutMs, 1000\)/);
});
test('BestTileScore and NextTeam constants are byte-exact',()=>{
  const e=j(ev);
  const anchors={
    '0x92e98':'f20f1035e09f0500',
    '0x930e2':'660f2f0d1e9e0500',
    '0x933b2':'f20f5d0d069c0500',
    '0x936d9':'f20f5f0db7980500',
    '0x9b683':'488d15dea50400',
    '0x9b6a9':'4883f806',
    '0x9b6b3':'f2440f2cee',
  };
  for(const [rva,bytes] of Object.entries(anchors)) assert.equal(bytesAt(parseInt(rva,16),bytes.length/2).toString('hex'),bytes,rva);
  const best=e.rules.BestTileScore.constants.find(x=>x.rva==='0x933b2');
  assert.equal(best.value,4000);
  const team=e.rules.NextTeam.constants.find(x=>x.rva==='0x9b6a9');
  assert.equal(team.value,6);
});
test('remaining-rules contract reflects three resolved predicates and one blocked',()=>{
  const s=j('reconstruction/spec/remaining-rules-v1.json');
  const byId=Object.fromEntries(s.rules.map(r=>[r.id,r]));
  assert.equal(byId.BestTileScore.status,'implementable');
  assert.equal(byId.NextTeam.status,'implementable');
  assert.equal(byId.HealerDeployReady.status,'implementable');
  assert.equal(byId.ComboBuffDone.status,'implementable');
  assert.equal(s.rules.filter(r=>r.status==='blocked').length,0);
  for(const id of ['BestTileScore','NextTeam','HealerDeployReady','ComboBuffDone']) assert.ok(byId[id].evidence.includes('native_remaining_rules_evidence.json'),id);
});

test('ComboBuffDone medicine gate anchors are byte-exact',()=>{
  const c=j(ev).rules.ComboBuffDone;
  const anchors={
    '0x57e13':'488d158ef40800',
    '0x57e2d':'488d1584f40800',
    '0x57e47':'488d1582f40800',
    '0x57e83':'488d1556f40800',
    '0x57f30':'0f1005c1f30800',
    '0x57fe8':'660f2f05904f0900',
    '0x58097':'660f2e05e94d0900',
  };
  for(const [rva,bytes] of Object.entries(anchors)) assert.equal(bytesAt(parseInt(rva,16),bytes.length/2).toString('hex'),bytes,rva);
  const gate=c.constants.find(x=>x.rva==='0x57fe8');
  assert.equal(gate.value,1000);
  const count=c.constants.find(x=>x.rva==='0x58097');
  assert.equal(count.value,3);
  assert.ok(c.observed_strings.some(s=>s.includes('hotkey de Medicine')));
  const seq=c.dispatch_gate.sequence.map(x=>x.key);
  for(const key of ['pokestopToComboMs','gateStopped','useReadyGate','cycleAtSafeSpot','gateReadyPct','readyPct','gateDpsMinHp']) assert.ok(seq.includes(key),key);
  for(const entry of c.dispatch_gate.sequence) assert.equal(bytesAt(parseInt(entry.rva,16),entry.bytes.length/2).toString('hex'),entry.bytes,entry.rva);
});
