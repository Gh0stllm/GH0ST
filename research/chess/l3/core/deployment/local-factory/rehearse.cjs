#!/usr/bin/env node
'use strict';

// This file deliberately has no RPC URL, private-key, .env, or command-line input.
// All signed transactions go to the in-process Ganache provider created below.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { gunzipSync } = require('node:zlib');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');

const HERE = __dirname;
const REPO = path.resolve(HERE, '../../../../../..');
const localRequire = createRequire(path.resolve(REPO, '../bridge/package.json'));
const ethers = localRequire('ethers');
const ganache = localRequire('ganache');
const solc = localRequire('solc');
const PIN = '4341b132cfbdcc980ead03765ca5224ff6cb5d97';
const CACHE = path.resolve(REPO, 'research/chess/l3/nitro/.cache/contracts-provenance');
const SOURCE = path.join(CACHE, 'git', `nitro-contracts-${PIN}`);
const MAIN = path.join(CACHE, 'compiled-main/build/contracts');
const SAFE = path.join(CACHE, 'deps/@safe-global__safe-smart-account/package/build/artifacts');
const ZERO = ethers.ZeroAddress;
const ZERO32 = ethers.ZeroHash;
const CANONICAL_CREATE2 = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const ARBSYS = '0x0000000000000000000000000000000000000064';
const MAX_DATA_SIZE = 104857;
const TX_GAS_CAP = 16777216n;
const ASSUMED_PARENT_GAS_PRICE = 20000000n;
const MACHINE_ROOT = '0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const relative = file => path.relative(REPO, file);
const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
const evidenceFile = path.join(HERE, 'evidence.json');
const report = {
  schema: 'gh0st.core.local-factory-rehearsal.v1',
  status: 'RUNNING_LOCAL_ONLY',
  recordedAt: new Date().toISOString(),
  scope: 'Actual pinned Nitro contracts deployed only in an ephemeral in-process synthetic EVM. This is not an RH fork, public RH deployment, running Nitro child chain, fraud-proof replay, or production gas estimate.',
  safety: {
    externalRpcConnections: 0, externalWalletsRead: 0, realEthSpent: '0', realIcpSpent: '0',
    environmentFilesRead: false, privateKeysPersisted: false, serverOrders: 0,
    chainProvider: 'ganache.provider() in-process EIP-1193 object; no listening socket, no fork configuration',
    wallet: 'Ganache randomly generated ephemeral unlocked accounts; fake ETH only',
    publicTransactionsBroadcast: 0, licenseAccepted: false,
  },
  provenance: { nitroContractsCommit: PIN, machineRoot: MACHINE_ROOT, machineRootPurpose: 'Official standard Nitro machine root supplied by the core image provenance; no experimental LLM machine root' },
  syntheticParent: { chainId: 4663, name: 'Synthetic local parent, not Robinhood', hardfork: 'shanghai', blockGasLimit: 30000000, transactionGasLimitCap: TX_GAS_CAP.toString(), maxRuntimeCodeBytes: 24576, maxInitcodeBytes: 49152, unlimitedContractSize: false, unlimitedInitcodeSize: false },
  fixtures: [], transactions: [], contracts: [], checks: [],
  deploymentSettings: { parentLayer: 2, maxDataSize: MAX_DATA_SIZE, reader4844: ZERO, create2Salt: ZERO32, contractVerificationServiceUsed: false, deployRollupProxyForExplorerVerification: false },
  limitations: [
    'Ganache Shanghai gas schedules and a synthetic ArbSys fixture are not Robinhood Nitro execution, fee accounting, precompiles, gas limits, transaction compression, or data-availability semantics.',
    'Child createRollup registers and initializes contracts only. No child node is booted and no genesis-state or fraud-proof claim follows.',
    'Child L2 keyless factories are intentionally not deployed: deployFactoriesToL2=false, so retryable execution is outside this rehearsal.',
    'A locally compiled mock token and mock unit-rate pricer are not GH0ST, a market price, a canonical token registration, or a bridge.',
  ],
};

function recordCheck(name, condition, observed) {
  report.checks.push({ name, passed: !!condition, observed });
  assert.ok(condition, name);
}

function findFile(root, name) {
  const matches = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name === `${name}.json`) matches.push(file);
    }
  }
  walk(root);
  assert.equal(matches.length, 1, `Exactly one artifact for ${name}`);
  return matches[0];
}

