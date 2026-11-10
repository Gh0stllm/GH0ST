import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  ROOT, compile, deploy, ethers, expectRevert, localChain, readJson,
  receiptEvidence, saveJson, sha256, transact, versions,
} from './lib.mjs';

const receipts = [];
const checks = [];
const fixtureResults = [];
const FEE = [1n, 2n, 3n].map(amount => amount * 10n ** 18n);
const TOTAL_FEE = FEE.reduce((sum, amount) => sum + amount, 0n);
const coder = ethers.AbiCoder.defaultAbiCoder();
const TRACE_TYPE = 'tuple(int256[8] hidden,int256[8][2] expertActivations,int256[8] merged,int256[] logits,uint16 token)';

function packI16(values) {
  return '0x' + values.map(value => {
    assert.ok(Number.isSafeInteger(value) && value >= -32768 && value <= 32767, `not an i16: ${value}`);
    return ((value + 65536) % 65536).toString(16).padStart(4, '0');
  }).join('');
}

function normalizeTrace(trace) {
  return {
    hidden: Array.from(trace.hidden, Number),
    expertActivations: Array.from(trace.expertActivations, row => Array.from(row, Number)),
    merged: Array.from(trace.merged, Number),
    logits: Array.from(trace.logits, Number),
    token: Number(trace.token),
  };
}

function parsedEvents(contract, receipt, name) {
  return receipt.logs.flatMap(log => {
    if (log.address.toLowerCase() !== contract.target.toLowerCase()) return [];
    try {
      const parsed = contract.interface.parseLog(log);
      return parsed?.name === name ? [parsed.args] : [];
    } catch { return []; }
  });
}

async function accounting(graph, token, recipients, payer) {
  return {
    balance: await token.balanceOf(graph.target),
    payerBalance: await token.balanceOf(payer),
    allowance: await token.allowance(payer, graph.target),
    totalCredits: await graph.totalCredits(),
    credits: await Promise.all(recipients.map(recipient => graph.credits(recipient))),
    totalSupply: await token.totalSupply(),
  };
}

async function rejectsWithoutChange(label, graph, token, recipients, payer, action) {
  const before = await accounting(graph, token, recipients, payer);
  await expectRevert(label, action, checks);
  assert.deepEqual(await accounting(graph, token, recipients, payer), before, `${label}: state changed`);
  checks[checks.length - 1].accountingUnchanged = true;
}

function summarizeGas(rows) {
  const values = rows.map(row => Number(row.gasUsed));
  return values.length ? {
    count: values.length, min: Math.min(...values), max: Math.max(...values),
    mean: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
    total: values.reduce((sum, value) => sum + value, 0),
  } : { count: 0 };
}

