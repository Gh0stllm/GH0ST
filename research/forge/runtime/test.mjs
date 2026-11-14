import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT, compile, constructorArgs, deploymentModelId, ethers, formatId, json, localChain,
  modelHash, normalizeTrace, packI16, save, traceType, versions,
} from './lib.mjs';

const receipts = [];
const checks = [];
const coder = ethers.AbiCoder.defaultAbiCoder();
const FEE = 10n ** 18n;
const hash = value => ethers.sha256(ethers.toUtf8Bytes(value));
const commitments = {
  featureSchemaHash: hash('fixture feature schema v1'), labelsHash: hash('fixture class labels v1'),
  datasetHash: hash('fixture training dataset v1'),
};
const specification = {
  format: 'GH0ST_FORGE_NUMERIC_MLP_Q8_V1', scale: 256, featureRange: [-256, 256],
  hiddenActivation: 'clip(truncTowardZero(dot(weights,features)/256)+bias,0,32767)',
  head: 'truncTowardZero(dot(weights,hidden)/256)+bias', tieBreak: 'lowest classId',
  packedOrder: ['hiddenWeights[H][F] output-major', 'hiddenBias[H]', 'headWeights[C][H] output-major', 'headBias[C]'],
  encoding: 'signed int16 big-endian', commitments,
};
function fixture(id, inputCount, hiddenWidth, classCount, weights, featureVectors) {
  return { id, inputCount, hiddenWidth, classCount, ...commitments, packedWeights: packI16(weights), featureVectors };
}
const models = [
  fixture('signed-truncation-and-relu', 2, 2, 2,
    [-1, 0, 1, -1, 1, 0, -257, 1, -257, -1, 0, 0],
    [[1, 0], [-256, 256], [256, -256], [0, 0], [-1, 0]]),
  fixture('lowest-index-tie', 1, 1, 4, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [[-256], [0], [256]]),
  fixture('max-width-int16-extremes', 8, 16, 4,
    Array.from({ length: 16 * 8 + 16 + 4 * 16 + 4 }, (_, i) => [32767, -32768, -1, 1, 0, 256, -256][i % 7]),
    [Array(8).fill(256), Array(8).fill(-256), Array.from({ length: 8 }, (_, i) => i % 2 ? 256 : -256), Array(8).fill(0)]),
  fixture('default-width-varied', 3, 8, 3,
    Array.from({ length: 8 * 3 + 8 + 3 * 8 + 3 }, (_, i) => ((i * 811 + 173) % 4097) - 2048),
    Array.from({ length: 32 }, (_, row) => Array.from({ length: 3 }, (_, col) => ((row * 97 + col * 131) % 513) - 256))),
];
const fixtureSet = { ...specification, models };
const python = JSON.parse(execFileSync('python3', [join(ROOT, 'tests/reference.py')], { input: json(fixtureSet), encoding: 'utf8' }));
for (const [i, model] of models.entries()) model.expected = python[i].traces;
save('runtime/fixtures.json', fixtureSet);

function evidence(label, receipt) {
  return { label, transactionHash: receipt.hash, blockNumber: receipt.blockNumber, status: receipt.status,
    contractAddress: receipt.contractAddress, gasUsed: receipt.gasUsed };
}
async function transact(label, promise) {
  const tx = await promise;
  const receipt = await tx.wait();
  assert.equal(receipt.status, 1);
  receipts.push(evidence(label, receipt));
  return receipt;
}
async function rejected(label, action) {
  let caught;
  try { const result = await action(); if (result?.wait) await result.wait(); } catch (error) { caught = error; }
  assert.ok(caught, `${label}: expected revert`);
  checks.push({ label, passed: true, rejected: true, actualTransaction: Boolean(caught.receipt),
    receipt: caught.receipt ? evidence(label, caught.receipt) : null });
}
function event(contract, receipt, name) {
  return receipt.logs.flatMap(log => {
    if (log.address.toLowerCase() !== contract.target.toLowerCase()) return [];
    try { const parsed = contract.interface.parseLog(log); return parsed?.name === name ? [parsed.args] : []; }
    catch { return []; }
  });
}