const compilationFile = path.join(REPO, 'research/chess/l3/nitro/evidence/contract-source-compilation.json');
const compilation = JSON.parse(fs.readFileSync(compilationFile));
assert.equal(compilation.main.sourceCommit, PIN);
report.provenance.compilationEvidence = { path: relative(compilationFile), sha256: sha256(fs.readFileSync(compilationFile)) };
report.provenance.rehearsalScript = { path: relative(__filename), sha256: sha256(fs.readFileSync(__filename)) };
report.provenance.localDependencies = { node: process.version, ethers: ethers.version, ganache: localRequire('ganache/package.json').version, solc: solc.version(), installedByThisScript: false };
report.provenance.upstreamDeployment = ['scripts/deployment.ts', 'scripts/deploymentUtils.ts', 'scripts/config.example.ts', 'scripts/rollupCreation.ts', 'src/rollup/DeployHelper.sol'].map(file => ({ path: relative(path.join(SOURCE, file)), sha256: sha256(fs.readFileSync(path.join(SOURCE, file))) }));

function artifact(name, kind = 'main') {
  const file = findFile(kind === 'safe' ? SAFE : MAIN, name);
  const data = fs.readFileSync(file);
  const value = JSON.parse(data);
  const artifacts = compilation[kind].artifacts;
  const match = kind === 'main'
    ? artifacts.find(item => item.path === path.relative(MAIN, file))
    : artifacts.find(item => item.name === name && item.source === value.sourceName);
  assert.ok(match, `Artifact ${name} covered by prior exact-source compilation evidence`);
  assert.equal(sha256(data), match.sha256 || match.artifactSha256, `Artifact ${name} hash`);
  assert.ok(value.bytecode.length > 2, `Artifact ${name} has genuine creation bytecode`);
  assert.ok(!value.bytecode.includes('__'), `Artifact ${name} has no unlinked libraries`);
  assert.ok(ethers.dataLength(value.deployedBytecode) <= 24576, `${name} EIP-170 runtime length`);
  return { ...value, evidence: { path: relative(file), sha256: sha256(data), source: value.sourceName, contract: value.contractName } };
}

// A Solidity fixture, never a replacement for any deployed Nitro contract.
const fixturesSource = `// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;
contract SyntheticArbSys {
    function arbOSVersion() external pure returns (uint256) { return 116; }
    function arbBlockNumber() external view returns (uint256) { return block.number; }
}
contract SyntheticArbGasInfo {
    function getL1BaseFeeEstimate() external pure returns (uint256) { return 0; }
}
contract LocalUnitRatePricer {
    function getExchangeRate() external pure returns (uint256) { return 1e18; }
}`;

