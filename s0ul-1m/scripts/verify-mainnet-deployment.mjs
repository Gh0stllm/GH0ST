#!/usr/bin/env node
// Independent read-only verification. No signer, environment keys or send RPCs.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { AbiCoder, Interface, getAddress, getCreateAddress, keccak256, formatEther } from 'ethers';

const root = fileURLToPath(new URL('../', import.meta.url));
const CHECKPOINT = '0x44bed666c464273e6fff84b10a4977744d9b0e923f5b6a519d7725920b500692';
const CONFIG_TYPE = 'tuple(uint16 vocabSize,uint16 dim,uint16 layers,uint16 heads,uint16 hiddenDim,uint16 maxSeqLen,uint32 epsQ28,uint32 attentionScaleQ14)';
const names = ['S0ULModel', 'S0ULTokenizer', 'S0ULInference'];
const readMethods = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode',
  'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_call']);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
  value && typeof value === 'object' ? '{' + Object.keys(value).filter(k => value[k] !== undefined).sort()
    .map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
const sameHex = (actual, expected, context) => {
  assert.equal(typeof actual, 'string', context); assert.equal(typeof expected, 'string', context);
  assert.match(actual, /^0x(?:[0-9a-f]{2})*$/i, context); assert.match(expected, /^0x(?:[0-9a-f]{2})*$/i, context);
  assert.equal(actual.toLowerCase(), expected.toLowerCase(), context);
};
const sameAddress = (actual, expected, context) => assert.equal(getAddress(actual), getAddress(expected), context);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const quantity = (value, context) => {
  assert.equal(typeof value, 'string', context);
  assert.match(value, /^0x[0-9a-f]+$/i, context);
  return BigInt(value);
};
const bytes = (value, context) => {
  assert.equal(typeof value, 'string', context);
  assert.match(value, /^0x(?:[0-9a-f]{2})*$/i, context);
  return Buffer.from(value.slice(2), 'hex');
};

function optionsFrom(argv) {
  const options = {};
  const allowed = new Set(['rpc', 'journal', 'manifest', 'build', 'output', 'timeout-ms']);
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].slice(2);
    assert.ok(argv[i].startsWith('--') && allowed.has(name) && argv[i + 1] !== undefined && !(name in options), 'Use unique supported --name value pairs');
    options[name] = argv[i + 1];
  }
  assert.ok(options.rpc && options.manifest && options.build, '--rpc, --manifest and --build are required');
  const url = new URL(options.rpc);
  assert.ok(['https:', 'http:'].includes(url.protocol), 'RPC must use HTTP(S)');
  assert.equal(url.username + url.password + url.hash, '', 'RPC URL must not contain credentials or fragment');
  options.timeout = Number(options['timeout-ms'] ?? 15000);
  assert.ok(Number.isSafeInteger(options.timeout) && options.timeout >= 1000 && options.timeout <= 30000, 'Read timeout must be 1000..30000 milliseconds');
  options.journal = resolve(options.journal ?? resolve(root, 'deployments/robinhood-mainnet.json'));
  options.manifest = resolve(options.manifest);
  options.build = resolve(options.build);
  options.output = resolve(options.output ?? resolve(root, 'reports/robinhood-mainnet-deployment-verification.json'));
  assert.ok(![options.journal, options.manifest, options.build].includes(options.output), 'Report must not replace an input');
  return options;
}

