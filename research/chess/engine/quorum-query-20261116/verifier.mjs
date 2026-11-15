// Research only: synthetic membership, no ICP certificate verifier or Stockfish.
import {createHash, verify} from 'node:crypto';

export const sha = x => createHash('sha256').update(x).digest();
const equal = (a,b) => Buffer.from(a).equals(Buffer.from(b));
const fail = m => { throw new Error(m); };
export const canonicalJSON = o => Buffer.from(JSON.stringify(o));
const leb = value => {
  let n=BigInt(value); if(n<0n) fail('negative natural'); const out=[];
  do { let b=Number(n&127n); n>>=7n; out.push(b|(n?128:0)); } while(n);
  return Buffer.from(out);
};
// ICP representation-independent hashing for the actual types used here.
export function hashValue(v) {
  if(Buffer.isBuffer(v)||v instanceof Uint8Array) return sha(v);
  if(typeof v==='string') return sha(Buffer.from(v));
  if(typeof v==='number'||typeof v==='bigint') return sha(leb(v));
  if(Array.isArray(v)) return sha(Buffer.concat(v.map(hashValue)));
  if(v&&typeof v==='object') {
    const fields=Object.entries(v).map(([k,x])=>Buffer.concat([sha(Buffer.from(k)),hashValue(x)]));
    fields.sort(Buffer.compare); return sha(Buffer.concat(fields));
  }
  fail('unsupported representation-independent value');
}
export function signatureMessage(query,replyArg,timestamp) {
  return Buffer.concat([Buffer.from('\x0bic-response','binary'),hashValue({
    status:'replied',reply:{arg:replyArg},timestamp,request_id:hashValue(query),
  })]);
}
export function expectedQuery(state, nowNs) {
  return {
    request_type:'query', canister_id:state.canisterId,
    method_name:'research_chunk',sender:Buffer.from([4]),
    ingress_expiry:BigInt(nowNs)+240_000_000_000n,
    arg:canonicalJSON({protocol:'GH0ST-research-quorum-1',moduleEpoch:state.moduleEpoch,
      keysetEpoch:state.keysetEpoch,nonce:state.nonce,stateCommitment:state.commitment,
      enginePolicyHash:state.enginePolicyHash}),
  };
}
export function transitionCommitment(state, patches) {
  // A transition-chain commitment, NOT a fresh digest of all engine memory.
  return sha(Buffer.concat([Buffer.from('GH0ST-state-transition-1\0'),
    Buffer.from(state.commitment,'hex'),canonicalJSON({moduleEpoch:state.moduleEpoch,
      keysetEpoch:state.keysetEpoch,nonce:state.nonce,enginePolicyHash:state.enginePolicyHash,patches})])).toString('hex');
}
export function replyFor(state,patches) {
  return canonicalJSON({protocol:'GH0ST-research-quorum-1',moduleEpoch:state.moduleEpoch,
    keysetEpoch:state.keysetEpoch,nonce:state.nonce,preCommitment:state.commitment,
    enginePolicyHash:state.enginePolicyHash,patches,
    postCommitment:transitionCommitment(state,patches)});
}
function wireValue(v) {
  if(Buffer.isBuffer(v)||v instanceof Uint8Array) return {base64:Buffer.from(v).toString('base64')};
  if(typeof v==='bigint') return {nat:v.toString()};
  if(Array.isArray(v)) return v.map(wireValue);
  if(v&&typeof v==='object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,wireValue(x)]));
  return v;
}
export const bundleWireBytes = bundle => canonicalJSON(wireValue(bundle)).length;

export function verifyAndCommit(state,bundle,keyset,nowNs,{allowSynthetic=false}={}) {
  if(keyset.provenance!=='synthetic-fixture'||!allowSynthetic)
    fail('production blocked: certified membership verifier is not implemented');
  if(keyset.members.size!==13||keyset.epoch!==state.keysetEpoch) fail('wrong membership epoch');
  if(bundleWireBytes(bundle)>2*1024*1024) fail('ingress payload exceeds 2 MiB');
  const want=expectedQuery(state,nowNs);
  // The expiry is chosen by the caller, but all other request fields must match
  // authoritative committed state. Request expiry and every signature are fresh.
  const expiry=BigInt(bundle.query.ingress_expiry);
  if(expiry<BigInt(nowNs)||expiry>BigInt(nowNs)+300_000_000_000n) fail('stale request');
  want.ingress_expiry=expiry;
  if(!equal(hashValue(bundle.query),hashValue(want))) fail('request binding mismatch');
  if(!Array.isArray(bundle.attestations)||bundle.attestations.length<9||bundle.attestations.length>13) fail('quorum size');
  const seen=new Set();
  for(const a of bundle.attestations) {
    if(seen.has(a.identity)) fail('duplicate node identity'); seen.add(a.identity);
    const pk=keyset.members.get(a.identity); if(!pk) fail('unknown member');
    const stamp=BigInt(a.timestamp);
    if(stamp<BigInt(nowNs)-300_000_000_000n||stamp>BigInt(nowNs)+30_000_000_000n) fail('stale signature');
    if(!verify(null,signatureMessage(bundle.query,bundle.replyArg,stamp),pk,a.signature)) fail('invalid signature or mismatched reply');
  }
  const r=JSON.parse(Buffer.from(bundle.replyArg).toString());
  if(r.protocol!=='GH0ST-research-quorum-1'||r.moduleEpoch!==state.moduleEpoch||
    r.keysetEpoch!==state.keysetEpoch||r.nonce!==state.nonce||
    r.preCommitment!==state.commitment||r.enginePolicyHash!==state.enginePolicyHash) fail('state or epoch mismatch');
  if(!Array.isArray(r.patches)||r.patches.length>200_000) fail('invalid patch list');
  const next=Buffer.from(state.bytes); let previousEnd=0;
  for(const p of r.patches) {
    if(!Number.isSafeInteger(p.offset)||p.offset<previousEnd||typeof p.data!=='string'||
      p.data.length%2||!/^[0-9a-f]*$/.test(p.data)) fail('noncanonical or overlapping patches');
    const data=Buffer.from(p.data,'hex');
    if(!data.length||p.offset+data.length>next.length) fail('patch out of bounds');
    data.copy(next,p.offset); previousEnd=p.offset+data.length;
  }
  if(r.postCommitment!==transitionCommitment(state,r.patches)) fail('inconsistent post commitment');
  // The only mutation occurs after every check, preserving CAS on failure/replay.
  state.bytes=next;state.commitment=r.postCommitment;state.nonce++;
  return {nonce:state.nonce,commitment:state.commitment,wireBytes:bundleWireBytes(bundle)};
}
