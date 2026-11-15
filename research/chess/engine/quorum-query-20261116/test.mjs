import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {sha,hashValue,signatureMessage,expectedQuery,replyFor,verifyAndCommit} from './verifier.mjs';
const NOW=1_794_758_400_000_000_000n;
const pairs=Array.from({length:13},()=>generateKeyPairSync('ed25519'));
const keyset={provenance:'synthetic-fixture',epoch:4,members:new Map(pairs.map((p,i)=>[`node-${i}`,p.publicKey]))};
const fresh=()=>({canisterId:Buffer.from([1,2,3,4,5]),moduleEpoch:7,keysetEpoch:4,
  nonce:0,bytes:Buffer.alloc(4096,7),commitment:sha(Buffer.alloc(4096,7)).toString('hex'),enginePolicyHash:'a'.repeat(64)});
const patches=[{offset:30,data:'aabbccdd'},{offset:100,data:'00112233'}];
const make=(state,options={})=>{
  const query=options.query??expectedQuery(state,NOW);
  const replyArg=options.replyArg??replyFor(state,patches);
  const at=options.timestamp??NOW;
  const attestations=Array.from({length:options.count??9},(_,i)=>({identity:`node-${i}`,timestamp:at,
    signature:sign(null,signatureMessage(query,replyArg,at),pairs[i].privateKey)}));
  return {query,replyArg,attestations};
};
const check=(s,b,k=keyset)=>verifyAndCommit(s,b,k,NOW,{allowSynthetic:true});
const tests=[];
function test(name,fn){fn();tests.push({name,passed:true});}
const reject=(name,mutate,pattern)=>test(name,()=>{
  const s=fresh(),before=Buffer.from(s.bytes),root=s.commitment;let b=make(s);b=mutate(b,s)??b;
  assert.throws(()=>check(s,b),pattern);assert.equal(s.nonce,0);assert.equal(s.commitment,root);assert.deepEqual(s.bytes,before);
});
test('accept 9 distinct genuine Ed25519 signatures and exact CAS patch',()=>{
  const s=fresh(); const result=check(s,make(s));assert.equal(s.nonce,1);
  assert.equal(s.bytes.subarray(30,34).toString('hex'),'aabbccdd');assert.equal(result.commitment,s.commitment);
});
test('ICP representation-independent map hashing ignores key order',()=>{
  assert.deepEqual(hashValue({a:'x',b:1}),hashValue({b:1,a:'x'}));
  assert.notDeepEqual(hashValue({a:'x',b:1}),hashValue({a:'x',b:2}));
});
reject('reject 8 signatures',b=>{b.attestations.pop();},/quorum/);
reject('reject duplicate identity',b=>{b.attestations[8]=b.attestations[0];},/duplicate/);
reject('reject unknown node',b=>{b.attestations[8].identity='node-unknown';},/unknown/);
reject('reject changed canister request even when resigned',(b,s)=>make(s,{query:{...b.query,canister_id:Buffer.from([9])}}),/request binding/);
reject('reject wrong state commitment in signed request',(b,s)=>{
  const q={...b.query,arg:Buffer.from(b.query.arg.toString().replace(s.commitment,'b'.repeat(64)))};return make(s,{query:q});
},/request binding/);
reject('reject wrong signed method',(b,s)=>make(s,{query:{...b.query,method_name:'other'}}),/request binding/);
reject('reject wrong module epoch in signed reply',(b,s)=>{
  const r=JSON.parse(b.replyArg);r.moduleEpoch++;return make(s,{replyArg:Buffer.from(JSON.stringify(r))});
},/state or epoch/);
reject('reject stale signature timestamp',(b,s)=>make(s,{timestamp:NOW-301_000_000_000n}),/stale signature/);
reject('reject stale query expiry',(b,s)=>make(s,{query:{...b.query,ingress_expiry:NOW-1n}}),/stale request/);
reject('reject corrupted signature',b=>{b.attestations[0].signature[0]^=1;},/invalid signature/);
reject('reject one signature over a different reply',(b,s)=>{
  b.attestations[8].signature=sign(null,signatureMessage(b.query,Buffer.from('different reply'),NOW),pairs[8].privateKey);
},/mismatched reply/);
reject('reject inconsistent post commitment even with 9 fixture signatures',(b,s)=>{
  const r=JSON.parse(b.replyArg);r.postCommitment='c'.repeat(64);return make(s,{replyArg:Buffer.from(JSON.stringify(r))});
},/inconsistent post/);
reject('reject oversized 2 MiB delta before verification',(b,s)=>make(s,{replyArg:replyFor(s,[{offset:0,data:'aa'.repeat(2*1024*1024)}])}),/2 MiB/);
reject('reject overlapping patches',(b,s)=>make(s,{replyArg:replyFor(s,[{offset:30,data:'aabbccdd'},{offset:31,data:'aabb'}])}),/overlapping/);
reject('reject out of range patch',(b,s)=>make(s,{replyArg:replyFor(s,[{offset:4095,data:'aabb'}])}),/bounds/);
test('reject replay after successful CAS',()=>{
  const s=fresh(),b=make(s);check(s,b);const root=s.commitment;
  assert.throws(()=>check(s,b),/request binding/);assert.equal(s.nonce,1);assert.equal(s.commitment,root);
});
test('reject stale membership epoch',()=>{
  const s=fresh(),b=make(s);assert.throws(()=>check(s,b,{...keyset,epoch:3}),/membership epoch/);
});
test('block production use without explicitly allowing synthetic keys',()=>{
  const s=fresh();assert.throws(()=>verifyAndCommit(s,make(s),keyset,NOW),/production blocked/);
});
console.log(JSON.stringify({scope:'synthetic quorum verifier only; no Stockfish, live node routing or certified membership',passed:true,tests},null,2));
