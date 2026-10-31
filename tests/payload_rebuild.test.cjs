'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const j=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const b=p=>fs.readFileSync(p);
const ev='dumps/payload_reconstructed.dll.evidence.json';
const dll='dumps/payload_reconstructed.dll';
const mem='dumps/pid32336_msftedit.dll.memory.bin';
const text='dumps/msftedit_text_32336.bin';
test('rebuilt payload binds base, entry, .text identity and template imports',()=>{
  const e=j(ev);
  assert.equal(e.base,'0x7ff85c470000');
  assert.equal(e.entry,'0x15590');
  assert.equal(e.image_base_rebuilt,e.base);
  assert.equal(e.entry_rebuilt,e.entry);
  assert.equal(e.text_matches_expected,true);
  assert.ok(e.imports>=40);
  assert.ok(e.sections.some(s=>s.name==='.text'));
});
test('rebuilt .text is byte-identical to the dumped payload .text',()=>{
  const e=j(ev);
  assert.equal(e.text_raw_slice_hash,require('node:crypto').createHash('sha256').update(b(text)).digest('hex'));
  const section=e.sections.find(s=>s.name==='.text');
  const raw=Number(section.virtualAddress);
  const size=Number(section.rawSize);
  const dllBytes=b(dll);
  const memBytes=b(mem);
  assert.ok(raw>0&&size>0&&raw+size<=dllBytes.length&&raw+size<=memBytes.length);
  assert.equal(Buffer.compare(dllBytes.slice(raw,raw+size),memBytes.slice(raw,raw+size)),0);
});
test('rebuilt payload preserves native markers at observed offsets',()=>{
  const dllBytes=b(dll);
  const markers={
    'PKA-INIT-SESSION':0xe4d58,
    'PKA-INIT-NATIVE':0xe4d90,
    'Debugger detected':0xe4d74,
    'pka-runtime-2- (utf16)':0x2026aa,
  };
  for(const [marker,off] of Object.entries(markers)){
    if(marker.includes('utf16')){
      const needle=Buffer.from('pka-runtime-2-','utf16le');
      assert.ok(dllBytes.slice(off,off+needle.length).equals(needle),marker);
    } else {
      assert.ok(dllBytes.slice(off,off+Buffer.byteLength(marker)).toString('latin1').startsWith(marker),marker);
    }
  }
});
test('rebuilt payload entry disassembles as a function prologue',()=>{
  const e=j(ev);
  const section=e.sections.find(s=>s.name==='.text');
  const raw=parseInt(section.virtualAddress,16);
  const entry=parseInt(e.entry,16);
  const prologue=b(dll).slice(raw+entry-raw,raw+entry-raw+24);
  assert.ok(prologue.includes(Buffer.from([0x48,0x89])) || prologue.includes(Buffer.from([0x55,0x48,0x8b,0xec])) ||
            prologue.includes(Buffer.from([0x4c,0x89,0x4c,0x24])),'prologue bytes');
});