async function main() {
  const pythonReference = execFileSync('python3', [join(ROOT, 'model/reference.py')], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.match(pythonReference, /^PASS:/);
  const model = readJson('model/model.json');
  const alternate = readJson('model/alternate-expert.json');
  const fixtureSet = readJson('model/fixtures.json');
  const modelManifest = readJson('model/manifest.json');
  for (const [name, expected] of Object.entries(modelManifest.files)) {
    assert.equal(sha256(readFileSync(join(ROOT, 'model', name))), expected, `${name}: manifest digest mismatch`);
  }
  assert.equal(model.scale, 256);
  assert.equal(model.contextSize, 2);
  assert.equal(model.hiddenSize, 8);
  assert.equal(model.experts.length, 2);
  assert.equal(alternate.replaceExpertIndex, 1);
  const vocabulary = model.vocab.length;
  assert.ok(vocabulary > 0 && vocabulary <= 32);
  const { artifacts, manifest } = compile();
  const chain = await localChain();
  const { provider, signers, addresses } = chain;
  const payer = signers[4];
  const recipients = addresses.slice(1, 4);
  const deployments = {};
  try {
    const token = await deploy('LocalTestToken', [], signers[0], artifacts, receipts);
    deployments.token = token.target;
    const packedBackbone = packI16([...model.embedding0, ...model.embedding1, ...model.headWeights, ...model.headBias]);
    const backbone = await deploy('SynapseBackbone', [recipients[0], FEE[0], vocabulary, packedBackbone], signers[1], artifacts, receipts);
    const spaceId = await backbone.spaceId();
    const expert0 = await deploy('SynapseExpert', [recipients[1], FEE[1], spaceId, packI16([...model.experts[0].weights, ...model.experts[0].bias])], signers[2], artifacts, receipts, 'expert0');
    const expert1 = await deploy('SynapseExpert', [recipients[2], FEE[2], spaceId, packI16([...model.experts[1].weights, ...model.experts[1].bias])], signers[3], artifacts, receipts, 'expert1');
    const alternateExpert = await deploy('SynapseExpert', [addresses[5], FEE[2], spaceId, packI16([...alternate.weights, ...alternate.bias])], signers[5], artifacts, receipts, 'alternateExpert1');
    const graph = await deploy('SynapseGraph', [token.target, backbone.target, [expert0.target, expert1.target]], signers[0], artifacts, receipts, 'baseGraph');
    const alternateGraph = await deploy('SynapseGraph', [token.target, backbone.target, [expert0.target, alternateExpert.target]], signers[0], artifacts, receipts, 'alternateGraph');
    Object.assign(deployments, {
      backbone: { address: backbone.target, deployer: addresses[1], beneficiary: recipients[0] },
      expert0: { address: expert0.target, deployer: addresses[2], beneficiary: recipients[1] },
      expert1: { address: expert1.target, deployer: addresses[3], beneficiary: recipients[2] },
      alternateExpert1: { address: alternateExpert.target, deployer: addresses[5], beneficiary: addresses[5] },
      baseGraph: graph.target, alternateGraph: alternateGraph.target,
    });
    const baseQuote = await graph.quote();
    const alternateQuote = await alternateGraph.quote();
    assert.equal(baseQuote[1], TOTAL_FEE);
    assert.equal(alternateQuote[1], TOTAL_FEE);
    assert.notEqual(baseQuote[0], alternateQuote[0], 'expert replacement must change graph ID');
    const initialPayer = 100_000n * 10n ** 18n;
    await transact('fund:payer', token.mint(addresses[4], initialPayer), receipts);
    for (const [label, selected] of [['base', graph], ['alternate', alternateGraph]]) {
      await transact(`approve:${label}`, token.connect(payer).approve(selected.target, ethers.MaxUint256), receipts);
    }
    const moduleBefore = await Promise.all([backbone, expert0, expert1, alternateExpert].map(async module => ({
      address: module.target, code: await provider.getCode(module.target),
      beneficiary: await module.beneficiary(), fee: await module.fee(), spaceId: await module.spaceId(), weightsHash: await module.weightsHash(),
    })));
    for (const fixture of fixtureSet.fixtures) {
      const selected = fixture.variant === 'alternate' ? alternateGraph : graph;
      const selectedQuote = fixture.variant === 'alternate' ? alternateQuote : baseQuote;
      const trace = normalizeTrace(await selected.preview(fixture.tokens));
      assert.deepEqual(trace, fixture.expected, `${fixture.id}: every intermediate must match Python`);
      const deadline = BigInt((await provider.getBlock('latest')).timestamp + 3600);
      assert.equal(Number(await selected.connect(payer).inferPaid.staticCall(fixture.tokens, selectedQuote[0], TOTAL_FEE, deadline)), fixture.expected.token);
      const receipt = await transact(`infer:${fixture.id}`, selected.connect(payer).inferPaid(fixture.tokens, selectedQuote[0], TOTAL_FEE, deadline), receipts);
      const events = parsedEvents(selected, receipt, 'Inference');
      assert.equal(events.length, 1);
      assert.equal(Number(events[0].token), fixture.expected.token);
      assert.equal(events[0].payer, addresses[4]);
      assert.equal(events[0].graphId, selectedQuote[0]);
      assert.equal(events[0].fee, TOTAL_FEE);
      assert.equal(events[0].inputHash, ethers.keccak256(coder.encode(['uint16[2]'], [fixture.tokens])));
      const traceHash = ethers.keccak256(coder.encode([TRACE_TYPE], [trace]));
      assert.equal(events[0].traceHash, traceHash);
      const used = parsedEvents(selected, receipt, 'ModuleUsed');
      assert.equal(used.length, 3);
      assert.deepEqual(used.map(event => event.fee), FEE);
      assert.deepEqual(used.map(event => event.module), [backbone.target, expert0.target, fixture.variant === 'alternate' ? alternateExpert.target : expert1.target]);
      assert.deepEqual(used.map(event => event.beneficiary), [recipients[0], recipients[1], fixture.variant === 'alternate' ? addresses[5] : recipients[2]]);
      const activationHashes = [
        ethers.keccak256(coder.encode(['int256[8]', 'int256[]'], [trace.hidden, trace.logits])),
        ...trace.expertActivations.map(activation => ethers.keccak256(coder.encode(['int256[8]'], [activation]))),
      ];
      assert.deepEqual(used.map(event => event.activationHash), activationHashes);
      fixtureResults.push({
        id: fixture.id, variant: fixture.variant, tokens: fixture.tokens, words: fixture.words,
        token: trace.token, word: model.vocab[trace.token], graphId: selectedQuote[0], traceHash,
        allIntermediatesMatch: true, actualTransaction: true, transactionHash: receipt.hash, gasUsed: receipt.gasUsed,
        trace,
      });
    }
    const baseCount = fixtureSet.fixtures.filter(fixture => fixture.variant === 'base').length;
    const alternateCount = fixtureSet.fixtures.length - baseCount;
    for (const [selected, count, owners] of [[graph, baseCount, recipients], [alternateGraph, alternateCount, [recipients[0], recipients[1], addresses[5]]]]) {
      assert.equal(await selected.totalCredits(), BigInt(count) * TOTAL_FEE);
      assert.equal(await token.balanceOf(selected.target), BigInt(count) * TOTAL_FEE);
      for (let index = 0; index < owners.length; index++) assert.equal(await selected.credits(owners[index]), BigInt(count) * FEE[index]);
    }
    assert.equal(await token.balanceOf(addresses[4]), initialPayer - BigInt(fixtureSet.fixtures.length) * TOTAL_FEE);
    checks.push({ label: 'all fixture transactions debit exact total fee and credit all used module beneficiaries', passed: true, baseCount, alternateCount });
    const greedyReference = JSON.parse(execFileSync('python3', ['-c', [
      'import json,sys',
      'from pathlib import Path',
      'sys.path.insert(0, str(Path(sys.argv[1]).parent))',
      'from reference import forward',
      'model=json.loads(Path(sys.argv[1]).read_text())',
      'context=[0,0]; steps=[]',
      'for i in range(8):',
      ' result=forward(model,context)',
      ' steps.append({"tokens":context.copy(),"expected":result})',
      ' context=[context[1],result["token"]]',
      'print(json.dumps(steps))',
    ].join('\n'), join(ROOT, 'model/model.json')], { cwd: ROOT, encoding: 'utf8' }));
    const greedySequence = [];
    for (const [index, step] of greedyReference.entries()) {
      const trace = normalizeTrace(await graph.preview(step.tokens));
      assert.deepEqual(trace, step.expected, `greedy step ${index}: Python/EVM mismatch`);
      const deadline = BigInt((await provider.getBlock('latest')).timestamp + 3600);
      const receipt = await transact(`infer:greedy-step-${index}`, graph.connect(payer).inferPaid(step.tokens, baseQuote[0], TOTAL_FEE, deadline), receipts);
      const [event] = parsedEvents(graph, receipt, 'Inference');
      assert.equal(Number(event.token), trace.token);
      greedySequence.push({ step: index, context: step.tokens, token: trace.token, word: model.vocab[trace.token], transactionHash: receipt.hash, gasUsed: receipt.gasUsed });
    }
    checks.push({ label: 'eight-step greedy sequence matches independently rerun Python at every intermediate and uses actual paid transactions', passed: true, steps: greedySequence.length });
    const sample = fixtureSet.fixtures.find(fixture => fixture.variant === 'base');
    const validDeadline = BigInt((await provider.getBlock('latest')).timestamp + 3600);
    await rejectsWithoutChange('maxFee below quote', graph, token, recipients, addresses[4], () => graph.connect(payer).inferPaid(sample.tokens, baseQuote[0], TOTAL_FEE - 1n, validDeadline, { gasLimit: 3_000_000 }));
    await rejectsWithoutChange('stale graph ID', graph, token, recipients, addresses[4], () => graph.connect(payer).inferPaid(sample.tokens, ethers.ZeroHash, TOTAL_FEE, validDeadline, { gasLimit: 3_000_000 }));
    await rejectsWithoutChange('expired deadline', graph, token, recipients, addresses[4], () => graph.connect(payer).inferPaid(sample.tokens, baseQuote[0], TOTAL_FEE, 1n, { gasLimit: 3_000_000 }));
    await rejectsWithoutChange('invalid token ID', graph, token, recipients, addresses[4], () => graph.connect(payer).inferPaid([vocabulary, 0], baseQuote[0], TOTAL_FEE, validDeadline, { gasLimit: 3_000_000 }));
    await transact('tax:enable', token.setTaxBps(100), receipts);
    await rejectsWithoutChange('fee-on-transfer ingress rejected atomically', graph, token, recipients, addresses[4], () => graph.connect(payer).inferPaid(sample.tokens, baseQuote[0], TOTAL_FEE, validDeadline, { gasLimit: 3_000_000 }));
    await transact('tax:disable', token.setTaxBps(0), receipts);
    // Fund the callback caller and approve its own funds, so insufficient balance
    // or allowance cannot masquerade as the graph's reentrancy protection.
    await transact('fund:token-self', token.mint(token.target, 100n * TOTAL_FEE), receipts);
    await transact('approve:token-self', token.approveSelf(graph.target, ethers.MaxUint256), receipts);
    const callback = graph.interface.encodeFunctionData('inferPaid', [sample.tokens, baseQuote[0], TOTAL_FEE, validDeadline]);
    await transact('callback:enable', token.setCallback(graph.target, callback, true), receipts);
    const creditsBeforeCallback = await graph.totalCredits();
    await transact('infer:reentry-callback', graph.connect(payer).inferPaid(sample.tokens, baseQuote[0], TOTAL_FEE, validDeadline), receipts);
    assert.equal(await token.callbackAttempted(), true);
    assert.equal(await token.callbackSucceeded(), false);
    assert.equal(await graph.totalCredits(), creditsBeforeCallback + TOTAL_FEE);
    const callbackResult = await token.callbackResult();
    const callbackError = graph.interface.parseError(callbackResult);
    assert.ok(callbackError && /reentr/i.test(callbackError.name), 'callback must fail specifically at the reentrancy guard');
    checks.push({ label: 'funded and approved token callback cannot reenter paid inference', passed: true, error: callbackError.name, revertData: callbackResult });
    await transact('callback:disable', token.setCallback(ethers.ZeroAddress, '0x', false), receipts);
    for (const [mode, behavior] of [[0, 'reverting'], [1, 'oversized-return'], [2, 'state-writing']]) {
      const hostile = await deploy('LocalHostileExpert', [addresses[6], spaceId, mode], signers[6], artifacts, receipts, `hostile:${behavior}`);
      const factory = new ethers.ContractFactory(artifacts.SynapseGraph.abi, artifacts.SynapseGraph.bytecode, signers[0]);
      await expectRevert(`foreign ${behavior} expert rejected before execution`, async () => {
        const rejected = await factory.deploy(token.target, backbone.target, [expert0.target, hostile.target], { gasLimit: 6_000_000 });
        return rejected.deploymentTransaction();
      }, checks);
      assert.equal(await hostile.calls(), 0n);
      checks[checks.length - 1].hostileCalls = 0;
      checks[checks.length - 1].scope = 'Foreign runtime rejected at graph construction; hostile body is never executed.';
    }
    // A caller can publish the exact kernel runtime without running its normal
    // constructor. Runtime identity alone must not bless an uninitialized model.
    const backboneRuntime = (await provider.getCode(backbone.target)).slice(2);
    const runtimeLength = (backboneRuntime.length / 2).toString(16).padStart(4, '0');
    const forgedInitcode = `0x61${runtimeLength}61000f60003961${runtimeLength}6000f3${backboneRuntime}`;
    const forgedReceipt = await transact('deploy:forged-uninitialized-backbone-runtime', signers[6].sendTransaction({ data: forgedInitcode, gasLimit: 6_000_000 }), receipts);
    const forgedAddress = forgedReceipt.contractAddress;
    assert.equal(await provider.getCode(forgedAddress), '0x' + backboneRuntime);
    const forged = new ethers.Contract(forgedAddress, artifacts.SynapseBackbone.abi, provider);
    assert.equal(await forged.vocabulary(), 0n);
    await expectRevert('canonical backbone runtime without valid constructor storage rejected', async () => {
      const factory = new ethers.ContractFactory(artifacts.SynapseGraph.abi, artifacts.SynapseGraph.bytecode, signers[0]);
      const rejected = await factory.deploy(token.target, forgedAddress, [expert0.target, expert1.target], { gasLimit: 6_000_000 });
      return rejected.deploymentTransaction();
    }, checks);
    checks[checks.length - 1].runtimeMatchesCanonical = true;
    checks[checks.length - 1].invalidVocabulary = 0;
    const modules = [backbone, expert0, expert1, alternateExpert];
    const moduleAfter = await Promise.all(modules.map(async module => ({
      address: module.target, code: await provider.getCode(module.target),
      beneficiary: await module.beneficiary(), fee: await module.fee(), spaceId: await module.spaceId(), weightsHash: await module.weightsHash(),
    })));
    assert.deepEqual(moduleAfter, moduleBefore);
    checks.push({ label: 'module runtime, model digests, fee, beneficiary and activation space unchanged after inference', passed: true });
    await transact('withdraw:block-token-transfer', token.setBlockedTransferRecipient(recipients[0]), receipts);
    await rejectsWithoutChange('failed withdrawal preserves all credit and balances', graph, token, recipients, addresses[4], () => graph.connect(signers[1]).withdraw({ gasLimit: 300_000 }));
    await transact('withdraw:unblock-token-transfer', token.setBlockedTransferRecipient(ethers.ZeroAddress), receipts);
    const withdrawalResults = [];
    for (const [selected, owners, ownerSigners] of [[graph, recipients, signers.slice(1, 4)], [alternateGraph, [recipients[0], recipients[1], addresses[5]], [signers[1], signers[2], signers[5]]]]) {
      for (let index = 0; index < owners.length; index++) {
        const credit = await selected.credits(owners[index]);
        const balance = await token.balanceOf(owners[index]);
        assert.equal(await selected.connect(ownerSigners[index]).withdraw.staticCall(), credit);
        const receipt = await transact(`withdraw:${selected.target}:${index}`, selected.connect(ownerSigners[index]).withdraw(), receipts);
        assert.equal(await selected.credits(owners[index]), 0n);
        assert.equal(await token.balanceOf(owners[index]), balance + credit);
        withdrawalResults.push({ graph: selected.target, beneficiary: owners[index], amount: credit, transactionHash: receipt.hash });
      }
      assert.equal(await selected.totalCredits(), 0n);
      assert.equal(await token.balanceOf(selected.target), 0n);
    }
    checks.push({ label: 'all base and alternate graph beneficiaries withdraw exact credits; no residual liability', passed: true });
    const sharedRecipient = addresses[7];
    const repeatedBackbone = await deploy('SynapseBackbone', [sharedRecipient, FEE[0], vocabulary, packedBackbone], signers[1], artifacts, receipts, 'repeated-beneficiary-backbone');
    const repeatedExpert0 = await deploy('SynapseExpert', [sharedRecipient, FEE[1], spaceId, packI16([...model.experts[0].weights, ...model.experts[0].bias])], signers[2], artifacts, receipts, 'repeated-beneficiary-expert0');
    const repeatedExpert1 = await deploy('SynapseExpert', [sharedRecipient, FEE[2], spaceId, packI16([...model.experts[1].weights, ...model.experts[1].bias])], signers[3], artifacts, receipts, 'repeated-beneficiary-expert1');
    const repeatedGraph = await deploy('SynapseGraph', [token.target, repeatedBackbone.target, [repeatedExpert0.target, repeatedExpert1.target]], signers[0], artifacts, receipts, 'repeated-beneficiary-graph');
    const repeatedQuote = await repeatedGraph.quote();
    await transact('approve:repeated-beneficiary', token.connect(payer).approve(repeatedGraph.target, TOTAL_FEE), receipts);
    await transact('infer:repeated-beneficiary', repeatedGraph.connect(payer).inferPaid(sample.tokens, repeatedQuote[0], TOTAL_FEE, validDeadline), receipts);
    assert.equal(await repeatedGraph.credits(sharedRecipient), TOTAL_FEE);
    const sharedBefore = await token.balanceOf(sharedRecipient);
    await transact('withdraw:repeated-beneficiary', repeatedGraph.connect(signers[7]).withdraw(), receipts);
    assert.equal(await token.balanceOf(sharedRecipient), sharedBefore + TOTAL_FEE);
    assert.equal(await repeatedGraph.credits(sharedRecipient), 0n);
    assert.equal(await repeatedGraph.totalCredits(), 0n);
    checks.push({ label: 'repeated beneficiary aggregates all module fees exactly once and withdraws exact total', passed: true });

    const inferenceReceipts = receipts.filter(receipt => receipt.label.startsWith('infer:'));
    const fixtureReceipts = receipts.filter(receipt => fixtureResults.some(fixture => fixture.transactionHash === receipt.transactionHash));
    const gasReport = {
      unit: 'gas (local Ganache Shanghai execution; no public network price or cost claim)',
      compile: { compiler: manifest.compiler, optimizer: manifest.settings.optimizer, viaIR: manifest.settings.viaIR, evmVersion: manifest.settings.evmVersion },
      coreDeployment: summarizeGas(receipts.filter(receipt => ['deploy:LocalTestToken', 'deploy:SynapseBackbone', 'deploy:expert0', 'deploy:expert1', 'deploy:baseGraph'].includes(receipt.label))),
      alternateCompositionDeployment: summarizeGas(receipts.filter(receipt => ['deploy:alternateExpert1', 'deploy:alternateGraph'].includes(receipt.label))),
      allTestDeployment: summarizeGas(receipts.filter(receipt => receipt.label.startsWith('deploy:'))),
      paidInferenceAll: summarizeGas(inferenceReceipts),
      paidInferenceFixtures: summarizeGas(fixtureReceipts),
      withdrawals: summarizeGas(receipts.filter(receipt => receipt.label.startsWith('withdraw:') && receipt.to !== token.target)),
      allSuccessfulTransactions: summarizeGas(receipts),
      fixtureGas: fixtureResults.map(({ id, variant, gasUsed, transactionHash }) => ({ id, variant, gasUsed, transactionHash })),
    };
    const report = {
      status: 'PASS', scope: 'Deterministic local EVM research prototype only',
      chain: { chainId: 31337, hardfork: 'shanghai', provider: 'in-memory Ganache', publicNetwork: false, fundedWalletUsed: false },
      versions, pythonReference, modelManifest, sourceHashes: manifest.sourceHashes,
      harnessHashes: Object.fromEntries(['scripts/lib.mjs', 'scripts/compile.mjs', 'scripts/test-local.mjs'].map(path => [path, sha256(readFileSync(join(ROOT, path)))])),
      authorship: 'All model components trained by the same GH0ST project; distinct local deployment accounts do not prove independent authorship.',
      architecture: { context: 2, hiddenSize: 8, experts: 2, vocabulary, scale: 256, merge: 'elementwise integer mean' },
      fees: { token: 'test-only ERC20, raw 18-decimal units', backbone: FEE[0], expert0: FEE[1], expert1: FEE[2], totalPerInference: TOTAL_FEE },
      deployments, graphIds: { base: baseQuote[0], alternate: alternateQuote[0] },
      fixtures: { count: fixtureResults.length, base: baseCount, alternate: alternateCount, everyIntermediateMatchesPython: true, everyFixturePaidTransactionMined: true },
      checks, withdrawals: withdrawalResults, greedySequence,
      limitations: [
        'This run contains no mainnet/testnet deployment, live GH0ST token transfer, funded wallet, external network RPC, or independent contributor submission.',
        'The v1 graph accepts only the exact audited-in-source module runtime. Hostile foreign kernels are rejected before execution; arbitrary EVM plugin execution is outside this prototype.',
        'Training-corpus fit and a 30-word micro-model do not establish useful language quality or generalization.',
        'The configurable test token is a harness fixture, not a production asset or token security review.',
      ],
    };
    saveJson('receipts.json', receipts);
    saveJson('fixtures-evm.json', fixtureResults);
    saveJson('gas-report.json', gasReport);
    saveJson('local-report.json', report);
    console.log(`PASS: ${fixtureResults.length} Python/EVM exact fixtures, ${checks.length} accounting/security checks, ${receipts.length} successful local transactions.`);
    console.log(`Paid fixture inference gas: ${gasReport.paidInferenceFixtures.min}–${gasReport.paidInferenceFixtures.max}; report: results/local-report.json`);
  } finally {
    await chain.close();
  }
}

main().catch(error => {
  saveJson('failure.json', { status: 'FAIL', message: error.message, stack: error.stack, receipts, checks, fixtureResults });
  console.error(error);
  process.exitCode = 1;
});
