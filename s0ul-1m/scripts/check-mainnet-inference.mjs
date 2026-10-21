#!/usr/bin/env node
// Independent receipt/log/output/reference verification. No signer or send RPC.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { AbiCoder, Interface, getAddress, keccak256, formatEther } from 'ethers';

const root = fileURLToPath(new URL('../', import.meta.url));
const methods = new Set(['eth_getTransactionReceipt', 'eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call']);
const reasons = new Set(['public_pool_busy', 'rate_limit_exceeded', 'rate_limited', 'too_many_requests', 'pool_busy', 'pool_saturated',
  'quota_exceeded', 'upstream_timeout', 'request_timeout', 'upstream_unavailable', 'batch_not_supported', 'batch_unsupported', 'batch_too_large', 'batch_limit_exceeded']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const qty = value => { assert.equal(typeof value, 'string'); assert.match(value, /^0x[0-9a-f]+$/i); return BigInt(value); };
const hexEqual = (a, b, message) => { assert.equal(typeof a, 'string', message); assert.equal(typeof b, 'string', message); assert.equal(a.toLowerCase(), b.toLowerCase(), message); };
const addressEqual = (a, b, message) => assert.equal(getAddress(a), getAddress(b), message);

async function main() {
  const options = { inference: [] };
  const allowed = new Set(['rpc', 'inference', 'deployment', 'build', 'expected', 'output', 'timeout-ms']);
  for (let i = 2; i < process.argv.length; i += 2) {
    const name = process.argv[i].slice(2), value = process.argv[i + 1];
    assert.ok(process.argv[i].startsWith('--') && allowed.has(name) && value !== undefined, 'Use supported --name value pairs');
    if (name === 'inference') options.inference.push(resolve(value));
    else { assert.ok(!(name in options), 'Only --inference may be repeated'); options[name] = value; }
  }
  assert.ok(options.rpc && options.build && options.expected && options.inference.length, '--rpc, --build, --expected and at least one --inference are required');
  const endpoint = new URL(options.rpc);
  assert.ok(['http:', 'https:'].includes(endpoint.protocol));
  assert.equal(endpoint.username + endpoint.password + endpoint.hash, '', 'RPC credentials/fragments are not supported');
  const timeout = Number(options['timeout-ms'] ?? 15000);
  assert.ok(Number.isSafeInteger(timeout) && timeout >= 1000 && timeout <= 30000);
  const deploymentPath = resolve(options.deployment ?? resolve(root, 'deployments/robinhood-mainnet.json'));
  const expectedPath = resolve(options.expected), buildPath = resolve(options.build);
  const output = resolve(options.output ?? resolve(root, 'reports/robinhood-mainnet-inference-check.json'));
  assert.ok(![deploymentPath, expectedPath, buildPath, ...options.inference].includes(output), 'Report must not replace an input');
  const deploymentRaw = readFileSync(deploymentPath), expectedRaw = readFileSync(expectedPath), buildRaw = readFileSync(buildPath);
  const deployment = JSON.parse(deploymentRaw), expected = JSON.parse(expectedRaw), build = JSON.parse(buildRaw);
  assert.equal(deployment.complete, true); assert.equal(deployment.pending, null); assert.equal(deployment.chainId, '4663');
  assert.equal(deployment.transactions.length, 51);
  assert.equal(deployment.sourceCheckpoint, '0x44bed666c464273e6fff84b10a4977744d9b0e923f5b6a519d7725920b500692');
  assert.equal(expected.source_checkpoint_sha256, deployment.sourceCheckpoint.slice(2));
  assert.equal(expected.prompt_text, 'Wait.'); assert.equal(expected.max_new_tokens, 2);
  assert.deepEqual(expected.prompt_ids, [1, 316, 50, 3]); assert.deepEqual(expected.expected_output_ids, [268, 2]);
  assert.equal(expected.decisions.length, 2); assert.ok(expected.decisions.every(x => x.logits.length === 512));
  assert.equal(build.compiler, deployment.compiler);
  assert.deepEqual(build.sourceSha256, deployment.sourceSha256, 'ABI build uses the deployed source identities');
  const engineABI = new Interface(build.contracts['S0ULInference.sol'].S0ULInference.abi);
  const tokenizerABI = new Interface(build.contracts['S0ULTokenizer.sol'].S0ULTokenizer.abi);
  const engine = getAddress(deployment.engine), tokenizer = getAddress(deployment.tokenizer), sender = getAddress(deployment.sender);
  const entries = new Map(), snapshots = new Map(), inputEvidence = [];
  let requestId = null, finalLedgerSeen = false;
  for (const path of options.inference) {
    const raw = readFileSync(path), ledger = JSON.parse(raw);
    assert.equal(ledger.format, 'gh0st-s0ul-inference-receipts-v1'); assert.equal(String(ledger.chainId), '4663');
    addressEqual(ledger.engine, engine, 'Inference engine'); hexEqual(ledger.modelId, deployment.modelId, 'Inference model');
    assert.equal(ledger.pending ?? null, null, 'Resolve each invocation pending transaction before checking the result');
    assert.ok(ledger.requestId !== null && ledger.requestId !== undefined, 'Every supplied invocation must identify its request');
    if (requestId === null) requestId = BigInt(ledger.requestId);
    assert.equal(BigInt(ledger.requestId), requestId, 'All invocations concern one request');
    assert.equal(Number(ledger.rowsPerStep), 128, 'This check expects the tested 128-row execution');
    for (const entry of ledger.transactions) {
      assert.match(entry.hash, /^0x[0-9a-f]{64}$/i);
      const key = entry.hash.toLowerCase(), prior = entries.get(key);
      if (prior) assert.equal(String(prior.gasUsed), String(entry.gasUsed), 'Duplicate receipt metadata agrees');
      else entries.set(key, entry);
    }
    for (const snapshot of ledger.decisions ?? []) {
      const index = Number(snapshot.generated);
      assert.ok(Number.isSafeInteger(index) && index >= 0 && index < 2, 'Decision index');
      const normalized = { position: Number(snapshot.position), generated: index,
        prefix_ids: snapshot.prefix_ids.map(Number), logits: snapshot.logits.map(Number) };
      assert.deepEqual(normalized.prefix_ids, expected.decisions[index].prefix_ids, 'Captured decision prefix');
      assert.deepEqual(normalized.logits, expected.decisions[index].logits, 'Every captured decision logit matches Python');
      assert.equal(normalized.logits.indexOf(Math.max(...normalized.logits)), expected.decisions[index].next_id, 'Lowest-ID greedy choice');
      if (snapshots.has(index)) assert.deepEqual(snapshots.get(index), normalized, 'Repeated decision snapshot agrees');
      else snapshots.set(index, normalized);
    }
    if (ledger.complete) {
      finalLedgerSeen = true;
      assert.deepEqual(ledger.generatedTokenIds.map(Number), expected.expected_output_ids);
      assert.equal(ledger.response, 'WAIT'); assert.equal(BigInt(ledger.saturatedValues), 0n);
    }
    inputEvidence.push({ sha256: sha(raw), complete: Boolean(ledger.complete), recorded_receipts: ledger.transactions.length,
      recorded_decisions: (ledger.decisions ?? []).length });
  }
  assert.ok(finalLedgerSeen, 'At least one invocation must record completion');
  assert.equal(snapshots.size, 2, 'Both decision snapshots must be preserved');
  assert.ok(entries.size >= 398, 'The complete request requires 398 successful transactions');

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
  let batching = true, totalGas = 0n, totalFee = 0n;
  for (let i = 0; i < recorded.length; i += 10) {
    const chunk = recorded.slice(i, i + 10);
    let results;
    if (batching) {
      try { results = await request(chunk.map(entry => ({ method: 'eth_getTransactionReceipt', params: [entry.hash] }))); }
      catch (error) { if (!error.batchUnsupported) throw error; batching = false; }
    }
    if (!results) { results = []; for (const entry of chunk) results.push(await one('eth_getTransactionReceipt', [entry.hash])); }
    for (let j = 0; j < chunk.length; ++j) {
      const entry = chunk[j], receipt = results[j];
      assert.ok(receipt, 'Inference receipt exists'); hexEqual(receipt.transactionHash, entry.hash, 'Receipt hash');
      addressEqual(receipt.from, sender, 'Inference sender'); addressEqual(receipt.to, engine, 'Inference destination');
      const gas = qty(receipt.gasUsed), price = qty(receipt.effectiveGasPrice), fee = gas * price, status = qty(receipt.status);
      assert.ok(status === 0n || status === 1n); assert.equal(gas, BigInt(entry.gasUsed), 'Receipt gas matches ledger');
      if (entry.status !== undefined) assert.equal(status, BigInt(entry.status));
      if (entry.blockNumber !== undefined) assert.equal(qty(receipt.blockNumber), BigInt(entry.blockNumber));
      if (entry.blockHash !== undefined) hexEqual(receipt.blockHash, entry.blockHash, 'Receipt block hash');
      const events = receipt.logs.filter(log => getAddress(log.address) === engine).map(log => {
        try { return engineABI.parseLog(log); } catch { return null; }
      }).filter(Boolean);
      if (status === 1n) {
        const advances = events.filter(event => event.name === 'Advanced'), begins = events.filter(event => event.name === 'Begun');
        assert.equal(advances.length + begins.length, 1, 'Successful receipt advances or begins exactly this request');
        for (const event of [...advances, ...begins]) assert.equal(event.args.requestId, requestId);
      }
      totalGas += gas; totalFee += fee;
      receipts.push({ raw: receipt, events, status: Number(status), transaction_hash: entry.hash,
        block_number: qty(receipt.blockNumber).toString(), transaction_index: qty(receipt.transactionIndex).toString(),
        block_hash: receipt.blockHash, gas_used: gas.toString(), effective_gas_price_wei: price.toString(),
        actual_fee_wei: fee.toString(), actual_fee_eth: formatEther(fee) });
    }
    process.stdout.write(JSON.stringify({ event: 'inference_receipts_checked', checked: receipts.length, total: recorded.length }) + '\n');
  }
  receipts.sort((a, b) => BigInt(a.block_number) < BigInt(b.block_number) ? -1 : BigInt(a.block_number) > BigInt(b.block_number) ? 1 : Number(BigInt(a.transaction_index) - BigInt(b.transaction_index)));
  const successful = receipts.filter(x => x.status === 1), events = successful.flatMap(x => x.events);
  assert.equal(successful.length, 398, '398 successful mainnet inference transactions');
  const begins = events.filter(x => x.name === 'Begun'), advances = events.filter(x => x.name === 'Advanced');
  assert.equal(begins.length, 1); assert.equal(advances.length, 397);
  const begun = begins[0].args;
  assert.equal(begun.requestId, requestId); addressEqual(begun.owner, sender); hexEqual(begun.modelId, deployment.modelId);
  assert.equal(begun.promptLength, 4n); assert.equal(begun.maxNewTokens, 2n);
  hexEqual(begun.requestHash, keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32', 'address', 'uint16[]', 'uint16'],
    [deployment.modelId, sender, expected.prompt_ids, 2])), 'Exact prompt/budget request hash');
  const generated = events.filter(x => x.name === 'TokenGenerated');
  assert.deepEqual(generated.map(x => Number(x.args.tokenId)), expected.expected_output_ids);
  assert.deepEqual(generated.map(x => Number(x.args.outputIndex)), [0, 1]);
  assert.ok(generated.every(x => x.args.requestId === requestId));
  const completions = events.filter(x => x.name === 'Completed');
  assert.equal(completions.length, 1); assert.equal(completions[0].args.requestId, requestId);
  assert.equal(completions[0].args.generated, 2n); assert.equal(completions[0].args.endedWithEOS, true);
  assert.equal(completions[0].args.saturationCount, 0n);
  assert.equal(events.filter(x => x.name === 'RequestCancelled').length, 0);
  // Read the first decision directly from the historical block that completed
  // its logit projection. Archive denial/unavailability stops this checker.
  const selectionReady = successful.filter(receipt => receipt.events.some(event =>
    event.name === 'Advanced' && event.args.requestId === requestId && event.args.nextPhase === 16n));
  assert.equal(selectionReady.length, 2, 'Two actual decision-ready transactions');
  for (let i = 0; i < 2; ++i) {
    const ready = selectionReady[i].events.find(event => event.name === 'Advanced');
    assert.equal(ready.args.position, BigInt(expected.decisions[i].prefix_ids.length - 1));
  }
  const firstDecisionReceipt = selectionReady[0], firstDecisionTag = '0x' + BigInt(firstDecisionReceipt.block_number).toString(16);
  const firstDecisionBlock = await one('eth_getBlockByNumber', [firstDecisionTag, false]);
  hexEqual(firstDecisionBlock?.hash, firstDecisionReceipt.block_hash, 'First decision block is canonical');
  const historicalCall = async method => engineABI.decodeFunctionResult(method,
    await one('eth_call', [{ to: engine, data: engineABI.encodeFunctionData(method, [requestId]) }, firstDecisionTag]))[0];
  const firstDecisionLogits = Array.from(await historicalCall('logits'), Number);
  assert.deepEqual(firstDecisionLogits, expected.decisions[0].logits, 'Historical on-chain first decision logits');
  const firstDecisionTokens = Array.from(await historicalCall('tokens'), Number);
  assert.deepEqual(firstDecisionTokens.slice(0, expected.prompt_ids.length), expected.prompt_ids, 'Historical first-decision prefix');
  // Block-level state can also include a later Select transaction in that same
  // block. Its only permissible additional token is the verified first output.
  assert.ok(firstDecisionTokens.length === expected.prompt_ids.length || firstDecisionTokens.length === expected.prompt_ids.length + 1);
  if (firstDecisionTokens.length > expected.prompt_ids.length) assert.equal(firstDecisionTokens.at(-1), expected.expected_output_ids[0]);
  hexEqual((await one('eth_getBlockByNumber', [firstDecisionTag, false]))?.hash, firstDecisionBlock.hash, 'Historical decision block remains canonical');
  assert.equal(qty(await one('eth_chainId')), 4663n);
  const head = qty(await one('eth_blockNumber')), anchorNumber = head - 50n;
  assert.ok(head >= 50n && receipts.every(x => BigInt(x.block_number) <= anchorNumber), 'Wait for all inference receipts to be 50 blocks deep');
  const anchorTag = '0x' + anchorNumber.toString(16), anchor = await one('eth_getBlockByNumber', [anchorTag, false]);
  assert.ok(anchor?.hash); assert.equal(qty(anchor.number), anchorNumber);
  for (const [kind, address] of [['engine', engine], ['tokenizer', tokenizer]]) {
    hexEqual(keccak256(await one('eth_getCode', [address, anchorTag])), deployment[kind + 'CodeHash'], kind + ' runtime journal pin');
  }
  const call = async (abi, address, method, args = []) => abi.decodeFunctionResult(method,
    await one('eth_call', [{ to: address, data: abi.encodeFunctionData(method, args) }, anchorTag]));
  hexEqual((await call(engineABI, engine, 'modelId'))[0], deployment.modelId);
  const status = (await call(engineABI, engine, 'status', [requestId]))[0];
  addressEqual(status.owner, sender); assert.equal(status.done, true); assert.equal(status.cancelled, false);
  assert.equal(status.phase, 17n); assert.equal(status.generated, 2n); assert.equal(status.promptLength, 4n);
  assert.equal(status.maxNewTokens, 2n); assert.equal(status.saturationCount, 0n);
  assert.deepEqual(Array.from((await call(engineABI, engine, 'tokens', [requestId]))[0], Number), [...expected.prompt_ids, ...expected.expected_output_ids]);
  const outputIds = Array.from((await call(engineABI, engine, 'outputTokens', [requestId]))[0], Number);
  assert.deepEqual(outputIds, expected.expected_output_ids);
  const finalLogits = Array.from((await call(engineABI, engine, 'logits', [requestId]))[0], Number);
  assert.deepEqual(finalLogits, expected.decisions[1].logits, 'Final on-chain EOS decision logits');
  const decoded = (await call(tokenizerABI, tokenizer, 'decode', [outputIds.slice(0, outputIds.indexOf(2)), false]))[0];
  const response = Buffer.from(decoded.slice(2), 'hex').toString('utf8'); assert.equal(response, 'WAIT');
  hexEqual((await one('eth_getBlockByNumber', [anchorTag, false]))?.hash, anchor.hash, 'Final state anchor remains canonical');
  const failed = receipts.filter(x => x.status === 0);
  const report = { format: 'gh0st-s0ul-mainnet-inference-verification-v1', verified_utc: new Date().toISOString(), complete: true,
    real_mainnet_generation_completed: true, read_only_checker: true, checker_transactions_submitted: 0,
    chain_id: 4663, engine, tokenizer, owner: sender, request_id: requestId.toString(), model_id: deployment.modelId,
    source_checkpoint_sha256: deployment.sourceCheckpoint.slice(2), prompt_text: 'Wait.', prompt_ids: expected.prompt_ids,
    max_new_tokens: 2, generated_token_ids: outputIds, response, ended_with_eos: true, saturation_count: 0,
    golden_reference: { sha256: sha(expectedRaw), decisions: 2, checked_logit_values: 1024, all_captured_logits_exact: true,
      captured_before_select: true, independently_reread_on_chain_logit_values: 1024, all_independently_reread_logits_exact: true,
      historical_first_decision_values_checked: 512, final_on_chain_logit_values_checked: 512, final_on_chain_logits_exact: true },
    captured_decisions: [...snapshots.values()].sort((a, b) => a.generated - b.generated),
    historical_first_decision: { ready_transaction_hash: firstDecisionReceipt.transaction_hash,
      block_number: firstDecisionReceipt.block_number, block_hash: firstDecisionBlock.hash, canonical_hash_rechecked: true,
      reference_prefix_ids: expected.prompt_ids, tokens_as_of_block: firstDecisionTokens, logits: firstDecisionLogits, all_512_logits_exact: true },
    final_state_anchor: { block_number: anchorNumber.toString(), block_hash: anchor.hash, depth_when_selected: 50, canonical_hash_rechecked: true },
    receipt_checks: { unique_receipts: receipts.length, successful_request_transactions: successful.length,
      begin_transactions: 1, advance_transactions: 397, failed_attempt_transactions: failed.length, generation_events_exact: true },
    fees: { currency: 'ETH', gas_used_including_failed_attempts: totalGas.toString(), actual_fee_wei: totalFee.toString(), actual_fee_eth: formatEther(totalFee),
      failed_attempt_fee_wei: failed.reduce((sum, x) => sum + BigInt(x.actual_fee_wei), 0n).toString(),
      calculation: 'Sum of every supplied unique inference receipt: gasUsed * effectiveGasPrice. L1 gas is already included; no additional L1 fee is added.',
      scope: 'Only this request and supplied failed attempt receipts. Excludes deployment, nonce recovery and other wallet activity.' },
    inputs: { deployment_journal_sha256: sha(deploymentRaw), abi_build_sha256: sha(buildRaw), invocation_ledgers: inputEvidence },
    rpc_reads: { http_attempts: attempts, retried_requests: retries, receipt_batch_http_attempts: batchRequests, single_http_attempts: singleRequests,
      maximum_receipt_batch_size: 10, batching_supported: batching, minimum_completion_spacing_ms: 510,
      maximum_attempts_public_pool_busy: 6, maximum_attempts_other_transient: 3, overall_read_budget_ms: 60000, timeout_ms: timeout },
    receipts: receipts.map(({ raw, events, ...publicEvidence }) => publicEvidence),
    limits: ['Both CLI decision snapshots are compared with Python; independently, decision0 is reread from its actual historical decision-ready block and decision1 from completed on-chain state.',
      'The checker submits no transactions. The referenced mainnet receipts establish real execution; this is not an eth_call generation simulation.',
      'Fees cover supplied unique receipts, including failed attempts when present. Missing invocation files would prevent the required 398-successful-receipt check.'] };
  mkdirSync(dirname(output), { recursive: true });
  const temporary = output + '.tmp.' + process.pid;
  writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o644, flush: true }); renameSync(temporary, output);
  process.stdout.write(JSON.stringify({ event: 'mainnet_inference_verified', report: output, requestId: requestId.toString(),
    generatedTokenIds: outputIds, response, checkedLogitValues: 1024, successfulTransactions: successful.length,
    actualFeeEth: formatEther(totalFee), checkerTransactionsSubmitted: 0 }) + '\n');
}

main().catch(error => { process.stderr.write('Inference verification failed: ' + String(error.message).split('\n', 1)[0].slice(0, 500) + '\n'); process.exitCode = 1; });
