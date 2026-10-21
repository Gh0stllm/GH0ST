#!/usr/bin/env node
// Receipt fees and simulated smoke check only. No signing or transaction RPCs.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Interface, getAddress, getCreateAddress, formatEther } from 'ethers';

const root = fileURLToPath(new URL('../', import.meta.url));
const methods = new Set(['eth_getTransactionReceipt', 'eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_call']);
const reasons = new Set(['public_pool_busy', 'rate_limit_exceeded', 'rate_limited', 'too_many_requests',
  'pool_busy', 'pool_saturated', 'quota_exceeded', 'upstream_timeout', 'request_timeout', 'upstream_unavailable',
  'batch_not_supported', 'batch_unsupported', 'batch_too_large', 'batch_limit_exceeded']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const qty = value => { assert.equal(typeof value, 'string'); assert.match(value, /^0x[0-9a-f]+$/i); return BigInt(value); };
const hexEqual = (a, b, message) => { assert.equal(typeof a, 'string', message); assert.equal(typeof b, 'string', message); assert.equal(a.toLowerCase(), b.toLowerCase(), message); };
const addressEqual = (a, b, message) => assert.equal(getAddress(a), getAddress(b), message);

async function main() {
  const options = {};
  const allowed = new Set(['rpc', 'journal', 'output', 'timeout-ms']);
  for (let i = 2; i < process.argv.length; i += 2) {
    const name = process.argv[i].slice(2);
    assert.ok(process.argv[i].startsWith('--') && allowed.has(name) && process.argv[i + 1] !== undefined && !(name in options), 'Use unique supported --name value pairs');
    options[name] = process.argv[i + 1];
  }
  assert.ok(options.rpc, '--rpc URL is required');
  const endpoint = new URL(options.rpc);
  assert.ok(['http:', 'https:'].includes(endpoint.protocol));
  assert.equal(endpoint.username + endpoint.password + endpoint.hash, '', 'RPC credentials/fragments are not supported');
  const timeout = Number(options['timeout-ms'] ?? 15000);
  assert.ok(Number.isSafeInteger(timeout) && timeout >= 1000 && timeout <= 30000);
  const journalPath = resolve(options.journal ?? resolve(root, 'deployments/robinhood-mainnet.json'));
  const output = resolve(options.output ?? resolve(root, 'reports/robinhood-mainnet-deployment-check.json'));
  assert.notEqual(output, journalPath, 'Report must not replace the journal');
  const journalRaw = readFileSync(journalPath), journal = JSON.parse(journalRaw);
  // No fetch is possible until all local completion and identity guards pass.
  assert.equal(journal.format, 'gh0st-s0ul-deployment-v1');
  assert.equal(journal.journalVersion, 2);
  assert.equal(journal.complete, true, 'Deployment must be complete');
  assert.equal(journal.pending, null);
  assert.equal(journal.chainId, '4663');
  assert.equal(journal.shards.length, 48);
  assert.equal(journal.transactions.length, 51);
  const sender = getAddress(journal.sender), engine = getAddress(journal.engine), tokenizer = getAddress(journal.tokenizer);
  const hashes = new Set(), addresses = new Set();
  for (let i = 0; i < 51; ++i) {
    const entry = journal.transactions[i], kind = i < 48 ? 'shard' : ['model', 'tokenizer', 'engine'][i - 48];
    assert.equal(entry.kind, kind); assert.equal(entry.key, kind === 'shard' ? 'shard:' + i : kind);
    assert.equal(entry.index, kind === 'shard' ? i : undefined);
    assert.match(entry.hash, /^0x[0-9a-f]{64}$/i);
    assert.ok(!hashes.has(entry.hash.toLowerCase()), 'Deployment transaction hashes must be unique'); hashes.add(entry.hash.toLowerCase());
    const address = getAddress(entry.address);
    assert.ok(!addresses.has(address), 'Deployment addresses must be unique'); addresses.add(address);
    assert.ok(Number.isSafeInteger(entry.nonce) && entry.nonce >= 0);
    addressEqual(entry.predictedAddress, address, 'Predicted deployment address');
    addressEqual(getCreateAddress({ from: sender, nonce: entry.nonce }), address, 'CREATE address');
    addressEqual(kind === 'shard' ? journal.shards[i] : journal[kind], address, 'Stage address');
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
    assert.ok(calls.length >= 1 && calls.length <= 3);
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
  const receipts = [];
  let batching = true, totalGas = 0n, totalFee = 0n;
  for (let i = 0; i < 51; i += 3) {
    const entries = journal.transactions.slice(i, i + 3);
    let results;
    if (batching) {
      try { results = await request(entries.map(entry => ({ method: 'eth_getTransactionReceipt', params: [entry.hash] }))); }
      catch (error) { if (!error.batchUnsupported) throw error; batching = false; }
    }
    if (!results) { results = []; for (const entry of entries) results.push(await one('eth_getTransactionReceipt', [entry.hash])); }
    for (let j = 0; j < entries.length; ++j) {
      const entry = entries[j], receipt = results[j];
      assert.ok(receipt, 'Deployment receipt exists');
      hexEqual(receipt.transactionHash, entry.hash, 'Receipt hash');
      assert.equal(qty(receipt.status), 1n, 'Successful deployment receipt');
      addressEqual(receipt.from, sender, 'Receipt deployer');
      addressEqual(receipt.contractAddress, entry.address, 'Receipt contract address');
      assert.equal(receipt.to, null, 'Creation receipt destination');
      assert.equal(qty(receipt.blockNumber), BigInt(entry.blockNumber));
      hexEqual(receipt.blockHash, entry.blockHash, 'Receipt block hash');
      const gas = qty(receipt.gasUsed), price = qty(receipt.effectiveGasPrice), fee = gas * price;
      assert.equal(gas, BigInt(entry.gasUsed), 'Receipt gas matches journal');
      totalGas += gas; totalFee += fee;
      receipts.push({ stage: entry.key, transaction_hash: entry.hash, contract_address: entry.address, from: receipt.from,
        block_number: qty(receipt.blockNumber).toString(), block_hash: receipt.blockHash, status: 1,
        gas_used: gas.toString(), effective_gas_price_wei: price.toString(), actual_fee_wei: fee.toString(), actual_fee_eth: formatEther(fee) });
    }
    process.stdout.write(JSON.stringify({ event: 'deployment_receipts_checked', checked: receipts.length, total: 51 }) + '\n');
  }
  assert.equal(receipts.length, 51);
  assert.equal(totalGas, BigInt(journal.totalDeploymentGas));
  assert.equal(qty(await one('eth_chainId')), 4663n);
  const head = qty(await one('eth_blockNumber'));
  assert.ok(head >= 50n);
  const anchorNumber = head - 50n, anchorTag = '0x' + anchorNumber.toString(16);
  assert.ok(receipts.every(receipt => BigInt(receipt.block_number) <= anchorNumber), 'Wait for all deployments to be at least 50 blocks deep');
  const anchor = await one('eth_getBlockByNumber', [anchorTag, false]);
  assert.ok(anchor?.hash); assert.equal(qty(anchor.number), anchorNumber);
  const tokenizerABI = new Interface(['function encode(string text) pure returns(uint16[] ids)']);
  const engineABI = new Interface(['function nextRequestId() view returns(uint256)', 'function beginText(string text,uint16 maxNewTokens) returns(uint256 requestId)']);
  const call = async (abi, address, method, args = [], extra = {}) => abi.decodeFunctionResult(method,
    await one('eth_call', [{ to: address, data: abi.encodeFunctionData(method, args), ...extra }, anchorTag]));
  const encoded = Array.from((await call(tokenizerABI, tokenizer, 'encode', ['Wait.']))[0], Number);
  assert.deepEqual(encoded, [316, 50]);
  const before = (await call(engineABI, engine, 'nextRequestId'))[0];
  const simulated = (await call(engineABI, engine, 'beginText', ['Wait.', 2], { from: sender, value: '0x0', gas: '0xb71b00' }))[0];
  assert.equal(simulated, before);
  assert.equal((await call(engineABI, engine, 'nextRequestId'))[0], before);
  hexEqual((await one('eth_getBlockByNumber', [anchorTag, false]))?.hash, anchor.hash, 'Smoke anchor remains canonical');
  const report = { format: 'gh0st-s0ul-mainnet-deployment-receipt-smoke-v1', checked_utc: new Date().toISOString(), complete: true,
    scope: 'Independent receipt/fee and simulated smoke check only. CLI deployment journal/runtime verification was not independently repeated; the full verifier was not executed by this helper.',
    read_only: true, transactions_submitted: 0, chain_id: 4663, sender,
    journal_sha256: createHash('sha256').update(journalRaw).digest('hex'),
    journal_identity: { source_checkpoint: journal.sourceCheckpoint, model_id: journal.modelId, registry: journal.model, tokenizer, engine,
      runtime_verification_source: 'Completed CLI deployment journal; runtime code and registry shard pins are not rechecked here.' },
    receipt_checks: { unique_deployment_hashes: 51, unique_contract_addresses: 51, successful_receipts: 51,
      hash_sender_address_block_and_gas_match_journal: true, maximum_receipt_batch_size: 3, batching_supported: batching },
    fees: { currency: 'ETH', total_gas_used: totalGas.toString(), actual_fee_wei: totalFee.toString(), actual_fee_eth: formatEther(totalFee),
      calculation: 'Sum of the 51 receipts: gasUsed * effectiveGasPrice. The L1 component is already included in receipt gasUsed; no additional L1 fee is added.',
      scope: 'All 48 shards, registry, tokenizer and engine; excludes nonce recovery, other wallet activity and inference.' },
    smoke: { block_number: anchorNumber.toString(), block_hash: anchor.hash, depth_when_selected: 50, canonical_hash_rechecked: true,
      tokenizer_text: 'Wait.', encoded_ids: encoded, prompt_ids_with_bos_sep: [1, ...encoded, 3],
      begin_text: { rpc_method: 'eth_call', text: 'Wait.', max_new_tokens: 2, from: sender, value_wei: '0', simulated_request_id: simulated.toString(), persisted: false },
      next_request_id_before_and_after: before.toString(), full_inference_executed: false },
    rpc_reads: { http_attempts: attempts, retried_requests: retries, receipt_batch_http_attempts: batchRequests, single_http_attempts: singleRequests,
      maximum_receipt_batch_size: 3, minimum_completion_spacing_ms: 510, maximum_attempts_public_pool_busy: 6,
      maximum_attempts_other_transient: 3, overall_read_budget_ms: 60000, timeout_ms: timeout }, receipts };
  mkdirSync(dirname(output), { recursive: true });
  const temporary = output + '.tmp.' + process.pid;
  writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o644, flush: true }); renameSync(temporary, output);
  process.stdout.write(JSON.stringify({ event: 'mainnet_deployment_receipt_smoke_checked', report: output, receipts: 51, actual_fee_eth: formatEther(totalFee), transactions_submitted: 0 }) + '\n');
}

main().catch(error => { process.stderr.write('Deployment check failed: ' + String(error.message).split('\n', 1)[0].slice(0, 500) + '\n'); process.exitCode = 1; });
