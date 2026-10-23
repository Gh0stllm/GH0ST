import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import solcV4 from 'solc-v4';
import hre from 'hardhat';
import { AbiCoder, BrowserProvider, Contract, ContractFactory, MaxUint256, ZeroAddress,
  getCreate2Address, keccak256, toBeHex, zeroPadValue } from 'ethers';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const track = 'swap-speaker-535k';
const hookFile = `${track}/contracts/SentenceSpeakerV4Hook.sol`;
const modelFile = `${track}/contracts/SentenceSpeakerModel.sol`;
const harnessFile = 'tests/evm/SentenceV4IntegrationHarness.sol';
const adversarialFile = 'tests/evm/SentenceV4AdversarialModels.sol';
const compilerSettings = { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'cancun',
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => readFileSync(path.join(base, file));
const modelDirectory = process.env.GH0ST_MODEL_DIR ? path.resolve(base, process.env.GH0ST_MODEL_DIR) : path.join(base, track, 'model');
const readModel = file => readFileSync(path.join(modelDirectory, file));
const reportPath = process.env.GH0ST_V4_REPORT ? path.resolve(base, process.env.GH0ST_V4_REPORT)
  : path.join(base, track, 'reports/v4-poolmanager-integration.json');
const abi = AbiCoder.defaultAbiCoder();

function compile() {
  const sources = Object.fromEntries([hookFile, modelFile, harnessFile, adversarialFile]
    .map(file => [file, { content: read(file).toString() }]));
  const callbacks = { import: file => {
      for (const location of [path.join(base, file), path.join(base, 'node_modules', file),
        path.join(base, 'node_modules/@uniswap/v4-core/lib', file)]) {
        if (existsSync(location)) return { contents: readFileSync(location, 'utf8') };
      }
      return { error: `Missing Solidity import: ${file}` };
    } };
  const result = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: compilerSettings }), callbacks));
  const errors = (result.errors ?? []).filter(item => item.severity === 'error');
  assert.deepEqual(errors, [], errors.map(item => item.formattedMessage).join('\n'));
  const managerFile = '@uniswap/v4-core/src/PoolManager.sol';
  const core = JSON.parse(solcV4.compile(JSON.stringify({ language: 'Solidity', settings: compilerSettings,
    sources: { [managerFile]: { content: read(`node_modules/${managerFile}`).toString() } } }), callbacks));
  const coreErrors = (core.errors ?? []).filter(item => item.severity === 'error');
  assert.deepEqual(coreErrors, [], coreErrors.map(item => item.formattedMessage).join('\n'));
  result.contracts[managerFile] = core.contracts[managerFile];
  return result.contracts;
}

function referenceModel() {
  const toWeights = file => {
    const bytes = readModel(file);
    return Array.from({ length: bytes.length / 2 }, (_, i) => BigInt(bytes.readInt16BE(i * 2)));
  };
  const core = toWeights('core.bin'), embeddings = toWeights('embeddings.bin'), nodes = toWeights('nodes.bin');
  const vocabulary = JSON.parse(readModel('vocabulary.json'));
  return (previous, state, features, maximumWords = 12) => {
    const tokens = [];
    let ended = false;
    for (let word = 0; word < maximumWords; word++) {
      const next = [];
      for (let row = 0; row < 32; row++) {
        let sum = core[2240 + row] * 1024n;
        for (let j = 0; j < 32; j++) {
          sum += core[row * 32 + j] * embeddings[previous * 32 + j];
          sum += core[1024 + row * 32 + j] * BigInt(state[j]);
        }
        for (let j = 0; j < 6; j++) sum += core[2048 + row * 6 + j] * BigInt(features[j]);
        sum /= 1024n;
        next.push(Number(sum < 0n ? 0n : sum > 8192n ? 8192n : sum));
      }
      let node = 0;
      for (let depth = 0; depth < 13; depth++) {
        let score = nodes[node * 33 + 32] * 1024n;
        for (let j = 0; j < 32; j++) score += nodes[node * 33 + j] * BigInt(next[j]);
        score /= 1024n;
        node = node * 2 + 1 + (score > 0n ? 1 : 0);
      }
      previous = node - 8191;
      state = next;
      tokens.push(previous);
      if (/[.!?]$/.test(vocabulary[previous])) { ended = true; break; }
    }
    return { previous, state, tokens, ended,
      text: tokens.map(token => vocabulary[token]).join(' ') + (ended ? '' : '.') };
  };
}