function compileFixtures() {
  const input = { language: 'Solidity', sources: { 'LocalFixtures.sol': { content: fixturesSource } }, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode'] } } } };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter(item => item.severity === 'error');
  assert.deepEqual(errors, []);
  report.provenance.fixtureCompiler = { version: solc.version(), evmVersion: 'shanghai', sourceSha256: sha256(fixturesSource) };
  fs.writeFileSync(path.join(HERE, 'LocalFixtures.sol'), fixturesSource + '\n');
  return Object.fromEntries(Object.entries(output.contracts['LocalFixtures.sol']).map(([name, result]) => [name, { contractName: name, abi: result.abi, bytecode: `0x${result.evm.bytecode.object}`, deployedBytecode: `0x${result.evm.deployedBytecode.object}`, evidence: { source: 'LocalFixtures.sol', sourceSha256: sha256(fixturesSource), contract: name } }]));
}

let localProvider;
let provider;
let signer;
const deployed = {};
async function send(tx, label, category) {
  const estimatedGas = await signer.estimateGas(tx);
  const gasLimit = estimatedGas + estimatedGas / 10n + 10000n;
  assert.ok(gasLimit <= TX_GAS_CAP, `${label} transaction gas cap`);
  const result = await signer.sendTransaction({ ...tx, gasLimit });
  const receipt = await result.wait();
  assert.equal(receipt.status, 1, `${label} transaction receipt`);
  assert.ok(receipt.gasUsed <= TX_GAS_CAP);
  report.transactions.push({ label, category, hash: receipt.hash, blockNumber: receipt.blockNumber, estimatedGas, gasLimit, gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.gasPrice, syntheticEthFee: ethers.formatEther(receipt.gasUsed * receipt.gasPrice), dataBytes: ethers.dataLength(tx.data || '0x'), status: receipt.status });
  return receipt;
}

async function verifyCode(label, address, a, category, args) {
  const code = await provider.getCode(address);
  recordCheck(`${label} runtime code exists and fits EIP-170`, code !== '0x' && ethers.dataLength(code) <= 24576, { codeBytes: ethers.dataLength(code) });
  assert.equal(ethers.dataLength(code), ethers.dataLength(a.deployedBytecode), `${label} runtime byte length matches artifact`);
  const exact = code.toLowerCase() === a.deployedBytecode.toLowerCase();
  // Immutable-bearing runtime differs from the artifact's zero placeholders.
  // Preserve an honest distinction; no masked-bytecode equivalence is claimed.
  recordCheck(`${label} Solidity metadata matches compiled artifact`, code.slice(-86) === a.deployedBytecode.slice(-86), { exactRuntimeMatchesArtifact: exact });
  report.contracts.push({ label, category, address, artifact: a.evidence, constructorArgs: args, creationBytecodeKeccak256: ethers.keccak256(a.bytecode), runtimeBytecodeKeccak256: ethers.keccak256(code), runtimeBytes: ethers.dataLength(code), exactRuntimeMatchesArtifact: exact, runtimeVerification: exact ? 'byte-for-byte equal to pinned artifact' : 'CREATE2 address binds exact pinned artifact creation input; runtime length/metadata and public immutable getters checked, runtime hash recorded; no byte-for-byte immutable normalization claim' });
}

async function deploy(label, name, args = [], options = {}) {
  const category = options.category || 'upstream-core-factory';
  const a = options.fixture || artifact(name, options.kind);
  const fac = new ethers.ContractFactory(a.abi, a.bytecode, signer);
  const init = (await fac.getDeployTransaction(...args)).data;
  assert.ok(ethers.dataLength(init) <= 49152, `${label} EIP-3860 initcode length`);
  let address;
  if (options.create2 === false) {
    const nonce = await signer.getNonce();
    address = ethers.getCreateAddress({ from: await signer.getAddress(), nonce });
    await send({ data: init }, label, category);
  } else {
    address = ethers.getCreate2Address(CANONICAL_CREATE2, ZERO32, ethers.keccak256(init));
    assert.equal(await provider.getCode(address), '0x', `${label} starts undeployed`);
    await send({ to: CANONICAL_CREATE2, data: ethers.concat([ZERO32, init]) }, label, category);
  }
  await verifyCode(label, address, a, category, args);
  report.contracts.at(-1).initcodeBytesIncludingConstructorArgs = ethers.dataLength(init);
  const contract = new ethers.Contract(address, a.abi, signer);
  deployed[label] = contract;
  return contract;
}

async function bootstrapCreate2() {
  const source = fs.readFileSync(path.join(SOURCE, 'src/rollup/DeployHelper.sol'), 'utf8');
  const payload = source.match(/NICK_CREATE2_PAYLOAD\s*=\s*hex"([0-9a-f]+)"/)[1];
  assert.equal(payload.slice(0, 2), '04');
  const rawTransaction = `0x${payload.slice(2)}`;
  const parsed = ethers.Transaction.from(rawTransaction);
  const expected = ethers.getCreateAddress({ from: parsed.from, nonce: parsed.nonce });
  assert.equal(expected.toLowerCase(), CANONICAL_CREATE2.toLowerCase());
  assert.equal(parsed.from.toLowerCase(), '0x3fab184622dc19b6109349b94811493bf2a45362');
  assert.ok(parsed.gasLimit <= TX_GAS_CAP);
  await send({ to: parsed.from, value: ethers.parseEther('0.01') }, 'Fund keyless canonical CREATE2 deployer (fake ETH)', 'local-bootstrap');
  const response = await provider.broadcastTransaction(rawTransaction);
  const receipt = await response.wait();
  assert.equal(receipt.status, 1);
  const runtime = await provider.getCode(CANONICAL_CREATE2);
  // The pinned payload's creation code copies its last 69 bytes to runtime.
  assert.equal(runtime.toLowerCase(), `0x${parsed.data.slice(-138)}`.toLowerCase());
  report.transactions.push({ label: 'Canonical CREATE2 factory from exact upstream keyless signed payload', category: 'local-bootstrap', hash: receipt.hash, blockNumber: receipt.blockNumber, gasLimit: parsed.gasLimit, gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.gasPrice, syntheticEthFee: ethers.formatEther(receipt.gasUsed * receipt.gasPrice), dataBytes: ethers.dataLength(parsed.data), status: receipt.status });
  report.fixtures.push({ name: 'canonical CREATE2 prerequisite', address: CANONICAL_CREATE2, source: 'Exact signed NICK_CREATE2_PAYLOAD from pinned DeployHelper.sol, stripped only of its 0x04 Nitro message-kind prefix', rawTransactionSha256: sha256(rawTransaction), runtimeBytecodeKeccak256: ethers.keccak256(runtime), runtimeBytes: ethers.dataLength(runtime), fundedWithFakeEth: '0.01' });
}

async function deployUpstreamCore(owner) {
  const d = async (label, name, args) => deploy(label, name, args);
  // Exact deployAllContracts ordering, with its Arbitrum-parent branch selected.
  // verify=false upstream skips its throwaway RollupProxy explorer-verification deployment.
  const eth = [];
  eth.push(await d('ethBridge', 'Bridge'));
  eth.push(await d('ethSequencerInbox', 'SequencerInbox', [MAX_DATA_SIZE, ZERO, false, false]));
  eth.push(await d('ethSequencerInboxDelayBufferable', 'SequencerInbox', [MAX_DATA_SIZE, ZERO, false, true]));
  eth.push(await d('ethInbox', 'Inbox', [MAX_DATA_SIZE]));
  eth.push(await d('ethRollupEventInbox', 'RollupEventInbox'));
  eth.push(await d('ethOutbox', 'Outbox'));
  const erc20 = [];
  erc20.push(await d('erc20Bridge', 'ERC20Bridge'));
  erc20.push(await d('erc20SequencerInbox', 'SequencerInbox', [MAX_DATA_SIZE, ZERO, true, false]));
  erc20.push(await d('erc20SequencerInboxDelayBufferable', 'SequencerInbox', [MAX_DATA_SIZE, ZERO, true, true]));
  erc20.push(await d('erc20Inbox', 'ERC20Inbox', [MAX_DATA_SIZE]));
  erc20.push(await d('erc20RollupEventInbox', 'ERC20RollupEventInbox'));
  erc20.push(await d('erc20Outbox', 'ERC20Outbox'));
  const addresses = list => list.map(c => c.target);
  const bridgeCreator = await d('bridgeCreator', 'BridgeCreator', [addresses(eth), addresses(erc20)]);
  const prover0 = await d('prover0', 'OneStepProver0');
  const proverMem = await d('proverMem', 'OneStepProverMemory');
  const proverMath = await d('proverMath', 'OneStepProverMath');
  const proverHostIo = await d('proverHostIo', 'OneStepProverHostIo', [ZERO]);
  const osp = await d('osp', 'OneStepProofEntry', addresses([prover0, proverMem, proverMath, proverHostIo]));
  const challengeManager = await d('challengeManager', 'EdgeChallengeManager');
  const rollupAdmin = await d('rollupAdmin', 'RollupAdminLogic');
  const rollupUser = await d('rollupUser', 'RollupUserLogic');
  // DeploymentUtils imports this separately packaged upstream artifact.
  const upgradeFile = path.join(CACHE, 'deps/@offchainlabs__upgrade-executor/package/build/contracts/src/UpgradeExecutor.sol/UpgradeExecutor.json');
  const upgradePackageRecord = compilation.npmDependencyArchives.find(item => item.package === '@offchainlabs/upgrade-executor');
  const upgradeArchive = fs.readFileSync(path.join(CACHE, 'deps/@offchainlabs__upgrade-executor/package.tgz'));
  assert.equal(sha256(upgradeArchive), upgradePackageRecord.tarballSha256);
  assert.equal(`sha512-${crypto.createHash('sha512').update(upgradeArchive).digest('base64')}`, upgradePackageRecord.integrity);
  const tar = gunzipSync(upgradeArchive);
  let upgradeArchiveArtifact;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = tar.subarray(offset, offset + 100).toString().replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(tar.subarray(offset + 124, offset + 136).toString().replace(/\0.*$/, '').trim(), 8);
    if (name === 'package/build/contracts/src/UpgradeExecutor.sol/UpgradeExecutor.json') upgradeArchiveArtifact = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(upgradeArchiveArtifact, 'UpgradeExecutor artifact present in verified archive');
  assert.deepEqual(fs.readFileSync(upgradeFile), upgradeArchiveArtifact);
  report.provenance.upgradeExecutorPackage = { ...upgradePackageRecord, archiveHashReverified: true, artifactBytesMatchVerifiedArchive: true };
  const upgradeArtifact = JSON.parse(fs.readFileSync(upgradeFile));
  const upgradeExecutor = await deploy('upgradeExecutor', 'UpgradeExecutor', [], { fixture: { ...upgradeArtifact, evidence: { path: relative(upgradeFile), sha256: sha256(fs.readFileSync(upgradeFile)), source: upgradeArtifact.sourceName, provenance: 'Pinned upgrade-executor package SHA512-verified in contract-source-compilation.json' } } });
  const validatorWalletCreator = await d('validatorWalletCreator', 'ValidatorWalletCreator');
  const deployHelper = await d('deployHelper', 'DeployHelper');
  const creator = await d('rollupCreator', 'RollupCreator', [owner, ...addresses([bridgeCreator, osp, challengeManager, rollupAdmin, rollupUser, upgradeExecutor, validatorWalletCreator, deployHelper])]);
  recordCheck('RollupCreator factory owner initialized', (await creator.owner()) === owner, await creator.owner());
  for (const [getter, contract] of Object.entries({ bridgeCreator, osp, challengeManagerTemplate: challengeManager, rollupAdminLogic: rollupAdmin, rollupUserLogic: rollupUser, upgradeExecutorLogic: upgradeExecutor, validatorWalletCreator, l2FactoriesDeployer: deployHelper })) {
    recordCheck(`RollupCreator.${getter} initialized`, await creator[getter]() === contract.target, contract.target);
  }
  for (const [kind, templates] of [['ethBasedTemplates', eth], ['erc20BasedTemplates', erc20]]) {
    recordCheck(`BridgeCreator.${kind} initialized`, JSON.stringify([...(await bridgeCreator[kind]())]) === JSON.stringify(addresses(templates)), addresses(templates));
  }
  for (const label of ['ethSequencerInbox', 'ethSequencerInboxDelayBufferable', 'erc20SequencerInbox', 'erc20SequencerInboxDelayBufferable', 'ethInbox', 'erc20Inbox']) {
    recordCheck(`${label}.maxDataSize`, await deployed[label].maxDataSize() === BigInt(MAX_DATA_SIZE), MAX_DATA_SIZE);
  }
  for (const [label, fee, delay] of [['ethSequencerInbox', false, false], ['ethSequencerInboxDelayBufferable', false, true], ['erc20SequencerInbox', true, false], ['erc20SequencerInboxDelayBufferable', true, true]]) {
    recordCheck(`${label} immutable constructor flags`, await deployed[label].isUsingFeeToken() === fee && await deployed[label].isDelayBufferable() === delay && await deployed[label].reader4844() === ZERO, { isUsingFeeToken: fee, isDelayBufferable: delay, reader4844: ZERO });
  }
  for (const [getter, contract] of Object.entries({ prover0, proverMem, proverMath, proverHostIo })) recordCheck(`OneStepProofEntry.${getter} initialized`, await osp[getter]() === contract.target, contract.target);
  recordCheck('Standard OneStepProverHostIo customDAValidator is zero', await proverHostIo.customDAValidator() === ZERO, ZERO);
  return creator;
}

async function createMockTokenRollup(creator, accounts, fixtures) {
  const [owner, validator, poster, posterManager, escrow] = accounts;
  const token = await deploy('GH0ST_LOCAL_MOCK_NOT_REAL_GH', 'TestWETH9', ['GH0ST LOCAL MOCK NOT REAL GH', 'GHMOCK'], { category: 'local-child-fixtures', create2: false });
  const pricer = await deploy('LOCAL_UNIT_RATE_PRICER_NOT_MARKET_DATA', 'LocalUnitRatePricer', [], { category: 'local-child-fixtures', create2: false, fixture: fixtures.LocalUnitRatePricer });
  const chainConfig = { chainId: 466300061, homesteadBlock: 0, daoForkBlock: null, daoForkSupport: true, eip150Block: 0, eip150Hash: ZERO32, eip155Block: 0, eip158Block: 0, byzantiumBlock: 0, constantinopleBlock: 0, petersburgBlock: 0, istanbulBlock: 0, muirGlacierBlock: 0, berlinBlock: 0, londonBlock: 0, clique: { period: 0, epoch: 0 }, arbitrum: { EnableArbOS: true, AllowDebugPrecompiles: false, DataAvailabilityCommittee: false, InitialArbOSVersion: 61, InitialChainOwner: owner, GenesisBlockNum: 0 } };
  const config = {
    confirmPeriodBlocks: 45818, stakeToken: token.target, baseStake: ethers.parseEther('1'), wasmModuleRoot: MACHINE_ROOT, owner, loserStakeEscrow: escrow,
    chainId: chainConfig.chainId, chainConfig: JSON.stringify(chainConfig), minimumAssertionPeriod: 75, validatorAfkBlocks: 201600,
    genesisAssertionState: { globalState: { bytes32Vals: [ZERO32, ZERO32], u64Vals: [0, 0] }, machineStatus: 1, endHistoryRoot: ZERO32 }, genesisInboxCount: 0,
    miniStakeValues: [0, ethers.parseEther('0.5'), ethers.parseEther('0.25')], layerZeroBlockEdgeHeight: 2 ** 26, layerZeroBigStepEdgeHeight: 2 ** 19, layerZeroSmallStepEdgeHeight: 2 ** 23,
    numBigStepLevel: 1, challengeGracePeriodBlocks: 10, bufferConfig: { threshold: 600, max: 14400, replenishRateInBasis: 833 },
    sequencerInboxMaxTimeVariation: { delayBlocks: 7200, futureBlocks: 12, delaySeconds: 86400, futureSeconds: 3600 }, anyTrustFastConfirmer: ZERO, dataCostEstimate: 0,
  };
  const params = { config, validators: [validator], maxDataSize: MAX_DATA_SIZE, nativeToken: token.target, deployFactoriesToL2: false, maxFeePerGasForRetryables: 1000000000, batchPosters: [poster], batchPosterManager: posterManager, feeTokenPricer: pricer.target, customOsp: ZERO };
  report.childRollup = { status: 'PREPARING', localOnly: true, chainConfig, params, nativeTokenLabel: 'GH0ST LOCAL MOCK NOT REAL GH', notRealGh0stToken: true, zeroGenesisStateIsRehearsalOnly: true, childNodeBooted: false, retryableFactoriesDeployed: false };
  const fragment = creator.interface.getFunction('createRollup');
  recordCheck('createRollup ABI includes exact current feeTokenPricer and customOsp tuple fields', fragment.inputs[0].components.map(v => v.name).join(',') === 'config,validators,maxDataSize,nativeToken,deployFactoriesToL2,maxFeePerGasForRetryables,batchPosters,batchPosterManager,feeTokenPricer,customOsp', fragment.format('full'));
  const data = creator.interface.encodeFunctionData('createRollup', [params]);
  const predictedRollup = ethers.getCreate2Address(creator.target, ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode([fragment.inputs[0]], [params])), ethers.keccak256(artifact('RollupProxy').bytecode));
  const receipt = await send({ to: creator.target, data }, 'createRollup with explicit GHMOCK token and pricer', 'local-child-creation');
  const event = receipt.logs.map(log => { try { return creator.interface.parseLog(log); } catch { return null; } }).find(log => log?.name === 'RollupCreated');
  assert.ok(event, 'RollupCreated emitted');
  const addresses = Object.fromEntries(event.fragment.inputs.map((input, i) => [input.name, event.args[i]]));
  report.childRollup = { ...report.childRollup, status: 'LOCAL_CONTRACT_REGISTRATION_VERIFIED', addresses, predictedRollup, receiptHash: receipt.hash };
  recordCheck('Rollup CREATE2 address matches exact encoded 3.2 tuple', addresses.rollupAddress === predictedRollup, predictedRollup);
  report.childRollup.deployedCode = {};
  for (const [name, address] of Object.entries(addresses)) {
    const code = await provider.getCode(address);
    recordCheck(`Created ${name} code exists`, code !== '0x' && ethers.dataLength(code) <= 24576, address);
    report.childRollup.deployedCode[name] = { address, runtimeBytes: ethers.dataLength(code), runtimeBytecodeKeccak256: ethers.keccak256(code) };
  }
  const rollup = new ethers.Contract(addresses.rollupAddress, [...artifact('RollupAdminLogic').abi, ...artifact('RollupUserLogic').abi], signer);
  const bridge = new ethers.Contract(addresses.bridge, artifact('ERC20Bridge').abi, signer);
  const seq = new ethers.Contract(addresses.sequencerInbox, artifact('SequencerInbox').abi, signer);
  const admin = new ethers.Contract(addresses.adminProxy, artifact('ProxyAdmin').abi, signer);
  const upgrade = new ethers.Contract(addresses.upgradeExecutor, deployed.upgradeExecutor.interface, signer);
  const challenge = new ethers.Contract(addresses.challengeManager, artifact('EdgeChallengeManager').abi, signer);
  const checks = [
    ['Rollup owner is upgrade executor', await rollup.owner() === addresses.upgradeExecutor],
    ['ProxyAdmin owner is upgrade executor', await admin.owner() === addresses.upgradeExecutor],
    ['UpgradeExecutor config.owner has EXECUTOR_ROLE', await upgrade.hasRole(await upgrade.EXECUTOR_ROLE(), owner)],
    ['UpgradeExecutor is self-administered', await upgrade.hasRole(await upgrade.ADMIN_ROLE(), addresses.upgradeExecutor)],
    ['Creator did not retain executor role', !(await upgrade.hasRole(await upgrade.EXECUTOR_ROLE(), creator.target))],
    ['Validator initialized', await rollup.isValidator(validator)],
    ['Batch poster initialized', await seq.isBatchPoster(poster)],
    ['Batch poster manager initialized', await seq.batchPosterManager() === posterManager],
    ['Fee-token pricer tuple field initialized', await seq.feeTokenPricer() === pricer.target],
    ['Native token is local GHMOCK', await bridge.nativeToken() === token.target],
    ['Expected inbox allowed at index zero', await bridge.allowedDelayedInboxList(0) === addresses.inboxAddress],
    ['Expected rollup event inbox allowed at index one', await bridge.allowedDelayedInboxList(1) === addresses.rollupEventInbox],
    ['Expected outbox allowed at index zero', await bridge.allowedOutboxList(0) === addresses.outbox],
    ['Created SequencerInbox uses custom fee token', await seq.isUsingFeeToken()],
    ['Created SequencerInbox enables delay buffer', await seq.isDelayBufferable()],
    ['Created SequencerInbox maxDataSize matches parent layer 2', await seq.maxDataSize() === BigInt(MAX_DATA_SIZE)],
    ['Rollup wasmModuleRoot matches standard Nitro root', await rollup.wasmModuleRoot() === MACHINE_ROOT],
    ['Rollup child chainId initialized', await rollup.chainId() === BigInt(chainConfig.chainId)],
    ['Rollup stake token initialized', await rollup.stakeToken() === token.target],
    ['Challenge manager assertion chain initialized', await challenge.assertionChain() === addresses.rollupAddress],
    ['Challenge manager standard proof entry initialized', await challenge.oneStepProofEntry() === deployed.osp.target],
    ['Challenge manager stake token initialized', await challenge.stakeToken() === token.target],
    ['Challenge manager challenge period initialized', await challenge.challengePeriodBlocks() === BigInt(config.confirmPeriodBlocks)],
  ];
  for (const [name, okay] of checks) recordCheck(name, okay);
  for (const [getter, length] of [['allowedDelayedInboxList', 2], ['allowedOutboxList', 1]]) {
    let outOfBoundsReverted = false;
    try { await bridge[getter](length); } catch (error) { outOfBoundsReverted = error.code === 'CALL_EXCEPTION'; }
    recordCheck(`${getter} contains exactly ${length} entries`, outOfBoundsReverted);
  }
  // EIP-1967 admin and implementation slots, plus Nitro's secondary implementation slot.
  const adminSlot = ethers.toBeHex(BigInt(ethers.keccak256(ethers.toUtf8Bytes('eip1967.proxy.admin'))) - 1n, 32);
  const implementationSlot = ethers.toBeHex(BigInt(ethers.keccak256(ethers.toUtf8Bytes('eip1967.proxy.implementation'))) - 1n, 32);
  const readAddress = async (address, slot) => ethers.getAddress(`0x${(await provider.getStorage(address, slot)).slice(-40)}`);
  for (const key of ['bridge', 'inboxAddress', 'outbox', 'rollupEventInbox', 'sequencerInbox', 'challengeManager', 'upgradeExecutor']) recordCheck(`${key} proxy admin storage`, await readAddress(addresses[key], adminSlot) === addresses.adminProxy, addresses.adminProxy);
  recordCheck('Rollup admin implementation storage', await readAddress(addresses.rollupAddress, implementationSlot) === deployed.rollupAdmin.target, deployed.rollupAdmin.target);
  const expectedImplementations = { bridge: deployed.erc20Bridge.target, inboxAddress: deployed.erc20Inbox.target, outbox: deployed.erc20Outbox.target, rollupEventInbox: deployed.erc20RollupEventInbox.target, sequencerInbox: deployed.erc20SequencerInboxDelayBufferable.target, challengeManager: deployed.challengeManager.target, upgradeExecutor: deployed.upgradeExecutor.target };
  for (const [key, implementation] of Object.entries(expectedImplementations)) recordCheck(`${key} proxy implementation storage`, await readAddress(addresses[key], implementationSlot) === implementation, implementation);
  report.childRollup.checkedRoles = { owner, validator, batchPoster: poster, batchPosterManager: posterManager, loserStakeEscrow: escrow };
}

