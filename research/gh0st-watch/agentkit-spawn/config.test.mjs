import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConfig} from './config.mjs';

const first='0x'+'A'.repeat(40), second='0x'+'b'.repeat(40);
test('builds a zero-spend read-only profile with canonical watched addresses',()=>{
  const parsed=buildConfig('  Night observer  ','guide',first+'\n'+second,['coverage'],'0');
  assert.deepEqual(parsed,{name:'Night observer',personality:'guide',addresses:[first.toLowerCase(),second],
    tools:['coverage'],daily_cap:0});
});
test('rejects duplicate, malformed, zero or excess contracts',()=>{
  const invalid=[first+'\n'+first.toLowerCase(),'','0x01','0x'+'0'.repeat(40),
    Array.from({length:5},(_,i)=>'0x'+String(i+1).repeat(40)).join('\n')];
  for(const addresses of invalid)assert.throws(()=>buildConfig('Agent','sentinel',addresses,['checks'],'1'));
});
test('enforces the same name, tool, role and whole-token limits as the ICP registry',()=>{
  const args=['Agent','analyst',first,['checks'],'1000000'];
  assert.equal(buildConfig(...args).daily_cap,1000000);
  for(const [index,value] of [[0,'🌘'.repeat(11)],[0,'one\ntwo'],[1,'default'],[3,[]],[3,['checks','checks']],[3,['pay']],[4,'1.5'],[4,'-1'],[4,'1000001']]){
    const invalid=[...args];invalid[index]=value;assert.throws(()=>buildConfig(...invalid));
  }
});