test('sentence adapter settles real v4 swaps, isolates pools and keeps inference optional', { timeout: 300_000 }, async t => {
  const contracts = compile();
  await hre.network.provider.request({ method: 'hardhat_reset', params: [] });
  const provider = new BrowserProvider(hre.network.provider, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  const signer = await provider.getSigner(0), payer = await signer.getAddress();
  const deployments = [], swaps = [], checks = [], failureFixtures = [];
  let requiredSpeechGasEstimate, requiredSpeechGasUsed;
  const artifact = (file, name) => contracts[file][name];
  async function deploy(file, name, args = [], gasLimit = 8_000_000) {
    const a = artifact(file, name);
    const contract = await new ContractFactory(a.abi, a.evm.bytecode.object, signer).deploy(...args, { gasLimit });
    const receipt = await contract.deploymentTransaction().wait();
    deployments.push({ name, address: await contract.getAddress(), gas: receipt.gasUsed.toString() });
    return contract;
  }
  const idFor = key => keccak256(abi.encode(['address', 'address', 'uint24', 'int24', 'address'],
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
  const swapParams = (zeroForOne, exactInput) => ({ zeroForOne,
    amountSpecified: exactInput ? -100_000_000_000_000n : 100_000_000_000_000n,
    sqrtPriceLimitX96: zeroForOne ? 4295128740n : 1461446703485210103287273052203988822378723970341n });

  try {
    const manager = await deploy('@uniswap/v4-core/src/PoolManager.sol', 'PoolManager', [payer]);
    const router = await deploy(harnessFile, 'SentenceV4SettlementRouter', [await manager.getAddress()]);
    const factory = await deploy(harnessFile, 'SentenceV4Create2Factory');
    const tokenA = await deploy(harnessFile, 'SentenceV4TestToken');
    const tokenB = await deploy(harnessFile, 'SentenceV4TestToken');
    const tokens = [tokenA, tokenB].sort((a, b) => BigInt(a.target) < BigInt(b.target) ? -1 : 1);
    for (const token of tokens) {
      await (await token.mint(payer, 10n ** 24n)).wait();
      await (await token.approve(await router.getAddress(), MaxUint256)).wait();
    }
    const manifest = JSON.parse(readModel('manifest.json'));
    const onchainArtifacts = ['core.bin', 'embeddings.bin', 'nodes.bin', 'vocabulary.bin', 'vocabulary.json'];
    for (const file of onchainArtifacts) {
      assert.ok(manifest.artifacts[file], `manifest pins ${file}`);
      assert.equal(sha(readModel(file)), manifest.artifacts[file].sha256);
    }
    const groups = {};
    for (const [group, file, chunkSize] of [['core', 'core.bin', 4544], ['embeddings', 'embeddings.bin', 24000],
      ['nodes', 'nodes.bin', 23760], ['vocabulary', 'vocabulary.bin', 24000]]) {
      const bytes = readModel(file), addresses = [];
      for (let start = 0; start < bytes.length; start += chunkSize) {
        const payload = '0x' + bytes.subarray(start, start + chunkSize).toString('hex');
        const shard = await deploy(modelFile, 'SentenceModelData', [payload], 6_000_000);
        assert.equal(await provider.getCode(shard.target), `0x00${payload.slice(2)}`);
        addresses.push(shard.target);
      }
      groups[group] = addresses;
    }
    const model = await deploy(modelFile, 'SentenceSpeakerModel',
      [groups.core[0], groups.embeddings, groups.nodes, groups.vocabulary]);
    const generate = referenceModel();
    async function deployHook(modelAddress, budget = 6_000_000) {
      const a = artifact(hookFile, 'SentenceSpeakerV4Hook');
      const request = await new ContractFactory(a.abi, a.evm.bytecode.object, signer)
        .getDeployTransaction(manager.target, modelAddress, 12, budget, 3000);
      const initHash = keccak256(request.data);
      let salt, address;
      for (let attempt = 0; attempt < 2_000_000; attempt++) {
        salt = zeroPadValue(toBeHex(attempt), 32);
        address = getCreate2Address(factory.target, salt, initHash);
        if ((BigInt(address) & 0x3fffn) === 0x1040n) break;
      }
      assert.equal(BigInt(address) & 0x3fffn, 0x1040n);
      await (await factory.deploy(salt, request.data, { gasLimit: 8_000_000 })).wait();
      return new Contract(address, a.abi, signer);
    }
    const hook = await deployHook(model.target);
    const staticKey = { currency0: tokens[0].target, currency1: tokens[1].target, fee: 3000, tickSpacing: 60, hooks: hook.target };
    const dynamicKey = { ...staticKey, fee: 0x800000 };
    const nativeKey = { ...staticKey, currency0: ZeroAddress, currency1: tokens[0].target, fee: 500, tickSpacing: 10 };
    const references = new Map();
    for (const key of [staticKey, dynamicKey, nativeKey]) {
      const receipt = await (await manager.initialize(key, 2n ** 96n)).wait();
      const block = await provider.getBlock(receipt.blockNumber), id = idFor(key);
      const state = await hook.contexts(id);
      assert.equal(state.initialized, true);
      assert.equal(state.previousToken, 8192n);
      const poolState = await router.poolState(key);
      assert.equal(poolState[3], BigInt(key.fee === 0x800000 ? 3000 : key.fee));
      references.set(id, { tick: 0, move: 0, ewma: 0, timestamp: block.timestamp, sequence: 0,
        previous: 8192, state: Array(32).fill(0) });
      await (await router.modifyLiquidity(key, { tickLower: -60000, tickUpper: 60000,
        liquidityDelta: key.currency0 === ZeroAddress ? 10n ** 15n : 10n ** 18n, salt: zeroPadValue('0x00', 32) },
      { gasLimit: 2_000_000, value: key.currency0 === ZeroAddress ? 10n ** 16n : 0n })).wait();
    }
    const modelHash = await model.modelHash();

    async function verifiedSwap(key, params, mode = 'spoken', gasLimit = 12_000_000) {
      const id = idFor(key), before = references.get(id);
      const beforeBalances = await Promise.all(tokens.map(token => token.balanceOf(payer)));
      const receipt = await (await router.swap(key, params, false, false, { gasLimit })).wait();
      const events = receipt.logs.filter(log => log.address.toLowerCase() === hook.target.toLowerCase())
        .map(log => hook.interface.parseLog(log));
      assert.equal(events.length, 1);
      const event = events[0], state = await hook.contexts(id), block = await provider.getBlock(receipt.blockNumber);
      assert.equal(state.sequence, BigInt(before.sequence + 1));
      const tick = Number(state.lastTick), move = Math.min(Math.abs(tick - before.tick), 1024);
      const features = [move * 4, before.ewma * 4, Math.abs(move - before.move) * 4,
        Math.floor(Math.min(Math.max(block.timestamp - before.timestamp, 0), 300) * 1024 / 300),
        params.zeroForOne ? 1024 : -1024, params.amountSpecified < 0 ? 1024 : -1024];
      const inputHash = keccak256(abi.encode(['bytes32', 'bytes32', 'uint64', 'uint16', 'int16[32]', 'int32[6]'],
        [id, modelHash, before.sequence + 1, before.previous, before.state, features]));
      assert.equal(event.args.inputHash, inputHash);
      let next;
      if (mode === 'spoken') {
        assert.equal(event.name, 'SentenceSpoken');
        const expected = generate(before.previous, before.state, features);
        assert.equal(event.args.text, expected.text);
        assert.equal(Number(event.args.words), expected.tokens.length);
        assert.equal(event.args.endedNaturally, expected.ended);
        next = expected.ended ? expected : { previous: 8192, state: Array(32).fill(0) };
        assert.equal(event.args.stateHash, keccak256(abi.encode(['uint16', 'int16[32]'], [next.previous, next.state])));
      } else {
        assert.equal(event.name, 'SentenceSkipped');
        assert.equal(event.args.reason, 1n);
        next = { previous: 8192, state: Array(32).fill(0) };
      }
      assert.equal(state.previousToken, BigInt(next.previous));
      assert.deepEqual(Array.from(await hook.hiddenState(id), Number), next.state);
      assert.equal(state.lastMove, BigInt(move));
      assert.equal(state.ewmaMove, BigInt(Math.floor((before.ewma * 7 + move) / 8)));
      references.set(id, { ...next, tick, move, ewma: Number(state.ewmaMove), timestamp: block.timestamp,
        sequence: Number(state.sequence) });
      const afterBalances = await Promise.all(tokens.map(token => token.balanceOf(payer)));
      if (key.currency0 !== ZeroAddress) {
        const paid = params.zeroForOne ? 0 : 1, received = 1 - paid;
        assert.ok(beforeBalances[paid] > afterBalances[paid], 'input token was paid');
        assert.ok(afterBalances[received] > beforeBalances[received], 'output token was received');
        if (params.amountSpecified < 0) assert.equal(beforeBalances[paid] - afterBalances[paid], -params.amountSpecified);
        else assert.equal(afterBalances[received] - beforeBalances[received], params.amountSpecified);
      }
      swaps.push({ pool_id: id, pool_kind: key.currency0 === ZeroAddress ? 'native' : key.fee === 0x800000 ? 'dynamic_fee' : 'static_fee',
        zero_for_one: params.zeroForOne, exact_input: params.amountSpecified < 0, gas_used: receipt.gasUsed.toString(),
        event: event.name, text: event.args.text ?? null, features, input_hash: inputHash });
      return receipt;
    }

    await t.test('both directions and exact input/output settle with exact model parity', async () => {
      for (const zeroForOne of [true, false]) for (const exactInput of [true, false])
        await verifiedSwap(staticKey, swapParams(zeroForOne, exactInput));
      checks.push('both_directions_exact_input_and_output');
    });
    await t.test('one hook isolates static, dynamic-fee and native-currency pools', async () => {
      const staticBefore = await hook.contexts(idFor(staticKey));
      const hiddenBefore = await hook.hiddenState(idFor(staticKey));
      await verifiedSwap(dynamicKey, swapParams(false, true));
      await verifiedSwap(nativeKey, { ...swapParams(true, true), amountSpecified: -10_000_000_000_000n });
      assert.deepEqual(Array.from(await hook.contexts(idFor(staticKey))), Array.from(staticBefore));
      assert.deepEqual(Array.from(await hook.hiddenState(idFor(staticKey))), Array.from(hiddenBefore));
      checks.push('multi_pool_isolation', 'dynamic_fee_pool_compatibility', 'native_currency_settlement');
    });
    await t.test('elapsed time is clamped and low transaction gas explicitly skips inference', async () => {
      await hre.network.provider.request({ method: 'evm_increaseTime', params: [600] });
      await verifiedSwap(staticKey, swapParams(true, true));
      assert.equal(swaps.at(-1).features[3], 1024);
      await verifiedSwap(staticKey, swapParams(false, true), 'skipped', 1_000_000);
      await verifiedSwap(staticKey, swapParams(false, false));
      checks.push('elapsed_time_clamp', 'low_gas_fail_open', 'recovery_after_skip');
    });
    await t.test('direct callbacks and unset pools cannot alter state', async () => {
      await assert.rejects(hook.afterInitialize.staticCall(payer, staticKey, 2n ** 96n, 0));
      await assert.rejects(hook.afterSwap.staticCall(payer, staticKey, swapParams(true, true), 0, '0x'));
      const unknown = { ...staticKey, fee: 10000 };
      await assert.rejects(router.swap.staticCall(unknown, swapParams(true, true), false, false, { gasLimit: 12_000_000 }));
      await assert.rejects(router.unlockCallback.staticCall('0x'));
      await assert.rejects(hook.decodeGeneration.staticCall('0x'));
      checks.push('canonical_manager_only', 'uninitialized_pool_rejected', 'router_callback_authorization');
    });
    await t.test('unsettled or reverted swaps roll back sentence, state and token balances', async () => {
      const id = idFor(staticKey), state = await hook.contexts(id), hidden = await hook.hiddenState(id);
      const balances = await Promise.all(tokens.map(token => token.balanceOf(payer)));
      for (const [skipSettlement, revertAfterSettlement] of [[true, false], [false, true]]) {
        await assert.rejects(async () => {
          const tx = await router.swap(staticKey, swapParams(true, true), skipSettlement, revertAfterSettlement, { gasLimit: 12_000_000 });
          await tx.wait();
        });
        assert.deepEqual(Array.from(await hook.contexts(id)), Array.from(state));
        assert.deepEqual(Array.from(await hook.hiddenState(id)), Array.from(hidden));
        assert.deepEqual(await Promise.all(tokens.map(token => token.balanceOf(payer))), balances);
      }
      checks.push('unsettled_swap_rollback', 'post_settlement_revert_rollback');
    });
    await t.test('a reverting model is isolated and pool settlement still succeeds', async () => {
      const failingModel = await deploy(harnessFile, 'SentenceV4FailingModel');
      const failingHook = await deployHook(failingModel.target, 300_000);
      const key = { ...staticKey, hooks: failingHook.target }, id = idFor(key);
      await (await manager.initialize(key, 2n ** 96n)).wait();
      await (await router.modifyLiquidity(key, { tickLower: -60000, tickUpper: 60000,
        liquidityDelta: 10n ** 18n, salt: zeroPadValue('0x00', 32) }, { gasLimit: 2_000_000 })).wait();
      const before = await Promise.all(tokens.map(token => token.balanceOf(payer)));
      const receipt = await (await router.swap(key, swapParams(true, true), false, false, { gasLimit: 2_000_000 })).wait();
      const event = receipt.logs.filter(log => log.address.toLowerCase() === failingHook.target.toLowerCase())
        .map(log => failingHook.interface.parseLog(log));
      assert.equal(event.length, 1);
      assert.equal(event[0].name, 'SentenceSkipped');
      assert.equal(event[0].args.reason, 2n);
      const state = await failingHook.contexts(id);
      assert.equal(state.sequence, 1n);
      assert.equal(state.previousToken, 8192n);
      assert.deepEqual(Array.from(await failingHook.hiddenState(id), Number), Array(32).fill(0));
      const after = await Promise.all(tokens.map(token => token.balanceOf(payer)));
      assert.ok(before[0] > after[0] && before[1] < after[1]);
      checks.push('model_revert_fail_open');
    });

    await t.test('malformed, oversized, invalid and gas-exhausting model returns cannot block settlement', async () => {
      const fixtures = [
        ['SentenceV4MalformedModel', []], ['SentenceV4OversizedModel', []],
        ['SentenceV4InvalidBooleanModel', []], ['SentenceV4GasBurningModel', []],
        ['SentenceV4InvalidLengthModel', []],
        ...Array.from({ length: 9 }, (_, mode) => ['SentenceV4InvalidOutputModel', [mode]]),
      ];
      for (const [name, args] of fixtures) {
        const maliciousModel = await deploy(adversarialFile, name, args);
        const boundedHook = await deployHook(maliciousModel.target, 300_000);
        const key = { ...staticKey, hooks: boundedHook.target }, id = idFor(key);
        await (await manager.initialize(key, 2n ** 96n)).wait();
        await (await router.modifyLiquidity(key, { tickLower: -60000, tickUpper: 60000,
          liquidityDelta: 10n ** 18n, salt: zeroPadValue('0x00', 32) }, { gasLimit: 2_000_000 })).wait();
        const before = await Promise.all(tokens.map(token => token.balanceOf(payer)));
        const receipt = await (await router.swap(key, swapParams(true, true), false, false, { gasLimit: 2_000_000 })).wait();
        const events = receipt.logs.filter(log => log.address.toLowerCase() === boundedHook.target.toLowerCase())
          .map(log => boundedHook.interface.parseLog(log));
        assert.equal(events.length, 1, `${name} emits one skip`);
        assert.equal(events[0].name, 'SentenceSkipped');
        assert.equal(events[0].args.reason, 2n);
        const state = await boundedHook.contexts(id);
        assert.equal(state.sequence, 1n);
        assert.equal(state.previousToken, 8192n);
        assert.deepEqual(Array.from(await boundedHook.hiddenState(id), Number), Array(32).fill(0));
        const after = await Promise.all(tokens.map(token => token.balanceOf(payer)));
        assert.ok(before[0] > after[0] && before[1] < after[1]);
        failureFixtures.push({ model: name, constructor_arguments: args, gas_used: receipt.gasUsed.toString() });
        if (name === 'SentenceV4MalformedModel') {
          await hre.network.provider.request({ method: 'hardhat_setCode', params: [maliciousModel.target, '0x00'] });
          const changed = await (await router.swap(key, swapParams(false, true), false, false, { gasLimit: 2_000_000 })).wait();
          const skipped = changed.logs.filter(log => log.address.toLowerCase() === boundedHook.target.toLowerCase())
            .map(log => boundedHook.interface.parseLog(log));
          assert.equal(skipped[0].name, 'SentenceSkipped');
          assert.equal(skipped[0].args.reason, 2n);
          assert.equal((await boundedHook.contexts(id)).sequence, 2n);
        }
      }
      checks.push('bounded_returndata_and_output_validation', 'gas_exhaustion_fail_open', 'model_runtime_hash_pinned');
    });

    await t.test('explicit speech opt-in lets gas estimation select inference and fails only the requesting swap', async () => {
      const marker = await hook.REQUIRE_SPEECH(), params = swapParams(true, true), id = idFor(staticKey);
      assert.equal(marker, '0x53504b31');
      const before = Array.from(await hook.contexts(id)), hidden = Array.from(await hook.hiddenState(id));
      await assert.rejects(async () => {
        const tx = await router.swapWithHookData(staticKey, params, marker, { gasLimit: 1_000_000 });
        await tx.wait();
      });
      assert.deepEqual(Array.from(await hook.contexts(id)), before);
      assert.deepEqual(Array.from(await hook.hiddenState(id)), hidden);
      const estimate = await router.swapWithHookData.estimateGas(staticKey, params, marker);
      requiredSpeechGasEstimate = estimate.toString();
      assert.ok(estimate > 6_000_000n, 'estimation must fund the model budget');
      const receipt = await (await router.swapWithHookData(staticKey, params, marker, { gasLimit: estimate })).wait();
      requiredSpeechGasUsed = receipt.gasUsed.toString();
      const events = receipt.logs.filter(log => log.address.toLowerCase() === hook.target.toLowerCase())
        .map(log => hook.interface.parseLog(log));
      assert.equal(events.length, 1);
      assert.equal(events[0].name, 'SentenceSpoken');
      assert.equal((await hook.contexts(id)).sequence, before[4] + 1n);

      const unknownData = await (await router.swapWithHookData(staticKey, swapParams(false, true), '0x01020304',
        { gasLimit: 1_000_000 })).wait();
      const optional = unknownData.logs.filter(log => log.address.toLowerCase() === hook.target.toLowerCase())
        .map(log => hook.interface.parseLog(log));
      assert.equal(optional[0].name, 'SentenceSkipped');
      assert.equal(optional[0].args.reason, 1n);

      const failingModel = await deploy(harnessFile, 'SentenceV4FailingModel');
      const failingHook = await deployHook(failingModel.target, 300_000);
      const key = { ...staticKey, hooks: failingHook.target }, failId = idFor(key);
      await (await manager.initialize(key, 2n ** 96n)).wait();
      await (await router.modifyLiquidity(key, { tickLower: -60000, tickUpper: 60000,
        liquidityDelta: 10n ** 18n, salt: zeroPadValue('0x00', 32) }, { gasLimit: 2_000_000 })).wait();
      const balances = await Promise.all(tokens.map(token => token.balanceOf(payer)));
      await assert.rejects(async () => {
        const tx = await router.swapWithHookData(key, params, marker, { gasLimit: 2_000_000 });
        await tx.wait();
      });
      assert.equal((await failingHook.contexts(failId)).sequence, 0n);
      assert.deepEqual(await Promise.all(tokens.map(token => token.balanceOf(payer))), balances);
      const optionalReceipt = await (await router.swap(key, params, false, false, { gasLimit: 2_000_000 })).wait();
      const skipped = optionalReceipt.logs.filter(log => log.address.toLowerCase() === failingHook.target.toLowerCase())
        .map(log => failingHook.interface.parseLog(log));
      assert.equal(skipped[0].name, 'SentenceSkipped');
      checks.push('required_speech_gas_estimation', 'required_speech_rollback', 'unrecognized_hook_data_remains_optional');
    });

    assert.equal(checks.length, 19, 'do not emit a passing report if any subtest failed');
    const report = { schema_version: 1, status: 'PASSED_REAL_LOCAL_POOLMANAGER',
      network: 'Hardhat local EVM, Cancun, 30 million block gas limit; no public transactions',
      upstream: '@uniswap/v4-core@1.0.2 unmodified PoolManager', compiler: { version: solc.version(), ...compilerSettings },
      upstream_compiler: { version: solcV4.version(), ...compilerSettings },
      model_hash: modelHash, max_words: 12, inference_gas_limit: 6_000_000,
      model_directory: path.relative(base, modelDirectory),
      model_artifacts: Object.fromEntries(onchainArtifacts.map(file => [file, manifest.artifacts[file]])),
      failure_fixtures: failureFixtures,
      required_speech_hook_data: '0x53504b31', required_speech_gas_estimate: requiredSpeechGasEstimate,
      required_speech_gas_used: requiredSpeechGasUsed,
      hooks_permissions: '0x1040 (afterInitialize, afterSwap)', checks, swaps,
      gas_scope: 'Full router transaction: real PoolManager AMM math, callback inference, ERC20/native settlement and logs',
      deployment_count: deployments.length,
      total_local_deployment_gas: deployments.reduce((sum, item) => sum + BigInt(item.gas), 0n).toString(),
      source_sha256: Object.fromEntries([hookFile, modelFile, harnessFile, adversarialFile, 'tests/evm/sentence-v4-poolmanager.test.mjs']
        .map(file => [file, sha(read(file))])),
      limitations: [
        'Local execution only; no fork, deployed public PoolManager, periphery router or external security audit.',
        'Dynamic fee pools receive the configured fixed 3000 initial LP fee; this adapter has no learned fee policy.',
        'Inference is intentionally optional. Insufficient gas or a failing model emits SentenceSkipped and resets language state.',
        'No reserve can make an arbitrarily gas-starved transaction succeed; the transaction must cover core swap and bookkeeping gas.',
      ] };
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ checks: checks.length, swaps: swaps.length,
      gas_range: [Math.min(...swaps.filter(s => s.event === 'SentenceSpoken').map(s => Number(s.gas_used))),
        Math.max(...swaps.filter(s => s.event === 'SentenceSpoken').map(s => Number(s.gas_used)))] }));
  } finally { await provider.destroy(); }
});
