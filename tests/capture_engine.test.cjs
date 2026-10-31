'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const { selectCaptureCandidate, chooseBall, nextCaptureAt, normalizeConfig }=require('../reconstruction/engines/capture-engine.cjs');
const { compareCaptureCandidates, rankCaptureCandidates, revalidateCaptureTarget,
  prepareCaptureDispatch, recordCaptureDispatchResult }=require('../reconstruction/engines/capture-engine.cjs');
const { encodeCommand }=require('../reconstruction/protocol.cjs');
const config=(patch={})=>({looting:{captureEnabled:true,maxCaptureDist:10,captureAfterCombat:false,captureDelay:300,captureEntries:[{name:'Rattata',corpseId:4029,ballId:15650,fallbackBallId:15651}],...patch}});
const telemetry=(patch={})=>({captureVersion:1,itemInspectorAvailable:true,position:{x:100,y:100,z:7},inspection:{revision:7,id:4029,kind:'item',container:true,pos:{x:103,y:100,z:7}},...patch});
test('capture candidate matches configured corpse, same floor and range',()=>{
  const result=selectCaptureCandidate(telemetry(),config());
  assert.equal(result.eligible,true); assert.equal(result.distance,3); assert.equal(result.entry.corpseId,4029);
  assert.equal(selectCaptureCandidate(telemetry({inspection:{revision:7,id:9999,kind:'item',container:true,pos:{x:100,y:100,z:7}}}),config()).reason,'corpse-not-configured');
  assert.equal(selectCaptureCandidate(telemetry({inspection:{revision:7,id:4029,kind:'item',container:true,pos:{x:111,y:100,z:7}}}),config()).reason,'out-of-range');
  assert.equal(selectCaptureCandidate(telemetry({inspection:{revision:7,id:4029,kind:'item',container:true,pos:{x:100,y:100,z:8}}}),config()).reason,'different-floor');
});
test('capture gates follow verified version, inspector and config flags',()=>{
  assert.equal(selectCaptureCandidate(telemetry({captureVersion:2}),config()).reason,'capture-version');
  assert.equal(selectCaptureCandidate(telemetry({itemInspectorAvailable:false}),config()).reason,'item-inspector-unavailable');
  assert.equal(selectCaptureCandidate(telemetry(),config({captureEnabled:false})).reason,'capture-disabled');
  assert.equal(selectCaptureCandidate(telemetry({inspection:null}),config()).reason,'no-inspection');
  assert.equal(selectCaptureCandidate(telemetry(),config({captureAfterCombat:true})).reason,'after-combat-pending');
  assert.equal(selectCaptureCandidate(telemetry(),config({captureAfterCombat:true}),{afterCombat:true}).eligible,true);
});
test('ball choice uses primary while stocked and falls back when empty',()=>{
  const entry={ballId:15650,fallbackBallId:15651};
  assert.deepEqual(chooseBall(entry,[{id:15650,count:2}]),{ballId:15650,source:'primary'});
  assert.deepEqual(chooseBall(entry,[{id:15650,count:0},{id:15651,count:1}]),{ballId:15651,source:'fallback'});
  assert.equal(chooseBall(entry,[{id:15650,count:0},{id:15651,count:0}]),null);
  assert.deepEqual(chooseBall(entry,[]),{ballId:15650,source:'primary'});
});
test('delay is bounded and normalized config keeps observed fields',()=>{
  assert.equal(nextCaptureAt(1000,300),1300);
  assert.equal(nextCaptureAt(1000,0),1001);
  const cfg=normalizeConfig(config({maxCaptureDist:99,captureDelay:0}));
  assert.equal(cfg.maxDistance,30); assert.equal(cfg.delayMs,1); assert.equal(cfg.entries[0].corpseId,4029);
});

const rankedCandidate=(patch={})=>({item:{id:4029,stack:0,instance:991,pos:{x:103,y:100,z:7}},
  distance:3,key:'991',history:{lastAttemptAt:0,attempts:0,failures:0},...patch});
const instanceKey=item=>String(item.instance);
const dispatchOptions={playerPosition:{x:100,y:100,z:7},maxDistance:3,ballId:15650,keyOf:instanceKey};

test('capture rank prefers fresh history before attempt time, distance or stack',()=>{
  const fresh=rankedCandidate({distance:30,history:{lastAttemptAt:900,attempts:0,failures:2}});
  const attempted=rankedCandidate({distance:0,history:{lastAttemptAt:0,attempts:1,failures:0}});
  const failed=rankedCandidate({distance:0,history:{lastAttemptAt:0,attempts:0,failures:3}});
  assert.equal(rankCaptureCandidates([attempted,fresh,failed]),fresh);
  assert.equal(compareCaptureCandidates(fresh,failed),-1);
  assert.equal(compareCaptureCandidates(failed,fresh),1);
});

