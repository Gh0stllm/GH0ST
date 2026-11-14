import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interface } from 'ethers';
import { parseFee, modelHash, constructorArgs, verifyActionReceipt, TOKEN_ADDRESS } from './core.mjs';
import { matchRuntime } from './wallet.mjs';
const artifacts=JSON.parse(readFileSync(new URL('../runtime/artifacts.json',import.meta.url)));
test('fee parser preserves exact 18-decimal amounts and rejects ambiguous or out-of-range values',()=>{
  assert.equal(parseFee('0'),0n);assert.equal(parseFee('1.000000000000000001'),1000000000000000001n);
  for(const v of ['-1','1e2','01','1.0000000000000000001','Infinity','',' 1','79228162515'])assert.throws(()=>parseFee(v));
});
test('runtime verification binds code and every copy of each immutable',()=>{
  const artifact=artifacts.contracts.ForgeModel;
  assert.equal(matchRuntime(artifact.deployedBytecode,artifact),true);
  const refs=Object.values(artifact.immutableReferences).find(r=>r.length>1);
  assert.ok(refs);
  const bytes=artifact.deployedBytecode.slice(2).split('');bytes[refs[0].start*2]='1';
  assert.throws(()=>matchRuntime('0x'+bytes.join(''),artifact),/inconsistent/);
  assert.throws(()=>matchRuntime('0xff'+artifact.deployedBytecode.slice(4),artifact),/differs/);
  assert.throws(()=>matchRuntime(artifact.deployedBytecode+'00',artifact),/size/);
});
test('approval receipts bind sender, token, spender and exact amount',()=>{
  const iface=new Interface(['event Approval(address indexed owner,address indexed spender,uint256 value)']);
  const owner='0x1111111111111111111111111111111111111111',spender='0x2222222222222222222222222222222222222222';
  const hash='0x'+'ab'.repeat(32),ev=iface.encodeEventLog(iface.getEvent('Approval'),[owner,spender,10n]);
  const receipt={hash,status:1,from:owner,to:TOKEN_ADDRESS,logs:[{address:TOKEN_ADDRESS,...ev}]};
  const p={hash,wallet:owner,type:'Approval exact fee',expected:{address:spender,amount:'10'}};
  assert.equal(verifyActionReceipt(receipt,p,l=>iface.parseLog(l)),true);
  assert.throws(()=>verifyActionReceipt(receipt,{...p,expected:{...p.expected,amount:'11'}},l=>iface.parseLog(l)),/differs/);
  assert.throws(()=>verifyActionReceipt({...receipt,to:spender},p,l=>iface.parseLog(l)),/unexpected/);
  assert.throws(()=>verifyActionReceipt({...receipt,hash:'0x'+'cd'.repeat(32)},p,l=>iface.parseLog(l)),/hash/);
});
