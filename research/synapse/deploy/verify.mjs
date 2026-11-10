#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHAIN_ID, PAYMENT_TOKEN, SPONSOR, TOKEN_ABI, assertChain, ethers, modelData, normalizedTrace, options, privateOutput, productionCompile, providerFor, readRpc, safeError, save } from './lib.mjs';
import { publicDeployment, validateDeployPlan, verifyInstance } from './guards.mjs';

export async function verifyCompleted(plan, journal, provider) {
  await assertChain(provider);
  assert.equal(journal.chainId, Number(CHAIN_ID)); assert.equal(ethers.getAddress(journal.owner), SPONSOR);
  assert.equal(journal.actions.length, plan.actions.length, 'Journal is incomplete');
  const head = await provider.getBlockNumber();
  const receipts = [];
  for (const action of plan.actions) {
    const evidence = journal.actions.find(item => item.id === action.id);
    assert.ok(evidence && evidence.status === 'confirmed');
    assert.equal(evidence.unsignedHash, action.unsignedHash);
    const signed = ethers.Transaction.from(evidence.rawSignedTransaction);
    assert.equal(signed.unsignedHash, action.unsignedHash); assert.equal(signed.hash, evidence.hash); assert.equal(signed.from, SPONSOR);
    const [receipt, tx] = await Promise.all([provider.getTransactionReceipt(evidence.hash), provider.getTransaction(evidence.hash)]);
    assert.ok(receipt && tx, 'Missing canonical transaction or receipt'); assert.equal(receipt.status, 1);
    const block = await provider.getBlock(receipt.blockNumber); assert.equal(block.hash, receipt.blockHash);
    assert.ok(head - receipt.blockNumber >= 12, 'Receipt has fewer than twelve descendant blocks');
    assert.equal(tx.hash, signed.hash); assert.equal(tx.from, SPONSOR); assert.equal(tx.nonce, action.nonce); assert.equal(tx.data, signed.data); assert.equal(tx.to, signed.to); assert.equal(tx.value, 0n); assert.equal(tx.chainId, CHAIN_ID);
    if (action.kind === 'deploy') assert.equal(receipt.contractAddress, plan.transactions[action.id].predictedAddress);
    receipts.push({ id: action.id, label: action.label, transactionHash: receipt.hash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, status: receipt.status, contractAddress: receipt.contractAddress, gasUsed: receipt.gasUsed, gasPrice: receipt.gasPrice, feeWei: receipt.fee });
  }
  const modules = [];
  for (const entry of plan.transactions) modules.push(await verifyInstance(provider, { label: entry.label.slice(7), address: entry.predictedAddress, runtimeHash: entry.expectedRuntimeHash, module: entry.module, graph: entry.graph }));
  const { artifacts } = productionCompile();
  const data = modelData(plan.modelDirectory);
  const fixtures = [];
  for (const fixture of data.fixtures) {
    const address = fixture.variant === 'alternate' ? plan.addresses.alternateGraph : plan.addresses.baseGraph;
    const graph = new ethers.Contract(address, artifacts.SynapseGraphV2.abi, provider);
    const trace = normalizedTrace(await graph.preview(fixture.tokens)); assert.deepEqual(trace, fixture.expected);
    fixtures.push({ id: fixture.id, variant: fixture.variant, token: trace.token, word: data.model.vocab[trace.token], allIntermediatesMatch: true });
  }
  let smoke = null;
  if (plan.optionalSmokeTransactions.length === 3) {
    const token = new ethers.Contract(PAYMENT_TOKEN, TOKEN_ABI, provider);
    const graph = new ethers.Contract(plan.addresses.baseGraph, artifacts.SynapseGraphV2.abi, provider);
    assert.equal(await graph.totalCredits(), 0n); assert.equal(await graph.credits(SPONSOR), 0n); assert.equal(await token.balanceOf(plan.addresses.baseGraph), 0n); assert.equal(await token.allowance(SPONSOR, plan.addresses.baseGraph), 0n);
    const inferReceipt = await provider.getTransactionReceipt(journal.actions.find(item => item.id === 7).hash);
    const withdrawReceipt = await provider.getTransactionReceipt(journal.actions.find(item => item.id === 8).hash);
    const parse = receipt => receipt.logs.filter(log => log.address.toLowerCase() === plan.addresses.baseGraph.toLowerCase()).flatMap(log => { try { return [graph.interface.parseLog(log)]; } catch { return []; } }).filter(Boolean);
    const events = parse(inferReceipt); const infer = events.filter(event => event.name === 'Inference'); const used = events.filter(event => event.name === 'ModuleUsed');
    assert.equal(infer.length, 1); assert.equal(used.length, 3); assert.equal(infer[0].args.payer, SPONSOR); assert.equal(infer[0].args.graphId, plan.transactions[4].graph.graphId); assert.equal(infer[0].args.fee, BigInt(plan.feePolicy.totalFeeRaw)); assert.equal(Number(infer[0].args.token), plan.actions[7].expectedOutputToken);
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const fixture = data.fixtures.find(item => item.variant === 'base');
    const trace = fixture.expected;
    assert.equal(infer[0].args.inputHash, ethers.keccak256(coder.encode(['uint16[]'], [plan.actions[7].inputTokens])));
    const traceType = 'tuple(int256[] hidden,int256[][] expertActivations,int256[] merged,int256[] logits,uint16 token)';
    assert.equal(infer[0].args.traceHash, ethers.keccak256(coder.encode([traceType], [trace])));
    const activationHashes = [ethers.keccak256(coder.encode(['int256[]', 'int256[]'], [trace.hidden, trace.logits])), ...trace.expertActivations.map(values => ethers.keccak256(coder.encode(['int256[]'], [values])))];
    const moduleAddresses = [plan.addresses.backbone, plan.addresses.expert0, plan.addresses.expert1];
    for (let index = 0; index < 3; index++) { assert.equal(used[index].args.graphId, plan.transactions[4].graph.graphId); assert.equal(used[index].args.module, moduleAddresses[index]); assert.equal(used[index].args.beneficiary, SPONSOR); assert.equal(used[index].args.fee, BigInt(plan.feePolicy.moduleFeesRaw[index])); assert.equal(used[index].args.activationHash, activationHashes[index]); }
    const withdrawals = parse(withdrawReceipt).filter(event => event.name === 'Withdrawal'); assert.equal(withdrawals.length, 1); assert.equal(withdrawals[0].args.beneficiary, SPONSOR); assert.equal(withdrawals[0].args.amount, BigInt(plan.feePolicy.totalFeeRaw));
    smoke = { inferenceTransactionHash: inferReceipt.hash, withdrawalTransactionHash: withdrawReceipt.hash, graphId: infer[0].args.graphId, token: Number(infer[0].args.token), word: data.model.vocab[Number(infer[0].args.token)], feeRaw: String(infer[0].args.fee), beneficiary: SPONSOR, inputTokens: plan.actions[7].inputTokens, inputWords: fixture.words, traceHash: infer[0].args.traceHash, trace, creditsAfter: '0', escrowBalanceAfter: '0', allowanceAfter: '0' };
  }
  return { schema: 'gh0st-synapse-canonical-verification-v1', chainId: 4663, checkedAt: new Date().toISOString(), headBlock: head, descendantBlocksRequired: 12, receipts, modules, fixtures, smoke, deployment: publicDeployment(plan, journal) };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = options(process.argv.slice(2));
  if (args.help) { console.log('Usage: node deploy/verify.mjs --plan /absolute/plan.json --journal /absolute/signed-journal.json --out /absolute/private/output [--env-file /absolute/.env.local]'); process.exit(0); }
  const provider = providerFor(readRpc(args['env-file']));
  try {
    const plan = JSON.parse(readFileSync(resolve(args.plan), 'utf8')); validateDeployPlan(plan);
    const journal = JSON.parse(readFileSync(resolve(args.journal), 'utf8'));
    const report = await verifyCompleted(plan, journal, provider);
    const out = privateOutput(args.out); save(out, 'canonical-verification.json', report); save(out, 'deployment.json', report.deployment);
    console.log(JSON.stringify({ verified: true, contracts: report.modules.length, receipts: report.receipts.length, fixtures: report.fixtures.length, out }));
  } catch (error) { console.error(JSON.stringify(safeError(error))); process.exitCode = 1; }
  finally { provider.destroy(); }
}
