import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ganache from 'ganache';
import { AbiCoder, BrowserProvider, Contract, ContractFactory, concat, decodeBytes32String,
  keccak256, toBeHex, zeroPadValue } from 'ethers';
import { base, compilationSettings, compileResearch, params } from '../tests/evm/helpers.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(readFileSync(path.join(base, file), 'utf8'));
const modelExport = read('swap-speaker/model/integer-speaker.json');
const vectors = read('swap-speaker/reports/integer-fixtures.json');
const sourceFiles = ['swap-speaker/contracts/SwapSpeakerModel.sol', 'swap-speaker/contracts/SwapSpeakerHook.sol',
  'tests/evm/ResearchHarness.sol'];
const compiled = compileResearch(sourceFiles);
const rpc = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' },
  wallet: { deterministic: true }, miner: { blockGasLimit: 30_000_000, timestampIncrement: 0 } });
const provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
provider.pollingInterval = 10;
const signer = await provider.getSigner(0);
const deploymentReceipts = [];
const deploy = async (file, name, args = []) => {
  const artifact = compiled.contracts[file][name];
  const contract = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy(...args);
  const receipt = await contract.deploymentTransaction().wait();
  deploymentReceipts.push({ contract: name, gas_used: receipt.gasUsed.toString() });
  return contract;
};

// Independent JavaScript BigInt oracle, checked against the Python fixtures.
const raw = Buffer.from(modelExport.weights_hex, 'hex');
const weights = Array.from({ length: raw.length / 2 }, (_, i) => BigInt(raw.readInt16BE(i * 2)));
const offset = name => modelExport.layout[name].offset_elements;
function integerStep(previous, state, features) {
  const next = [];
  for (let row = 0; row < 24; row++) {
    let sum = weights[offset('hidden_bias') + row] * 1024n;
    for (let j = 0; j < 12; j++) sum += weights[offset('input_weight') + row * 12 + j] * weights[previous * 12 + j];
    for (let j = 0; j < 24; j++) sum += weights[offset('recurrent_weight') + row * 24 + j] * BigInt(state[j]);
    for (let j = 0; j < 6; j++) sum += weights[offset('feature_weight') + row * 6 + j] * BigInt(features[j]);
    sum /= 1024n;
    next.push(Number(sum < 0n ? 0n : sum > 8192n ? 8192n : sum));
  }
  const scores = [];
  for (let row = 0; row < modelExport.vocabulary_size; row++) {
    let sum = weights[offset('output_bias') + row] * 1024n;
    for (let j = 0; j < 24; j++) sum += weights[offset('output_weight') + row * 24 + j] * BigInt(next[j]);
    scores.push(sum / 1024n);
  }
  let token = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[token]) token = i;
  return { token, state: next, scores, word: modelExport.vocabulary[token] };
}

