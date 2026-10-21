import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ganache from 'ganache';
import { keccak256 } from 'ethers';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'scripts/s0ul-solidity.mjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
const writeJSON = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

// Every RPC request is handled by this process's disposable Ganache provider.
// The Wallet cases use only Ganache's disposable local key, held in memory and
// passed to a child environment. No key or raw transaction is printed or saved.
test('deployment journals resume pending hashes and reject identity drift without duplicate contracts', { timeout: 360000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 's0ul-cli-resume-'));
  const reportPath = join(root, 'reports/solidity-cli-resume-local.json');
  rmSync(reportPath, { force: true });
  const children = new Set();
  const stopChildren = () => { for (const child of children) child.kill('SIGKILL'); };
  t.signal.addEventListener('abort', stopChildren);
  const rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 31337, hardfork: 'shanghai', allowUnlimitedContractSize: false },
    miner: { blockGasLimit: 30000000, instamine: 'eager' },
    wallet: { deterministic: true, defaultBalance: 1000000 },
  });
  const sent = [];
  const rawAttempts = [];
  const queriedReceiptHashes = [];
  let pausedForInterruption = false;
  let rawFailure = null;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const part of request) body += part;
    const serve = async value => {
      try {
        if (value.method === 'eth_getTransactionReceipt') queriedReceiptHashes.push(value.params[0]);
        if (value.method === 'eth_sendRawTransaction') {
          const hash = keccak256(value.params[0]);
          rawAttempts.push(hash);
          if (rawFailure && !rawFailure.consumed) {
            rawFailure.consumed = true;
            rawFailure.hash = hash;
            rawFailure.raw = value.params[0];
            if (rawFailure.kind !== 'missing') {
              const accepted = await rpc.request({ method: value.method, params: value.params });
              sent.push(accepted);
            }
            return { jsonrpc: '2.0', id: value.id, error: { code: -32000, message: 'Synthetic ambiguous broadcast response' } };
          }
        }
        if (['eth_sendTransaction', 'eth_sendRawTransaction'].includes(value.method) && sent.length === 3 && !pausedForInterruption) {
          await rpc.request({ method: 'miner_stop', params: [] });
          pausedForInterruption = true;
        }
        let result = await rpc.request({ method: value.method, params: value.params ?? [] });
        if (value.method === 'eth_getTransactionByHash' && rawFailure?.kind === 'mismatch' && value.params[0] === rawFailure.hash && result) {
          rawFailure.lookupMutations = (rawFailure.lookupMutations ?? 0) + 1;
          result = { ...result, nonce: '0x' + (BigInt(result.nonce) + 1n).toString(16) };
        }
        if (['eth_sendTransaction', 'eth_sendRawTransaction'].includes(value.method)) sent.push(result);
        return { jsonrpc: '2.0', id: value.id, result };
      } catch (error) {
        return { jsonrpc: '2.0', id: value.id, error: { code: error.code ?? -32000, message: error.message, data: error.data } };
      }
    };
    try {
      const value = JSON.parse(body);
      const result = Array.isArray(value) ? await Promise.all(value.map(serve)) : await serve(value);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(400); response.end(String(error));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const run = (args, { executable = process.execPath, cwd = root, env = process.env } = {}) => {
    const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    const state = { child, stdout: '', stderr: '' };
    child.stdout.on('data', part => { state.stdout += part.toString(); });
    child.stderr.on('data', part => { state.stderr += part.toString(); });
    state.finished = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => { children.delete(child); resolve({ code, signal, stdout: state.stdout, stderr: state.stderr }); });
    });
    return state;
  };
  const success = async state => {
    const result = await state.finished;
    assert.equal(result.code, 0, result.stderr + result.stdout);
    return result;
  };
  const waitFor = async (predicate, state, message) => {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      if (state.child.exitCode !== null) assert.fail(`${message}: process exited ${state.child.exitCode}\n${state.stderr}\n${state.stdout}`);
      await delay(20);
    }
    assert.fail(`${message}: timed out\n${state.stderr}\n${state.stdout}`);
  };
  const deploymentPath = join(directory, 'deployment.json');
  const buildPath = join(directory, 'contracts.json');
  const modelPath = join(directory, 'model-a/model.json');
  const args = ['deploy', '--rpc', endpoint, '--chain-id', '31337', '--model', modelPath, '--output', deploymentPath, '--build', buildPath, '--poll-ms', '10'];
  const deploy = extra => run([cli, ...args, ...extra]);
  const localKey = Object.values(rpc.getInitialAccounts())[0].secretKey;
  const walletDeploy = output => run([cli, ...args, '--output', output, '--private-key-env', 'S0UL_LOCAL_TEST_SIGNING_KEY'], {
    env: { ...process.env, S0UL_LOCAL_TEST_SIGNING_KEY: localKey },
  });
  const assertRedacted = (result, output) => {
    assert.equal(result.stdout.includes(localKey) || result.stderr.includes(localKey), false, 'CLI output exposed the local signing key');
    assert.equal(result.stdout.includes(rawFailure.raw) || result.stderr.includes(rawFailure.raw), false, 'CLI output exposed the signed raw transaction');
    const journalText = readFileSync(output, 'utf8');
    assert.equal(journalText.includes(localKey), false, 'Journal exposed the local signing key');
    assert.equal(journalText.includes(rawFailure.raw), false, 'Journal exposed the signed raw transaction');
  };
  let completedSubtests = 0;
  const broadcastChecks = {};
  const rejectedWithoutSend = async (extra, pattern) => {
    const before = sent.length;
    const result = await deploy(extra).finished;
    assert.notEqual(result.code, 0, result.stdout);
    assert.match(result.stderr + result.stdout, pattern);
    assert.equal(sent.length, before, 'Rejected resume broadcast a transaction');
  };
  try {
    await success(run(['-c', String.raw`
import math,sys,torch
from pathlib import Path
from s0ul.integer import IntegerModel
from s0ul.model import ModelConfig,S0ULModel
from s0ul.solidity_export import build_export
from s0ul.tokenizer import S0ULTokenizer
torch.set_num_threads(2)
config=ModelConfig(vocab_size=512,dim=8,n_layers=1,n_heads=2,hidden_dim=16,max_seq_len=12)
for seed,name in [(41,'model-a'),(42,'model-b')]:
 torch.manual_seed(seed)
 model=IntegerModel.from_state_dict(S0ULModel(config).eval().state_dict(),config.to_dict())
 model.tokenizer_spec=S0ULTokenizer().spec()
 probe=build_export(model,Path(sys.argv[1])/('probe-'+name))
 manifest=build_export(model,Path(sys.argv[1])/name,shard_bytes=math.ceil(probe['payload']['nbytes']/48))
 assert len(manifest['shards'])==48
`, directory], { executable: process.env.PYTHON ?? 'python' }));
    await success(run([cli, 'compile', '--output', buildPath]));
    const manifest = readJSON(modelPath);
    assert.equal(manifest.shards.length, 48);

    await t.test('a broadcast pending transaction is journalled before receipt and reused after interruption', async () => {
      const first = deploy([]);
      await waitFor(() => existsSync(deploymentPath) && sent.length === 4 && readFileSync(deploymentPath, 'utf8').includes(sent[3]), first, 'Pending transaction hash was not saved');
      const interrupted = readJSON(deploymentPath);
      assert.equal(interrupted.complete, false);
      assert.equal(interrupted.transactions.length, 3, 'Interruption must preserve a confirmed deployment prefix');
      assert.equal(interrupted.pending.hash, sent[3]);
      first.child.kill('SIGKILL');
      await first.finished;
      assert.equal(sent.length, 4);
      const pendingHash = sent[3];
      assert.equal(await rpc.request({ method: 'eth_getTransactionReceipt', params: [pendingHash] }), null);
      const missingPending = structuredClone(interrupted);
      missingPending.pending.hash = '0x' + 'ab'.repeat(32);
      const missingPendingPath = join(directory, 'missing-pending.json');
      writeJSON(missingPendingPath, missingPending);
      await rejectedWithoutSend(['--resume', missingPendingPath, '--output', missingPendingPath], /pending|missing|unknown|hash|transaction/i);
      const beforeReceiptQueries = queriedReceiptHashes.filter(hash => hash === pendingHash).length;
      const resumed = deploy(['--resume', deploymentPath]);
      await waitFor(() => queriedReceiptHashes.filter(hash => hash === pendingHash).length > beforeReceiptQueries, resumed, 'Resume did not inspect the saved pending receipt');
      await delay(100);
      assert.equal(sent.length, 4, 'Resume duplicated a confirmed or still-pending shard');
      await rpc.request({ method: 'evm_mine', params: [] });
      await rpc.request({ method: 'miner_start', params: [1] });
      await success(resumed);
      const complete = readJSON(deploymentPath);
      assert.equal(complete.complete, true);
      assert.equal(complete.shards.length, 48);
      assert.equal(complete.transactions.length, 51, 'Expected 48 shards plus model, tokenizer and engine');
      assert.equal(new Set(complete.transactions.map(tx => tx.hash)).size, 51);
      assert.equal(complete.transactions[3].hash, pendingHash);
      assert.equal(sent.length, 51, 'Deployment replayed a confirmed or pending stage');
      for (let index = 0; index < complete.shards.length; index++) {
        const code = await rpc.request({ method: 'eth_getCode', params: [complete.shards[index], 'latest'] });
        assert.equal(keccak256(code), manifest.shards[index].runtimeKeccak256);
      }
      for (const name of ['model', 'tokenizer', 'engine']) {
        const code = await rpc.request({ method: 'eth_getCode', params: [complete[name], 'latest'] });
        assert.equal(keccak256(code), complete[name + 'CodeHash']);
      }
      completedSubtests++;
    });
    assert.equal(completedSubtests, 1, 'Interrupted deployment must pass before later resume checks');

    await t.test('completed resume is idempotent and existing output requires explicit resume', async () => {
      const before = sent.length;
      await success(deploy(['--resume', deploymentPath]));
      assert.equal(sent.length, before, 'Completed resume deployed duplicate contracts');
      await rejectedWithoutSend([], /exist|resume/i);
      completedSubtests++;
    });
    assert.equal(completedSubtests, 2);

    await t.test('resume rejects a different verified model bundle and changed build identity', async () => {
      await rejectedWithoutSend(['--resume', deploymentPath, '--model', join(directory, 'model-b/model.json')], /manifest|model|hash|identity/i);
      const build = readJSON(buildPath);
      build.sourceSha256['S0ULInference.sol'] = '0'.repeat(64);
      const changedBuild = join(directory, 'changed-build.json');
      writeJSON(changedBuild, build);
      await rejectedWithoutSend(['--resume', deploymentPath, '--build', changedBuild], /build|source|hash|identity/i);
      const substituted = readJSON(deploymentPath);
      substituted.transactions[0].hash = substituted.transactions[1].hash;
      const substitutedPath = join(directory, 'substituted-receipt.json');
      writeJSON(substitutedPath, substituted);
      await rejectedWithoutSend(['--resume', substitutedPath, '--output', substitutedPath], /hash|nonce|receipt|transaction|identity|stage/i);
      completedSubtests++;
    });
    assert.equal(completedSubtests, 3);

    await t.test('chain and wallet mismatches fail before broadcasting', async () => {
      await rejectedWithoutSend(['--resume', deploymentPath, '--chain-id', '31338'], /chain/i);
      await rejectedWithoutSend(['--resume', deploymentPath, '--account', '1'], /wallet|sender|signer|account/i);
      completedSubtests++;
    });
    assert.equal(completedSubtests, 4);

    await t.test('Wallet broadcast accepted upstream then reported as an error reconciles its exact hash once', async () => {
      const before = sent.length, attemptsBefore = rawAttempts.length;
      const output = join(directory, 'wallet-reconciled.json');
      rawFailure = { kind: 'accepted', consumed: false };
      const result = await walletDeploy(output).finished;
      assert.ok(rawFailure.consumed, 'Proxy did not inject the ambiguous response');
      assertRedacted(result, output);
      assert.equal(result.code, 0, 'Wallet deployment did not complete after accepted-then-error response');
      const events = result.stdout.trim().split('\n').map(line => JSON.parse(line));
      const reconciled = events.filter(event => event.event === 'deployment_broadcast_reconciled');
      assert.equal(reconciled.length, 1);
      assert.equal(reconciled[0].hash, rawFailure.hash);
      const journal = readJSON(output);
      assert.equal(journal.complete, true);
      assert.equal(journal.pending, null);
      assert.equal(journal.transactions[0].hash, rawFailure.hash);
      assert.equal(journal.transactions.length, 51);
      assert.equal(rawAttempts.length - attemptsBefore, 51, 'Accepted broadcast was retried');
      assert.equal(sent.length - before, 51);
      assert.equal(rawAttempts.slice(attemptsBefore).filter(hash => hash === rawFailure.hash).length, 1);
      broadcastChecks.accepted_then_error = { complete: true, reconciled_events: 1, broadcast_attempts: 51, accepted_transactions: 51, duplicate_attempts: 0, journal_redacted: true };
      rawFailure = null;
      completedSubtests++;
    });
    assert.equal(completedSubtests, 5);

    await t.test('Wallet broadcast failures with missing or mismatched exact hashes preserve pending state without retries', async () => {
      for (const kind of ['missing', 'mismatch']) {
        const before = sent.length, attemptsBefore = rawAttempts.length;
        const output = join(directory, `wallet-${kind}.json`);
        rawFailure = { kind, consumed: false };
        const result = await walletDeploy(output).finished;
        assert.ok(rawFailure.consumed, 'Proxy did not inject the broadcast failure');
        assertRedacted(result, output);
        assert.notEqual(result.code, 0, 'Ambiguous mismatched/missing transaction must stop deployment');
        assert.match(result.stderr, /^Error: [^\n]{1,500}\n$/);
        assert.equal(result.stdout.includes('deployment_broadcast_reconciled'), false);
        const journal = readJSON(output);
        assert.equal(journal.complete, false);
        assert.equal(journal.transactions.length, 0);
        assert.equal(journal.pending.hash, rawFailure.hash);
        assert.equal(rawAttempts.length - attemptsBefore, 1, 'Failed broadcast was retried');
        assert.equal(sent.length - before, kind === 'missing' ? 0 : 1);
        assert.equal(rawAttempts.slice(attemptsBefore).filter(hash => hash === rawFailure.hash).length, 1);
        if (kind === 'mismatch') assert.ok(rawFailure.lookupMutations > 0, 'Proxy did not apply the intended transaction-identity mutation');
        broadcastChecks[kind + '_exact_hash'] = { complete: false, pending_preserved: true, broadcast_attempts: 1, accepted_transactions: kind === 'missing' ? 0 : 1, replacement_attempts: 0, lookup_mutations: rawFailure.lookupMutations ?? 0, stderr_redacted: true, journal_redacted: true };
        rawFailure = null;
      }
      completedSubtests++;
    });

    assert.equal(completedSubtests, 6, 'A failed subtest prevents a success report');
    const complete = readJSON(deploymentPath);
    mkdirSync(join(root, 'reports'), { recursive: true });
    writeJSON(reportPath, {
      format: 's0ul-cli-resume-local-v1', recorded_utc: new Date().toISOString(),
      cli_sha256: createHash('sha256').update(readFileSync(cli)).digest('hex'),
      chain: { kind: 'loopback Ganache', chain_id: 31337, hardfork: 'shanghai', block_gas_limit: 30000000, unlimited_contract_size: false },
      fixture: { vocab_size: 512, dim: 8, layers: 1, shard_count: 48, full_trained_model: false },
      checks: ['pending hash persisted before receipt', 'missing pending transaction rejected without replacement', 'three confirmed stages reused after interruption', 'interrupted pending transaction resumed once', 'all 51 deployment stages completed', 'runtime hashes exact', 'completed resume idempotent', 'existing output rejected without resume', 'model manifest mismatch rejected', 'build identity mismatch rejected', 'substituted confirmed transaction hash rejected', 'chain mismatch rejected', 'wallet mismatch rejected'],
      broadcast_transactions: sent.length, unique_transactions: new Set(sent).size,
      confirmed_prefix_at_interruption: 3, pending_transaction_index_at_interruption: 3,
      deployment_complete: complete.complete, deployment_transaction_count: complete.transactions.length,
      total_deployment_gas: complete.totalDeploymentGas,
      wallet_broadcast_reconciliation: broadcastChecks,
      public_chain_transactions_sent: 0,
    });
  } finally {
    stopChildren();
    await Promise.allSettled([...children].map(child => new Promise(resolve => child.once('close', resolve))));
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rpc.disconnect();
    t.signal.removeEventListener('abort', stopChildren);
    rmSync(directory, { recursive: true, force: true });
  }
});
