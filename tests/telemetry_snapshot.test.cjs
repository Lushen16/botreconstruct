'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const crypto=require('node:crypto');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const { decodeTelemetry }=require('../reconstruction/telemetry.cjs');
const fixture='reconstruction/fixtures/telemetry-schema2-redacted.json';
const inspectionFixture='reconstruction/fixtures/telemetry-schema2-inspection-redacted.json';
const evidence='reconstruction/telemetry-snapshot-evidence.json';
test('schema2 snapshot preserves observed telemetry shape',()=>{
  const t=JSON.parse(fs.readFileSync(fixture,'utf8'));
  assert.equal(t.schema,2);
  assert.equal(t.nativeVerified,true);
  assert.equal(t.captureVersion,1);
  assert.equal(t.itemInspectorAvailable,true);
  assert.equal(t.inspection,null);
  assert.equal(t.items.length,627);
  assert.equal(t.creatures.length,8);
  assert.equal(t.itemCounts.length,26);
  for(const key of ['items','creatures','itemCounts','inspection','alertEvents','alertSignals','conditions','performance','nativeSequence','tiles']) assert.ok(Object.hasOwn(t,key),key);
});
test('observed item and creature records have the expected scalar fields',()=>{
  const t=JSON.parse(fs.readFileSync(fixture,'utf8'));
  for(const item of t.items.slice(0,50)){
    assert.equal(typeof item.id,'number');
    assert.equal(typeof item.stack,'number');
    assert.equal(typeof item.instance,'number');
    assert.equal(typeof item.container,'boolean');
    for(const k of ['x','y','z']) assert.equal(typeof item.pos[k],'number');
  }
  for(const c of t.creatures){
    assert.equal(typeof c.id,'number');
    assert.equal(typeof c.name,'string');
    assert.equal(typeof c.healthPercent,'number');
    assert.equal(typeof c.canAttack,'boolean');
    for(const k of ['x','y','z']) assert.equal(typeof c.pos[k],'number');
  }
  for(const c of t.itemCounts){ assert.equal(typeof c.id,'number'); assert.equal(typeof c.count,'number'); }
});
test('snapshot evidence binds raw and redacted bytes without leaking the raw frame',()=>{
  const e=JSON.parse(fs.readFileSync(evidence,'utf8'));
  assert.equal(e.raw_bytes,78160);
  assert.match(e.raw_sha256,/^[0-9a-f]{64}$/);
  assert.equal(e.redacted_sha256,hash(fixture));
  assert.equal(e.redacted_bytes,fs.statSync(fixture).size);
  assert.equal(e.inspection,'NoneType');
});

test('decoder accepts the observed schema2 inspection and alert events',()=>{
  const raw=JSON.parse(fs.readFileSync(inspectionFixture,'utf8'));
  const out=decodeTelemetry(Buffer.from(JSON.stringify(raw)));
  assert.equal(out.inspection.id,4029);
  assert.equal(out.inspection.kind,'item');
  assert.equal(out.alertEvents.length,11);
  assert.equal(out.alertEvents[0].kind,'talk');
  assert.equal(out.itemCounts.length,29);
  for(const key of ['chat','gm_message','pokemon_capture','gm_arrow','camera_viewers']) assert.equal(out.alertSignals[key],true);
});
test('decoder rejects malformed inspection and alert events',()=>{
  const base=JSON.parse(fs.readFileSync(inspectionFixture,'utf8'));
  const badInspection=JSON.parse(JSON.stringify(base)); badInspection.inspection={id:'4029',kind:'item',revision:1,pos:{x:1,y:2,z:7}};
  assert.throws(()=>decodeTelemetry(Buffer.from(JSON.stringify(badInspection))),/Inspeção de item inválida/);
  const badEvent=JSON.parse(JSON.stringify(base)); badEvent.alertEvents=[{id:1,kind:'unknown'}];
  assert.throws(()=>decodeTelemetry(Buffer.from(JSON.stringify(badEvent))),/Evento de alerta inválido/);
});
