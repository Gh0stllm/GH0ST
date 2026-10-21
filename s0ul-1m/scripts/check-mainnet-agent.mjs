#!/usr/bin/env node
// Read-only proof of one real model -> controller -> owner-memory action.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { AbiCoder, Interface, getAddress, keccak256, formatEther, encodeBytes32String, toUtf8Bytes } from 'ethers';

const root = fileURLToPath(new URL('../', import.meta.url));
const methods = new Set(['eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call']);
const reasons = new Set(['public_pool_busy', 'rate_limit_exceeded', 'rate_limited', 'too_many_requests', 'pool_busy', 'pool_saturated',
  'quota_exceeded', 'upstream_timeout', 'request_timeout', 'upstream_unavailable', 'batch_not_supported', 'batch_unsupported', 'batch_too_large', 'batch_limit_exceeded']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const qty = value => { assert.equal(typeof value, 'string'); assert.match(value, /^0x[0-9a-f]+$/i); return BigInt(value); };
const hexEqual = (a, b, message) => { assert.equal(typeof a, 'string', message); assert.equal(typeof b, 'string', message); assert.equal(a.toLowerCase(), b.toLowerCase(), message); };
const addressEqual = (a, b, message) => assert.equal(getAddress(a), getAddress(b), message);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ?
  '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
const file = path => { const raw = readFileSync(path); return { raw, json: JSON.parse(raw), sha256: sha(raw) }; };

async function main() {
  const options = { ledger: [] };
  const allowed = new Set(['rpc', 'build', 'deployment', 'agent', 'adopt', 'finalize', 'reference', 'ledger', 'request-id', 'output', 'timeout-ms']);
  for (let i = 2; i < process.argv.length; i += 2) {
    const name = process.argv[i].slice(2), value = process.argv[i + 1];
    assert.ok(process.argv[i].startsWith('--') && allowed.has(name) && value !== undefined, 'Use supported --name value pairs');
    if (name === 'ledger') options.ledger.push(resolve(value));
    else { assert.ok(!(name in options), 'Only --ledger may be repeated'); options[name] = value; }
  }
  assert.ok(options.rpc && options.build, '--rpc and --build are required');
  const endpoint = new URL(options.rpc);
  assert.ok(['https:', 'http:'].includes(endpoint.protocol)); assert.equal(endpoint.username + endpoint.password + endpoint.hash, '');
  const timeout = Number(options['timeout-ms'] ?? 15000);
  assert.ok(Number.isSafeInteger(timeout) && timeout >= 1000 && timeout <= 30000);
  const requestId = BigInt(options['request-id'] ?? 2); assert.ok(requestId > 0n);
  const paths = {
    base: resolve(options.deployment ?? resolve(root, 'deployments/robinhood-mainnet.json')),
    agent: resolve(options.agent ?? resolve(root, 'deployments/robinhood-mainnet-agent.json')),
    adopt: resolve(options.adopt ?? resolve(root, 'deployments/agent-adopt-' + requestId + '.json')),
    finalize: resolve(options.finalize ?? resolve(root, 'deployments/agent-finalize-' + requestId + '.json')),
    reference: resolve(options.reference ?? resolve(root, 'reports/agent-memory-reference.json')),
    build: resolve(options.build),
  };
  if (!options.ledger.length) options.ledger = [resolve(root, 'deployments/robinhood-mainnet-agent-memory-000.json'), resolve(root, 'deployments/agent-memory-batch.json')];
  const output = resolve(options.output ?? resolve(root, 'reports/robinhood-mainnet-agent-check.json'));
  assert.ok(![...Object.values(paths), ...options.ledger].includes(output), 'Report must not replace an input');
  const inputs = Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, file(path)]));
  const { json: base } = inputs.base, { json: agent } = inputs.agent, { json: adopt } = inputs.adopt,
    { json: finalize } = inputs.finalize, { json: reference } = inputs.reference, { json: build } = inputs.build;
  assert.equal(base.complete, true); assert.equal(base.pending, null); assert.equal(base.chainId, '4663'); assert.equal(base.transactions.length, 51);
  assert.equal(base.sourceCheckpoint, '0x44bed666c464273e6fff84b10a4977744d9b0e923f5b6a519d7725920b500692');
  assert.equal(reference.source_checkpoint_sha256, base.sourceCheckpoint.slice(2));
  assert.equal(reference.format, 'gh0st-s0ul-agent-memory-reference-v1');
  assert.equal(reference.decisions.length, 5); assert.ok(reference.decisions.every(x => x.logits.length === 512));
  assert.equal(reference.max_new_tokens, 5); assert.equal(reference.expected_output_ids.at(-1), 2);
  const memoryAction = /^MEM_SET\|(theme|language|mode)\|([a-z][a-z0-9_]{0,23})$/.exec(reference.expected_action);
  assert.ok(memoryAction, 'Golden reference must identify one bounded memory action');
  const memoryKey = encodeBytes32String(memoryAction[1]), memoryValue = '0x' + Buffer.from(memoryAction[2], 'ascii').toString('hex');
  const actionBytes = '0x' + Buffer.from(reference.expected_action, 'ascii').toString('hex'), actionHash = keccak256(actionBytes);
  assert.equal(agent.format, 'gh0st-s0ul-agent-deployment-v1'); assert.equal(agent.complete, true); assert.equal(agent.pending, null);
  assert.equal(agent.chainId, '4663'); hexEqual(agent.engine, base.engine); hexEqual(agent.modelId, base.modelId);
  const owner = getAddress(adopt.sender), controller = getAddress(agent.controller), engine = getAddress(base.engine), tokenizer = getAddress(base.tokenizer);
  addressEqual(finalize.sender, owner); addressEqual(agent.sender, owner);
  const artifact = name => build.contracts[name + '.sol'][name];
  const engineABI = new Interface(artifact('S0ULInference').abi), agentABI = new Interface(artifact('S0ULAgent').abi), tokenizerABI = new Interface(artifact('S0ULTokenizer').abi);
  assert.equal(build.compiler, base.compiler);
  for (const [name, hash] of Object.entries(base.sourceSha256)) assert.equal(build.sourceSha256[name], hash, 'Existing deployed source identity');
  const a = artifact('S0ULAgent');
  const fingerprint = sha(canonical({ compiler: build.compiler, optimizerRuns: build.optimizerRuns, viaIR: build.viaIR,
    evmVersion: build.evmVersion, sourceSha256: build.sourceSha256, abi: a.abi, creation: a.evm.bytecode.object, runtime: a.evm.deployedBytecode.object }));
  assert.equal(agent.buildFingerprint, fingerprint); assert.equal(agent.baseDeploymentSha256, inputs.base.sha256);
  const mask = Number(adopt.allowedActions); assert.ok(Number.isSafeInteger(mask) && mask >= 0 && mask <= 1023 && (mask & 8) !== 0);
  for (const [operation, journal] of [['adopt', adopt], ['finalize', finalize]]) {
    assert.equal(journal.operation, operation); assert.equal(journal.chainId, '4663'); assert.equal(BigInt(journal.requestId), requestId);
    addressEqual(journal.sender, owner); addressEqual(journal.engine, engine); addressEqual(journal.to, controller);
    hexEqual(journal.modelId, base.modelId); hexEqual(journal.expectedActionHash, actionHash);
    assert.equal(Number(journal.allowedActions), mask); assert.equal(journal.buildFingerprint, fingerprint);
    assert.equal(journal.baseDeploymentSha256, inputs.base.sha256);
  }
  const entries = new Map(), snapshots = new Map(), ledgerEvidence = [];
  const addEntry = (entry, category, destination, pending = null) => {
    assert.match(entry.hash, /^0x[0-9a-f]{64}$/i);
    const hash = entry.hash.toLowerCase(), previous = entries.get(hash);
    if (previous) {
      assert.equal(previous.category, category, 'Duplicate receipt category agrees');
      if (previous.entry.gasUsed !== undefined && entry.gasUsed !== undefined) assert.equal(String(previous.entry.gasUsed), String(entry.gasUsed));
      if (entry.gasUsed !== undefined) previous.entry = entry;
      if (pending) previous.pending = pending;
    } else entries.set(hash, { entry, category, destination, pending });
  };
  for (const [category, journal, destination] of [['agent_deployment', agent, null], ['adoption', adopt, controller], ['finalization', finalize, controller]]) {
    const transaction = journal.transaction ?? journal.pending;
    const hash = transaction?.hash ?? journal.receipt?.hash; assert.ok(hash, category + ' must have a signed transaction hash');
    addEntry({ ...journal.receipt, hash }, category, destination, transaction);
  }
  for (const path of options.ledger) {
    const input = file(path), ledger = input.json;
    const direct = ledger.format === 'gh0st-s0ul-inference-receipts-v1';
    assert.ok(direct || ledger.format === 'gh0st-s0ul-agent-continuation-v1');
    assert.equal(String(ledger.chainId), '4663'); assert.equal(BigInt(ledger.requestId), requestId);
    addressEqual(ledger.engine, engine); hexEqual(ledger.modelId, base.modelId); assert.equal(Number(ledger.rowsPerStep), 128);
    if (ledger.sender) addressEqual(ledger.sender, owner);
    if (!direct) {
      addressEqual(ledger.controller, controller); hexEqual(ledger.controllerCodeHash, agent.controllerCodeHash);
      hexEqual(ledger.expectedActionHash, actionHash); assert.equal(Number(ledger.allowedActions), mask);
      assert.equal(ledger.buildFingerprint, fingerprint); assert.equal(ledger.baseDeploymentSha256, inputs.base.sha256);
    }
    const category = direct ? 'direct_inference' : 'batch_continuation', destination = direct ? engine : controller;
    for (const entry of ledger.transactions) addEntry(entry, category, destination);
    if (ledger.pending) { assert.ok(ledger.pending.hash, 'An unsigned pending marker must be resolved before verification'); addEntry({ hash: ledger.pending.hash }, category, destination, ledger.pending); }
    for (const snapshot of ledger.decisions ?? []) {
      const index = Number(snapshot.generated); assert.ok(Number.isSafeInteger(index) && index >= 0 && index < reference.decisions.length);
      const normalized = { position: Number(snapshot.position), generated: index, prefix_ids: snapshot.prefix_ids.map(Number), logits: snapshot.logits.map(Number) };
      assert.deepEqual(normalized.prefix_ids, reference.decisions[index].prefix_ids);
      assert.deepEqual(normalized.logits, reference.decisions[index].logits, 'Captured logits match the independent Python reference');
      if (snapshots.has(index)) assert.deepEqual(snapshots.get(index), normalized); else snapshots.set(index, normalized);
    }
    if (ledger.generatedTokenIds) {
      const ids = ledger.generatedTokenIds.map(Number);
      assert.deepEqual(ids, reference.expected_output_ids.slice(0, ids.length));
      if (ledger.complete) assert.deepEqual(ids, reference.expected_output_ids);
    }
    if (ledger.saturatedValues !== undefined) assert.equal(BigInt(ledger.saturatedValues), 0n);
    ledgerEvidence.push({ sha256: input.sha256, format: ledger.format, complete_recorded: Boolean(ledger.complete),
      receipt_entries: ledger.transactions.length, signed_pending_hash: ledger.pending?.hash ?? null, captured_decisions: (ledger.decisions ?? []).length });
  }

  let nextStart = 0, nextId = 0, attempts = 0, retries = 0, batchRequests = 0, singleRequests = 0;
  const batchUnsupported = (body, status) => {
    if ([401, 403, 429, 503].includes(status)) return false;
    // A single Invalid Request response to our valid JSON-RPC array is the
    // standard shape of a server that does not accept batching.
    if (!Array.isArray(body) && body?.error?.code === -32600) return true;
    const errors = Array.isArray(body) ? body.map(x => x?.error) : [body?.error];
    return errors.length > 0 && errors.every(error => error &&
      (['batch_not_supported', 'batch_unsupported', 'batch_too_large', 'batch_limit_exceeded'].includes(error?.data?.reason ?? error?.reason) ||
       ([-32600, -32601].includes(error.code) && /\bbatch\b.*\b(?:unsupported|not supported|disabled|not allowed|limit|large)\b|\b(?:unsupported|disabled)\b.*\bbatch\b/i.test(String(error.message ?? '')))));
  };
  const request = async calls => {
    assert.ok(calls.length >= 1 && calls.length <= 10);
    for (const call of calls) assert.ok(methods.has(call.method), 'Only read-only RPC methods are allowed');
    assert.ok(calls.length === 1 || calls.every(x => x.method === 'eth_getTransactionReceipt'), 'Only receipt reads may be batched');
    const batched = calls.length > 1, deadline = Date.now() + 60000;
    for (let attempt = 1; attempt <= 6; ++attempt) {
      const wait = Math.max(0, nextStart - Date.now());
      if (Date.now() + wait >= deadline) throw Error('Read budget exhausted');
      await sleep(wait);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw Error('Read budget exhausted');
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.min(timeout, remaining));
      let transient = false, pool = false, after = 0, details = {};
      try {
        const payload = calls.map(call => ({ jsonrpc: '2.0', id: ++nextId, method: call.method, params: call.params }));
        ++attempts; if (batched) ++batchRequests; else ++singleRequests;
        const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(batched ? payload : payload[0]), signal: controller.signal, redirect: 'error' });
        details.status = response.status;
        transient = [429, 503].includes(response.status);
        let body;
        try { body = await response.json(); } catch { if (response.ok) throw Error('Invalid JSON-RPC response'); }
        if (batched && batchUnsupported(body, response.status)) {
          const error = Error('Receipt batching unsupported'); error.batchUnsupported = true; throw error;
        }
        const errorItems = (Array.isArray(body) ? body : [body]).map(x => x?.error).filter(Boolean);
        const candidates = errorItems.map(error => error?.data?.reason ?? error?.reason);
        const reason = body?.reason ?? candidates[0] ?? body?.data?.reason;
        if (reasons.has(reason)) details.reason = reason;
        if (Number.isSafeInteger(errorItems[0]?.code)) details.code = errorItems[0].code;
        pool = response.status === 429 && details.reason === 'public_pool_busy';
        if (!response.ok) {
          const header = response.headers.get('retry-after');
          const seconds = typeof header === 'string' && /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) : NaN;
          const delay = Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : typeof header === 'string' ? Math.max(0, Date.parse(header) - Date.now()) : 0;
          after = Math.max(response.status === 429 ? 1000 : 0, Number.isFinite(delay) ? delay : 0);
          throw Error('HTTP ' + response.status);
        }
        if (errorItems.length) {
          transient = errorItems.every(error => [-32000, -32002, -32005].includes(error.code) &&
            /^(?:(?:request|upstream|gateway|connection|network|response)\s+)*(?:timeout|timed\s+out)(?:\b|$)/i.test(String(error.message ?? '').trim()));
          throw Error('JSON-RPC read error');
        }
        const replies = batched ? body : [body];
        assert.ok(Array.isArray(replies) && replies.length === payload.length, 'RPC response count');
        const seen = new Set();
        const results = payload.map(item => {
          const reply = replies.find(x => x?.id === item.id);
          assert.ok(reply && reply.jsonrpc === '2.0' && Object.hasOwn(reply, 'result') && !seen.has(reply.id), 'RPC response identity');
          seen.add(reply.id); return reply.result;
        });
        if (Date.now() >= deadline) throw Error('Read budget exhausted');
        return results;
      } catch (error) {
        if (error.batchUnsupported) throw error;
        transient ||= controller.signal.aborted || error instanceof TypeError || ['ETIMEDOUT', 'ECONNRESET'].includes(error?.code);
        if (controller.signal.aborted) details.code = 'TIMEOUT';
        const maximumAttempts = pool ? 6 : 3, delay = Math.max(500 * attempt, after);
        if (!transient || attempt >= maximumAttempts || Date.now() + Math.max(510, delay) >= deadline) throw Error('Read failed after ' + attempt + ' attempt(s): ' + error.message);
        ++retries; nextStart = Math.max(nextStart, Date.now() + delay);
        process.stdout.write(JSON.stringify({ event: 'deployment_check_read_retry', methods: calls.map(x => x.method), attempt, maximumAttempts, ...details }) + '\n');
      } finally { clearTimeout(timer); nextStart = Math.max(nextStart, Date.now() + 510); }
    }
  };
  const one = async (method, params = []) => (await request([{ method, params }]))[0];

  assert.equal(qty(await one('eth_chainId')), 4663n);
  const recorded = [...entries.values()], receipts = [];
  let batching = true;
  const parseEvents = (receipt, address, abi) => receipt.logs.filter(log => getAddress(log.address) === address)
    .map(log => { try { return abi.parseLog(log); } catch { return null; } }).filter(Boolean);
  for (let i = 0; i < recorded.length; i += 10) {
    const chunk = recorded.slice(i, i + 10);
    let results;
    if (batching) {
      try { results = await request(chunk.map(x => ({ method: 'eth_getTransactionReceipt', params: [x.entry.hash] }))); }
      catch (error) { if (!error.batchUnsupported) throw error; batching = false; }
    }
    if (!results) { results = []; for (const item of chunk) results.push(await one('eth_getTransactionReceipt', [item.entry.hash])); }
    for (let j = 0; j < chunk.length; ++j) {
      const item = chunk[j], { entry, category, destination, pending } = item, receipt = results[j];
      assert.ok(receipt, 'Every supplied signed hash must have a mined receipt'); hexEqual(receipt.transactionHash, entry.hash);
      addressEqual(receipt.from, owner);
      if (destination) addressEqual(receipt.to, destination); else { assert.equal(receipt.to, null); addressEqual(receipt.contractAddress, controller); }
      const status = qty(receipt.status), gas = qty(receipt.gasUsed), price = qty(receipt.effectiveGasPrice), fee = gas * price;
      assert.ok(status === 0n || status === 1n);
      if (entry.status !== undefined) assert.equal(status, BigInt(entry.status));
      if (entry.gasUsed !== undefined) assert.equal(gas, BigInt(entry.gasUsed));
      if (entry.blockNumber !== undefined) assert.equal(qty(receipt.blockNumber), BigInt(entry.blockNumber));
      if (entry.blockHash) hexEqual(receipt.blockHash, entry.blockHash);
      if (pending) {
        const transaction = await one('eth_getTransactionByHash', [entry.hash]);
        assert.ok(transaction); hexEqual(transaction.hash, entry.hash); addressEqual(transaction.from, owner);
        if (destination) addressEqual(transaction.to, destination); else assert.equal(transaction.to, null);
        assert.equal(qty(transaction.chainId), 4663n); assert.equal(qty(transaction.value), 0n);
        if (pending.nonce !== undefined) assert.equal(qty(transaction.nonce), BigInt(pending.nonce));
        if (pending.gasLimit !== undefined) assert.equal(qty(transaction.gas), BigInt(pending.gasLimit));
        const dataHash = pending.calldataKeccak256 ?? (category === 'agent_deployment' ? agent.calldataKeccak256 : category === 'adoption' ? adopt.calldataKeccak256 : category === 'finalization' ? finalize.calldataKeccak256 : undefined);
        if (dataHash) hexEqual(keccak256(transaction.input), dataHash, 'Exact signed calldata identity');
        if (category === 'agent_deployment') {
          const creation = '0x' + a.evm.bytecode.object + agentABI.encodeDeploy([engine, base.engineCodeHash, base.modelId, agent.gh0stToken]).slice(2);
          hexEqual(transaction.input, creation, 'Exact reviewed controller creation and constructor arguments');
        }
      }
      const engineEvents = parseEvents(receipt, engine, engineABI), agentEvents = parseEvents(receipt, controller, agentABI);
      if (status === 1n) {
        for (const event of [...engineEvents, ...agentEvents]) if (event.args.requestId !== undefined) assert.equal(event.args.requestId, requestId);
        const begins = engineEvents.filter(x => x.name === 'Begun'), advances = engineEvents.filter(x => x.name === 'Advanced');
        if (category === 'direct_inference') assert.equal(begins.length + advances.length, 1);
        if (category === 'batch_continuation') {
          assert.equal(begins.length, 0); assert.ok(advances.length <= 4);
          const batches = agentEvents.filter(x => x.name === 'BatchAdvanced'); assert.equal(batches.length, 1);
          assert.equal(batches[0].args.executed, BigInt(advances.length));
          if (entry.plannedSteps !== undefined) assert.ok(advances.length <= Number(entry.plannedSteps));
        }
        if (category === 'adoption') assert.equal(agentEvents.filter(x => x.name === 'Bound').length, 1);
        if (category === 'finalization') assert.equal(agentEvents.filter(x => x.name === 'Executed').length, 1);
        if (!['direct_inference', 'batch_continuation'].includes(category)) assert.equal(engineEvents.length, 0);
      } else { assert.equal(engineEvents.length, 0); assert.equal(agentEvents.length, 0); }
      receipts.push({ category, status: Number(status), hash: entry.hash, block_number: qty(receipt.blockNumber).toString(),
        transaction_index: qty(receipt.transactionIndex).toString(), block_hash: receipt.blockHash,
        from: receipt.from, to: receipt.to, contract_address: receipt.contractAddress, gas_used: gas.toString(),
        effective_gas_price_wei: price.toString(), actual_fee_wei: fee.toString(), actual_fee_eth: formatEther(fee),
        resolved_signed_pending: Boolean(pending && entry.gasUsed === undefined), engineEvents, agentEvents });
    }
    process.stdout.write(JSON.stringify({ event: 'agent_receipts_checked', checked: receipts.length, total: recorded.length }) + '\n');
  }
  receipts.sort((a, b) => BigInt(a.block_number) < BigInt(b.block_number) ? -1 : BigInt(a.block_number) > BigInt(b.block_number) ? 1 : Number(BigInt(a.transaction_index) - BigInt(b.transaction_index)));
  const successful = receipts.filter(x => x.status === 1), engineEvents = successful.flatMap(x => x.engineEvents), agentEvents = successful.flatMap(x => x.agentEvents);
  for (const category of ['agent_deployment', 'adoption', 'finalization']) assert.equal(successful.filter(x => x.category === category).length, 1);
  const begins = engineEvents.filter(x => x.name === 'Begun'), advances = engineEvents.filter(x => x.name === 'Advanced');
  assert.equal(begins.length, 1); assert.equal(advances.length, reference.expected_128_row_transactions - 1, 'All logical engine phases are accounted for, including inner batch steps');
  const begun = begins[0].args;
  addressEqual(begun.owner, owner); hexEqual(begun.modelId, base.modelId); assert.equal(begun.promptLength, BigInt(reference.prompt_ids.length)); assert.equal(begun.maxNewTokens, BigInt(reference.max_new_tokens));
  const coder = AbiCoder.defaultAbiCoder(), promptHash = keccak256(coder.encode(['uint16[]'], [reference.prompt_ids])), outputHash = keccak256(coder.encode(['uint16[]'], [reference.expected_output_ids]));
  hexEqual(begun.requestHash, keccak256(coder.encode(['bytes32', 'address', 'uint16[]', 'uint16'], [base.modelId, owner, reference.prompt_ids, reference.max_new_tokens])));
  const generated = engineEvents.filter(x => x.name === 'TokenGenerated');
  assert.deepEqual(generated.map(x => Number(x.args.tokenId)), reference.expected_output_ids);
  assert.deepEqual(generated.map(x => Number(x.args.outputIndex)), reference.expected_output_ids.map((_, i) => i));
  const completed = engineEvents.filter(x => x.name === 'Completed'); assert.equal(completed.length, 1);
  assert.equal(completed[0].args.generated, BigInt(reference.expected_output_ids.length)); assert.equal(completed[0].args.endedWithEOS, true); assert.equal(completed[0].args.saturationCount, 0n);
  const bounds = agentEvents.filter(x => x.name === 'Bound'), executions = agentEvents.filter(x => x.name === 'Executed');
  assert.equal(bounds.length, 1); assert.equal(executions.length, 1);
  addressEqual(bounds[0].args.owner, owner); hexEqual(bounds[0].args.modelId, base.modelId); assert.equal(bounds[0].args.allowedActions, BigInt(mask));
  assert.equal(bounds[0].args.adopted, true); hexEqual(bounds[0].args.promptHash, promptHash);
  addressEqual(executions[0].args.owner, owner); assert.equal(executions[0].args.kind, 3n); hexEqual(executions[0].args.outputHash, outputHash);
  const executedResult = coder.decode(['bytes32', 'bytes'], executions[0].args.result);
  hexEqual(executedResult[0], memoryKey); hexEqual(executedResult[1], memoryValue);
  assert.equal(agentEvents.filter(x => x.name === 'Rejected' || x.name === 'Cancelled').length, 0);

  const ready = [];
  for (const receipt of successful) for (const event of receipt.engineEvents) if (event.name === 'Advanced' && event.args.nextPhase === 16n) ready.push({ receipt, event });
  assert.equal(ready.length, reference.decisions.length);
  const archivedDecisions = [];
  for (let i = 0; i < ready.length; ++i) {
    const { receipt, event } = ready[i], golden = reference.decisions[i], tag = '0x' + BigInt(receipt.block_number).toString(16);
    assert.equal(event.args.position, BigInt(golden.prefix_ids.length - 1));
    const block = await one('eth_getBlockByNumber', [tag, false]); hexEqual(block?.hash, receipt.block_hash, 'Historical decision block is canonical');
    const read = async method => engineABI.decodeFunctionResult(method, await one('eth_call', [{ to: engine, data: engineABI.encodeFunctionData(method, [requestId]) }, tag]))[0];
    const logits = Array.from(await read('logits'), Number), tokens = Array.from(await read('tokens'), Number);
    assert.deepEqual(logits, golden.logits, 'Every historical decision logit matches Python');
    assert.deepEqual(tokens.slice(0, golden.prefix_ids.length), golden.prefix_ids);
    assert.ok(tokens.length === golden.prefix_ids.length || tokens.length === golden.prefix_ids.length + 1);
    if (tokens.length > golden.prefix_ids.length) assert.equal(tokens.at(-1), golden.next_id);
    assert.equal(logits.indexOf(Math.max(...logits)), golden.next_id);
    hexEqual((await one('eth_getBlockByNumber', [tag, false]))?.hash, block.hash, 'Historical decision canonical recheck');
    archivedDecisions.push({ decision: i, ready_transaction_hash: receipt.hash, block_number: receipt.block_number, block_hash: block.hash,
      reference_prefix_ids: golden.prefix_ids, tokens_as_of_block: tokens, logits, next_id: golden.next_id, all_logits_exact: true, canonical_hash_rechecked: true });
  }

  assert.equal(qty(await one('eth_chainId')), 4663n);
  const finalReceipt = successful.find(x => x.category === 'finalization'), finalNumber = BigInt(finalReceipt.block_number), head = qty(await one('eth_blockNumber'));
  assert.ok(head >= finalNumber + 50n, 'Wait until finalization is at least 50 blocks deep');
  const finalTag = '0x' + finalNumber.toString(16), finalBlock = await one('eth_getBlockByNumber', [finalTag, false]);
  hexEqual(finalBlock?.hash, finalReceipt.block_hash);
  const read = async (abi, address, method, args = []) => abi.decodeFunctionResult(method,
    await one('eth_call', [{ to: address, data: abi.encodeFunctionData(method, args) }, finalTag]));
  for (const [address, hash] of [[controller, agent.controllerCodeHash], [engine, base.engineCodeHash], [base.model, base.modelCodeHash], [tokenizer, base.tokenizerCodeHash]]) hexEqual(keccak256(await one('eth_getCode', [address, finalTag])), hash, 'Final runtime code pin');
  for (const [getter, value] of [['engine', engine], ['model', base.model], ['tokenizer', tokenizer], ['gh0stToken', agent.gh0stToken]]) addressEqual((await read(agentABI, controller, getter))[0], value);
  for (const [getter, value] of [['engineCodeHash', base.engineCodeHash], ['modelCodeHash', base.modelCodeHash], ['tokenizerCodeHash', base.tokenizerCodeHash], ['modelId', base.modelId], ['sourceCheckpoint', base.sourceCheckpoint], ['gh0stCodeHash', agent.gh0stCodeHash]]) hexEqual((await read(agentABI, controller, getter))[0], value);
  const status = (await read(engineABI, engine, 'status', [requestId]))[0];
  addressEqual(status.owner, owner); assert.equal(status.done, true); assert.equal(status.cancelled, false); assert.equal(status.phase, 17n);
  assert.equal(status.generated, BigInt(reference.expected_output_ids.length)); assert.equal(status.saturationCount, 0n);
  assert.deepEqual(Array.from((await read(engineABI, engine, 'tokens', [requestId]))[0], Number), [...reference.prompt_ids, ...reference.expected_output_ids]);
  const outputIds = Array.from((await read(engineABI, engine, 'outputTokens', [requestId]))[0], Number); assert.deepEqual(outputIds, reference.expected_output_ids);
  assert.deepEqual(Array.from((await read(engineABI, engine, 'logits', [requestId]))[0], Number), reference.decisions.at(-1).logits);
  const decoded = (await read(tokenizerABI, tokenizer, 'decode', [outputIds.slice(0, -1), false]))[0]; hexEqual(decoded, actionBytes);
  const binding = await read(agentABI, controller, 'requests', [requestId]);
  addressEqual(binding.owner, owner); assert.equal(binding.adopted, true); assert.equal(binding.allowedActions, BigInt(mask));
  assert.equal(binding.outcome, 2n); assert.equal(binding.action, 3n); assert.equal(binding.reason, 0n);
  hexEqual(binding.promptHash, promptHash); hexEqual(binding.outputHash, outputHash); hexEqual(binding.expectedActionHash, actionHash);
  const result = await read(agentABI, controller, 'resultOf', [requestId]); hexEqual(result[0], actionBytes); hexEqual(result[1], executions[0].args.result);
  hexEqual((await read(agentABI, controller, 'memoryOf', [owner, memoryKey]))[0], memoryValue, 'Actual owner memory at finalization block');
  const revision = (await read(agentABI, controller, 'stateRevision', [owner]))[0]; assert.equal(revision, binding.stateRevision + 1n);
  hexEqual((await one('eth_getBlockByNumber', [finalTag, false]))?.hash, finalBlock.hash, 'Finalization block canonical recheck');
  const feeTotals = list => {
    const gas = list.reduce((sum, x) => sum + BigInt(x.gas_used), 0n), fee = list.reduce((sum, x) => sum + BigInt(x.actual_fee_wei), 0n);
    return { receipts: list.length, gas_used: gas.toString(), actual_fee_wei: fee.toString(), actual_fee_eth: formatEther(fee) };
  };
  const inferenceReceipts = receipts.filter(x => ['direct_inference', 'batch_continuation'].includes(x.category));
  const report = { format: 'gh0st-s0ul-mainnet-agent-verification-v1', verified_utc: new Date().toISOString(), complete: true,
    real_mainnet_generation_and_memory_action_completed: true, checker_read_only: true, checker_transactions_submitted: 0,
    chain_id: 4663, request_id: requestId.toString(), controller, engine, owner, model_id: base.modelId, source_checkpoint_sha256: base.sourceCheckpoint.slice(2),
    prompt_text: reference.prompt_text, prompt_ids: reference.prompt_ids, generated_token_ids: outputIds,
    canonical_action: reference.expected_action, ended_with_eos: true, saturation_count: 0,
    authorization: { allowed_actions: mask, expected_action_keccak256: actionHash, adopted_direct_owner_request: true,
      bound_state_revision: binding.stateRevision.toString(), owner_state_revision_at_finalization: revision.toString() },
    execution: { kind: 3, outcome: 'Executed', exactly_one_executed_event: true, finalize_transaction_hash: finalReceipt.hash,
      memory_key: memoryAction[1], memory_value: memoryAction[2], memory_at_finalize_block_exact: true, result_abi: result[1] },
    independent_reference: { sha256: inputs.reference.sha256, decisions: archivedDecisions.length, independently_reread_logit_values: archivedDecisions.length * 512,
      all_historical_logits_exact: true, captured_cli_decisions: snapshots.size, all_supplied_cli_snapshots_exact: true },
    historical_decisions: archivedDecisions, captured_decisions: [...snapshots.values()].sort((a, b) => a.generated - b.generated),
    engine_progress: { logical_advanced_events: advances.length, begin_events: 1, calculated_unbatched_128_row_transactions: reference.expected_128_row_transactions,
      actual_paid_inference_transactions: inferenceReceipts.length, controller_batch_transactions: inferenceReceipts.filter(x => x.category === 'batch_continuation').length },
    finalization_block: { number: finalNumber.toString(), hash: finalBlock.hash, depth_when_checked: (head - finalNumber).toString(), canonical_hash_rechecked: true },
    fees: { currency: 'ETH', inference: feeTotals(inferenceReceipts), adoption: feeTotals(receipts.filter(x => x.category === 'adoption')),
      finalization: feeTotals(receipts.filter(x => x.category === 'finalization')), shared_agent_deployment: feeTotals(receipts.filter(x => x.category === 'agent_deployment')),
      incremental_request_total_excluding_shared_deployment: feeTotals(receipts.filter(x => x.category !== 'agent_deployment')),
      all_supplied_receipts: feeTotals(receipts), failed_attempts: feeTotals(receipts.filter(x => x.status === 0)),
      calculation: 'Each unique supplied receipt contributes gasUsed * effectiveGasPrice. L1 gas is already included; no additional L1 fee is added.',
      scope: 'Includes supplied direct/batch inference, adoption, finalization and separately labelled shared agent deployment. Excludes old model deployment, unrelated requests and other wallet activity.' },
    input_evidence: { files: Object.fromEntries(Object.entries(inputs).map(([name, value]) => [name, { sha256: value.sha256 }])), ledger_files: ledgerEvidence },
    rpc_reads: { http_attempts: attempts, retried_requests: retries, receipt_batch_http_attempts: batchRequests, single_http_attempts: singleRequests,
      maximum_receipt_batch_size: 10, batching_supported: batching, minimum_completion_spacing_ms: 510, maximum_attempts_public_pool_busy: 6,
      maximum_attempts_other_transient: 3, overall_read_budget_ms: 60000, timeout_ms: timeout },
    receipts: receipts.map(({ engineEvents, agentEvents, ...publicEvidence }) => publicEvidence),
    limits: ['All five model decisions are independently reread from their actual decision-ready blocks; archive access failure stops verification.',
      'Memory is independently checked at the real finalization block, whose canonical hash is rechecked. No signing or transaction submission occurs in this checker.',
      'This proves one permitted memory action for the supplied request; it does not establish general agent autonomy, model accuracy or production readiness.'] };
  mkdirSync(dirname(output), { recursive: true });
  const temporary = output + '.tmp.' + process.pid;
  writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o644, flush: true }); renameSync(temporary, output);
  process.stdout.write(JSON.stringify({ event: 'mainnet_agent_memory_verified', report: output, requestId: requestId.toString(), action: reference.expected_action,
    historicalLogitValues: archivedDecisions.length * 512, logicalAdvancedEvents: advances.length, paidInferenceTransactions: inferenceReceipts.length,
    incrementalRequestFeeEth: report.fees.incremental_request_total_excluding_shared_deployment.actual_fee_eth, checkerTransactionsSubmitted: 0 }) + '\n');
}

main().catch(error => { process.stderr.write('Agent verification failed: ' + String(error.message).split('\n', 1)[0].slice(0, 500) + '\n'); process.exitCode = 1; });