test('capture rank prefers oldest last attempt within a freshness tier',()=>{
  const older=rankedCandidate({distance:30,history:{lastAttemptAt:1,attempts:2,failures:0}});
  const newer=rankedCandidate({distance:0,history:{lastAttemptAt:2,attempts:1,failures:0}});
  assert.equal(rankCaptureCandidates([newer,older]),older);
});

test('capture rank uses nearest distance, highest stack and stable input order for ties',()=>{
  const far=rankedCandidate({distance:4});
  const low=rankedCandidate({distance:3});
  const high=rankedCandidate({distance:3,item:{...low.item,stack:5}});
  const tie=structuredClone(high);
  const input=[far,low,high,tie];
  const snapshot=structuredClone(input);
  assert.equal(rankCaptureCandidates(input),high);
  assert.equal(rankCaptureCandidates([tie,high]),tie);
  assert.equal(rankCaptureCandidates([]),null);
  assert.deepEqual(input,snapshot);
});

test('capture rank rejects missing internal history and nonfinite values instead of guessing',()=>{
  for(const candidate of [rankedCandidate({history:null}),rankedCandidate({distance:NaN}),
    rankedCandidate({history:{lastAttemptAt:Infinity,attempts:0,failures:0}}),
    rankedCandidate({history:{lastAttemptAt:0,attempts:-1,failures:0}})]) {
    assert.throws(()=>rankCaptureCandidates([candidate]),TypeError);
  }
  assert.throws(()=>rankCaptureCandidates(null),TypeError);
});

test('capture dispatch plans existing useWith at maxCaptureDist without inventing a walk',()=>{
  const candidate=rankedCandidate();
  const result=prepareCaptureDispatch(candidate,[candidate.item],dispatchOptions);
  assert.deepEqual(result,{state:'DISPATCH_PLANNED',command:'useWith',
    parameter:{x:103,y:100,z:7,itemId:15650,targetId:4029,stack:0}});
  const bytes=encodeCommand(1,result.command,result.parameter);
  assert.equal(bytes.readUInt32LE(4),14);
  assert.equal(bytes.readUInt32LE(8),15650);
  assert.equal(bytes.readUInt32LE(20),4029);
  assert.deepEqual(prepareCaptureDispatch(candidate,[candidate.item],{...dispatchOptions,maxDistance:2}),
    {state:'BLOCKED',reason:'out-of-range'});
  assert.equal(prepareCaptureDispatch(candidate,[candidate.item],{...dispatchOptions,
    playerPosition:{x:100,y:100,z:8}}).reason,'different-floor');
});

test('capture preflight rejects changed id, stack, XY, instance key and removed corpse',()=>{
  const candidate=rankedCandidate();
  for(const item of [{...candidate.item,id:4030},{...candidate.item,stack:1},
    {...candidate.item,pos:{x:104,y:100,z:7}},{...candidate.item,instance:992}]) {
    assert.equal(revalidateCaptureTarget(candidate,[item],instanceKey),false);
    assert.equal(prepareCaptureDispatch(candidate,[item],dispatchOptions).reason,'corpse-updated');
  }
  assert.equal(revalidateCaptureTarget(candidate,[],instanceKey),false);
  assert.throws(()=>revalidateCaptureTarget(candidate,[candidate.item]),TypeError);
  assert.throws(()=>prepareCaptureDispatch(candidate,[candidate.item],{...dispatchOptions,ballId:0}),TypeError);
});

test('native preflight checks XY distance zero, not an invented floor comparison',()=>{
  const candidate=rankedCandidate();
  const otherFloor={...candidate.item,pos:{...candidate.item.pos,z:8}};
  assert.equal(revalidateCaptureTarget(candidate,[otherFloor],instanceKey),true);
});

test('dispatch acceptance updates internal attempts; rejection updates failures; both cooldown',()=>{
  const history={lastAttemptAt:0,lastSeenAt:42,attempts:2,failures:2};
  const accepted=recordCaptureDispatchResult(history,1000,300,true);
  assert.deepEqual(accepted,{state:'COOLDOWN',nextAttemptAt:1300,
    history:{lastAttemptAt:1000,lastSeenAt:42,attempts:3,failures:0}});
  const rejected=recordCaptureDispatchResult(history,1000,300,false);
  assert.equal(rejected.history.attempts,2);
  assert.equal(rejected.history.failures,3);
  assert.equal(rejected.nextAttemptAt,1300);
  assert.equal(history.lastAttemptAt,0);
  assert.equal(recordCaptureDispatchResult({...history,failures:0xffffffff},1,0,false).history.failures,0);
  assert.throws(()=>recordCaptureDispatchResult(history,1,NaN,false),TypeError);
});