async function rehearseSafe(owner) {
  // Supplemental exact Safe artifacts, not part of deployAllContracts' core sequence.
  const singleton = await deploy('Safe singleton supplemental', 'Safe', [], { kind: 'safe', category: 'supplemental-safe', create2: false });
  const factory = await deploy('SafeProxyFactory supplemental', 'SafeProxyFactory', [], { kind: 'safe', category: 'supplemental-safe', create2: false });
  const data = singleton.interface.encodeFunctionData('setup', [[owner], 1, ZERO, '0x', ZERO, ZERO, 0, ZERO]);
  const receipt = await send({ to: factory.target, data: factory.interface.encodeFunctionData('createProxyWithNonce', [singleton.target, data, 0]) }, 'Initialize ephemeral 1-of-1 Safe proxy', 'supplemental-safe');
  const event = receipt.logs.map(log => { try { return factory.interface.parseLog(log); } catch { return null; } }).find(log => log?.name === 'ProxyCreation');
  assert.ok(event);
  const safe = new ethers.Contract(event.args.proxy, singleton.interface, signer);
  recordCheck('Supplemental Safe proxy initialized with ephemeral owner', JSON.stringify([...(await safe.getOwners())]) === JSON.stringify([owner]), owner);
  recordCheck('Supplemental Safe threshold initialized to 1', await safe.getThreshold() === 1n, 1);
  report.safe = { scope: 'Supplemental exact artifact rehearsal only; not real custody or a proposed production multisig policy', singleton: singleton.target, factory: factory.target, proxy: event.args.proxy, owners: [owner], threshold: 1 };
}