const artifacts = compile(true);
const chain = await localChain();
const { provider, eip1193, signers, addresses } = chain;
const deploy = async (name, args, signer = signers[0]) => {
  const artifact = artifacts[name];
  assert.ok(artifact.runtimeBytes <= 24_576);
  const contract = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(...args);
  const receipt = await contract.deploymentTransaction().wait();
  assert.equal(receipt.status, 1);
  receipts.push(evidence(`deploy:${name}`, receipt));
  return contract.waitForDeployment();
};
try {
  const token = await deploy('ForgeTestToken', []);
  const payer = signers[2];
  const recipient = signers[1];
  const selected = [];
  const parity = [];
  const deadline = 2_000_000_000n;
  await transact('fund payer', token.mint(addresses[2], 1000n * FEE));
  for (const model of models) {
    const contract = await deploy('ForgeModel', constructorArgs(token.target, addresses[1], FEE, model), recipient);
    selected.push(contract);
    const quote = await contract.quote();
    const actualRuntime = ethers.getBytes(await provider.getCode(contract.target));
    const expectedRuntime = ethers.getBytes(artifacts.ForgeModel.deployedBytecode);
    assert.equal(actualRuntime.length, expectedRuntime.length);
    for (const location of Object.values(artifacts.ForgeModel.immutableReferences).flat()) {
      actualRuntime.fill(0, location.start, location.start + location.length);
      expectedRuntime.fill(0, location.start, location.start + location.length);
    }
    assert.deepEqual(actualRuntime, expectedRuntime, 'runtime matches compiler artifact after masking immutable slots');
    assert.equal(quote.quotedFee, FEE);
    assert.equal(await contract.FORMAT_ID(), formatId);
    assert.equal(await contract.modelHash(), modelHash(model));
    assert.equal(await contract.modelId(), deploymentModelId(31337, contract.target, token.target, addresses[1], FEE, modelHash(model)));
    assert.equal(await contract.weightsHash(), ethers.keccak256(model.packedWeights));
    assert.equal(await contract.featureSchemaHash(), model.featureSchemaHash);
    assert.equal(await contract.labelsHash(), model.labelsHash);
    assert.equal(await contract.datasetHash(), model.datasetHash);
    const dataCode = await provider.getCode(await contract.data());
    assert.equal(dataCode, '0x00' + model.packedWeights.slice(2));
    assert.equal(await contract.dataCodeHash(), ethers.keccak256(dataCode));
    for (const [i, features] of model.featureVectors.entries()) {
      const trace = normalizeTrace(await contract.predict(features));
      assert.deepEqual(trace, model.expected[i], `${model.id} vector ${i}: Python/EVM parity`);
      parity.push({ fixture: model.id, features, trace, allIntermediatesMatch: true });
    }
    await transact(`approve ${model.id}`, token.connect(payer).approve(contract.target, 10n * FEE));
    const features = model.featureVectors[0];
    assert.equal(Number(await contract.connect(payer).inferPaid.staticCall(features, quote[0], FEE, deadline)), model.expected[0].classId);
    const receipt = await transact(`paid ${model.id}`, contract.connect(payer).inferPaid(features, quote[0], FEE, deadline));
    const [inferred] = event(contract, receipt, 'Inference');
    assert.equal(inferred.payer, addresses[2]);
    assert.equal(inferred.modelId, quote[0]);
    assert.equal(Number(inferred.classId), model.expected[0].classId);
    assert.equal(inferred.inputHash, ethers.keccak256(coder.encode(['int256[]'], [features])));
    assert.equal(inferred.traceHash, ethers.keccak256(coder.encode([traceType], [model.expected[0]])));
    assert.equal(inferred.fee, FEE);
    assert.equal(await token.balanceOf(contract.target), FEE);
    assert.equal(await contract.totalCredits(), FEE);
    assert.equal(await contract.credits(addresses[1]), FEE);
    checks.push({ label: `${model.id}: immutable commitments, STOP shard, quote, paid inference and trace event hashes`, passed: true });
  }
  checks.push({ label: `${parity.length} independent Python/EVM traces cover signed truncation, ReLU, clipping, tie breaks and maximum dimensions`, passed: true });
  assert.ok(parity.some(row => row.trace.hidden.includes(32767)), 'clipping boundary must be exercised');
  assert.ok(parity.some(row => row.trace.logits.some(value => value < 0)), 'negative logits must be exercised');

  const model = models[0];
  const contract = selected[0];
  const [id] = await contract.quote();
  const features = model.featureVectors[0];
  const snapshot = async (target = contract, beneficiary = addresses[1]) => ({
    payerBalance: await token.balanceOf(addresses[2]), balance: await token.balanceOf(target.target),
    beneficiaryBalance: await token.balanceOf(beneficiary), supply: await token.totalSupply(),
    allowance: await token.allowance(addresses[2], target.target), credits: await target.credits(beneficiary),
    totalCredits: await target.totalCredits(),
  });
  async function unchanged(label, action, target = contract, beneficiary = addresses[1]) {
    const before = await snapshot(target, beneficiary);
    await rejected(label, action);
    assert.deepEqual(await snapshot(target, beneficiary), before, `${label}: accounting changed after rollback`);
    checks.at(-1).accountingUnchanged = true;
  }
  const paid = (input, expected = id, maxFee = FEE, expiry = deadline) => contract.connect(payer)
    .inferPaid(input, expected, maxFee, expiry, { gasLimit: 2_000_000 });
  await unchanged('stale modelId rolls back', () => paid(features, ethers.ZeroHash));
  await unchanged('maxFee below quote rolls back', () => paid(features, id, FEE - 1n));
  await unchanged('expired deadline rolls back', () => paid(features, id, FEE, 1n));
  for (const [label, invalid] of [['short feature vector', [0]], ['long feature vector', [0, 0, 0]], ['low feature bound', [-257, 0]], ['high feature bound', [257, 0]], ['huge integer feature', [ethers.MaxInt256, 0]]]) {
    await unchanged(label, () => paid(invalid));
  }
  await transact('tax incoming on', token.configure(100, false, false));
  await unchanged('taxed transferFrom rolls back token burn, allowance, balances and credits', () => paid(features));
  await transact('false incoming on', token.configure(0, true, false));
  await unchanged('false-return transferFrom rolls back token movement and credits', () => paid(features));
  await transact('incoming normal', token.configure(0, false, false));
  await transact('allowance zero', token.connect(payer).approve(contract.target, 0));
  await unchanged('missing allowance rolls back', () => paid(features));
  await transact('allowance restore', token.connect(payer).approve(contract.target, 10n * FEE));
  await transact('fund callback caller', token.mint(token.target, 100n * FEE));
  await transact('approve callback caller', token.approveSelf(contract.target, ethers.MaxUint256));
  await transact('enable infer callback', token.setCallback(contract.target, contract.interface.encodeFunctionData('inferPaid', [features, id, FEE, deadline]), true));
  const beforeCallback = await snapshot();
  await transact('infer blocks funded callback reentry', paid(features));
  assert.equal(await token.callbackAttempted(), true);
  assert.equal(await token.callbackSucceeded(), false);
  assert.equal(contract.interface.parseError(await token.callbackResult()).name, 'Reentrancy');
  assert.equal(await contract.totalCredits(), beforeCallback.totalCredits + FEE);
  checks.push({ label: 'funded, approved token callback cannot reenter inferPaid', passed: true });
  await transact('disable callback', token.setCallback(ethers.ZeroAddress, '0x', false));

  await transact('tax outgoing on', token.configure(100, false, false));
  await unchanged('taxed withdrawal rolls back token burn, balances and credit clearing', () => contract.connect(recipient).withdraw({ gasLimit: 500_000 }));
  await transact('false outgoing on', token.configure(0, false, true));
  await unchanged('false-return withdrawal rolls back token movement and credit clearing', () => contract.connect(recipient).withdraw({ gasLimit: 500_000 }));
  await transact('outgoing normal', token.configure(0, false, false));
  const beforeWithdraw = await snapshot();
  assert.equal(await contract.connect(signers[3]).withdraw.staticCall(), 0n);
  await transact('uncredited caller withdraws zero', contract.connect(signers[3]).withdraw());
  const withdrawal = await transact('creator withdraws exact credits', contract.connect(recipient).withdraw());
  assert.equal(event(contract, withdrawal, 'Withdrawal')[0].amount, beforeWithdraw.credits);
  assert.equal(await contract.totalCredits(), 0n);
  assert.equal(await contract.credits(addresses[1]), 0n);
  assert.equal(await token.balanceOf(contract.target), 0n);
  assert.equal(await token.balanceOf(addresses[1]), beforeWithdraw.beneficiaryBalance + beforeWithdraw.credits);
  checks.push({ label: 'only each caller credits are withdrawable, successful withdrawal pays exact balance', passed: true });

  const callbackModel = await deploy('ForgeModel', constructorArgs(token.target, token.target, FEE, model));
  const callbackId = await callbackModel.modelId();
  await transact('approve callback-owned model', token.connect(payer).approve(callbackModel.target, FEE));
  await transact('fund callback-owned credits', callbackModel.connect(payer).inferPaid(features, callbackId, FEE, deadline));
  await transact('enable withdraw callback', token.setCallback(callbackModel.target, callbackModel.interface.encodeFunctionData('withdraw'), true));
  await transact('withdraw blocks callback reentry', token.callExternal(callbackModel.target, callbackModel.interface.encodeFunctionData('withdraw')));
  assert.equal(await token.callbackAttempted(), true);
  assert.equal(await token.callbackSucceeded(), false);
  assert.equal(callbackModel.interface.parseError(await token.callbackResult()).name, 'Reentrancy');
  assert.equal(await callbackModel.totalCredits(), 0n);
  checks.push({ label: 'outgoing token callback cannot reenter withdrawal', passed: true });
  await transact('disable withdraw callback', token.setCallback(ethers.ZeroAddress, '0x', false));

  const free = await deploy('ForgeModel', constructorArgs(token.target, addresses[1], 0n, model));
  const beforeFree = await snapshot(free);
  await transact('disable token transfer availability', token.configure(10_000, true, true));
  await transact('zero fee inference needs no approval or token transfer', free.connect(payer).inferPaid(features, await free.modelId(), 0, deadline));
  assert.deepEqual(await snapshot(free), beforeFree);
  assert.equal((await free.quote())[1], 0n);
  checks.push({ label: 'zero-fee inference makes no token call and creates no credits', passed: true });
  await transact('restore token transfers', token.configure(0, false, false));

  const dataAddress = await contract.data();
  const originalCode = await provider.getCode(dataAddress);
  await eip1193.request({ method: 'evm_setAccountCode', params: [dataAddress, '0x0001'] });
  await unchanged('tampered data bytecode rejected before charging', () => paid(features));
  await eip1193.request({ method: 'evm_setAccountCode', params: [dataAddress, originalCode] });
  assert.deepEqual(normalizeTrace(await contract.predict(features)), model.expected[0]);

  const normalArgs = constructorArgs(token.target, addresses[1], FEE, model);
  const invalidConstructors = [
    ['token has no code', 0, addresses[7]], ['zero beneficiary', 1, ethers.ZeroAddress],
    ['zero inputs', 3, 0], ['too many inputs', 3, 9], ['zero width', 4, 0], ['too wide', 4, 17],
    ['one class', 5, 1], ['too many classes', 5, 5], ['zero schema commitment', 6, ethers.ZeroHash],
    ['zero label commitment', 7, ethers.ZeroHash], ['zero dataset commitment', 8, ethers.ZeroHash],
    ['short weight bytes', 9, model.packedWeights.slice(0, -4)], ['long weight bytes', 9, model.packedWeights + '0000'],
  ];
  for (const [label, index, value] of invalidConstructors) {
    const args = [...normalArgs]; args[index] = value;
    await rejected(`constructor: ${label}`, () => new ethers.ContractFactory(artifacts.ForgeModel.abi, artifacts.ForgeModel.bytecode, signers[0]).deploy(...args));
  }
  assert.notEqual(await free.modelId(), id, 'deployment and fee change binding');
  assert.equal(await free.modelHash(), await contract.modelHash(), 'portable model hash excludes deployment economics');
  const report = {
    status: 'PASS', evidence: 'isolated local Ganache EVM transactions; no public deployment or wallet signing',
    versions, chainId: 31337, contractRuntimeBytes: artifacts.ForgeModel.runtimeBytes,
    fixtureTraces: parity.length, checks: checks.length, transactions: receipts.length,
    gas: { deploy: receipts.filter(row => row.label === 'deploy:ForgeModel').map(row => row.gasUsed),
      paid: receipts.filter(row => row.label.startsWith('paid ')).map(row => row.gasUsed) },
    parity, validations: checks, receipts,
  };
  save('runtime/test-report.json', report);
  console.log(`PASS: ${parity.length} Python/EVM parity traces; ${checks.length} checks; ${receipts.length} local transactions. Report: runtime/test-report.json`);
} finally {
  await chain.close();
}
