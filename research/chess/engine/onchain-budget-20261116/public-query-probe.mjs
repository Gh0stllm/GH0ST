// Read-only transport experiment. Never calls an update, signs a transaction,
// starts an engine search, spends cycles, or changes a deployed canister.
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { HttpAgent } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';

const canister = 'vhlzv-eiaaa-aaaas-amy7q-cai';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = bytes => Buffer.from(bytes).toString('hex');
const startedAt = new Date().toISOString();
const agent = await HttpAgent.create({
  host: 'https://icp-api.io', shouldFetchRootKey: false,
  verifyQuerySignatures: true, fetchRetryTimes: 0,
});
const nonce = new Uint8Array(randomBytes(16));
const expiry = BigInt(Date.now() + 240_000) * 1_000_000n;
agent.addTransform('query', async request => {
  request.body.nonce = nonce;
  request.body.ingress_expiry = expiry;
  return request;
});
const pinnedRootSHA256 = hash(agent.rootKey);
if (pinnedRootSHA256 !== '737ba355e855bd4b61279056603e05501db5e5bad147c6eba7be8c2a13f4b6b3')
  throw Error('Unexpected SDK mainnet trust root');
const keys = await agent.fetchSubnetKeys({ canisterId: Principal.fromText(canister) });
if (keys.size !== 13) throw Error('Expected current 13-member engine subnet');
const arg = new Uint8Array(IDL.encode([IDL.Vec(IDL.Nat8)], [new Uint8Array(32)]));
const rows = [], failures = [];
let sameRequestId, sameReplyHash;
const distinct = new Set();
for (let attempt = 0; attempt < 26 && distinct.size < 9; attempt++) {
  try {
    const t0 = performance.now();
    const result = await agent.query(canister, { methodName: 'get_result', arg });
    if (result.status !== 'replied' || !result.signatures?.length)
      throw Error('Expected a signed canister reply');
    const requestId = hex(result.requestId), replySHA256 = hash(result.reply.arg);
    sameRequestId ??= requestId;
    sameReplyHash ??= replySHA256;
    if (requestId !== sameRequestId || replySHA256 !== sameReplyHash)
      throw Error('Fixed request or deterministic reply changed');
    for (const signature of result.signatures) {
      const node = Principal.fromUint8Array(signature.identity).toText();
      if (!keys.has(node)) throw Error('Signer absent from certified key set');
      distinct.add(node);
      rows.push({ attempt, node, requestId, replySHA256,
        timestampNanoseconds: String(signature.timestamp),
        signatureHex: hex(signature.signature), publicKeyDERHex: hex(keys.get(node)),
        milliseconds: Math.round(performance.now() - t0) });
    }
  } catch (error) {
    failures.push({ attempt, name: error.name, message: String(error.message).slice(0, 250) });
  }
}
const report = {
  scope: 'Mainnet read-only signed-query routing probe using an unknown-job get_result query; no Stockfish search or on-chain quorum verifier executed',
  startedAt, finishedAt: new Date().toISOString(), canister,
  pinnedRootSHA256, membershipKeyCount: keys.size,
  queryNodeSignaturesVerifiedBySDK: true,
  fixedRequest: { method: 'get_result', argumentHex: hex(arg), nonceHex: hex(nonce),
    ingressExpiryNanoseconds: String(expiry), requestId: sameRequestId },
  distinctVerifiedSigners: distinct.size, matchingReplySHA256: sameReplyHash,
  reachedNineDistinctSigners: distinct.size >= 9, rows, failures,
  updatesSubmitted: 0, searchesRun: 0, transactionsBroadcast: 0,
  proves: 'Only whether a nonce-bearing identical light query can obtain matching replies signed by nine current subnet members through the public gateway',
  doesNotProve: ['Full-engine chunk continuation', 'State-delta size or cost',
    'On-chain signature/certificate verification', 'Query capacity under real search load',
    'Twenty-game affordability', 'Standard replicated-update execution'],
};
writeFileSync(new URL('./public-query-probe.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
if (!report.reachedNineDistinctSigners) process.exitCode = 2;
