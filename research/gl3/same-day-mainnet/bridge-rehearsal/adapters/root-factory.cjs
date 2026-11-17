'use strict';

// A library only: no self-execution, wallet loading, environment access, listener,
// fork configuration, or public RPC support. The orchestrator supplies an
// ephemeral signer connected to its own loopback-only actual Geth root.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { gunzipSync } = require('node:zlib');
const { createRequire } = require('node:module');
const REPO = path.resolve(process.env.GL3_PARITY_REPO);
const localRequire = createRequire(path.resolve(REPO, '../bridge/package.json'));
const ethers = localRequire('ethers');
const solc = localRequire('solc');
const PIN = '4341b132cfbdcc980ead03765ca5224ff6cb5d97';
const MACHINE_ROOT = '0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97';
const CACHE = path.join(REPO, 'research/chess/l3/nitro/.cache/contracts-provenance');
const SOURCE = path.join(CACHE, 'git', `nitro-contracts-${PIN}`);
const MAIN = path.join(CACHE, 'compiled-main/build/contracts');
const ZERO = ethers.ZeroAddress;
const ZERO32 = ethers.ZeroHash;
const MAX_DATA_SIZE = 117964;
// Ethereum root execution gas guard, with ordinary Geth limits unchanged.
const TX_GAS_CAP = 16777216n;
const CREATE2 = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const ARBSYS = '0x0000000000000000000000000000000000000064';
const ARBGASINFO = '0x000000000000000000000000000000000000006c';
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const jsonSafe = value => JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item));
const PRICER_SOURCE = '// SPDX-License-Identifier: UNLICENSED\npragma solidity ^0.8.20;\ncontract LocalUnitRatePricer { function getExchangeRate() external pure returns (uint256) { return 1e18; } }\n';

