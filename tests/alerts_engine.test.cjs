'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const { createAlertsEngine, normalizeRules }=require('../reconstruction/engines/alerts-engine.cjs');

const config=(rules)=>({alerts:{rules}});
const session=(patch={})=>({online:true,stale:false,error:null,authExpired:false,ageMs:10,...patch});
const telemetry=(patch={})=>({healthPercent:100,position:{x:100,y:100,z:7},creatures:[],...patch});
const creature=(id,name,x,y,z=7,healthPercent=100)=>({id,name,healthPercent,canAttack:true,pos:{x,y,z}});

test('hpOnce fires once per drop and rearms above the threshold',()=>{
  const engine=createAlertsEngine(config([{name:'low hp',type:'hp',enabled:true,hpThreshold:30,hpOnce:true}]));
  assert.deepEqual(engine.step(session(),telemetry({healthPercent:40}),0).actions,[]);
  let result=engine.step(session(),telemetry({healthPercent:20}),1000);
  assert.deepEqual(result.actions,[{action:'notify',ruleId:'low hp',type:'hp'}]);
  assert.deepEqual(engine.step(session(),telemetry({healthPercent:20}),2000).actions,[]);
  assert.deepEqual(engine.step(session(),telemetry({healthPercent:40}),3000).actions,[]);
  result=engine.step(session(),telemetry({healthPercent:20}),4000);
  assert.equal(result.actions.filter(a=>a.action==='notify').length,1);
});

test('repeat fires again only after soundRepeatSeconds',()=>{
  const engine=createAlertsEngine(config([{name:'hp repeat',type:'hp',enabled:true,hpThreshold:30,soundRepeatEnabled:true,soundRepeatSeconds:10}]));
  assert.equal(engine.step(session(),telemetry({healthPercent:20}),0).actions.length,1);
  assert.equal(engine.step(session(),telemetry({healthPercent:20}),5000).actions.length,0);
  assert.equal(engine.step(session(),telemetry({healthPercent:20}),10000).actions.length,1);
});

test('creature alerts respect name, range, floor and re-entry',()=>{
  const engine=createAlertsEngine(config([{name:'wild',type:'creature',enabled:true,creatureName:'*',creatureRange:3}]));
  assert.equal(engine.step(session(),telemetry({creatures:[creature(1,'Pidgey',102,100)]}),0).actions.length,1);
  assert.equal(engine.step(session(),telemetry({creatures:[creature(1,'Pidgey',102,100)]}),1000).actions.length,0);
  assert.equal(engine.step(session(),telemetry({creatures:[creature(1,'Pidgey',110,100)]}),2000).actions.length,0);
  assert.equal(engine.step(session(),telemetry({creatures:[creature(1,'Pidgey',102,100)]}),3000).actions.length,1);
  assert.equal(engine.step(session(),telemetry({creatures:[creature(2,'Pidgey',102,100,8)]}),4000).actions.length,0);
  const named=createAlertsEngine(config([{name:'named',type:'creature',enabled:true,creatureName:'pidgey',creatureRange:5}]));
  assert.equal(named.step(session(),telemetry({creatures:[creature(3,'Rattata',101,100)]}),0).actions.length,0);
  assert.equal(named.step(session(),telemetry({creatures:[creature(4,'PIDGEY',101,100)]}),1000).actions.length,1);
});

test('hunt alert fires only for creatures outside the expected list',()=>{
  const engine=createAlertsEngine(config([{name:'hunt',type:'hunt_pokemon',enabled:true,huntPokemonNames:'Pidgey, Charmander'}]));
  assert.equal(engine.step(session(),telemetry({creatures:[creature(1,'Pidgey',101,100),creature(2,'Charmander',102,100)]}),0).actions.length,0);
  assert.equal(engine.step(session(),telemetry({creatures:[creature(3,'Rattata',101,100)]}),1000).actions.length,1);
});

test('teleport fires on >=3 tile delta after the interval',()=>{
  const engine=createAlertsEngine(config([{name:'tp',type:'teleport',enabled:true,teleportIntervalMs:1000}]));
  assert.equal(engine.step(session(),telemetry({position:{x:100,y:100,z:7}}),0).actions.length,0);
  assert.equal(engine.step(session(),telemetry({position:{x:103,y:100,z:7}}),500).actions.length,0);
  assert.equal(engine.step(session(),telemetry({position:{x:103,y:100,z:7}}),1000).actions.length,1);
  assert.equal(engine.step(session(),telemetry({position:{x:104,y:100,z:7}}),2000).actions.length,0);
});

