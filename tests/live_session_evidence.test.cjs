'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const crypto=require('node:crypto');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const j=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const ev='native_live_session_evidence.json';
test('live session evidence binds the dumped artifacts by hash',()=>{
  const e=j(ev);
  assert.equal(e.dumps.full_image.sha256,hash('dumps/pid37152_msftedit.memory.bin'));
  assert.equal(e.dumps.text.sha256,hash('dumps/msftedit_text_live_37152.bin'));
  assert.equal(e.dumps.rebuilt_pe.sha256,hash('dumps/payload_reconstructed_live37152.dll'));
  assert.equal(e.stomp_region.allocation_base,'0x7ff85c470000');
  assert.equal(e.stomp_region.header,'zerado (e_magic 0000, sem PE signature) em todas as sessoes');
  assert.equal(e.identity_status.original_name,'RESOLVED');
  assert.equal(e.identity_status.name,'shiba_bots.dll');
});
test('live build differs from the 32336 build with shared config strings',()=>{
  const e=j(ev);
  assert.equal(e.build_difference.conclusion.includes('build DIFERENTE'),true);
  const k=e.build_difference.evidence.find(x=>x.key==='bestTileMaxWaitMs');
  assert.equal(k.rva_32336,'0xe8ea8');
  assert.equal(k.rva_live,'0xe9940');
  const pro=e.build_difference.evidence.find(x=>x.anchor);
  assert.ok(pro.rva_32336!==pro.rva_live);
  assert.equal(e.build_difference.evidence.find(x=>x.present_live!==undefined).present_live,false);
});
test('live session evidence was captured read-only and scopes identity limitation',()=>{
  const e=j(ev);
  assert.ok(e.limitations.some(l=>l.toLowerCase().includes('read-only')));
  assert.equal(e.identity_status.original_name,'RESOLVED');
  assert.equal(e.identity_status.name,'shiba_bots.dll');
  assert.ok(e.identity_status.capture_recipe);
  assert.equal(e.identity_status.capture_recipe.tool,'tools/seize_payload_dll.py');
  assert.ok(e.identity_status.capture_recipe.how.toLowerCase().includes('delete'));
  assert.equal(e.stomp_region.marker_PKA_INIT_SESSION,'0x7ff85c5557d8');
});