function loopbackUrl(value) {
  const url = new URL(value);
  assert.ok(['http:', 'https:'].includes(url.protocol), 'Only loopback HTTP RPC URLs are supported');
  assert.ok(['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname), 'Public and non-loopback RPC endpoints are forbidden');
  assert.equal(url.username, '', 'No credentials in local RPC URLs');
  assert.equal(url.password, '', 'No credentials in local RPC URLs');
  assert.equal(url.search, '', 'No query parameters in local RPC URLs');
  assert.equal(url.hash, '', 'No URL fragments');
  return url.href;
}

async function localContext({ provider, signer, rpcUrl, expectedChainId }) {
  assert.ok(provider instanceof ethers.JsonRpcProvider, 'Inject an ethers JsonRpcProvider connected directly to loopback Geth');
  assert.ok(signer && signer.provider === provider);
  const normalized = loopbackUrl(rpcUrl);
  assert.equal(loopbackUrl(provider._getConnection().url), normalized);
  const expected = BigInt(expectedChainId);
  assert.equal(expected, 1337n, 'Only isolated actual Ethereum root1337 is supported');
  const guard = async () => {
    assert.equal(loopbackUrl(provider._getConnection().url), normalized);
    assert.equal(BigInt(await provider.send('eth_chainId', [])), expected);
  };
  await guard();
  const owner = await signer.getAddress();
  assert.equal(await provider.getCode(owner), '0x');
  assert.equal(await provider.getCode(ARBSYS), '0x', 'No synthetic or Nitro ArbSys code on the Ethereum root');
  const clientVersion = await provider.send('web3_clientVersion', []);
  assert.ok(clientVersion.startsWith('Geth/'), 'Use actual native Geth Ethereum root, not a synthetic EVM');
  return { provider, signer, owner, guard, rpcUrl: normalized, expectedChainId: expected, probe: { chainId: expected, kind: 'Actual native Geth Ethereum root L1', clientVersion, latestBlock: await provider.getBlockNumber(), syntheticPrecompileOverrides: false } };
}

async function estimateLocalTransaction(ctx, tx) {
  const estimatedGas = await ctx.signer.estimateGas(tx);
  const gasLimit = estimatedGas + estimatedGas / 5n + 10000n;
  assert.ok(gasLimit <= TX_GAS_CAP, 'Ethereum execution estimate plus margin exceeds local16,777,216 gas guard');
  return { estimatedGas, gasLimit, source: 'Actual Ethereum root eth_estimateGas; no Nitro poster-gas conversion on this layer' };
}

async function actualReceiptGas(ctx, receipt) {
  assert.ok(receipt.gasUsed <= TX_GAS_CAP);
  return { ethereumExecutionGasUsed: receipt.gasUsed };
}

function loadArtifacts() {
  const compilationFile = path.join(REPO, 'research/chess/l3/nitro/evidence/contract-source-compilation.json');
  const compilation = JSON.parse(fs.readFileSync(compilationFile));
  assert.equal(compilation.main.sourceCommit, PIN);
  const files = new Map();
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.json')) {
        const key = entry.name.slice(0, -5);
        if (!files.has(key)) files.set(key, []);
        files.get(key).push(file);
      }
    }
  }
  walk(MAIN);
  const load = name => {
    const matches = files.get(name) || [];
    assert.equal(matches.length, 1, `Unique ${name} exact-source artifact`);
    const file = matches[0];
    const bytes = fs.readFileSync(file);
    const record = compilation.main.artifacts.find(item => item.path === path.relative(MAIN, file));
    assert.ok(record);
    assert.equal(sha256(bytes), record.sha256);
    const artifact = JSON.parse(bytes);
    assert.ok(artifact.bytecode.length > 2 && !artifact.bytecode.includes('__'));
    assert.ok(ethers.dataLength(artifact.deployedBytecode) <= 24576);
    return { ...artifact, provenance: { path: path.relative(REPO, file), sha256: sha256(bytes), source: artifact.sourceName, contract: name } };
  };
  const archive = fs.readFileSync(path.join(CACHE, 'deps/@offchainlabs__upgrade-executor/package.tgz'));
  const record = compilation.npmDependencyArchives.find(item => item.package === '@offchainlabs/upgrade-executor');
  assert.equal(sha256(archive), record.tarballSha256);
  assert.equal(`sha512-${crypto.createHash('sha512').update(archive).digest('base64')}`, record.integrity);
  const tar = gunzipSync(archive);
  let verifiedArtifact;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = tar.subarray(offset, offset + 100).toString().replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(tar.subarray(offset + 124, offset + 136).toString().replace(/\0.*$/, '').trim(), 8);
    if (name === 'package/build/contracts/src/UpgradeExecutor.sol/UpgradeExecutor.json') verifiedArtifact = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(verifiedArtifact);
  const upgradeFile = process.env.GL3_PRIVATE_UPGRADE_ARTIFACT || path.join(CACHE, 'deps/@offchainlabs__upgrade-executor/package/build/contracts/src/UpgradeExecutor.sol/UpgradeExecutor.json');
  assert.deepEqual(fs.readFileSync(upgradeFile), verifiedArtifact);
  const upgrade = JSON.parse(verifiedArtifact);
  upgrade.provenance = { path: path.relative(REPO, upgradeFile), sha256: sha256(verifiedArtifact), packageArchiveSha256: record.tarballSha256, source: upgrade.sourceName, contract: 'UpgradeExecutor' };
  const input = { language: 'Solidity', sources: { 'LocalUnitRatePricer.sol': { content: PRICER_SOURCE } }, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode'] } } } };
  const result = JSON.parse(solc.compile(JSON.stringify(input)));
  assert.deepEqual((result.errors || []).filter(error => error.severity === 'error'), []);
  const pricer = result.contracts['LocalUnitRatePricer.sol'].LocalUnitRatePricer;
  assert.equal(sha256(fs.readFileSync(path.join(SOURCE, 'src/rollup/DeployHelper.sol'))), compilation.main.sourceFileHashes['src/rollup/DeployHelper.sol']);
  return { load, upgrade, pricer: { abi: pricer.abi, bytecode: `0x${pricer.evm.bytecode.object}`, deployedBytecode: `0x${pricer.evm.deployedBytecode.object}`, provenance: { contract: 'LocalUnitRatePricer', sourceSha256: sha256(PRICER_SOURCE), compiler: solc.version(), purpose: 'Local fixed unit-rate mock; not market price data' } }, provenance: { nitroContractsCommit: PIN, compilationEvidenceSha256: sha256(fs.readFileSync(compilationFile)), helperSourceSha256: sha256(fs.readFileSync(__filename)), machineRoot: MACHINE_ROOT } };
}

