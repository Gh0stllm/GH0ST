import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ganache from 'ganache';
import { keccak256 } from 'ethers';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'scripts/s0ul-solidity.mjs');
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');

test('focused local CLI read batching and first-sign nonce guard', { timeout: 180000 }, async t => {
  const temporary = mkdtempSync(join(tmpdir(), 's0ul-batch-nonce-'));
  const reportPath = join(root, 'reports/solidity-cli-batch-nonce-local.json');
  rmSync(reportPath, { force: true });
  const children = new Set();
  const stop = () => { for (const child of children) child.kill('SIGKILL'); };
  t.signal.addEventListener('abort', stop);
  const rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337, hardfork: 'shanghai', allowUnlimitedContractSize: false }, miner: { blockGasLimit: 30000000 }, wallet: { deterministic: true, defaultBalance: 1000000 } });
  const [sender, account] = Object.entries(rpc.getInitialAccounts())[0];
  const key = account.secretKey; // Disposable Ganache key; never printed or saved.
  const batches = [], attempts = [], accepted = [];
  let nonceRace = null, failAcceptedSend = false, failedHash = null, failedRaw = null;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const part of request) body += part;
    const value = JSON.parse(body);
    if (Array.isArray(value)) batches.push(value.map(item => item.method));
    const serve = async payload => {
      try {
        if (payload.method === 'eth_sendRawTransaction') {
          const hash = keccak256(payload.params[0]);
          attempts.push(hash);
          const result = await rpc.request({ method: payload.method, params: payload.params });
          accepted.push(result);
          if (failAcceptedSend) {
            failAcceptedSend = false; failedHash = hash; failedRaw = payload.params[0];
            return { jsonrpc: '2.0', id: payload.id, error: { code: -32000, message: 'upstream request timeout' } };
          }
          return { jsonrpc: '2.0', id: payload.id, result };
        }
        let result = await rpc.request({ method: payload.method, params: payload.params ?? [] });
        if (nonceRace && payload.method === 'eth_getTransactionCount' && payload.params[1] === 'pending') {
          nonceRace.queries++;
          if (nonceRace.queries === 2) { result = '0x' + (BigInt(result) + 1n).toString(16); nonceRace.mutations++; }
        }
        return { jsonrpc: '2.0', id: payload.id, result };
      } catch (error) {
        return { jsonrpc: '2.0', id: payload.id, error: { code: error.code ?? -32000, message: error.message } };
      }
    };
    // Valid JSON-RPC batches may return responses in arbitrary order. Reversing
    // them exercises ID-based result matching through the CLI's split batches.
    const result = Array.isArray(value) ? (await Promise.all(value.map(serve))).reverse() : await serve(value);
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const run = (args, executable = process.execPath, env = process.env) => {
    const child = spawn(executable, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let stdout = '', stderr = '';
    child.stdout.on('data', part => { stdout += part.toString(); });
    child.stderr.on('data', part => { stderr += part.toString(); });
    return new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => { children.delete(child); resolve({ code, stdout, stderr }); });
    });
  };
  try {
    const modelPath = resolve(process.env.S0UL_TEST_MODEL ?? join(temporary, 'model/model.json'));
    const buildPath = resolve(process.env.S0UL_TEST_BUILD ?? join(temporary, 'contracts.json'));
    if (!process.env.S0UL_TEST_MODEL) {
      const generated = await run(['-c', String.raw`
import sys,torch
from s0ul.model import ModelConfig,S0ULModel
from s0ul.integer import IntegerModel
from s0ul.tokenizer import S0ULTokenizer
from s0ul.solidity_export import build_export
torch.set_num_threads(2);torch.manual_seed(73)
c=ModelConfig(vocab_size=512,dim=8,n_layers=1,n_heads=2,hidden_dim=16,max_seq_len=12)
m=IntegerModel.from_state_dict(S0ULModel(c).eval().state_dict(),c.to_dict());m.tokenizer_spec=S0ULTokenizer().spec()
build_export(m,sys.argv[1])
`, dirname(modelPath)], process.env.PYTHON ?? 'python');
      assert.equal(generated.code, 0, generated.stderr);
    }
    if (!process.env.S0UL_TEST_BUILD) {
      const compiled = await run([cli, 'compile', '--output', buildPath]);
      assert.equal(compiled.code, 0, compiled.stderr);
    }
    const manifest = readJSON(modelPath), build = readJSON(buildPath);
    assert.equal(manifest.config.vocabSize, 512); assert.equal(manifest.config.dim, 8);
    assert.equal(manifest.shards.length, 2, 'Focused fixture must use only two data shards');
    for (const [name, hash] of Object.entries(build.sourceSha256)) assert.equal(digest(readFileSync(join(root, 'contracts', name))), hash);
    const actualNonce = Number(BigInt(await rpc.request({ method: 'eth_getTransactionCount', params: [sender, 'pending'] })));
    const base = [cli, 'deploy', '--rpc', endpoint, '--chain-id', '31337', '--model', modelPath, '--build', buildPath, '--poll-ms', '10', '--rpc-batch-max', '12', '--private-key-env', 'S0UL_LOCAL_BATCH_TEST_KEY'];
    const deploy = (output, expected) => run([...base, '--output', output, '--expected-next-nonce', String(expected)], process.execPath, { ...process.env, S0UL_LOCAL_BATCH_TEST_KEY: key });
    const checkOutput = result => {
      assert.equal(result.stdout.includes(key) || result.stderr.includes(key), false, 'Local signing key appeared in output');
      if (failedRaw) assert.equal(result.stdout.includes(failedRaw) || result.stderr.includes(failedRaw), false, 'Signed transaction appeared in output');
    };
    const mismatchPath = join(temporary, 'nonce-mismatch.json');
    const mismatch = await deploy(mismatchPath, actualNonce + 1);
    checkOutput(mismatch);
    assert.notEqual(mismatch.code, 0);
    assert.match(mismatch.stderr, /nonce/i);
    assert.equal(attempts.length, 0); assert.equal(accepted.length, 0);
    const mismatchJournal = readJSON(mismatchPath);
    assert.equal(mismatchJournal.pending, null); assert.equal(mismatchJournal.transactions.length, 0);

    nonceRace = { queries: 0, mutations: 0 };
    const racePath = join(temporary, 'nonce-race.json');
    const raced = await deploy(racePath, actualNonce);
    checkOutput(raced);
    assert.notEqual(raced.code, 0);
    assert.match(raced.stderr, /nonce/i);
    assert.equal(nonceRace.mutations, 1, 'Pre-sign race injection did not fire');
    assert.equal(attempts.length, 0); assert.equal(accepted.length, 0);
    const raceJournal = readJSON(racePath);
    assert.equal(raceJournal.transactions.length, 0); assert.equal(raceJournal.pending?.hash ?? null, null);
    nonceRace = null;

    failAcceptedSend = true;
    const completePath = join(temporary, 'complete.json');
    const completed = await deploy(completePath, actualNonce);
    checkOutput(completed);
    assert.equal(completed.code, 0, 'Matching nonce/batched-read deployment did not complete');
    const journal = readJSON(completePath);
    assert.equal(journal.complete, true); assert.equal(journal.transactions.length, 5);
    assert.equal(journal.transactions[0].nonce, actualNonce);
    assert.equal(journal.transactions.at(-1).nonce, actualNonce + 4);
    assert.equal(attempts.length, 5); assert.equal(accepted.length, 5); assert.equal(new Set(attempts).size, 5);
    assert.equal(attempts.filter(hash => hash === failedHash).length, 1, 'Signed send was retried');
    const events = completed.stdout.trim().split('\n').map(JSON.parse);
    assert.equal(events.filter(event => event.event === 'deployment_nonce_guard_checked').length, 1);
    assert.equal(events.filter(event => event.event === 'deployment_broadcast_reconciled').length, 1);
    assert.ok(batches.some(methods => methods.length > 1), 'Opt-in batching did not produce a read batch');
    assert.ok(batches.every(methods => methods.length <= 12));
    assert.ok(batches.every(methods => methods.every(method => !['eth_sendRawTransaction', 'eth_sendTransaction'].includes(method))), 'An HTTP batch contained a send');
    for (const [index, address] of journal.shards.entries()) assert.equal(keccak256(await rpc.request({ method: 'eth_getCode', params: [address, 'latest'] })), manifest.shards[index].runtimeKeccak256);
    for (const name of ['model', 'tokenizer', 'engine']) assert.equal(keccak256(await rpc.request({ method: 'eth_getCode', params: [journal[name], 'latest'] })), journal[name + 'CodeHash']);
    const report = {
      format: 's0ul-cli-focused-batch-nonce-v1', recorded_utc: new Date().toISOString(), cli_sha256: digest(readFileSync(cli)),
      scope: 'Focused tests for opt-in read batching and first-sign nonce guard; earlier nine-test recovery suite not rerun.',
      chain: { kind: 'loopback Ganache', chain_id: 31337, public_transactions: 0 },
      fixture: { vocab_size: 512, dim: 8, layers: 1, shards: 2, contracts: 5, full_trained_model: false },
      checks: { opt_in_batch_max: 12, read_batches_observed: batches.filter(methods => methods.length > 1).length, maximum_observed_batch: Math.max(...batches.map(methods => methods.length)), reversed_read_response_ids_preserved: true, send_in_http_batch: false, signed_broadcast_attempts: attempts.length, unique_accepted_transactions: new Set(accepted).size, accepted_error_send_attempts: 1, expected_nonce_mismatch_broadcasts: 0, pre_sign_nonce_race_broadcasts: 0, expected_nonce_checked_once: true, later_stage_nonces_advanced: true, runtime_hashes_exact: true },
    };
    mkdirSync(dirname(reportPath), { recursive: true }); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  } finally {
    stop();
    await Promise.allSettled([...children].map(child => new Promise(resolve => child.once('close', resolve))));
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rpc.disconnect();
    t.signal.removeEventListener('abort', stop); rmSync(temporary, { recursive: true, force: true });
  }
});
