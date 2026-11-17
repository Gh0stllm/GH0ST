// Observed private-fork state, never a claim of a complete canonical ledger.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(process.env.GL3_NODE_PACKAGE),E=require('ethers');
export const TOKEN='0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
export const TOKEN_HASH='0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164';
const HOLDER='0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6';
export const word=x=>'0x'+BigInt(x==='0x'?'0x0':x.startsWith('0x')?x:'0x'+x).toString(16).padStart(64,'0');
export function storageAccesses(trace,rootAddress){
 const contexts=new Map(),rows=[];let prev;
 for(const log of trace.structLogs||[]){
  if(!prev)contexts.set(log.depth,{storage:rootAddress?.toLowerCase(),code:rootAddress?.toLowerCase()});
  if(prev&&log.depth>prev.depth){
   const parent=contexts.get(prev.depth)||{};let storage,code;
   if(['CALL','STATICCALL','DELEGATECALL','CALLCODE'].includes(prev.op)){
    code=E.getAddress('0x'+prev.stack.at(-2).replace(/^0x/,'').slice(-40).padStart(40,'0')).toLowerCase();
    storage=['DELEGATECALL','CALLCODE'].includes(prev.op)?parent.storage:code;
   }
   contexts.set(log.depth,{storage,code});
  }
  if(prev&&log.depth<prev.depth)for(const n of contexts.keys())if(n>log.depth)contexts.delete(n);
  const context=contexts.get(log.depth)||{};
  if(context.storage===TOKEN.toLowerCase()&&['SLOAD','SSTORE'].includes(log.op))rows.push({op:log.op,key:word(log.stack.at(-1)),pc:log.pc,depth:log.depth});
  prev=log;
 }
 return rows;
}
// No network client is created: this is a bounded synthetic balance-owner remap.
export async function createSource(out){
 const raw=fs.readFileSync(new URL('./frozen-token-source.json',import.meta.url));
 const frozen=JSON.parse(raw),snapshot=structuredClone(frozen);
 assert.equal(E.keccak256(frozen.account.code),TOKEN_HASH);
 const wallets={owner:E.Wallet.createRandom(),player:E.Wallet.createRandom(),poster:E.Wallet.createRandom()};
 const balanceKey=a=>E.keccak256(E.AbiCoder.defaultAbiCoder().encode(['address','uint256'],[a,0]));
 const oldKey=balanceKey(frozen.holder),newKey=balanceKey(wallets.owner.address),amount=E.parseEther('32');
 assert.equal(BigInt(snapshot.account.storage[oldKey]),amount);assert(!(newKey in snapshot.account.storage));
 snapshot.account.storage[oldKey]=word('0x0');snapshot.account.storage[newKey]=word(E.toQuantity(amount));
 Object.assign(snapshot,{scope:'Private synthetic balance-owner remap of frozen observed GH0ST sparse state; no canonical ledger or current public-state claim',holder:wallets.owner.address,balanceRemap:{oldHolder:frozen.holder,newHolder:wallets.owner.address,oldKey,newKey,amount:String(amount),slot:0,totalSupplyUnchanged:true},publicRPCUsed:false});
 fs.writeFileSync(out+'/source-snapshot.json',JSON.stringify(snapshot,null,2)+'\n');
 fs.writeFileSync(out+'/source-wallets.private.json',JSON.stringify(Object.fromEntries(Object.entries(wallets).map(([n,w])=>[n,{address:w.address,privateKey:w.privateKey}])),null,2)+'\n',{mode:0o600});
 return {snapshot,wallets,methods:new Set(),read:async key=>snapshot.account.storage[key]||word('0x0'),close:async()=>{}};
}