function reader(url, timeout) {
  let nextStart = 0, id = 0, active = false, requests = 0, retries = 0;
  const rpc = async (method, params) => {
    assert.ok(readMethods.has(method), 'RPC method is outside the read-only whitelist');
    assert.equal(active, false, 'RPC requests must remain sequential');
    active = true;
    try {
      for (let attempt = 1; attempt <= 3; ++attempt) {
        await sleep(Math.max(0, nextStart - Date.now()));
        nextStart = Date.now() + 510; // At most two request starts per second.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        let retryable = false;
        try {
          const requestId = ++id;
          ++requests;
          const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }), signal: controller.signal, redirect: 'error' });
          retryable = [429, 503].includes(response.status);
          if (!response.ok) throw Error('HTTP ' + response.status);
          const body = await response.json();
          assert.ok(body && !Array.isArray(body) && body.id === requestId && body.jsonrpc === '2.0', 'Invalid RPC response envelope');
          if (body.error) {
            retryable = [-32000, -32002, -32005].includes(body.error.code) &&
              /^(?:(?:request|upstream|gateway|connection|network|response)\s+)*(?:timeout|timed\s+out)(?:\b|$)/i.test(String(body.error.message ?? '').trim());
            throw Error('RPC error ' + body.error.code);
          }
          assert.ok(Object.hasOwn(body, 'result'), 'RPC response has no result');
          return body.result;
        } catch (error) {
          retryable ||= controller.signal.aborted || error instanceof TypeError || ['ETIMEDOUT', 'ECONNRESET'].includes(error?.code);
          if (!retryable || attempt === 3) throw Error(method + ' failed after ' + attempt + ' attempt(s): ' + error.message);
          ++retries;
          process.stdout.write(JSON.stringify({ event: 'verification_read_retry', method, attempt }) + '\n');
        } finally { clearTimeout(timer); }
        await sleep(500 * attempt);
      }
    } finally { active = false; }
  };
  return { rpc, stats: () => ({ request_attempts: requests, retried_reads: retries, maximum_rps: 2, maximum_attempts_per_read: 3, timeout_ms: timeout }) };
}

