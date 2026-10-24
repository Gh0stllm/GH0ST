// Portable copy with exact reference assertions; original measured script is preserved.
// Exact stateful continuity model on isolated local Anvil, never a public chain.
import fs from 'node:fs';
import {loadRuntimeFixtures} from '../portable/runtime-fixtures.mjs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AbiCoder, ContractFactory, JsonRpcProvider, ZeroHash, keccak256, zeroPadValue, toBeHex } from 'ethers';
const dir = path.resolve('experiments/simplestories-v2/optimization/varied-sentence/continuity');
const source = path.join(dir, 'kernel/SimpleStoriesV2Relative64Model.sol');
const artifact = JSON.parse(fs.readFileSync(source.replace('.sol', '.compiled.json')));
const {plan,runtimes,manifestSha256:runtimeFixtureSha256}=loadRuntimeFixtures();
const ref = JSON.parse(fs.readFileSync(path.join(dir, 'quality/relative64/relative64-policy26-2060turn-reference.json')));
const flatExpected = ref.turns.flatMap(t => t.tokens);
const endpointHashes = new Map(ref.turns.map(t => [t.total_generated_after,t.last_logit_hash]));
const table = fs.readFileSync(path.join(dir, 'model/tables-relative64.bin'));
const CAP = 32_000_000n, localPort=Number(process.env.GH0ST_LOCAL_PORT||18596), TARGET_POSITIONS=Number(process.env.GH0ST_MODEL_MAX_POSITIONS||150), url = `http://127.0.0.1:${localPort}`;
assert(Number.isInteger(localPort)&&localPort>=1024&&localPort<=65535);
// The inherited counter-relocation control requires a full 64-position window.
assert(Number.isInteger(TARGET_POSITIONS)&&TARGET_POSITIONS>=64&&TARGET_POSITIONS<=150);
const tableAddresses = Array.from({length:Math.ceil(table.length/24000)},(_,i)=>zeroPadValue(toBeHex(0xc300+i),20));
const output = path.join(dir, 'model-relative64-portable-local.json');
const report = { runtimeFixtureSha256,targetPositions:TARGET_POSITIONS,status: 'RUNNING', localOnly: true, publicTransactionsSubmitted: 0, chainId: 31337,
  sourceSha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
  referenceSha256: createHash('sha256').update(fs.readFileSync(path.join(dir, 'quality/relative64/relative64-policy26-2060turn-reference.json'))).digest('hex'),
  transactionGasLimit: CAP.toString(), runtimeBytes: artifact.evm.deployedBytecode.object.length / 2,
  policy: { prompt: 3, maxNew: 2, topK: 8, temperatureMilli: 800, seed: zeroPadValue(toBeHex(42), 32),
    adaptive: 'two tokens while processed<=26; one afterward', attentionWindow:64, positionIndependent:true, overflow:'No fixed-position table limit; uint64 lifecycle counters' },
  turns: [], checks: {} };
