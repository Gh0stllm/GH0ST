import assert from 'node:assert/strict';
import { CHAIN_ID, PAYMENT_TOKEN, SPONSOR, TOKEN_ABI, assertChain, ethers, modelData, normalizedTrace, productionCompile } from './lib.mjs';
import { assertReviewedFeeBounds } from './fee-guards.mjs';

const labels = ['backbone', 'expert0', 'expert1', 'alternateExpert1', 'baseGraph', 'alternateGraph'];
function sameAddress(actual, expected, message) { assert.equal(ethers.getAddress(actual), ethers.getAddress(expected), message); }
function runtimeMatchesTemplate(artifact, code) {
  const actual = Buffer.from(code.slice(2), 'hex');
  const expected = Buffer.from(artifact.deployedBytecode.slice(2), 'hex');
  if (actual.length !== expected.length || !actual.length) return false;
  for (const refs of Object.values(artifact.immutableReferences ?? {})) for (const { start, length } of refs) expected.copy(actual, start, start, start + length);
  return actual.equals(expected);
}

export function validateDeployPlan(plan) {
  assert.equal(plan.schema, 'gh0st-synapse-unsigned-plan-v1');
  assert.equal(plan.broadcast, false); assert.equal(plan.mode, 'REVIEW_ONLY_UNSIGNED_NO_MAINNET_BROADCAST');
  assert.equal(Number(plan.chainId), Number(CHAIN_ID)); sameAddress(plan.owner, SPONSOR); sameAddress(plan.sponsor, SPONSOR); sameAddress(plan.paymentToken, PAYMENT_TOKEN);
  const { artifacts, manifest } = productionCompile();
  const data = modelData(plan.modelDirectory);
  assert.equal(plan.kernelVersion, 2); assert.equal(data.kernelVersion, 2);
  assert.equal(plan.sourceInputSha256, manifest.inputSha256, 'Candidate source input changed');
  assert.deepEqual(plan.sourceHashes, manifest.sourceHashes); assert.deepEqual(plan.modelManifest, data.manifest, 'Candidate model changed');
  assert.equal(plan.transactions.length, 6);
  assert.ok([0, 3].includes(plan.optionalSmokeTransactions.length), 'Smoke must be exact approve/infer/withdraw sequence');
  const entries = [...plan.transactions, ...plan.optionalSmokeTransactions];
  assert.equal(plan.actions.length, entries.length); assert.equal(plan.nonceEndExclusive, plan.nonceStart + entries.length);
  const fee = [10n ** 18n, 2n * 10n ** 18n, 3n * 10n ** 18n];
  assert.deepEqual(plan.feePolicy.moduleFeesRaw.map(BigInt), fee); assert.equal(BigInt(plan.feePolicy.totalFeeRaw), 6n * 10n ** 18n);
  assert.deepEqual(plan.feePolicy.beneficiaries, [SPONSOR, SPONSOR, SPONSOR]);
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const totalFee = fee.reduce((sum, value) => sum + value, 0n);
  for (const [index, label] of labels.entries()) {
    const entry = plan.transactions[index];
    assert.equal(entry.label, `deploy:${label}`);
    sameAddress(entry.predictedAddress, ethers.getCreateAddress({ from: SPONSOR, nonce: plan.nonceStart + index }));
    sameAddress(plan.addresses[label], entry.predictedAddress);
    const contractName = index === 0 ? 'SynapseBackboneV2' : index < 4 ? 'SynapseExpertV2' : 'SynapseGraphV2';
    assert.equal(entry.contractName, contractName);
    let constructorArgs;
    if (index === 0) constructorArgs = [SPONSOR, fee[0], data.model.vocab.length, data.model.contextSize, data.model.hiddenSize, data.packed.backbone];
    else if (index < 4) constructorArgs = [SPONSOR, index === 1 ? fee[1] : fee[2], data.spaceId, data.model.hiddenSize, data.packed[label]];
    else constructorArgs = [PAYMENT_TOKEN, plan.addresses.backbone, [plan.addresses.expert0, index === 4 ? plan.addresses.expert1 : plan.addresses.alternateExpert1]];
    const factory = new ethers.ContractFactory(artifacts[contractName].abi, artifacts[contractName].bytecode);
    const expectedData = artifacts[contractName].bytecode + factory.interface.encodeDeploy(constructorArgs).slice(2);
    assert.equal(entry.data.toLowerCase(), expectedData.toLowerCase(), 'Creation calldata differs from actual candidate model');
    assert.equal(ethers.keccak256(entry.expectedRuntime), entry.expectedRuntimeHash);
    assert.ok(runtimeMatchesTemplate(artifacts[contractName], entry.expectedRuntime), 'Expected runtime differs from compiler template');
    if (index < 4) {
      sameAddress(entry.module.beneficiary, SPONSOR); assert.equal(BigInt(entry.module.fee), index === 0 ? fee[0] : index === 1 ? fee[1] : fee[2]);
      assert.equal(entry.module.weightsHash, ethers.keccak256(data.packed[label])); assert.equal(entry.module.spaceId, data.spaceId);
      assert.equal(entry.module.hiddenSize, data.model.hiddenSize);
      const payload = data.packed[label];
      assert.equal(entry.module.shards.length, Math.ceil((payload.length - 2) / 2 / 24000));
      for (const [shardIndex, shard] of entry.module.shards.entries()) {
        const code = '0x00' + payload.slice(2 + shardIndex * 48000, 2 + (shardIndex + 1) * 48000);
        assert.equal(shard.runtimeHash, ethers.keccak256(code)); assert.equal(shard.runtimeBytes, (code.length - 2) / 2);
        sameAddress(shard.address, ethers.getCreateAddress({ from: entry.predictedAddress, nonce: 1 + shardIndex }));
      }
    } else {
      const modules = [plan.addresses.expert0, index === 4 ? plan.addresses.expert1 : plan.addresses.alternateExpert1];
      const moduleEntries = [plan.transactions[0], plan.transactions[1], plan.transactions[index === 4 ? 2 : 3]];
      const expectedGraphId = ethers.keccak256(coder.encode(['uint256', 'address', 'address', 'address', 'address[2]', 'bytes32', 'bytes32[3]', 'bytes32[3]', 'address[3]', 'uint96[3]'], [CHAIN_ID, entry.predictedAddress, PAYMENT_TOKEN, plan.addresses.backbone, modules, data.spaceId, moduleEntries.map(item => item.module.weightsHash), moduleEntries.map(item => item.expectedRuntimeHash), [SPONSOR, SPONSOR, SPONSOR], fee]));
      assert.equal(entry.graph.graphId, expectedGraphId); assert.equal(BigInt(entry.graph.totalFee), totalFee);
    }
  }
  for (const [index, entry] of entries.entries()) {
    const action = plan.actions[index];
    assert.equal(action.id, index); assert.equal(action.nonce, plan.nonceStart + index); assert.equal(entry.nonce, action.nonce);
    assert.equal(action.label, entry.label); assert.equal(action.kind, index < 6 ? 'deploy' : index === 6 ? 'approve' : index === 7 ? 'infer' : 'withdraw');
    assert.deepEqual(action.transaction, entry.walletRequest.params[0]);
    assert.equal(entry.walletRequest.method, 'eth_sendTransaction'); assert.equal(entry.walletRequest.params.length, 1);
    const tx = action.transaction;
    const allowed = ['from', 'to', 'data', 'value', 'type', 'chainId', 'nonce', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas'];
    assert.ok(Object.keys(tx).every(key => allowed.includes(key))); sameAddress(tx.from, SPONSOR);
    const decoded = ethers.Transaction.from(entry.unsignedSerialized);
    assert.equal(decoded.signature, null); assert.equal(decoded.chainId, CHAIN_ID); assert.equal(decoded.type, 2); assert.equal(decoded.value, 0n);
    assert.equal(decoded.unsignedHash, entry.unsignedHash); assert.equal(action.unsignedHash, entry.unsignedHash); assert.equal(action.unsignedSerialized, entry.unsignedSerialized);
    assert.equal(decoded.nonce, action.nonce); assert.equal(decoded.data, tx.data); assert.equal(ethers.keccak256(tx.data), entry.calldataHash);
    assert.equal(BigInt(tx.chainId), CHAIN_ID); assert.equal(BigInt(tx.type), 2n); assert.equal(BigInt(tx.value), 0n); assert.equal(Number(BigInt(tx.nonce)), decoded.nonce);
    assert.equal(decoded.to, tx.to ? ethers.getAddress(tx.to) : null); assert.equal(decoded.gasLimit, BigInt(tx.gas)); assert.equal(decoded.maxFeePerGas, BigInt(tx.maxFeePerGas)); assert.equal(decoded.maxPriorityFeePerGas, BigInt(tx.maxPriorityFeePerGas));
    assert.ok(decoded.gasLimit > 0n && decoded.gasLimit <= 16_777_216n && decoded.maxFeePerGas > 0n && decoded.maxPriorityFeePerGas >= 0n && decoded.maxPriorityFeePerGas <= decoded.maxFeePerGas);
    assert.equal(BigInt(action.maxCostWei), decoded.gasLimit * decoded.maxFeePerGas);
    const required = plan.transactions.slice(0, Math.min(index, 6)).map(instance => ({ label: instance.label.slice(7), address: instance.predictedAddress, runtimeHash: instance.expectedRuntimeHash, module: instance.module ?? null, graph: instance.graph ?? null }));
    assert.deepEqual(action.requiredContracts, required, 'Action prerequisite changed');
    if (index < 6) assert.equal(decoded.to, null);
    if (index === 6) {
      sameAddress(decoded.to, PAYMENT_TOKEN);
      const expected = new ethers.Interface(TOKEN_ABI).encodeFunctionData('approve', [plan.addresses.baseGraph, totalFee]);
      assert.equal(decoded.data, expected, 'Approval must be exactly six GH0ST to baseGraph');
    }
    if (index === 7) {
      sameAddress(decoded.to, plan.addresses.baseGraph);
      const iface = new ethers.Interface(artifacts.SynapseGraphV2.abi);
      const call = iface.decodeFunctionData('inferPaid', decoded.data);
      assert.deepEqual(Array.from(call[0], Number), entry.inputTokens); assert.equal(call[1], plan.transactions[4].graph.graphId); assert.equal(call[2], totalFee); assert.equal(call[3], BigInt(entry.deadline));
      const fixture = data.fixtures.find(item => item.variant === 'base');
      assert.deepEqual(entry.inputTokens, fixture.tokens); assert.equal(entry.expectedOutputToken, fixture.expected.token);
    }
    if (index === 8) {
      sameAddress(decoded.to, plan.addresses.baseGraph); assert.equal(decoded.data, new ethers.Interface(artifacts.SynapseGraphV2.abi).encodeFunctionData('withdraw', []));
      assert.equal(BigInt(entry.amountRaw), totalFee); sameAddress(entry.beneficiary, SPONSOR);
    }
  }
  return plan.actions;
}

export async function verifyInstance(provider, instance) {
  assert.equal(ethers.keccak256(await provider.getCode(instance.address)), instance.runtimeHash, `Runtime hash mismatch: ${instance.label}`);
  if (instance.module) {
    const c = new ethers.Contract(instance.address, ['function beneficiary() view returns(address)', 'function fee() view returns(uint96)', 'function hiddenSize() view returns(uint16)', 'function contextSize() view returns(uint16)', 'function vocabulary() view returns(uint16)', 'function spaceId() view returns(bytes32)', 'function weightsHash() view returns(bytes32)', 'function data(uint256) view returns(address)', 'function dataCodeHashes(uint256) view returns(bytes32)'], provider);
    const actual = await Promise.all([c.beneficiary(), c.fee(), c.spaceId(), c.weightsHash(), c.hiddenSize()]);
    sameAddress(actual[0], instance.module.beneficiary); assert.equal(actual[1], BigInt(instance.module.fee)); assert.equal(actual[2], instance.module.spaceId); assert.equal(actual[3], instance.module.weightsHash); assert.equal(Number(actual[4]), instance.module.hiddenSize);
    if (instance.module.contextSize != null) { assert.equal(Number(await c.contextSize()), instance.module.contextSize); assert.equal(Number(await c.vocabulary()), instance.module.vocabulary); }
    for (const [index, shard] of instance.module.shards.entries()) {
      sameAddress(await c.data(index), shard.address); assert.equal(await c.dataCodeHashes(index), shard.runtimeHash); assert.equal(ethers.keccak256(await provider.getCode(shard.address)), shard.runtimeHash, 'Weight shard bytecode mismatch');
    }
  }
  if (instance.graph) {
    const c = new ethers.Contract(instance.address, ['function paymentToken() view returns(address)', 'function backbone() view returns(address)', 'function experts(uint256) view returns(address)', 'function graphId() view returns(bytes32)', 'function totalFee() view returns(uint256)', 'function beneficiaries(uint256) view returns(address)', 'function fees(uint256) view returns(uint96)'], provider);
    sameAddress(await c.paymentToken(), PAYMENT_TOKEN); sameAddress(await c.backbone(), instance.graph.backbone); assert.equal(await c.graphId(), instance.graph.graphId); assert.equal(await c.totalFee(), BigInt(instance.graph.totalFee));
    for (let i = 0; i < 2; i++) sameAddress(await c.experts(i), instance.graph.experts[i]);
    for (let i = 0; i < 3; i++) { sameAddress(await c.beneficiaries(i), SPONSOR); assert.equal(await c.fees(i), BigInt(instance.graph.fees[i])); }
  }
  return { label: instance.label, address: instance.address, runtimeHash: instance.runtimeHash, verified: true };
}

export function createFreshCheck(plan) {
  const artifacts = productionCompile().artifacts;
  return async (provider, action) => {
    await assertChain(provider);
    const nonce = await provider.getTransactionCount(SPONSOR, 'pending');
    assert.equal(nonce, action.nonce, 'Wallet nonce changed; preserve the journal and reconcile before continuing');
    assert.equal(await provider.getTransactionCount(SPONSOR, 'latest'), action.nonce, 'Wallet has a pending transaction');
    assert.equal(ethers.keccak256(await provider.getCode(PAYMENT_TOKEN)), plan.anchor.paymentToken.runtimeHash, 'Payment token code changed');
    for (const instance of action.requiredContracts) await verifyInstance(provider, instance);
    if (action.kind === 'deploy') assert.equal(await provider.getCode(plan.transactions[action.id].predictedAddress), '0x', 'Planned deployment address already has code');
    const tx = action.transaction;
    const block = await provider.getBlock('latest');
    assertReviewedFeeBounds(tx, block?.baseFeePerGas);
    const token = new ethers.Contract(PAYMENT_TOKEN, TOKEN_ABI, provider);
    const totalFee = BigInt(plan.feePolicy.totalFeeRaw);
    if (action.kind === 'approve' || action.kind === 'infer') assert.ok(await token.balanceOf(SPONSOR) >= totalFee, 'Insufficient GH0ST for exact smoke inference');
    if (action.kind === 'infer') {
      assert.ok(BigInt(block.timestamp) <= BigInt(action.deadline), 'Paid inference quote deadline expired');
      assert.equal(await token.allowance(SPONSOR, plan.addresses.baseGraph), totalFee, 'Approval differs from exact six-GH0ST plan');
      const graph = new ethers.Contract(plan.addresses.baseGraph, artifacts.SynapseGraphV2.abi, provider);
      const fixture = modelData(plan.modelDirectory).fixtures.find(item => item.variant === 'base');
      assert.deepEqual(normalizedTrace(await graph.preview(action.inputTokens)), fixture.expected, 'Live model preview differs from reference');
    }
    if (action.kind === 'withdraw') {
      const graph = new ethers.Contract(plan.addresses.baseGraph, artifacts.SynapseGraphV2.abi, provider);
      assert.equal(await graph.credits(SPONSOR), totalFee); assert.equal(await graph.totalCredits(), totalFee); assert.equal(await token.balanceOf(plan.addresses.baseGraph), totalFee);
    }
    const estimate = await provider.estimateGas({ from: SPONSOR, ...(tx.to ? { to: tx.to } : {}), data: tx.data, value: 0n });
    assert.ok(estimate <= BigInt(tx.gas), 'Current gas estimate exceeds reviewed plan');
    assert.ok(await provider.getBalance(SPONSOR) >= BigInt(action.maxCostWei), 'Insufficient native balance for reviewed action');
    return { checkedAt: new Date().toISOString(), pendingNonce: nonce, gasEstimate: String(estimate) };
  };
}

export function publicDeployment(plan, journal) {
  const txHash = id => journal.actions.find(action => action.id === id)?.hash ?? null;
  const module = (entry, extra = {}) => ({ ...extra, address: entry.predictedAddress, spaceId: entry.module.spaceId, weightsHash: entry.module.weightsHash, codeHash: entry.expectedRuntimeHash, beneficiary: entry.module.beneficiary, fee: entry.module.fee, hiddenSize: entry.module.hiddenSize, ...(entry.module.contextSize != null ? { contextSize: entry.module.contextSize, vocabulary: entry.module.vocabulary } : {}), transactionHash: txHash(plan.transactions.indexOf(entry)) });
  return {
    schema: 'gh0st-synapse-deployment-v1', status: 'live', chainId: 4663, chainName: 'Robinhood Chain', rpcUrl: 'https://rpc.mainnet.chain.robinhood.com', explorerUrl: 'https://explorer.robinhood.com',
    token: { address: PAYMENT_TOKEN, symbol: 'GH0ST', decimals: 18 }, confirmations: 12, kernelVersion: 2,
    backbone: module(plan.transactions[0]),
    experts: [module(plan.transactions[1], { id: 'expert0', name: 'Expert 0' }), module(plan.transactions[2], { id: 'expert1', name: 'Expert 1' }), module(plan.transactions[3], { id: 'alternateExpert1', name: 'Alternate expert 1' })],
    graphs: plan.transactions.slice(4).map((entry, index) => ({ id: index === 0 ? 'base' : 'alternate', name: index === 0 ? 'Base graph' : 'Alternate graph', address: entry.predictedAddress, graphId: entry.graph.graphId, totalFee: entry.graph.totalFee, expertIds: ['expert0', index === 0 ? 'expert1' : 'alternateExpert1'], codeHash: entry.expectedRuntimeHash, transactionHash: txHash(index + 4) })),
    proofs: journal.actions.map(action => ({ action: action.id, label: action.label, transactionHash: action.hash, ...action.receipt })),
  };
}