function validateGenesis(options, owner) {
  assert.equal(typeof options.chainConfigJSON, 'string', 'Supply exact serialized chain config used by genesis-generator');
  const config = JSON.parse(options.chainConfigJSON);
  assert.equal(BigInt(config.chainId), BigInt(options.childChainId));
  const arb = config.arbitrum;
  assert.equal(arb.InitialArbOSVersion, 61);
  assert.equal(arb.AllowDebugPrecompiles, false);
  assert.equal(arb.DataAvailabilityCommittee, false);
  assert.equal(ethers.getAddress(arb.InitialChainOwner), owner);
  assert.equal(arb.MaxCodeSize, 24576);
  assert.equal(arb.MaxInitCodeSize, 49152);
  assert.ok(BigInt(options.dataCostEstimate) > 0n, 'Nonzero initialL1BaseFee/dataCostEstimate is required for exact precomputed genesis');
  const assertion = options.genesisAssertionState;
  assert.ok(assertion?.globalState?.bytes32Vals?.[0] && assertion.globalState.bytes32Vals[0] !== ZERO32, 'Supply real genesis-generator block hash; no null genesis assertion fallback');
  assert.equal(ethers.dataLength(assertion.globalState.bytes32Vals[0]), 32);
  assert.equal(ethers.dataLength(assertion.globalState.bytes32Vals[1]), 32);
  assert.equal(BigInt(assertion.globalState.u64Vals[0]), 1n);
  assert.equal(BigInt(assertion.globalState.u64Vals[1]), 0n);
  assert.equal(Number(assertion.machineStatus), 1);
  assert.equal(assertion.endHistoryRoot, ZERO32);
  return config;
}