async function main() {
  assert.equal(process.argv.length, 2, 'No arguments accepted; script cannot select an external chain or wallet');
  const fixtures = compileFixtures();
  localProvider = ganache.provider({ chain: { chainId: 4663, networkId: 4663, hardfork: 'shanghai', allowUnlimitedContractSize: false, allowUnlimitedInitCodeSize: false }, miner: { blockGasLimit: 30000000 }, wallet: { totalAccounts: 8, defaultBalance: 1000, deterministic: false }, logging: { quiet: true } });
  provider = new ethers.BrowserProvider(localProvider, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  signer = await provider.getSigner(0);
  const accounts = await Promise.all([0, 1, 2, 3, 4].map(async i => (await provider.getSigner(i)).getAddress()));
  report.syntheticParent.accounts = accounts;
  const fixtureRuntime = fixtures.SyntheticArbSys.deployedBytecode;
  await localProvider.request({ method: 'evm_setAccountCode', params: [ARBSYS, fixtureRuntime] });
  report.fixtures.push({ name: 'SyntheticArbSys, not a real Nitro precompile', address: ARBSYS, compileSource: 'LocalFixtures.sol', runtimeBytecodeKeccak256: ethers.keccak256(fixtureRuntime), installation: 'Ganache evm_setAccountCode local fixture only', arbOSVersionRaw: 116, arbOSVersionDecoded: 61, behavior: 'arbOSVersion returns 116 (Nitro encoding 55+61); arbBlockNumber returns Ganache block.number; all other ArbSys methods unavailable' });
  const gasInfoAddress = '0x000000000000000000000000000000000000006c';
  await localProvider.request({ method: 'evm_setAccountCode', params: [gasInfoAddress, fixtures.SyntheticArbGasInfo.deployedBytecode] });
  report.fixtures.push({ name: 'SyntheticArbGasInfo, not real Nitro fee accounting', address: gasInfoAddress, compileSource: 'LocalFixtures.sol', runtimeBytecodeKeccak256: ethers.keccak256(fixtures.SyntheticArbGasInfo.deployedBytecode), installation: 'Ganache evm_setAccountCode local fixture only', behavior: 'getL1BaseFeeEstimate returns zero; local RollupEventInbox initialization adds no real parent-chain data charge' });
  const arb = new ethers.Contract(ARBSYS, fixtures.SyntheticArbSys.abi, provider);
  recordCheck('Synthetic parent selects official Arbitrum deployment branch', await arb.arbOSVersion() === 116n, 116);
  await bootstrapCreate2();
  const creator = await deployUpstreamCore(accounts[0]);
  await createMockTokenRollup(creator, accounts, fixtures);
  await rehearseSafe(accounts[0]);
  const gasByCategory = {};
  for (const tx of report.transactions) gasByCategory[tx.category] = (gasByCategory[tx.category] || 0n) + BigInt(tx.gasUsed);
  const totalGas = Object.values(gasByCategory).reduce((a, b) => a + b, 0n);
  const deploymentGas = gasByCategory['upstream-core-factory'] + gasByCategory['local-child-creation'];
  report.gas = { measuredSyntheticGasByCategory: gasByCategory, measuredSyntheticTotalGas: totalGas, coreFactoryPlusCreateRollupGas: deploymentGas, assumedParentGasPriceWei: ASSUMED_PARENT_GAS_PRICE, assumptionSource: '20,000,000 wei supplied parent-gas assumption; not refreshed or verified against current Robinhood RPC', assumptionIsCurrentVerifiedEstimate: false, coreFactoryPlusCreateRollupAtAssumptionEth: ethers.formatEther(deploymentGas * ASSUMED_PARENT_GAS_PRICE), allTransactionsAtAssumptionEth: ethers.formatEther(totalGas * ASSUMED_PARENT_GAS_PRICE), conversionLimit: 'Gas multiplied by an assumed price only. Excludes Robinhood-specific fee components, real Nitro pricing/compression differences, deployment retries and running costs; not a cap guarantee or transaction approval.' };
  report.budget = { historicalRealSpendEth: '0.000064114367868', historicalIcpFeesIncluded: '13', currentPolicy: { priorEthIcpSpendingCeilingsRemovedByUser: true, activeEthCeiling: null, activeIcpCeiling: null }, historicalCeilingsForContextOnly: { retiredTotalEthCap: '0.003', retiredRemainingEthCap: '0.002935885632132', retiredTotalIcpCapIncludingFees: '100' }, realSpendThisRehearsalEth: '0', realSpendThisRehearsalIcp: '0', publicSpendAuthorizedByThisScript: false };
  report.status = 'LOCAL_FACTORY_AND_MOCK_ROLLUP_VERIFIED_NO_PUBLIC_DEPLOYMENT';
  console.log(json({ status: report.status, transactions: report.transactions.length, deployedContracts: report.contracts.length, checks: report.checks.length, gas: report.gas }));
}

main().catch(error => {
  report.status = 'LOCAL_REHEARSAL_FAILED';
  report.failure = { name: error.name, message: error.shortMessage || error.message, code: error.code, details: error.info?.error?.message || error.reason || null };
  console.error(json(report.failure));
  process.exitCode = 1;
}).finally(async () => {
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(evidenceFile, json(report));
  if (provider) provider.destroy();
  if (localProvider) await localProvider.disconnect();
});
