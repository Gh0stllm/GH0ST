import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { digest, ensure } from './engine.mjs';
import { validateConfig } from './worker.mjs';
const req = createRequire('/workspace/gl3/durable/neutral/dispute/package.json');
const { JsonRpcProvider, getCreateAddress } = req('ethers');
const dir = path.dirname(new URL(import.meta.url).pathname);
const c = JSON.parse(fs.readFileSync(process.argv[2]));
// Validate the public draft structure, while reporting its actual approval bit.
validateConfig({ ...c, activationApproved: true });
for (const [file, field] of [['artifacts.json','artifactsSHA256'], ['engine.mjs','engineSHA256'], ['worker.mjs','workerSHA256']])
  ensure(digest(fs.readFileSync(path.join(dir, file))) === c[field], 'SOURCE_OR_ARTIFACT_HASH_MISMATCH');
const p = new JsonRpcProvider(c.rpc, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
const rpc = (m,a) => p.send(m,a);
try {
  ensure(Number(BigInt(await rpc('eth_chainId', []))) === c.chainId, 'WRONG_CHAIN');
  ensure((await rpc('eth_getBlockByNumber', ['0x0',false])).hash === c.genesis, 'WRONG_GENESIS');
  const latest = await rpc('eth_getTransactionCount', [c.signer,'latest']);
  const pending = await rpc('eth_getTransactionCount', [c.signer,'pending']);
  const balance = await rpc('eth_getBalance', [c.signer,'latest']);
  const contracts = [];
  for (let nonce = 0; nonce < 3; nonce++) {
    const address = getCreateAddress({from:c.signer,nonce}); contracts.push({address,nonce,code:await rpc('eth_getCode',[address,'latest'])});
  }
  const report = { schema:'gh0st.gl3.automated-demo.preflight.v1',passed:true,observedUTC:new Date().toISOString(),chainId:c.chainId,
    genesis:c.genesis,signer:c.signer,activationApproved:c.activationApproved,latestNonce:latest,pendingNonce:pending,balanceWei:BigInt(balance).toString(),
    fundingReady:BigInt(balance)>=BigInt(c.budgetWei),freshWalletReady:latest==='0x0'&&pending==='0x0'&&contracts.every(x=>x.code==='0x'),contracts,
    transactionsSigned:0,transactionsSent:0,privateFilesRead:0,scope:'Read-only source/chain/nonce/balance/code checks, not worker launch or throughput acceptance.'};
  fs.writeFileSync(path.join(dir,'evidence/preflight.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} finally {p.destroy();}
