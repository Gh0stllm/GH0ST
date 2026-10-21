import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interface, Transaction, keccak256 } from 'ethers';
import ganache from 'ganache';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'scripts/s0ul-solidity.mjs');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('focused inference receipts and signed pending hashes survive ambiguous broadcasts and interruption', { timeout: 120000 }, async t => {
  const modelPath = resolve(process.env.S0UL_TEST_MODEL ?? 'exports/cli-fixture/model.json');
  const buildPath = resolve(process.env.S0UL_TEST_BUILD ?? 'exports/solidity-build/contracts.json');
  assert.ok(existsSync(modelPath) && existsSync(buildPath), 'Set S0UL_TEST_MODEL and S0UL_TEST_BUILD to the tiny512 fixture and compiled artifact');
  const build = json(buildPath), manifest = json(modelPath);
  assert.equal(manifest.config.dim, 8); assert.equal(manifest.shards.length, 2);
  for (const [name, hash] of Object.entries(build.sourceSha256)) assert.equal(digest(readFileSync(join(root, 'contracts', name))), hash);
  const engineABI = new Interface(build.contracts['S0ULInference.sol'].S0ULInference.abi);
  const temporary = mkdtempSync(join(tmpdir(), 's0ul-infer-durable-'));
  const reportPath = join(root, 'reports/solidity-cli-infer-durability-local.json');
  rmSync(reportPath, { force: true });
  const rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337, hardfork: 'shanghai', allowUnlimitedContractSize: false }, miner: { blockGasLimit: 30000000 }, wallet: { deterministic: true, defaultBalance: 1000000 } });
  const key = Object.values(rpc.getInitialAccounts())[0].secretKey;
  const children = new Set(), rawInMemory = [], attempts = [], accepted = [], observations = [];
  const stop = () => { for (const child of children) child.kill('SIGKILL'); };
  t.signal.addEventListener('abort', stop);
  let policy = null, proxyFailure = null;
  const server = createServer(async (request, response) => {
    let body = ''; for await (const part of request) body += part;
    const serve = async payload => {
      try {
        if (payload.method === 'eth_sendRawTransaction') {
          const raw = payload.params[0], tx = Transaction.from(raw), hash = keccak256(raw);
          rawInMemory.push(raw); attempts.push(hash);
          if (policy) {
            const journal = json(policy.output), pending = journal.pending;
            assert.equal(pending.hash, hash, 'Signed hash must be saved before upstream broadcast');
            assert.equal(pending.from.toLowerCase(), tx.from.toLowerCase());
            assert.equal(pending.to.toLowerCase(), tx.to.toLowerCase());
            assert.equal(pending.nonce, tx.nonce); assert.equal(BigInt(pending.chainId), tx.chainId);
            assert.equal(pending.calldataKeccak256, keccak256(tx.data));
            assert.equal(pending.method, engineABI.parseTransaction({ data: tx.data }).name);
            assert.equal(Object.hasOwn(pending, 'data'), false); assert.equal(Object.hasOwn(pending, 'raw'), false);
            if (policy.previous) assert.ok(journal.transactions.some(receipt => receipt.hash === policy.previous), 'Previous receipt was not saved before the next broadcast');
            const observation = { hash, method: pending.method, persisted_before_broadcast: true };
            observations.push(observation); policy.observations.push(observation);
            policy.previous = hash;
            if (policy.mode === 'missing') return { jsonrpc: '2.0', id: payload.id, error: { code: -32000, message: 'upstream request timeout' } };
          }
          const result = await rpc.request({ method: payload.method, params: payload.params });
          accepted.push(result);
          if (policy?.mode === 'accepted-error' && !policy.injected) {
            policy.injected = true;
            return { jsonrpc: '2.0', id: payload.id, error: { code: -32000, message: 'upstream request timeout' } };
          }
          return { jsonrpc: '2.0', id: payload.id, result };
        }
        return { jsonrpc: '2.0', id: payload.id, result: await rpc.request({ method: payload.method, params: payload.params ?? [] }) };
      } catch (error) {
        if (error.code === 'ERR_ASSERTION') proxyFailure = error.message;
        return { jsonrpc: '2.0', id: payload.id, error: { code: -32000, message: 'Local proxy assertion or RPC failure' } };
      }
    };
    const parsed = JSON.parse(body);
    const result = Array.isArray(parsed) ? await Promise.all(parsed.map(serve)) : await serve(parsed);
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const run = args => {
    const child = spawn(process.execPath, [cli, ...args, '--rpc', endpoint, '--build', buildPath, '--poll-ms', '10', '--rpc-batch-max', '12', '--private-key-env', 'S0UL_LOCAL_INFER_TEST_KEY'], { cwd: root, env: { ...process.env, S0UL_LOCAL_INFER_TEST_KEY: key }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    const state = { child, stdout: '', stderr: '' };
    child.stdout.on('data', part => { state.stdout += part.toString(); }); child.stderr.on('data', part => { state.stderr += part.toString(); });
    state.finished = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => { children.delete(child); resolve({ code, stdout: state.stdout, stderr: state.stderr }); }); });
    return state;
  };
  const redacted = (result, output) => {
    const text = result.stdout + result.stderr + readFileSync(output, 'utf8');
    assert.equal(text.includes(key), false, 'Signing key was persisted or printed');
    assert.equal(rawInMemory.some(raw => text.includes(raw)), false, 'Raw transaction was persisted or printed');
  };
  const waitFor = async (predicate, child) => {
    const deadline = Date.now() + 30000;
    while (!predicate()) {
      assert.equal(proxyFailure, null);
      assert.equal(child.child.exitCode, null, 'Inference process exited before pending observation');
      assert.ok(Date.now() < deadline, 'Inference pending observation timed out'); await delay(10);
    }
  };
  try {
    const deploymentPath = join(temporary, 'deployment.json');
    const deployed = await run(['deploy', '--chain-id', '31337', '--model', modelPath, '--output', deploymentPath]).finished;
    assert.equal(deployed.code, 0, 'Tiny setup deployment failed'); redacted(deployed, deploymentPath);
    const deployment = json(deploymentPath);
    const infer = (output, extra) => run(['infer', '--deployment', deploymentPath, '--output', output, '--rows', '32', ...extra]);
    const beginPath = join(temporary, 'begin-pending.json');
    await rpc.request({ method: 'miner_stop', params: [] });
    policy = { output: beginPath, mode: 'hold', observations: [] };
    const begun = infer(beginPath, ['--prompt', 'Wait.', '--max-new-tokens', '1', '--max-transactions', '1']);
    await waitFor(() => policy.observations.length === 1 && accepted.includes(policy.observations[0].hash), begun);
    const beginHash = policy.observations[0].hash;
    assert.equal(await rpc.request({ method: 'eth_getTransactionReceipt', params: [beginHash] }), null);
    begun.child.kill('SIGKILL'); const interrupted = await begun.finished;
    redacted(interrupted, beginPath);
    assert.equal(json(beginPath).transactions.length, 0); assert.equal(json(beginPath).pending.hash, beginHash);
    const preserved = digest(readFileSync(beginPath)), count = attempts.length;
    const clobber = await infer(beginPath, ['--prompt', 'Wait.', '--max-new-tokens', '1']).finished;
    assert.notEqual(clobber.code, 0); assert.match(clobber.stderr, /already exists|new --output/i);
    assert.equal(attempts.length, count); assert.equal(digest(readFileSync(beginPath)), preserved);
    await rpc.request({ method: 'evm_mine', params: [] }); await rpc.request({ method: 'miner_start', params: [1] });
    const receipt = await rpc.request({ method: 'eth_getTransactionReceipt', params: [beginHash] });
    const begunEvent = receipt.logs.map(log => { try { return engineABI.parseLog(log); } catch { return null; } }).find(event => event?.name === 'Begun');
    assert.ok(begunEvent); const requestId = String(begunEvent.args.requestId);

    const advancePath = join(temporary, 'advances.json');
    policy = { output: advancePath, mode: 'accepted-error', observations: [] };
    const advances = await infer(advancePath, ['--session', requestId, '--max-transactions', '2']).finished;
    redacted(advances, advancePath); assert.equal(advances.code, 2, 'Two-step continuation should remain incomplete');
    assert.equal(policy.observations.length, 2); assert.equal(policy.injected, true);
    const continued = json(advancePath);
    assert.equal(continued.pending, null); assert.equal(continued.transactions.length, 2);
    assert.ok(continued.transactions.every(tx => tx.status === 1));
    assert.equal(advances.stdout.trim().split('\n').map(JSON.parse).filter(event => event.event === 'inference_broadcast_reconciled').length, 1);
    for (const observation of policy.observations) assert.equal(attempts.filter(hash => hash === observation.hash).length, 1);

    const failedPath = join(temporary, 'failed-receipt.json');
    policy = { output: failedPath, mode: 'normal', observations: [] };
    const failed = await infer(failedPath, ['--session', requestId, '--max-transactions', '1', '--step-gas', '23000']).finished;
    redacted(failed, failedPath); assert.notEqual(failed.code, 0);
    const failedJournal = json(failedPath);
    assert.equal(failedJournal.pending, null); assert.equal(failedJournal.transactions.length, 1); assert.equal(failedJournal.transactions[0].status, 0);

    const missingPath = join(temporary, 'missing-hash.json');
    policy = { output: missingPath, mode: 'missing', observations: [] };
    const acceptedBefore = accepted.length;
    const missing = await infer(missingPath, ['--session', requestId, '--max-transactions', '1']).finished;
    redacted(missing, missingPath); assert.notEqual(missing.code, 0);
    assert.equal(policy.observations.length, 1); assert.equal(accepted.length, acceptedBefore);
    assert.equal(json(missingPath).pending.hash, policy.observations[0].hash); assert.equal(json(missingPath).transactions.length, 0);
    assert.equal(attempts.filter(hash => hash === policy.observations[0].hash).length, 1);
    assert.equal(proxyFailure, null);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify({ format: 's0ul-focused-inference-durability-v1', recorded_utc: new Date().toISOString(), cli_sha256: digest(readFileSync(cli)), scope: 'Tiny local begin and two continuation steps only; no full inference or prior suite rerun.', chain_id: 31337, public_transactions: 0, fixture: { vocab_size: 512, dim: 8, layers: 1, deployment_contracts: 5, full_trained_model: false }, checks: { signed_hash_saved_before_all_inference_broadcasts: true, pending_fields_exact: true, interrupted_pending_hash_retained: true, existing_output_rejected_without_send: true, accepted_error_reconciled_once: true, receipt_saved_before_next_send: true, successful_advance_receipts: 2, failed_status_zero_receipt_saved: true, missing_hash_no_resend: true, no_keys_or_raw_transactions_saved: true }, accepted_transactions_including_setup: accepted.length, broadcast_attempts_including_setup: attempts.length }, null, 2) + '\n');
  } finally {
    stop(); await Promise.allSettled([...children].map(child => new Promise(resolve => child.once('close', resolve))));
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rpc.disconnect();
    t.signal.removeEventListener('abort', stop); rmSync(temporary, { recursive: true, force: true });
  }
});