async function deployLocalEthereumRootFactoryAndRollup(options) {
  options = { ...options, childChainId: options.parentChainId };
  const ctx = await localContext({ provider: options.provider, signer: options.signer, rpcUrl: options.rootRpcUrl, expectedChainId: options.expectedRootChainId });
  assert.equal(ctx.expectedChainId, 1337n, 'This integration helper is scoped to actual isolated Ethereum root1337');
  assert.equal(BigInt(options.childChainId), 4663n, 'Only isolated Nitro parent4663 is created here');
  const chainConfig = validateGenesis(options, ctx.owner);
  const artifacts = loadArtifacts();
  const transactions = [];
  const contracts = {};
  const code = address => ctx.provider.send('eth_getCode', [address, 'latest']);
  const send = async (tx, label, category) => {
    await ctx.guard();
    const gas = await estimateLocalTransaction(ctx, tx);
    const sent = await ctx.signer.sendTransaction({ ...tx, gasLimit: gas.gasLimit });
    const receipt = await sent.wait();
    assert.equal(receipt.status, 1, label);
    const actualGas = await actualReceiptGas(ctx, receipt);
    transactions.push({ label, category, hash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, ...actualGas, ...gas, effectiveGasPrice: receipt.gasPrice, dataBytes: ethers.dataLength(tx.data || '0x'), localFakeEthFee: ethers.formatEther(receipt.gasUsed * receipt.gasPrice) });
    await ctx.guard();
    options.onProgress?.({ label, hash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString() });
    return receipt;
  };
  const bootstrapSource = fs.readFileSync(path.join(SOURCE, 'src/rollup/DeployHelper.sol'), 'utf8');
  const raw = `0x${bootstrapSource.match(/NICK_CREATE2_PAYLOAD\s*=\s*hex"([0-9a-f]+)"/)[1].slice(2)}`;
  const legacy = ethers.Transaction.from(raw);
  assert.equal(ethers.getCreateAddress({ from: legacy.from, nonce: legacy.nonce }), CREATE2);
  const expectedFactoryCode = `0x${legacy.data.slice(-138)}`;
  let create2FactoryAddress = options.existingCreate2FactoryAddress ? ethers.getAddress(options.existingCreate2FactoryAddress) : CREATE2;
  let bootstrapRoute = options.existingCreate2FactoryAddress ? 'Explicitly supplied prior local CREATE2 factory, exact-runtime verified' : 'Existing canonical factory with byte-for-byte runtime verification';
  let bootstrapGasComponents;
  let factoryCode = await code(create2FactoryAddress);
  if (options.existingCreate2FactoryAddress) assert.notEqual(factoryCode, '0x', 'Explicit prior local factory must already exist');
  if (factoryCode === '0x') {
    bootstrapGasComponents = await estimateLocalTransaction(ctx, { data: legacy.data });
    if (options.useCanonicalKeylessPayload === true && bootstrapGasComponents.gasLimit <= legacy.gasLimit) {
      await send({ to: legacy.from, value: ethers.parseEther('0.01') }, 'Fund keyless CREATE2 deployer with local fake ETH', 'bootstrap');
      await ctx.guard();
      const receipt = await (await ctx.provider.broadcastTransaction(raw)).wait();
      assert.equal(receipt.status, 1);
      transactions.push({ label: 'Canonical CREATE2 from exact upstream signed payload', category: 'bootstrap', hash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, gasLimit: legacy.gasLimit, ...await actualReceiptGas(ctx, receipt), effectiveGasPrice: receipt.gasPrice });
      factoryCode = await code(CREATE2);
      bootstrapRoute = 'Canonical keyless exact signed payload';
    } else {
      // Exact upstream deploymentUtils supports CREATE2_FACTORY override.
      // Deploy its identical genuine proxy creation code with the ephemeral
      // signer, so ordinary Nitro L1-poster gas is paid without changing fees,
      // changing node limits, installing runtime, or inventing a new factory.
      const receipt = await send({ data: legacy.data }, 'Deploy genuine Arachnid CREATE2 proxy via supported upstream factory override', 'bootstrap');
      assert.ok(receipt.contractAddress);
      create2FactoryAddress = receipt.contractAddress;
      factoryCode = await code(create2FactoryAddress);
      bootstrapRoute = 'Upstream-supported CREATE2_FACTORY override: exact genuine proxy initcode/runtime deployed by ephemeral signer with chain1337 replay protection; no code installation or unsigned/unprotected RPC allowance change';
    }
  }
  assert.equal(factoryCode.toLowerCase(), expectedFactoryCode.toLowerCase(), 'Canonical CREATE2 deployed code must match exact upstream payload');
  const deploy = async (label, name, args = [], override) => {
    const artifact = override || artifacts.load(name);
    const fac = new ethers.ContractFactory(artifact.abi, artifact.bytecode, ctx.signer);
    const init = (await fac.getDeployTransaction(...args)).data;
    assert.ok(ethers.dataLength(init) <= 49152, `${label} initcode limit`);
    const address = ethers.getCreate2Address(create2FactoryAddress, ZERO32, ethers.keccak256(init));
    const reusedExisting = await code(address) !== '0x';
    if (reusedExisting) assert.ok(options.existingCreate2FactoryAddress, 'Existing template reuse requires the explicit prior local factory option');
    else await send({ to: create2FactoryAddress, data: ethers.concat([ZERO32, init]) }, label, 'deployment');
    const runtime = await code(address);
    assert.notEqual(runtime, '0x');
    assert.equal(ethers.dataLength(runtime), ethers.dataLength(artifact.deployedBytecode));
    assert.ok(ethers.dataLength(runtime) <= 24576);
    assert.equal(runtime.slice(-86), artifact.deployedBytecode.slice(-86));
    const contract = new ethers.Contract(address, artifact.abi, ctx.signer);
    contracts[label] = { address, contract, reusedExisting, artifact: artifact.provenance, runtimeBytes: ethers.dataLength(runtime), runtimeBytecodeKeccak256: ethers.keccak256(runtime), initcodeBytes: ethers.dataLength(init), constructorArgs: args };
    return contract;
  };
  const target = list => list.map(contract => contract.target);
  const eth = [];
  eth.push(await deploy('ethBridge', 'Bridge'));
  const readerBytes = fs.readFileSync(process.env.GL3_READER_ARTIFACT);
  assert.equal(sha256(readerBytes), '58702895193dc16c083ad8f734f4c5fbd508828d3e62637fec59b4ae81acf61d');
  const readerArtifact = JSON.parse(readerBytes);
  const reader = await deploy('reader4844', 'Reader4844', [], readerArtifact);
  const readerDataHashes = [...await reader.getDataHashes()];
  const readerBlobBaseFee = await reader.getBlobBaseFee();
  assert.deepEqual(readerDataHashes, [], 'Ordinary call has no EIP4844 blob hashes');
  assert.ok(readerBlobBaseFee > 0n, 'Reader executes real BLOBBASEFEE opcode on Geth');
  eth.push(await deploy('ethSequencerInbox', 'SequencerInbox', [MAX_DATA_SIZE, reader.target, false, false]));
  eth.push(await deploy('ethSequencerInboxDelayBufferable', 'SequencerInbox', [MAX_DATA_SIZE, reader.target, false, true]));
  eth.push(await deploy('ethInbox', 'Inbox', [MAX_DATA_SIZE]));
  eth.push(await deploy('ethRollupEventInbox', 'RollupEventInbox'));
  eth.push(await deploy('ethOutbox', 'Outbox'));
  const erc20 = [];
  erc20.push(await deploy('erc20Bridge', 'ERC20Bridge'));
  erc20.push(await deploy('erc20SequencerInbox', 'SequencerInbox', [MAX_DATA_SIZE, reader.target, true, false]));
  erc20.push(await deploy('erc20SequencerInboxDelayBufferable', 'SequencerInbox', [MAX_DATA_SIZE, reader.target, true, true]));
  erc20.push(await deploy('erc20Inbox', 'ERC20Inbox', [MAX_DATA_SIZE]));
  erc20.push(await deploy('erc20RollupEventInbox', 'ERC20RollupEventInbox'));
  erc20.push(await deploy('erc20Outbox', 'ERC20Outbox'));
  const bridgeCreator = await deploy('bridgeCreator', 'BridgeCreator', [target(eth), target(erc20)]);
  const p0 = await deploy('prover0', 'OneStepProver0');
  const pm = await deploy('proverMem', 'OneStepProverMemory');
  const px = await deploy('proverMath', 'OneStepProverMath');
  const ph = await deploy('proverHostIo', 'OneStepProverHostIo', [ZERO]);
  const osp = await deploy('osp', 'OneStepProofEntry', target([p0, pm, px, ph]));
  const challenge = await deploy('challengeManager', 'EdgeChallengeManager');
  const admin = await deploy('rollupAdmin', 'RollupAdminLogic');
  const user = await deploy('rollupUser', 'RollupUserLogic');
  const upgrade = await deploy('upgradeExecutor', 'UpgradeExecutor', [], artifacts.upgrade);
  const walletCreator = await deploy('validatorWalletCreator', 'ValidatorWalletCreator');
  const deployHelper = await deploy('deployHelper', 'DeployHelper');
  const creator = await deploy('rollupCreator', 'RollupCreator', [ctx.owner, ...target([bridgeCreator, osp, challenge, admin, user, upgrade, walletCreator, deployHelper])]);
  assert.equal(await creator.owner(), ctx.owner);
  const token = await deploy('LOCAL_STAKE_WETH_MOCK', 'TestWETH9', ['LOCAL STAKE WETH MOCK NOT REAL COLLATERAL', 'LSTK']);
  const config = {
    confirmPeriodBlocks: 45818, stakeToken: token.target, baseStake: ethers.parseEther('1'), wasmModuleRoot: MACHINE_ROOT, owner: ctx.owner, loserStakeEscrow: ctx.owner,
    chainId: BigInt(options.childChainId), chainConfig: options.chainConfigJSON, minimumAssertionPeriod: 75, validatorAfkBlocks: 201600,
    genesisAssertionState: options.genesisAssertionState, genesisInboxCount: BigInt(options.genesisInboxCount ?? 0), miniStakeValues: [0, ethers.parseEther('0.5'), ethers.parseEther('0.25')],
    layerZeroBlockEdgeHeight: 2 ** 26, layerZeroBigStepEdgeHeight: 2 ** 19, layerZeroSmallStepEdgeHeight: 2 ** 23, numBigStepLevel: 1, challengeGracePeriodBlocks: 10,
    bufferConfig: { threshold: 600, max: 14400, replenishRateInBasis: 833 }, sequencerInboxMaxTimeVariation: { delayBlocks: 7200, futureBlocks: 12, delaySeconds: 86400, futureSeconds: 3600 },
    anyTrustFastConfirmer: ZERO, dataCostEstimate: BigInt(options.dataCostEstimate),
  };
  const params = { config, validators: [ctx.owner], maxDataSize: MAX_DATA_SIZE, nativeToken: ZERO, deployFactoriesToL2: false, maxFeePerGasForRetryables: 1000000000, batchPosters: [ctx.owner], batchPosterManager: ctx.owner, feeTokenPricer: ZERO, customOsp: ZERO };
  const fragment = creator.interface.getFunction('createRollup');
  assert.equal(fragment.inputs[0].components.map(item => item.name).join(','), 'config,validators,maxDataSize,nativeToken,deployFactoriesToL2,maxFeePerGasForRetryables,batchPosters,batchPosterManager,feeTokenPricer,customOsp');
  const predictedRollup = ethers.getCreate2Address(creator.target, ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode([fragment.inputs[0]], [params])), ethers.keccak256(artifacts.load('RollupProxy').bytecode));
  const creation = await send({ to: creator.target, data: creator.interface.encodeFunctionData('createRollup', [params]) }, 'Create actual Ethereum-root ETH-native Nitro4663 rollup', 'rollup-creation');
  const parsed = creation.logs.map(log => { try { return creator.interface.parseLog(log); } catch { return null; } }).find(log => log?.name === 'RollupCreated');
  assert.ok(parsed);
  const addresses = Object.fromEntries(parsed.fragment.inputs.map((input, i) => [input.name, parsed.args[i]]));
  assert.equal(addresses.rollupAddress, predictedRollup);
  for (const address of Object.values(addresses)) if (address !== ZERO) assert.notEqual(await code(address), '0x');
  assert.equal(addresses.nativeToken, ZERO);
  const rollup = new ethers.Contract(addresses.rollupAddress, artifacts.load('RollupUserLogic').abi, ctx.signer);
  const inbox = new ethers.Contract(addresses.inboxAddress, artifacts.load('Inbox').abi, ctx.signer);
  const seq = new ethers.Contract(addresses.sequencerInbox, artifacts.load('SequencerInbox').abi, ctx.signer);
  const bridge = new ethers.Contract(addresses.bridge, artifacts.load('Bridge').abi, ctx.signer);
  const executor = new ethers.Contract(addresses.upgradeExecutor, artifacts.upgrade.abi, ctx.signer);
  assert.equal(await rollup.owner(), addresses.upgradeExecutor);
  assert.equal(await executor.hasRole(await executor.EXECUTOR_ROLE(), ctx.owner), true);
  assert.equal(await rollup.isValidator(ctx.owner), true);
  assert.equal(await seq.isBatchPoster(ctx.owner), true);
  assert.equal(await seq.batchPosterManager(), ctx.owner);
  assert.equal(await seq.feeTokenPricer(), ZERO);
  assert.equal(await seq.reader4844(), reader.target);
  assert.equal(await seq.isUsingFeeToken(), false);
  assert.equal(await seq.maxDataSize(), BigInt(MAX_DATA_SIZE));
  assert.equal(await bridge.rollup(), addresses.rollupAddress);
  assert.equal(await rollup.chainId(), BigInt(options.childChainId));
  assert.equal(await rollup.wasmModuleRoot(), MACHINE_ROOT);
  const genesisAssertionHash = await rollup.computeAssertionHash(ZERO32, options.genesisAssertionState, ZERO32);
  assert.equal(await rollup.latestConfirmed(), genesisAssertionHash, 'Initialized confirmed assertion must bind the exact nonzero supplied genesis state');
  const rollupAddresses = { bridge: addresses.bridge, inbox: addresses.inboxAddress, 'sequencer-inbox': addresses.sequencerInbox, rollup: addresses.rollupAddress, 'native-token': ZERO, 'upgrade-executor': addresses.upgradeExecutor, 'validator-utils': ZERO, 'validator-wallet-creator': walletCreator.target, 'stake-token': token.target, 'deployed-at': creation.blockNumber };
  const packet = {
    schema: 'gh0st.core.actual-ethereum-root-factory.v1', status: 'ACTUAL_ETHEREUM_ROOT_FACTORY_AND_ETH_NATIVE_NITRO_ROLLUP_VERIFIED_NITRO_BOOT_PENDING', recordedAt: new Date().toISOString(),
    localOnly: true, realSpendEth: '0', realSpendIcp: '0', tokenLabel: 'LOCAL STAKE WETH MOCK NOT REAL COLLATERAL', nativeGas: 'ETH', nativeToken: ZERO, noSyntheticPrecompileOverrides: true, provenance: artifacts.provenance,
    parent: { rpcUrl: ctx.rpcUrl, ...ctx.probe }, childChainId: options.childChainId, owner: ctx.owner, creationBlockNumber: creation.blockNumber, creationTransactionHash: creation.hash,
    addresses, factoryAddress: creator.target, create2Factory: { address: create2FactoryAddress, canonicalAddress: CREATE2, route: bootstrapRoute, canonicalKeylessGasLimit: legacy.gasLimit, bootstrapGasComponents }, localFeeTokenPricer: ZERO, reader4844: { address: reader.target, dataHashes: readerDataHashes, blobBaseFee: readerBlobBaseFee, artifactProvenance: readerArtifact.provenance }, chainConfigJSON: options.chainConfigJSON, chainConfig, genesisAssertionState: options.genesisAssertionState, genesisAssertionHash, genesisInboxCount: config.genesisInboxCount, dataCostEstimate: config.dataCostEstimate,
    rollup: rollupAddresses, chainInfo: { 'chain-name': 'GH0ST actual Geth-root Nitro parent rehearsal', 'chain-id': Number(options.childChainId), 'parent-chain-id': Number(ctx.expectedChainId), 'parent-chain-is-arbitrum': false, 'chain-config': chainConfig, rollup: rollupAddresses, 'has-genesis-state': true, 'sequencer-url': '', 'feed-url': '' },
    validatorUtilsNote: 'Zero address because current deployAllContracts/3.2 RollupCreator deploys no ValidatorUtils; no placeholder code or invented address',
    deployFactoriesToL2: false, roleAddresses: { validator: ctx.owner, batchPoster: ctx.owner, batchPosterManager: ctx.owner, ownerExecutor: ctx.owner },
    contracts: Object.fromEntries(Object.entries(contracts).map(([label, { contract, ...item }]) => [label, item])), transactions,
    limitations: ['Actual isolated native Geth root; never public Ethereum or Robinhood', 'Caller must independently boot Nitro4663 against this actual root with exact genesis and validation enabled', 'Nitro keyless-factory retryables disabled; no challenge/fraud-proof claim', 'Stake WETH is an unfunded local mock, no real collateral/security budget claim'],
  };
  return { packet, contracts, creator, rollup, stakeToken: token, reader4844: reader, inbox, bridge, sequencerInbox: seq, jsonPacket: () => jsonSafe(packet) };
}
module.exports = { deployLocalEthereumRootFactoryAndRollup, loopbackUrl, jsonSafe, constants: { PIN, MACHINE_ROOT, MAX_DATA_SIZE, TX_GAS_CAP } };
