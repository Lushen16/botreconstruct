'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const crypto=require('node:crypto');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const textPath='dumps/msftedit_text_32336.bin';
const memoryPath='dumps/pid32336_msftedit.dll.memory.bin';
test('native payload text dump preserves identity and markers',()=>{
  const text=fs.readFileSync(textPath);
  assert.equal(hash(textPath),'7c0fd219dc24f3fa273ded518eca8ea840d3395f00d14e78beacb4ffd7c50ea4');
  assert.equal(text.length,0x287000);
  assert.ok(text.includes(Buffer.from('PKA-INIT-SESSION')));
  assert.ok(text.includes(Buffer.from('PKA2/')));
  assert.ok(text.includes(Buffer.from('[native] Resolving %s target %u.')));
  assert.ok(text.includes(Buffer.from('?AV<lambda_1>@?0??tickBestTile@Runtime@bot@pka@@')));
});
test('memory image dump preserves identity and msftedit base',()=>{
  assert.equal(hash(memoryPath),'8fbd9d963ac5bb09030b8ae27c01b74c0888717fd9b282551ebe978bba28d648');
});
test('native dump evidence lists Runtime methods and classes',()=>{
  const evidence=JSON.parse(fs.readFileSync('native_dump_evidence.json','utf8'));
  assert.equal(evidence.sha256,'7c0fd219dc24f3fa273ded518eca8ea840d3395f00d14e78beacb4ffd7c50ea4');
  for(const method of ['Runtime::tick','Runtime::tickBestTile','Runtime::tickHoenn','Runtime::tickLoot','Runtime::tickRevive','Runtime::comboTick','TravelLure::plan']) assert.ok(evidence.runtime_methods.includes(method),method);
  assert.ok(evidence.keyword_strings.includes('walker'));
  assert.ok(evidence.keyword_strings.some(s=>s.includes('captureVersion')));
});