try {
  const manager = await deploy('tests/evm/ResearchHarness.sol', 'V4CallbackHarness');
  const model = await deploy('swap-speaker/contracts/SwapSpeakerModel.sol', 'SwapSpeakerModel',
    [modelExport.vocabulary_size, '0x' + modelExport.weights_hex, '0x' + modelExport.vocabulary_hex]);
  const factory = await deploy('tests/evm/ResearchHarness.sol', 'ResearchCreate2Factory');
  assert.equal(Number(await model.parameterCount()), modelExport.parameters);
  assert.equal(Number(await model.vocabularySize()), modelExport.vocabulary_size);
  const dataCode = await provider.getCode(await model.modelData());
  assert.equal(dataCode, '0x00' + modelExport.weights_hex + modelExport.vocabulary_hex);
  assert.equal(keccak256(dataCode), await model.dataCodeHash());
  let logitMatches = 0;
  for (let start = 0; start < vectors.length; start += 4) {
    const chunk = vectors.slice(start, start + 4);
    const calls = await Promise.allSettled(chunk.map(v => model.inspect(v.previous_token, v.state, v.features)));
    for (let i = 0; i < chunk.length; i++) {
      const v = chunk[i], call = calls[i];
      assert.equal(call.status, 'fulfilled');
      const got = call.value;
      const oracle = integerStep(v.previous_token, v.state, v.features);
      assert.equal(Number(got.token), v.token);
      assert.deepEqual(Array.from(got.nextState, Number), v.next_state);
      assert.deepEqual(Array.from(got.scores, String), v.logits.map(String));
      assert.equal(oracle.token, v.token);
      assert.deepEqual(oracle.state, v.next_state);
      assert.deepEqual(oracle.scores.map(String), v.logits.map(String));
      const [word, terminal] = await model.vocabularyWord(v.token);
      assert.equal(decodeBytes32String(word), v.word);
      assert.equal(terminal, v.terminal);
      logitMatches += v.logits.length;
    }
  }
  console.log(`Verified ${vectors.length} recurrent vectors, ${logitMatches} logits and all hidden states.`);

  const invalid = [
    ['previous_token', modelExport.vocabulary_size + 1, Array(24).fill(0), Array(6).fill(0)],
    ['negative_hidden', 0, [-1, ...Array(23).fill(0)], Array(6).fill(0)],
    ['hidden_above_clamp', 0, [8193, ...Array(23).fill(0)], Array(6).fill(0)],
    ['positive_feature_bound', 0, Array(24).fill(0), [4097, 0, 0, 0, 0, 0]],
    ['negative_feature_bound', 0, Array(24).fill(0), [-4097, 0, 0, 0, 0, 0]],
  ];
  for (const [, previous, state, features] of invalid) await assert.rejects(model.step(previous, state, features));
  await assert.rejects(model.vocabularyWord(modelExport.vocabulary_size));
  const hookArtifact = compiled.contracts['swap-speaker/contracts/SwapSpeakerHook.sol'].SwapSpeakerHook;
  const config = [await manager.getAddress(), await model.getAddress(),
    '0x0000000000000000000000000000000000000100', '0x0000000000000000000000000000000000000200', 60, 3000];
  const request = await new ContractFactory(hookArtifact.abi, hookArtifact.evm.bytecode.object, signer).getDeployTransaction(...config);
  const initHash = keccak256(request.data), factoryAddress = await factory.getAddress();
  let salt, address, attempts;
  for (attempts = 0; attempts < 2_000_000; attempts++) {
    salt = zeroPadValue(toBeHex(attempts), 32);
    address = '0x' + keccak256(concat(['0xff', factoryAddress, salt, initHash])).slice(-40);
    if ((BigInt(address) & 0x3fffn) === 0x1040n) break;
  }
  assert.ok(attempts < 2_000_000);
  const hookDeployment = await (await factory.deploy(salt, request.data, { gasLimit: 8_000_000 })).wait();
  deploymentReceipts.push({ contract: 'SwapSpeakerHook including test factory', gas_used: hookDeployment.gasUsed.toString() });
  const hook = new Contract(address, hookArtifact.abi, signer);
  const key = { currency0: config[2], currency1: config[3], tickSpacing: 60, fee: 3000, hooks: address };
  const init = await (await manager.initialize(key, 0)).wait();
  const initialBlock = await provider.getBlock(init.blockNumber);
  const poolId = await hook.poolId(), modelHash = await model.modelHash();
  assert.equal(BigInt(address) & 0x3fffn, 0x1040n);
  await assert.rejects(hook.afterSwap.staticCall(await signer.getAddress(), key, params, 0, '0x'));
  await assert.rejects(manager.driveAfterSwap.staticCall({ ...key, fee: 500 }, params, 1, '0x'));
  let reference = { tick: 0, move: 0, ewma: 0, timestamp: initialBlock.timestamp,
    sequence: 0, sentence: 1, wordIndex: 0, previous: modelExport.bos_token, state: Array(24).fill(0) };
  const words = [], measurements = [];
  const abi = AbiCoder.defaultAbiCoder();
  async function checkReceipt(receipt, ticks) {
    const events = receipt.logs.filter(log => log.address.toLowerCase() === address.toLowerCase())
      .map(log => hook.interface.parseLog(log)).filter(event => event.name === 'WordSpoken');
    assert.equal(events.length, ticks.length);
    const timestamp = (await provider.getBlock(receipt.blockNumber)).timestamp;
    for (let i = 0; i < ticks.length; i++) {
      const tick = ticks[i], c = reference;
      const move = Math.min(Math.abs(tick - c.tick), 1024);
      const features = [move * 4, c.ewma * 4, Math.abs(move - c.move) * 4,
        Math.floor(Math.min(Math.max(timestamp - c.timestamp, 0), 300) * 1024 / 300), 1024, 1024];
      const prediction = integerStep(c.previous, c.state, features);
      const event = events[i].args;
      const terminal = prediction.word.endsWith('.'), forced = !terminal && c.wordIndex === 15;
      assert.equal(event.word, prediction.word);
      assert.equal(event.sequence, BigInt(c.sequence + 1));
      assert.equal(event.sentence, BigInt(c.sentence));
      assert.equal(event.wordIndex, BigInt(c.wordIndex));
      assert.equal(event.sentenceEnd, terminal);
      assert.equal(event.forcedReset, forced);
      const inputHash = keccak256(abi.encode(['bytes32', 'bytes32', 'uint64', 'uint16', 'int16[24]', 'int32[6]'],
        [poolId, modelHash, c.sequence + 1, c.previous, c.state, features]));
      assert.equal(event.inputHash, inputHash);
      words.push({ sequence: c.sequence + 1, sentence: c.sentence, word_index: c.wordIndex,
        word: event.word, terminal, forced_reset: forced, features, input_hash: inputHash, block_number: receipt.blockNumber });
      reference = { tick, move, ewma: Math.floor((c.ewma * 7 + move) / 8), timestamp, sequence: c.sequence + 1,
        sentence: c.sentence + (terminal || forced ? 1 : 0), wordIndex: terminal || forced ? 0 : c.wordIndex + 1,
        previous: terminal || forced ? modelExport.bos_token : prediction.token,
        state: terminal || forced ? Array(24).fill(0) : prediction.state };
    }
    const actual = await hook.context();
    assert.equal(Number(actual.sequence), reference.sequence);
    assert.equal(Number(actual.previousToken), reference.previous);
    assert.equal(Number(actual.ewmaMove), reference.ewma);
    assert.deepEqual(Array.from(await hook.hiddenState(), Number), reference.state);
    measurements.push({ callbacks: ticks.length, transaction_gas: receipt.gasUsed.toString(),
      scope: 'Complete local callback-harness transaction including recurrent inference and events; no AMM math or token settlement' });
  }
  for (let i = 0; i < 32; i++) {
    if (i === 16) await rpc.request({ method: 'evm_increaseTime', params: [600] });
    const move = i < 12 ? 5 : i < 24 ? 90 : 320;
    const tick = reference.tick - move;
    const receipt = await (await manager.driveCallbackCycle(key, params, tick, '0x', { gasLimit: 8_000_000 })).wait();
    await checkReceipt(receipt, [tick]);
    assert.equal(await manager.lastAppliedFee(), 3000n);
  }
  const first = reference.tick - 7, second = reference.tick - 14;
  const receipt = await (await manager.driveTwoAfterCallbacks(key, params, first, second, '0x', { gasLimit: 16_000_000 })).wait();
  await checkReceipt(receipt, [first, second]);
  assert.equal(words.at(-1).block_number, words.at(-2).block_number);
  const sentences = [];
  let sentence = [];
  for (const row of words) {
    sentence.push(row.word);
    if (row.terminal || row.forced_reset) { sentences.push({ text: sentence.join(' '), complete: row.terminal }); sentence = []; }
  }
  const singleGas = measurements.filter(row => row.callbacks === 1).map(row => Number(row.transaction_gas));
  const report = { schema_version: 1, status: 'PASSED_LOCAL_EVM', network: 'In-process Ganache Shanghai; no public transactions',
    scope: 'One learned whole-word recurrent output per successful local afterSwap callback; persistent onchain hidden state',
    vocabulary_tokens: modelExport.vocabulary_size,
    distinct_lexical_words_ignoring_periods: new Set(modelExport.vocabulary.map(word => word.replace(/\.$/, ''))).size,
    parameters: modelExport.parameters, model_hash: modelHash, data_runtime_keccak256: await model.dataCodeHash(),
    compiler_settings: compilationSettings, constructor_hook_flags: '0x1040',
    python_js_solidity_parity: { fixtures: vectors.length, logits_matched: logitMatches, all_hidden_states_exact: true },
    invalid_inputs_rejected: [...invalid.map(row => row[0]), 'vocabulary_index'],
    unauthorized_and_wrong_pool_callbacks_rejected: true,
    word_events: words.length, sentences, unfinished_sentence: sentence.join(' '),
    every_callback_emits_exactly_one_word: true, multiple_callbacks_same_block_verified: true,
    fixed_lp_fee_unchanged_in_callback_harness: true, gas_range_single_callback_transactions: [Math.min(...singleGas), Math.max(...singleGas)],
    deployment_receipts: deploymentReceipts, measurements,
    source_sha256: Object.fromEntries([...sourceFiles, 'scripts/bench-speaker.mjs'].map(file => [file, sha256(readFileSync(path.join(base, file)))])),
    limitations: ['Uses the upstream hook library with a callback/state-layout harness, not a real PoolManager swap.',
      'Gas includes harness, transaction overhead, full model execution, persistent state writes and the word event.',
      'The vocabulary is 54 lexical words represented by 94 tokens including period-bearing variants, not open-domain language.',
      'Synthetic grammar training does not establish insight, economic accuracy or robust sentence coherence.',
      'A reverted outer swap rolls back state and events; speech stops when swaps stop.',
      'No GitHub-hosted training or public-chain deployment was performed.'] };
  writeFileSync(path.join(base, 'swap-speaker/reports/evm-benchmark.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(path.join(base, 'swap-speaker/reports/swap-word-stream.json'), JSON.stringify(words, null, 2) + '\n');
  console.log(JSON.stringify({ word_events: words.length, sentences, gas_range: report.gas_range_single_callback_transactions,
    parity: report.python_js_solidity_parity }, null, 2));
} finally { await provider.destroy(); await rpc.disconnect(); }
