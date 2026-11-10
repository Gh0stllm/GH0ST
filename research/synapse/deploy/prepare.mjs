#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { CHAIN_ID, PAYMENT_TOKEN, ROOT, SPONSOR, TOKEN_ABI, assertChain, dataFeeComponent, ethers, ganache, modelData, normalizedTrace, options, privateOutput, productionCompile, providerFor, readRpc, safeError, save, unsignedEntry } from './lib.mjs';

const args = options(process.argv.slice(2));
if (args.help) {
  console.log('Read-only mainnet snapshot + local fork simulation + unsigned six-deploy plan. Never signs or broadcasts to mainnet.\nUsage: node deploy/prepare.mjs --out /absolute/private/output --env-file /absolute/.env.local --fee-cap-gwei 0.1 --model-dir candidates/domain [--simulate-smoke]\nThe optional smoke simulation uses existing GH0ST on the local fork only.');
  process.exit(0);
}
const out = privateOutput(args.out);
const provider = providerFor(readRpc(args['env-file']));
let fork;
try {
  await assertChain(provider); // First network operation must establish the chain.
  const feeCap = ethers.parseUnits(String(args['fee-cap-gwei'] ?? '0.1'), 'gwei');
  assert.ok(feeCap > 0n, 'Fee cap must be positive');
  const token = new ethers.Contract(PAYMENT_TOKEN, TOKEN_ABI, provider);
  const [block, nonceLatest, noncePending, balance, feeData, decimals, symbol, tokenBalance, tokenCode] = await Promise.all([
    provider.getBlock('latest'), provider.getTransactionCount(SPONSOR, 'latest'), provider.getTransactionCount(SPONSOR, 'pending'),
    provider.getBalance(SPONSOR), provider.getFeeData(), token.decimals(), token.symbol(), token.balanceOf(SPONSOR), provider.getCode(PAYMENT_TOKEN),
  ]);
  assert.equal(nonceLatest, noncePending, 'Wallet has pending transactions; do not predict overlapping deployment addresses');
  assert.equal(Number(decimals), 18, 'Expected canonical GH0ST decimals18');
  assert.notEqual(tokenCode, '0x', 'Missing payment token code');
  assert.ok(feeData.maxFeePerGas != null && feeData.maxPriorityFeePerGas != null, 'No EIP-1559 fee suggestion');
  assert.ok(feeData.maxFeePerGas > 0n && feeData.maxFeePerGas <= feeCap, 'Suggested fee exceeds explicit cap');
  assert.ok(feeData.maxPriorityFeePerGas >= 0n && feeData.maxPriorityFeePerGas <= feeData.maxFeePerGas);
  const fees = [1n, 2n, 3n].map(value => value * 10n ** BigInt(decimals));
  const totalFee = fees.reduce((sum, value) => sum + value, 0n);
  const snapshot = {
    observedAt: new Date().toISOString(), chainId: Number(CHAIN_ID), blockNumber: block.number, blockHash: block.hash, timestamp: block.timestamp,
    sponsor: SPONSOR, nonceLatest, noncePending, nativeBalanceWei: balance, nativeBalanceEth: ethers.formatEther(balance),
    paymentToken: { address: PAYMENT_TOKEN, symbol, decimals: Number(decimals), sponsorBalanceRaw: tokenBalance, runtimeHash: ethers.keccak256(tokenCode) },
    gasPrice: feeData.gasPrice, maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas, explicitFeeCapWei: feeCap,
  };
  save(out, 'snapshot.json', snapshot);
  const { input, artifacts, manifest } = productionCompile();
  const { model, manifest: modelManifest, packed, fixtures, kernelVersion, directory: modelDirectory } = modelData(args['model-dir'] ?? 'model');
  assert.equal(kernelVersion, 2, 'Mainnet deployment requires an explicitly selected upgraded V2 model');
  const contractNames = { backbone: 'SynapseBackboneV2', expert: 'SynapseExpertV2', graph: 'SynapseGraphV2' };
  save(out, 'build/compile-input.json', input);
  save(out, 'build/artifacts.json', artifacts);
  save(out, 'build/manifest.json', manifest);
  save(out, 'model-manifest.json', modelManifest);
  const forkProvider = { request: ({ method, params }) => provider.send(method, params ?? []) };
  fork = ganache.provider({
    logging: { quiet: true },
    fork: { provider: forkProvider, blockNumber: block.number },
    wallet: { unlockedAccounts: [SPONSOR], totalAccounts: 0 },
    chain: { chainId: Number(CHAIN_ID), hardfork: 'shanghai', time: new Date(block.timestamp * 1000) },
    miner: { blockGasLimit: 60_000_000, timestampIncrement: 1 },
  });
  const local = new ethers.BrowserProvider(fork, undefined, { cacheTimeout: -1 });
  local.pollingInterval = 10;
  await assertChain(local);
  const signer = await local.getSigner(SPONSOR);
  assert.equal(await local.getTransactionCount(SPONSOR, 'latest'), nonceLatest, 'Fork nonce mismatch');
  const names = ['backbone', 'expert0', 'expert1', 'alternateExpert1', 'baseGraph', 'alternateGraph'];
  const addresses = Object.fromEntries(names.map((name, index) => [name, ethers.getCreateAddress({ from: SPONSOR, nonce: nonceLatest + index })]));
  const contracts = {};
  const entries = [];
  const simulations = [];
  for (const [index, label] of names.entries()) {
    let contractName, constructorArgs;
    if (label === 'backbone') { contractName = contractNames.backbone; constructorArgs = [SPONSOR, fees[0], model.vocab.length, model.contextSize, model.hiddenSize, packed.backbone]; }
    else if (label.includes('Graph')) { contractName = contractNames.graph; constructorArgs = [PAYMENT_TOKEN, addresses.backbone, [addresses.expert0, label === 'baseGraph' ? addresses.expert1 : addresses.alternateExpert1]]; }
    else { contractName = contractNames.expert; constructorArgs = [SPONSOR, label === 'expert0' ? fees[1] : fees[2], await contracts.backbone.spaceId(), model.hiddenSize, packed[label]]; }
    const artifact = artifacts[contractName];
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
    const request = await factory.getDeployTransaction(...constructorArgs);
    // Dependent contracts do not yet exist on mainnet; estimate sequentially on
    // an isolated fork with the same sponsor nonce, chain and constructor state.
    assert.ok((request.data.length - 2) / 2 <= 49_152, `${label} initcode exceeds EIP-3860 size limit`);
    const estimate = await local.estimateGas({ ...request, from: SPONSOR });
    const entry = unsignedEntry({ label: `deploy:${label}`, nonce: nonceLatest + index, data: request.data, gasEstimate: estimate, l1Component: await dataFeeComponent(provider, null, request.data), maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas });
    entry.predictedAddress = addresses[label];
    entry.contractName = contractName;
    entry.constructorArgs = constructorArgs;
    const transaction = await signer.sendTransaction({ ...request, nonce: entry.nonce, gasLimit: BigInt(entry.gasLimit), maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas });
    const receipt = await transaction.wait();
    assert.equal(receipt.status, 1, `Fork deployment failed: ${label}`);
    assert.equal(receipt.contractAddress, addresses[label]);
    const contract = new ethers.Contract(addresses[label], artifact.abi, signer);
    contracts[label] = contract;
    const runtime = await local.getCode(addresses[label]);
    assert.notEqual(runtime, '0x');
    entry.expectedRuntimeHash = ethers.keccak256(runtime);
    entry.expectedRuntimeBytes = (runtime.length - 2) / 2;
    entry.expectedRuntime = runtime;
    if (!label.includes('Graph')) {
      const payload = packed[label];
      const shards = [];
      for (let offset = 0, shardIndex = 0; offset < (payload.length - 2) / 2; offset += 24000, shardIndex++) {
        const dataAddress = await contract.data(shardIndex);
        const dataCode = await local.getCode(dataAddress);
        assert.ok((dataCode.length - 2) / 2 <= 24_576, 'Weight shard exceeds EIP-170');
        assert.equal(dataCode, '0x00' + payload.slice(2 + offset * 2, 2 + Math.min(offset + 24000, (payload.length - 2) / 2) * 2));
        assert.equal(dataAddress, ethers.getCreateAddress({ from: addresses[label], nonce: 1 + shardIndex }));
        shards.push({ address: dataAddress, runtimeHash: ethers.keccak256(dataCode), runtimeBytes: (dataCode.length - 2) / 2 });
      }
      entry.module = { beneficiary: await contract.beneficiary(), fee: await contract.fee(), weightsHash: await contract.weightsHash(), spaceId: await contract.spaceId(), hiddenSize: Number(await contract.hiddenSize()), ...(label === 'backbone' ? { contextSize: Number(await contract.contextSize()), vocabulary: Number(await contract.vocabulary()) } : {}), shards };
      assert.equal(entry.module.weightsHash, ethers.keccak256(payload));
    } else {
      entry.graph = { graphId: await contract.graphId(), totalFee: await contract.totalFee(), backbone: await contract.backbone(), experts: [await contract.experts(0), await contract.experts(1)], beneficiaries: [await contract.beneficiaries(0), await contract.beneficiaries(1), await contract.beneficiaries(2)], fees: [await contract.fees(0), await contract.fees(1), await contract.fees(2)] };
      assert.equal(entry.graph.totalFee, totalFee);
      assert.deepEqual(entry.graph.beneficiaries, [SPONSOR, SPONSOR, SPONSOR]);
    }
    simulations.push({ label: entry.label, forkOnly: true, gasUsed: receipt.gasUsed, gasEstimate: estimate, predictedAddress: receipt.contractAddress });
    entries.push(entry);
  }
  const fixtureResults = [];
  for (const fixture of fixtures) {
    const graph = fixture.variant === 'alternate' ? contracts.alternateGraph : contracts.baseGraph;
    const trace = normalizedTrace(await graph.preview(fixture.tokens));
    assert.deepEqual(trace, fixture.expected, `Fork fixture mismatch: ${fixture.id}`);
    fixtureResults.push({ id: fixture.id, variant: fixture.variant, tokens: fixture.tokens, token: trace.token, word: model.vocab[trace.token], allIntermediatesMatch: true });
  }
  const optional = [];
  if (args['simulate-smoke']) {
    assert.ok(tokenBalance >= totalFee, 'Sponsor lacks exact GH0ST for optional smoke');
    const localToken = new ethers.Contract(PAYMENT_TOKEN, TOKEN_ABI, signer);
    const graph = contracts.baseGraph;
    const graphId = await graph.graphId();
    const fixture = fixtures.find(item => item.variant === 'base');
    const deadline = BigInt(block.timestamp + 86400);
    const approveData = localToken.interface.encodeFunctionData('approve', [addresses.baseGraph, totalFee]);
    const approveEstimate = await local.estimateGas({ from: SPONSOR, to: PAYMENT_TOKEN, data: approveData });
    const approve = unsignedEntry({ label: 'optional:approve-exact-six-GH0ST', nonce: nonceLatest + 6, to: PAYMENT_TOKEN, data: approveData, gasEstimate: approveEstimate, l1Component: await dataFeeComponent(provider, PAYMENT_TOKEN, approveData), maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas });
    const approveReceipt = await (await signer.sendTransaction({ to: PAYMENT_TOKEN, data: approveData, gasLimit: BigInt(approve.gasLimit), nonce: approve.nonce, maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas })).wait();
    assert.equal(approveReceipt.status, 1);
    const inferData = graph.interface.encodeFunctionData('inferPaid', [fixture.tokens, graphId, totalFee, deadline]);
    const inferEstimate = await local.estimateGas({ from: SPONSOR, to: addresses.baseGraph, data: inferData });
    const infer = unsignedEntry({ label: 'optional:one-paid-inference', nonce: nonceLatest + 7, to: addresses.baseGraph, data: inferData, gasEstimate: inferEstimate, l1Component: await dataFeeComponent(provider, addresses.baseGraph, inferData), maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas });
    const before = await localToken.balanceOf(SPONSOR);
    const inferReceipt = await (await signer.sendTransaction({ to: addresses.baseGraph, data: inferData, gasLimit: BigInt(infer.gasLimit), nonce: infer.nonce, maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas })).wait();
    assert.equal(inferReceipt.status, 1);
    assert.equal(before - await localToken.balanceOf(SPONSOR), totalFee);
    assert.equal(await localToken.balanceOf(addresses.baseGraph), totalFee);
    assert.equal(await graph.credits(SPONSOR), totalFee);
    assert.equal(await graph.totalCredits(), totalFee);
    assert.equal(await localToken.allowance(SPONSOR, addresses.baseGraph), 0n);
    const events = inferReceipt.logs.flatMap(log => { try { const parsed = graph.interface.parseLog(log); return parsed?.name === 'Inference' ? [parsed] : []; } catch { return []; } });
    assert.equal(events.length, 1); assert.equal(Number(events[0].args.token), fixture.expected.token);
    const withdrawalData = graph.interface.encodeFunctionData('withdraw', []);
    const withdrawalEstimate = await local.estimateGas({ from: SPONSOR, to: addresses.baseGraph, data: withdrawalData });
    const withdraw = unsignedEntry({ label: 'optional:withdraw-exact-six-GH0ST-to-sponsor', nonce: nonceLatest + 8, to: addresses.baseGraph, data: withdrawalData, gasEstimate: withdrawalEstimate, l1Component: await dataFeeComponent(provider, addresses.baseGraph, withdrawalData), maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas });
    const withdrawalReceipt = await (await signer.sendTransaction({ to: addresses.baseGraph, data: withdrawalData, gasLimit: BigInt(withdraw.gasLimit), nonce: withdraw.nonce, maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas })).wait();
    assert.equal(withdrawalReceipt.status, 1);
    assert.equal(await localToken.balanceOf(SPONSOR), before);
    assert.equal(await localToken.balanceOf(addresses.baseGraph), 0n);
    assert.equal(await graph.credits(SPONSOR), 0n);
    assert.equal(await graph.totalCredits(), 0n);
    optional.push(approve, { ...infer, inputTokens: fixture.tokens, expectedOutputToken: fixture.expected.token, expectedOutputWord: model.vocab[fixture.expected.token], deadline: String(deadline), feeRaw: String(totalFee), sponsorCreditRaw: String(totalFee) }, { ...withdraw, amountRaw: String(totalFee), beneficiary: SPONSOR });
    simulations.push({ label: 'optional:approve', forkOnly: true, gasUsed: approveReceipt.gasUsed }, { label: 'optional:inferPaid', forkOnly: true, gasUsed: inferReceipt.gasUsed, token: fixture.expected.token, exactAccountingVerified: true }, { label: 'optional:withdraw', forkOnly: true, gasUsed: withdrawalReceipt.gasUsed, exactAccountingVerified: true });
  }
  // Catch wallet activity while the plan was built. A changed nonce invalidates
  // all predicted CREATE addresses, graph IDs and graph immutable runtime hashes.
  assert.equal(await provider.getTransactionCount(SPONSOR, 'pending'), nonceLatest, 'Wallet nonce changed during preparation');
  const sum = values => values.reduce((total, item) => total + BigInt(item), 0n);
  const maxExecutionCostWei = sum(entries.map(entry => entry.maxExecutionCostWei));
  const optionalMaxExecutionCostWei = sum(optional.map(entry => entry.maxExecutionCostWei));
  assert.ok(balance >= maxExecutionCostWei + optionalMaxExecutionCostWei, 'Insufficient native balance for padded execution costs');
  const plan = {
    schema: 'gh0st-synapse-unsigned-plan-v1', broadcast: false, owner: SPONSOR, mode: 'REVIEW_ONLY_UNSIGNED_NO_MAINNET_BROADCAST', createdAt: new Date().toISOString(),
    chainId: Number(CHAIN_ID), sponsor: SPONSOR, paymentToken: PAYMENT_TOKEN, anchor: snapshot,
    sourceInputSha256: manifest.inputSha256, sourceHashes: manifest.sourceHashes, modelManifest, modelDirectory, kernelVersion, contractNames,
    nonceStart: nonceLatest, nonceEndExclusive: nonceLatest + 6, addresses,
    feePolicy: { moduleFeesRaw: fees, totalFeeRaw: totalFee, beneficiaries: [SPONSOR, SPONSOR, SPONSOR], explanation: 'Same-project initial research demo; all module credits accrue to the sponsor. Optional smoke withdraws only the exact self-funded sponsor six-GH0ST credit.' },
    estimates: { source: 'sequential-isolated-mainnet-fork', gasPaddingPercent: 25, gasEstimateTotal: sum(entries.map(entry => entry.gasEstimate)), gasLimitTotal: sum(entries.map(entry => entry.gasLimit)), maxExecutionCostWei, maxExecutionCostEth: ethers.formatEther(maxExecutionCostWei), optionalMaxExecutionCostWei, l1DataFeeIncluded: true, dataGasEstimateTotal: sum([...entries, ...optional].map(entry => entry.l1Component.gasEstimateForL1)), dataFeeEstimateWei: sum([...entries, ...optional].map(entry => entry.l1Component.dataFeeEstimateWei)), limitation: 'Gas bounds include the live Nitro NodeInterface parent-chain component estimate. Fee/nonce/source checks must be repeated immediately before signing.' },
    transactions: entries, optionalSmokeTransactions: optional, fixtureResults,
    evidenceBoundary: 'Fork-only execution and unsigned mainnet requests. No mainnet transaction was signed or broadcast by this tool.',
  };
  const allEntries = [...entries, ...optional];
  plan.actions = allEntries.map((entry, index) => ({
    id: index, kind: index < 6 ? 'deploy' : index === 6 ? 'approve' : index === 7 ? 'infer' : 'withdraw', label: entry.label,
    transaction: entry.walletRequest.params[0], unsignedHash: entry.unsignedHash, unsignedSerialized: entry.unsignedSerialized,
    destination: entry.to ?? `New contract: ${entry.predictedAddress}`, nonce: entry.nonce,
    maxCostWei: entry.maxExecutionCostWei, maxCostEth: ethers.formatEther(BigInt(entry.maxExecutionCostWei)),
    requiredContracts: entries.slice(0, Math.min(index, 6)).map(instance => ({ label: instance.label.slice(7), address: instance.predictedAddress, runtimeHash: instance.expectedRuntimeHash, module: instance.module ?? null, graph: instance.graph ?? null })),
    ...(index === 7 ? { inputTokens: entry.inputTokens, deadline: entry.deadline, feeRaw: entry.feeRaw, expectedOutputToken: entry.expectedOutputToken } : {}),
  }));
  plan.nonceEndExclusive = nonceLatest + allEntries.length;
  save(out, 'plan.json', plan);
  save(out, 'fork-simulation.json', { anchor: snapshot, simulations, fixtureResults, mainnetBroadcasts: 0 });
  console.log(JSON.stringify({ mode: plan.mode, out, nonceStart: nonceLatest, nonceEndExclusive: plan.nonceEndExclusive, addresses, fixturesMatched: fixtureResults.length, gasEstimateTotal: String(plan.estimates.gasEstimateTotal), maxExecutionCostWei: String(maxExecutionCostWei), maxExecutionCostEth: ethers.formatEther(maxExecutionCostWei), optionalSmokeTransactions: optional.length }, null, 2));
} catch (error) {
  console.error(JSON.stringify(safeError(error)));
  process.exitCode = 1;
} finally {
  if (fork) await fork.disconnect();
  provider.destroy();
}