async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write('Usage: node scripts/verify-mainnet-deployment.mjs --rpc URL --manifest VERIFIED/model.json --build VERIFIED/contracts.json [--journal deployments/robinhood-mainnet.json] [--output reports/robinhood-mainnet-deployment-verification.json]\nRead-only; requires a completed 51-contract journal. No signing or transactions.\n');
    return;
  }
  const options = optionsFrom(process.argv.slice(2));
  const journalRaw = readFileSync(options.journal), manifestRaw = readFileSync(options.manifest), buildRaw = readFileSync(options.build);
  const journal = JSON.parse(journalRaw), manifest = JSON.parse(manifestRaw), build = JSON.parse(buildRaw);
  // All local guards run before the first network request.
  assert.equal(journal.format, 'gh0st-s0ul-deployment-v1');
  assert.equal(journal.journalVersion, 2);
  assert.equal(journal.complete, true, 'Deployment must be complete before verification');
  assert.equal(journal.pending, null, 'Complete deployment must have no pending transaction');
  assert.equal(journal.chainId, '4663');
  assert.equal(manifest.format, 'gh0st-s0ul-solidity-v1');
  assert.equal(manifest.shards.length, 48);
  assert.equal(journal.shards.length, 48);
  assert.equal(journal.transactions.length, 51);
  sameHex(manifest.sourceCheckpoint, CHECKPOINT, 'Selected checkpoint');
  sameHex(journal.sourceCheckpoint, CHECKPOINT, 'Journal checkpoint');
  sameHex(manifest.constructor.sourceCheckpoint, CHECKPOINT, 'Constructor checkpoint');
  sameHex(journal.modelManifestHash, manifest.manifestHash, 'Manifest hash pin');
  sameHex(manifest.constructor.manifestHash, manifest.manifestHash, 'Constructor manifest pin');
  assert.equal(journal.modelManifestSha256, sha(manifestRaw), 'Exact verified manifest file');
  assert.equal(canonical(manifest.constructor.config), canonical(manifest.config), 'Constructor configuration');
  assert.equal(manifest.constructor.shardBytes, manifest.shardBytes);
  assert.equal(journal.compiler, build.compiler);
  assert.equal(canonical(journal.sourceSha256), canonical(build.sourceSha256), 'Build source hashes');
  const artifacts = Object.fromEntries(names.map(name => {
    const artifact = build.contracts[name + '.sol'][name];
    return [name, { abi: artifact.abi, creation: keccak256('0x' + artifact.evm.bytecode.object), runtimeTemplate: keccak256('0x' + artifact.evm.deployedBytecode.object) }];
  }));
  const fingerprint = sha(canonical({ compiler: build.compiler, optimizerRuns: build.optimizerRuns, viaIR: build.viaIR,
    evmVersion: build.evmVersion, sourceSha256: build.sourceSha256, artifacts }));
  assert.equal(fingerprint, journal.buildFingerprint, 'Exact deployment build fingerprint');
  const interfaces = Object.fromEntries(names.map(name => [name, new Interface(build.contracts[name + '.sol'][name].abi)]));
  const sender = getAddress(journal.sender);
  const payload = readFileSync(resolve(dirname(options.manifest), manifest.payload.path));
  assert.equal(payload.length, manifest.payload.nbytes);
  assert.equal(sha(payload), manifest.payload.sha256);
  const expectedId = keccak256(AbiCoder.defaultAbiCoder().encode([CONFIG_TYPE, 'bytes32', 'bytes32', 'address[]', 'bytes32[]', 'uint32', 'uint256'],
    [manifest.config, CHECKPOINT, manifest.manifestHash, journal.shards, manifest.shards.map(s => s.runtimeKeccak256), manifest.shardBytes, payload.length]));
  sameHex(journal.modelId, expectedId, 'Expected model ID');
  const stages = [];
  const seenHashes = new Set(), seenAddresses = new Set();
  let previousNonce = -1;
  for (let i = 0; i < 51; ++i) {
    const entry = journal.transactions[i], kind = i < 48 ? 'shard' : ['model', 'tokenizer', 'engine'][i - 48];
    const key = kind === 'shard' ? 'shard:' + i : kind;
    assert.equal(entry.kind, kind); assert.equal(entry.key, key);
    assert.equal(entry.index, kind === 'shard' ? i : undefined);
    assert.ok(Number.isSafeInteger(entry.nonce) && entry.nonce > previousNonce, 'Ordered deployment nonces');
    previousNonce = entry.nonce;
    assert.match(entry.hash, /^0x[0-9a-f]{64}$/i);
    assert.ok(!seenHashes.has(entry.hash.toLowerCase()), 'Unique transaction hash'); seenHashes.add(entry.hash.toLowerCase());
    const address = getAddress(kind === 'shard' ? journal.shards[i] : journal[kind]);
    assert.ok(!seenAddresses.has(address), 'Unique contract address'); seenAddresses.add(address);
    sameAddress(entry.address, address, key + ' journal address');
    sameAddress(entry.predictedAddress, address, key + ' predicted address');
    sameAddress(getCreateAddress({ from: sender, nonce: entry.nonce }), address, key + ' CREATE address');
    let creation, expectedRuntimeHash;
    if (kind === 'shard') {
      const shard = manifest.shards[i];
      assert.equal(shard.index, i); assert.equal(shard.offset, i * manifest.shardBytes);
      const part = payload.subarray(shard.offset, shard.offset + shard.payloadBytes);
      assert.equal(part.length, Math.min(manifest.shardBytes, payload.length - shard.offset));
      assert.equal(sha(part), shard.payloadSha256);
      expectedRuntimeHash = keccak256(Buffer.concat([Buffer.from([0]), part]));
      sameHex(expectedRuntimeHash, shard.runtimeKeccak256, key + ' payload/runtime hash');
      creation = shard.initCodeHex;
      sameHex(keccak256(creation), shard.initCodeKeccak256, key + ' initcode');
    } else {
      const name = { model: 'S0ULModel', tokenizer: 'S0ULTokenizer', engine: 'S0ULInference' }[kind];
      const args = kind === 'model' ? [manifest.config, CHECKPOINT, manifest.manifestHash, journal.shards,
        manifest.shards.map(s => s.runtimeKeccak256), manifest.shardBytes] : kind === 'engine' ? [journal.model, journal.tokenizer] : [];
      creation = '0x' + build.contracts[name + '.sol'][name].evm.bytecode.object + interfaces[name].encodeDeploy(args).slice(2);
      expectedRuntimeHash = journal[kind + 'CodeHash'];
      assert.match(expectedRuntimeHash, /^0x[0-9a-f]{64}$/i);
      if (kind === 'tokenizer') sameHex(expectedRuntimeHash, artifacts.S0ULTokenizer.runtimeTemplate, 'Tokenizer exact compiled runtime');
    }
    sameHex(entry.creationCodeKeccak256, keccak256(creation), key + ' journal creation identity');
    sameHex(entry.runtimeCodeHash, expectedRuntimeHash, key + ' journal runtime identity');
    stages.push({ entry, kind, key, address, creation, expectedRuntimeHash });
  }
  const { rpc, stats } = reader(options.rpc, options.timeout);
  assert.equal(quantity(await rpc('eth_chainId', []), 'Chain ID'), 4663n);
  const startedUtc = new Date().toISOString();
  const startingHead = quantity(await rpc('eth_blockNumber', []), 'Starting head');
  const deployments = [];
  let totalGas = 0n, totalFee = 0n;
  for (const stage of stages) {
    const { entry, kind, key, address, creation, expectedRuntimeHash } = stage;
    const transaction = await rpc('eth_getTransactionByHash', [entry.hash]);
    const receipt = await rpc('eth_getTransactionReceipt', [entry.hash]);
    assert.ok(transaction && receipt, key + ' transaction and receipt exist');
    sameHex(transaction.hash, entry.hash, key + ' transaction hash');
    sameHex(receipt.transactionHash, entry.hash, key + ' receipt hash');
    sameAddress(transaction.from, sender, key + ' transaction sender');
    sameAddress(receipt.from, sender, key + ' receipt sender');
    assert.equal(transaction.to, null, key + ' creation destination');
    assert.equal(receipt.to, null, key + ' receipt creation destination');
    assert.equal(quantity(transaction.chainId, key + ' chain ID'), 4663n);
    assert.equal(quantity(transaction.value, key + ' value'), 0n);
    assert.equal(quantity(transaction.nonce, key + ' nonce'), BigInt(entry.nonce));
    assert.equal(quantity(transaction.gas, key + ' gas limit'), BigInt(entry.gasLimit));
    sameHex(transaction.input, creation, key + ' complete creation bytes');
    assert.equal(quantity(receipt.status, key + ' status'), 1n);
    sameAddress(receipt.contractAddress, address, key + ' receipt contract');
    const blockNumber = quantity(receipt.blockNumber, key + ' block number');
    assert.equal(blockNumber, BigInt(entry.blockNumber));
    sameHex(receipt.blockHash, entry.blockHash, key + ' journal block hash');
    sameHex(transaction.blockHash, receipt.blockHash, key + ' transaction block');
    const gasUsed = quantity(receipt.gasUsed, key + ' gas used');
    assert.equal(gasUsed, BigInt(entry.gasUsed));
    const effectiveGasPrice = quantity(receipt.effectiveGasPrice, key + ' effective gas price');
    const fee = gasUsed * effectiveGasPrice;
    // The public RPC has a short historical-state window. Give each immutable
    // runtime its own fresh snapshot instead of holding one across the run.
    const codeSnapshot = await rpc('eth_getBlockByNumber', ['latest', false]);
    assert.ok(codeSnapshot && codeSnapshot.hash, key + ' fresh code snapshot');
    const codeBlock = quantity(codeSnapshot.number, key + ' code snapshot number');
    assert.ok(blockNumber <= codeBlock, key + ' deployment precedes code snapshot');
    const code = await rpc('eth_getCode', [address, codeSnapshot.number]);
    const runtime = bytes(code, key + ' runtime');
    assert.ok(runtime.length > 0 && runtime.length <= 24576, key + ' standard runtime size');
    sameHex(keccak256(code), expectedRuntimeHash, key + ' deployed runtime');
    if (kind === 'shard') { assert.equal(runtime.length, manifest.shards[entry.index].runtimeBytes); assert.equal(runtime[0], 0); }
    totalGas += gasUsed; totalFee += fee;
    deployments.push({ stage: key, kind, address, transaction_hash: entry.hash, nonce: entry.nonce,
      block_number: blockNumber.toString(), block_hash: receipt.blockHash, receipt_status: 1,
      runtime_verification_block_number: codeBlock.toString(), runtime_verification_block_hash: codeSnapshot.hash,
      runtime_bytes: runtime.length, runtime_code_keccak256: expectedRuntimeHash,
      gas_used: gasUsed.toString(), effective_gas_price_wei: effectiveGasPrice.toString(),
      actual_fee_wei: fee.toString(), actual_fee_eth: formatEther(fee),
      ...(receipt.gasUsedForL1 !== undefined ? { gas_used_for_l1_as_reported: receipt.gasUsedForL1 } : {}) });
    process.stdout.write(JSON.stringify({ event: 'deployment_verified', stage: key, confirmed: deployments.length, total: 51 }) + '\n');
  }
  assert.equal(totalGas, BigInt(journal.totalDeploymentGas), 'Receipt gas total matches journal');
  // Only final ABI reads share an anchor. Starting it here keeps these reads
  // within the provider's historical-state window during normal operation.
  const identityHead = quantity(await rpc('eth_blockNumber', []), 'Final identity head');
  assert.ok(identityHead >= 50n, 'Final identity anchor has 50 blocks of depth');
  const anchorNumber = identityHead - 50n, blockTag = '0x' + anchorNumber.toString(16);
  const anchor = await rpc('eth_getBlockByNumber', [blockTag, false]);
  assert.ok(anchor && anchor.hash, 'Fresh canonical identity anchor is available');
  assert.equal(quantity(anchor.number, 'Identity anchor number'), anchorNumber);
  const newestDeployment = deployments.reduce((latest, item) => BigInt(item.block_number) > latest ? BigInt(item.block_number) : latest, 0n);
  assert.ok(newestDeployment <= anchorNumber, 'Wait until all deployments are at least 50 blocks deep before verification');
  const call = async (name, address, method, args = [], extra = {}) => {
    const data = interfaces[name].encodeFunctionData(method, args);
    const result = await rpc('eth_call', [{ to: address, data, ...extra }, blockTag]);
    return interfaces[name].decodeFunctionResult(method, result);
  };
  const model = async (method, args) => call('S0ULModel', journal.model, method, args);
  const engine = async (method, args) => call('S0ULInference', journal.engine, method, args);
  const checkConfig = actual => { for (const [key, value] of Object.entries(manifest.config)) assert.equal(actual[key], BigInt(value), key + ' configuration'); };
  checkConfig((await model('configuration'))[0]);
  checkConfig((await engine('configuration'))[0]);
  sameHex((await model('modelId'))[0], expectedId, 'Registry model ID');
  sameHex((await model('sourceCheckpoint'))[0], CHECKPOINT, 'Registry checkpoint');
  sameHex((await model('manifestHash'))[0], manifest.manifestHash, 'Registry manifest hash');
  assert.equal((await model('shardCount'))[0], 48n);
  assert.equal((await model('tensorCount'))[0], BigInt(manifest.tensors.length));
  assert.equal((await model('payloadLength'))[0], BigInt(payload.length));
  assert.equal((await model('shardBytes'))[0], BigInt(manifest.shardBytes));
  for (let i = 0; i < 48; ++i) {
    const info = await model('shardInfo', [i]);
    sameAddress(info[0], journal.shards[i], 'Registry shard address ' + i);
    sameHex(info[1], manifest.shards[i].runtimeKeccak256, 'Registry shard hash ' + i);
  }
  sameAddress((await engine('model'))[0], journal.model, 'Engine model address');
  sameAddress((await engine('tokenizer'))[0], journal.tokenizer, 'Engine tokenizer address');
  sameHex((await engine('modelId'))[0], expectedId, 'Engine model ID');
  assert.equal((await engine('MAX_ROWS'))[0], 128n);
  assert.equal((await engine('MAX_NEW_TOKENS'))[0], 32n);
  sameHex((await engine('TOKENIZER_DOMAIN_SHA256'))[0], manifest.tokenizerDomainSha256, 'Engine dictionary pin');
  sameHex((await call('S0ULTokenizer', journal.tokenizer, 'domainSha256'))[0], manifest.tokenizerDomainSha256, 'Tokenizer dictionary');
  const encoded = Array.from((await call('S0ULTokenizer', journal.tokenizer, 'encode', ['Wait.']))[0], Number);
  assert.deepEqual(encoded, [316, 50], 'Tokenizer Wait. golden IDs');
  const nextId = (await engine('nextRequestId'))[0];
  const simulatedId = (await call('S0ULInference', journal.engine, 'beginText', ['Wait.', 2], { from: sender, value: '0x0', gas: '0xb71b00' }))[0];
  assert.equal(simulatedId, nextId, 'beginText simulation return value');
  assert.equal((await engine('nextRequestId'))[0], nextId, 'Simulation did not persist a request');
  const finalAnchor = await rpc('eth_getBlockByNumber', [blockTag, false]);
  sameHex(finalAnchor?.hash, anchor.hash, 'Verification anchor remains canonical');
  assert.equal(quantity(await rpc('eth_chainId', []), 'Final chain ID'), 4663n);
  const report = { format: 'gh0st-s0ul-mainnet-deployment-verification-v1', verification_started_utc: startedUtc,
    verified_utc: new Date().toISOString(), complete: true,
    chain_id: 4663, verification_mode: 'Per-contract fresh runtime snapshots, followed by one fresh 50-block-deep anchor for ABI identity reads; not an atomic snapshot of all checks.',
    runtime_verification_block_range: { first: deployments[0].runtime_verification_block_number, last: deployments.at(-1).runtime_verification_block_number,
      snapshots: 51, starting_head: startingHead.toString() },
    identity_verification_block_number: anchorNumber.toString(), identity_verification_block_hash: anchor.hash,
    identity_anchor_depth_when_selected: 50,
    read_only: true, transactions_submitted: 0, sender,
    inputs: { journal_sha256: sha(journalRaw), model_manifest_sha256: sha(manifestRaw), build_file_sha256: sha(buildRaw), build_fingerprint: fingerprint },
    model: { checkpoint_sha256: CHECKPOINT.slice(2), manifest_hash: manifest.manifestHash, model_id: expectedId,
      payload_sha256: manifest.payload.sha256, payload_bytes: payload.length, configuration: manifest.config,
      data_shards: 48, required_deployments: 51, registry: journal.model, tokenizer: journal.tokenizer, inference_engine: journal.engine },
    checks: { all_creation_transactions_exact: true, all_receipts_successful: true, all_runtime_hashes_exact: true,
      all_registry_shard_pins_exact: true, model_and_engine_configuration_exact: true, engine_model_and_tokenizer_pins_exact: true,
      tokenizer_compiled_runtime_exact: true, tokenizer_dictionary_exact: true },
    tokenizer_check: { text: 'Wait.', encoded_ids: encoded, prompt_ids_with_bos_sep: [1, ...encoded, 3] },
    begin_text_simulation: { rpc_method: 'eth_call', text: 'Wait.', max_new_tokens: 2, from: sender, value_wei: '0',
      simulated_request_id: simulatedId.toString(), persisted: false, inference_advanced: false },
    fees: { native_currency: 'ETH', receipt_count: 51, total_gas_used: totalGas.toString(),
      total_actual_fee_wei: totalFee.toString(), total_actual_fee_eth: formatEther(totalFee),
      calculation: 'Sum of receipt.gasUsed * receipt.effectiveGasPrice for these 51 deployment transactions.',
      l1_accounting: 'The rollup L1 component is already included in receipt gasUsed; no additional L1 fee is added.',
      scope: 'Includes all 48 shards, registry, tokenizer and engine. Excludes nonce-recovery transactions, other wallet activity and inference.' },
    rpc_reads: stats(), deployments,
    limits: ['Read-only verification and beginText simulation do not execute a complete mainnet inference request.',
      'Runtime checks use separate fresh snapshots to fit the RPC historical-state window; only final ABI identity calls share the final anchor, whose canonical hash is rechecked.',
      'Model and engine runtime hashes are checked against the deployment journal; exact creation bytes are checked against the supplied build.',
      'Source-publication verification is recorded separately. Receipt fees are historical costs, not future fee estimates.'] };
  mkdirSync(dirname(options.output), { recursive: true });
  const temporary = options.output + '.tmp.' + process.pid;
  writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o644, flush: true });
  renameSync(temporary, options.output);
  process.stdout.write(JSON.stringify({ event: 'mainnet_deployment_verified', report: options.output, deployments: 51,
    total_gas_used: totalGas.toString(), actual_fee_eth: formatEther(totalFee), transactions_submitted: 0 }) + '\n');
}

main().catch(error => {
  process.stderr.write('Verification failed: ' + String(error.message).split('\n', 1)[0].slice(0, 500) + '\n');
  process.exitCode = 1;
});