const save = () => fs.writeFileSync(output, JSON.stringify(report, (_, x) => typeof x === 'bigint' ? x.toString() : x, 2) + '\n');
async function rpc(method, params = []) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(120000) });
  const value = await response.json(); if (value.error) throw Error(value.error.message); return value.result;
}
async function guard() { assert.equal(await rpc('eth_chainId'), '0x7a69'); assert((await rpc('web3_clientVersion')).toLowerCase().includes('anvil')); }
let provider, child, temp, stderr = '';
try {
  save();
  try { await rpc('eth_chainId'); throw Error('Reserved local port busy'); } catch (e) { if (e.message === 'Reserved local port busy') throw e; }
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh0st-continuity-'));
  child = spawn(process.env.ANVIL_BINARY||'anvil', ['--host', '127.0.0.1', '--port', String(localPort), '--chain-id', '31337',
    '--hardfork', 'cancun', '--gas-limit', CAP.toString(), '--code-size-limit', '24576', '--quiet', '--no-cors'],
  { cwd: temp, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', x => { stderr = (stderr + String(x)).slice(-3000); });
  let ready = false;
  for (let i = 0; i < 100; i++) { try { await guard(); ready = true; break; } catch {} await new Promise(r => setTimeout(r, 50)); }
  assert(ready, stderr);
  const entries = plan.transactions.filter(x => x.kind.startsWith('data:weights:') || x.kind.startsWith('tile:'));
  for (let i = 0; i < entries.length; i += 20) {
    await guard(); await Promise.all(entries.slice(i, i + 20).map(async x => {
      assert.equal(keccak256(runtimes[x.predicted_address]), x.runtime_code_hash);
      await rpc('anvil_setCode', [x.predicted_address, runtimes[x.predicted_address]]);
    }));
  }
  for(let i=0;i<tableAddresses.length;i++){await guard();await rpc('anvil_setCode',[tableAddresses[i],'0x00'+table.subarray(i*24000,(i+1)*24000).toString('hex')]);}
  provider = new JsonRpcProvider(url, 31337, { staticNetwork: true, cacheTimeout: -1 }); provider.pollingInterval = 10;
  const signer = await provider.getSigner(0), owner = await signer.getAddress();
  const factory = new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer);
  const original = plan.transactions[544].constructor_arguments;
  const args = [original[0], tableAddresses, original[2], 3];
  const request = await factory.getDeployTransaction(...args);
  report.initCodeBytes = (request.data.length - 2) / 2;
  assert(report.initCodeBytes <= 49152 && report.runtimeBytes <= 24576);
  await guard(); const model = await factory.deploy(...args, { gasLimit: CAP });
  const deployed = await model.deploymentTransaction().wait(); assert.equal(deployed.status, 1);
  report.constructorGas = deployed.gasUsed; report.model = model.target; report.modelHash = await model.modelHash();
  const id = keccak256(Buffer.from('continuity-reference-quote')), seed = report.policy.seed;
  let context = ZeroHash, accumulated = [], firstRootCode, firstRootAddress;
  for (let turn = 1; turn <= 160; turn++) {
    const before = await model.storyState(owner, id);
    const maxNew = Number(before[1]) <= 26 ? 2 : 1;
    let preview;
    try { preview = await model.preview(id, maxNew, seed, 8, 800, { gasLimit: CAP }); }
    catch (error) { report.extensionStopped = { turn, processed: before[1], reason: error.shortMessage || error.message }; break; }
    const tokens = Array.from(preview[0], Number);
    const expected=ref.turns[turn-1];
    assert.equal(maxNew,expected.max_new_tokens_requested);assert.deepEqual(tokens,expected.tokens);
    assert.equal(preview[1],expected.ended_eos);assert.equal(preview[2],expected.ended_sentence);
    assert.equal(preview[3],expected.last_logit_hash);

    const endCount=accumulated.length+tokens.length;

    await guard();
    let receipt;
    try { const tx = await model.advanceStory(id, context, maxNew, seed, 8, 800, { gasLimit: CAP }); receipt=await tx.wait(); assert.equal(receipt.status,1); }
    catch(error){ report.extensionStopped={turn,processed:before[1],reason:error.shortMessage||error.message,failedGas:error.receipt?.gasUsed};break; }
    const after = await model.storyState(owner, id);
    assert.equal(after[0], preview[4]); assert.equal(Number(after[2]), tokens.at(-1));
    accumulated.push(...tokens); assert.equal(Number(after[3]), accumulated.length);

    context = after[0];
    const [address, hash] = await model.storyChunk(owner, id, Number(after[6]) - 1);
    const code = await provider.getCode(address); assert.equal(keccak256(code), hash);
    const row = { turn, maxNew, tokens, processed: after[1], generated: after[3], pending: after[2], epoch: after[4],
      contextHash: context, gasUsed: receipt.gasUsed, chunk: address, chunkRuntimeBytes: (code.length - 2) / 2,
      exactReference: true, logitHash:preview[3], endedEos: preview[1], endedSentence: preview[2], refreshed: preview[5] };
    report.turns.push(row); save();
    if (turn === 1) { firstRootCode = code; firstRootAddress = address; }
    if (turn % 10 === 0) console.log(`Continuity ${turn} turns / ${after[1]} positions; latest gas ${receipt.gasUsed}`);
    assert.equal(preview[5],false);if(Number(after[1])>=TARGET_POSITIONS)break;
  }
  assert(accumulated.length>=TARGET_POSITIONS,'Did not complete requested reference prefix.');
  report.checks.exactReferenceParity = true;
  const state = await model.storyState(owner, id);
  let stale = false;
  try { await model.advanceStory.staticCall(id, ZeroHash, 2, seed, 8, 800, { gasLimit: 1_000_000n }); } catch { stale = true; }
  assert(stale); assert.equal((await model.storyState(owner, id))[0], state[0]); report.checks.staleContextRejected = true;
  const other = await provider.getSigner(1), otherOwner = await other.getAddress();
  const otherPreview = await model.previewFor(otherOwner, id, 2, seed, 8, 800, { gasLimit: CAP });
  const startPreview=await model.previewFor(otherOwner,id,2,seed,8,800,{gasLimit:CAP});assert.deepEqual(Array.from(otherPreview[0],Number),Array.from(startPreview[0],Number));
  assert.equal((await model.storyState(otherOwner, id))[0], ZeroHash); report.checks.callerStateIsolated = true;
  const latestIndex=Number(state[6])-1;
  const [latestAddress,latestHash]=await model.storyChunk(owner,id,latestIndex);
  const latestCode=await provider.getCode(latestAddress);
  const altered=Buffer.from(latestCode.slice(2),'hex');altered[6]^=1;
  await guard();await rpc('anvil_setCode',[latestAddress,'0x'+altered.toString('hex')]);
  let bad=false;try{await model.preview(id,1,seed,8,800,{gasLimit:CAP});}catch{bad=true;}
  assert(bad);report.checks.modifiedActiveChunkRejected=true;
  await guard();await rpc('anvil_setCode',[latestAddress,latestCode]);
  if(state[5]>0n){
    const oldest=await model.storyChunk(owner,id,0);const oldCode=await provider.getCode(oldest[0]);
    await guard();await rpc('anvil_setCode',[oldest[0],'0x00']);
    await model.preview(id,1,seed,8,800,{gasLimit:CAP});
    report.checks.expiredChunkNotRead=true;
    await guard();await rpc('anvil_setCode',[oldest[0],oldCode]);
  }
  // Synthetic local-state relocation verifies that numeric inference does not depend on
  // absolute position. This is an Anvil-only probe, not a production cache-writing API.
  const normalPreview=await model.preview(id,1,seed,8,800,{gasLimit:CAP});
  const abi=AbiCoder.defaultAbiCoder();
  const key=keccak256(abi.encode(['address','bytes32'],[owner,id]));
  const base=BigInt(keccak256(abi.encode(['bytes32','uint256'],[key,3])));
  const slot=base+1n;
  const packed=BigInt(await rpc('eth_getStorageAt',[model.target,toBeHex(slot,32),'latest']));
  const processedMask=((1n<<64n)-1n)<<176n;
  assert.equal((packed&processedMask)>>176n,state[1]);
  const delta=65536n;
  const moved=(packed&~processedMask)|((state[1]+delta)<<176n);
  await guard();await rpc('anvil_setStorageAt',[model.target,toBeHex(slot,32),toBeHex(moved,32)]);
  const arrayData=BigInt(keccak256(abi.encode(['uint256'],[base+3n])));
  for(let i=Number(state[5]);i<Number(state[6]);i++){
    const [address,hash]=await model.storyChunk(owner,id,i);const code=Buffer.from((await provider.getCode(address)).slice(2),'hex');
    const start=code.readBigUInt64BE(1);code.writeBigUInt64BE(start+delta,1);
    const shifted='0x'+code.toString('hex');
    await rpc('anvil_setCode',[address,shifted]);
    await rpc('anvil_setStorageAt',[model.target,toBeHex(arrayData+BigInt(i)*2n+1n,32),keccak256(shifted)]);
  }
  const movedPreview=await model.preview(id,1,seed,8,800,{gasLimit:CAP});
  assert.deepEqual(Array.from(movedPreview[0],Number),Array.from(normalPreview[0],Number));
  assert.equal(movedPreview[3],normalPreview[3]);
  await guard();const movedTx=await model.advanceStory(id,state[0],1,seed,8,800,{gasLimit:CAP});const movedReceipt=await movedTx.wait();assert.equal(movedReceipt.status,1);
  const movedState=await model.storyState(owner,id);
  assert.equal(movedState[1],state[1]+delta+1n);
  report.counterRelocationProbe={syntheticLocalOnly:true,delta:delta.toString(),processedBefore:state[1].toString(),processedAfter:movedState[1].toString(),sameTokens:true,sameFullLogitHash:true,gasUsed:movedReceipt.gasUsed.toString()};
  report.checks.beyond2048And65535WithoutReset=true;
  report.generatedIds=accumulated;
  report.maximumMeasuredGas = report.turns.reduce((m, x) => x.gasUsed > m ? x.gasUsed : m, 0n);
  report.status = 'PASS'; save();
  console.log(JSON.stringify({ status: report.status, constructorGas: report.constructorGas, turns: report.turns.length,
    maximumMeasuredGas: report.maximumMeasuredGas, extensionStopped: report.extensionStopped, checks: report.checks }, (_, x) => typeof x === 'bigint' ? x.toString() : x));
} catch (error) { report.status = 'FAIL'; report.error = error.shortMessage || error.message; save(); throw error; }
finally { provider?.destroy(); child?.kill('SIGTERM'); if (child) await new Promise(r => child.exitCode !== null ? r() : child.once('exit', r)); if (temp) fs.rmSync(temp, { recursive: true, force: true }); }