test('disconnected fires on the online-to-offline edge once and rearms',()=>{
  const engine=createAlertsEngine(config([{name:'off',type:'disconnected',enabled:true,pauseWk:true}]));
  assert.equal(engine.step(session({online:true}),telemetry(),0).actions.length,0);
  let result=engine.step(session({online:false}),telemetry(),1000);
  assert.deepEqual(result.actions,[{action:'notify',ruleId:'off',type:'disconnected'},{action:'pause',target:'walker',ruleId:'off'}]);
  assert.deepEqual(engine.step(session({online:false}),telemetry(),2000).actions,[]);
  assert.deepEqual(engine.step(session({online:true}),telemetry(),3000).actions,[]);
  assert.equal(engine.step(session({online:false}),telemetry(),4000).actions.filter(a=>a.action==='notify').length,1);
});

test('disabled rules and blocked types do not emit',()=>{
  const engine=createAlertsEngine(config([
    {name:'disabled',type:'hp',enabled:false,hpThreshold:99},
    {name:'player',type:'player',enabled:true,playerRange:5},
    {name:'gm_message',type:'gm_message',enabled:true},
  ]));
  const result=engine.step(session(),telemetry({healthPercent:1}),0);
  assert.deepEqual(result.actions,[]);
  assert.deepEqual(result.states.map(s=>s.phase),['unsupported','unsupported']);
});

test('normalizeRules clamps and filters configuration',()=>{
  const rules=normalizeRules(config([
    {name:'a',type:'teleport',enabled:true,teleportIntervalMs:10},
    {name:'b',type:'creature',enabled:true,creatureRange:99},
    {name:'c',type:'hp',enabled:false},
  ]));
  assert.equal(rules.length,2);
  assert.equal(rules[0].teleportIntervalMs,50);
  assert.equal(rules[1].creatureRange,30);
});

test('hunt repeat re-alerts while an unexpected creature remains',()=>{
  const engine=createAlertsEngine(config([{name:'hunt repeat',type:'hunt_pokemon',enabled:true,huntPokemonNames:'Pidgey',soundRepeatEnabled:true,soundRepeatSeconds:10}]));
  assert.equal(engine.step(session(),telemetry({creatures:[creature(9,'Rattata',101,100)]}),0).actions.length,1);
  assert.equal(engine.step(session(),telemetry({creatures:[creature(9,'Rattata',101,100)]}),5000).actions.length,0);
  assert.equal(engine.step(session(),telemetry({creatures:[creature(9,'Rattata',101,100)]}),10000).actions.length,1);
  assert.equal(engine.step(session(),telemetry({creatures:[creature(9,'Pidgey',101,100)]}),15000).actions.length,0);
});

test('chat fires on new talk alert events with observed shape',()=>{
  const engine=createAlertsEngine(config([{name:'chat',type:'chat',enabled:true}]));
  const talks=[
    {id:175,kind:'talk',mode:7,value:0,name:'Falken',text:'oi',self:false,pos:null},
    {id:176,kind:'talk',mode:44,value:0,name:'Rattata',text:'hi',self:false,pos:null},
  ];
  assert.equal(engine.step(session(),telemetry({alertEvents:[talks[0]]}),0).actions.length,1);
  assert.equal(engine.step(session(),telemetry({alertEvents:talks}),1000).actions.length,1);
  assert.equal(engine.step(session(),telemetry({alertEvents:talks}),2000).actions.length,0);
  assert.equal(engine.step(session(),telemetry({alertEvents:talks.concat({id:177,kind:'talk',mode:7,value:0,name:'Skyuwu',text:'oi',self:false,pos:null})}),3000).actions.length,1);
});

test('chat repeat re-alerts while new talk events keep arriving',()=>{
  const engine=createAlertsEngine(config([{name:'chat repeat',type:'chat',enabled:true,soundRepeatEnabled:true,soundRepeatSeconds:10}]));
  const base=[{id:175,kind:'talk',mode:7,value:0,name:'Falken',text:'oi',self:false,pos:null}];
  assert.equal(engine.step(session(),telemetry({alertEvents:base}),0).actions.length,1);
  assert.equal(engine.step(session(),telemetry({alertEvents:base}),5000).actions.length,0);
  assert.equal(engine.step(session(),telemetry({alertEvents:base}),10000).actions.length,1);
});
