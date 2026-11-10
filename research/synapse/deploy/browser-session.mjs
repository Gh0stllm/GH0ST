#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { executeActions, executionMessage, validateSigned } from '../../../../rh-icp-live/rh-icp-inference/scripts/execute-rh.mjs';
import { ROOT, SPONSOR, ethers, options, privateOutput, providerFor, readRpc, safeError, save, sha256 } from './lib.mjs';
import { createFreshCheck, validateDeployPlan } from './guards.mjs';
import { verifyCompleted } from './verify.mjs';

function regularPrivateFile(path) {
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && (!process.getuid || stat.uid === process.getuid()), 'Expected user-owned mode0600 regular file');
  return stat;
}
const encode = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item);

export async function startSession({ planPath, keystorePath, output, envFile, port = 0 }) {
  assert.ok(isAbsolute(planPath) && isAbsolute(keystorePath), 'Plan and keystore paths must be absolute');
  regularPrivateFile(planPath);
  const out = privateOutput(output);
  const journalPath = join(out, 'signed-journal.json');
  const batchPath = join(out, 'signed-batch.json');
  for (const path of [journalPath, journalPath + '.lock', batchPath, join(out, 'deployment.json')]) assert.ok(!existsSync(path), 'A prior signing attempt exists. Reconcile it before starting a new session.');
  const planBytes = readFileSync(planPath);
  const planHash = sha256(planBytes);
  const plan = JSON.parse(planBytes);
  const actions = validateDeployPlan(plan);
  assert.equal(actions.length, 9, 'Browser deployment requires exact six deploys + approve + infer + sponsor withdrawal');
  const freshCheck = createFreshCheck(plan);
  const provider = providerFor(readRpc(envFile));
  try { await freshCheck(provider, actions[0]); } catch (error) { provider.destroy(); throw error; }
  const keyStat = regularPrivateFile(keystorePath);
  assert.ok(keyStat.size > 0 && keyStat.size < 32768, 'Unexpected keystore size');
  const encrypted = readFileSync(keystorePath, 'utf8');
  const metadata = JSON.parse(encrypted);
  const cipher = metadata.crypto ?? metadata.Crypto;
  assert.equal(metadata.version, 3); assert.match(cipher?.ciphertext ?? '', /^[0-9a-fA-F]{64}$/);
  assert.equal(ethers.getAddress('0x' + String(metadata.address).replace(/^0x/, '')), SPONSOR);
  assert.ok(!['privateKey', 'private_key', 'password', 'mnemonic'].some(field => Object.hasOwn(metadata, field)));
  const browserDir = dirname(fileURLToPath(import.meta.url)) + '/browser-unlock';
  const html = readFileSync(join(browserDir, 'index.html'));
  const script = readFileSync(join(browserDir, 'unlock.js'));
  const require = createRequire(existsSync(join(ROOT, 'node_modules/ethers')) ? join(ROOT, 'package.json') : resolve(ROOT, '../../../recovered-model/research/v4-hook-1m/package.json'));
  const ethersBrowser = readFileSync(join(dirname(dirname(require.resolve('ethers'))), 'dist/ethers.umd.min.js'));
  const prefix = '/' + randomBytes(24).toString('hex') + '/';
  const expiresAt = Date.now() + 4 * 60 * 60 * 1000;
  const maxNetworkFeeWei = actions.reduce((sum, action) => sum + BigInt(action.maxCostWei), 0n);
  const review = { planHash, planText: planBytes.toString('utf8'), owner: SPONSOR, chainId: 4663, maxNetworkFeeWei: String(maxNetworkFeeWei), maxNetworkFeeEth: ethers.formatEther(maxNetworkFeeWei), expiresAt };
  let state = { state: 'ready', message: 'Ready for your wallet signature.', planHash, expiresAt, totalActions: actions.length, completedActions: 0 };
  let host, origin, running = false;
  const unchanged = () => assert.equal(sha256(readFileSync(planPath)), planHash, 'Plan changed on disk');
  const closed = () => Date.now() >= expiresAt || state.state !== 'ready';

  async function submit(rawTransactions, hashes) {
    running = true;
    try {
      const journal = await executeActions({ planPath, planHash, owner: SPONSOR, actions, provider, journalPath, freshCheck,
        getSigner: async () => ({ getAddress: async () => SPONSOR, signTransaction: async request => {
          const hash = ethers.Transaction.from(request).unsignedHash;
          const index = actions.findIndex(action => action.unsignedHash === hash);
          assert.ok(index >= 0, 'Unreviewed transaction');
          return rawTransactions[index];
        } }),
        log: message => {
          try {
            const report = JSON.parse(message);
            if (report.action && report.transactionHash) state = { ...state, completedActions: state.completedActions + 1, message: `${report.action} confirmed.`, lastTransactionHash: report.transactionHash };
          } catch { /* Preserve only bounded public progress text. */ }
        },
      });
      const verification = await verifyCompleted(plan, journal, provider);
      save(out, 'canonical-verification.json', verification); save(out, 'deployment.json', verification.deployment);
      state = { ...state, state: 'confirmed', completedActions: actions.length, message: 'All nine transactions, model outputs and exact GH0ST accounting are verified.', addresses: plan.addresses, hashes };
      console.log(encode({ verified: true, transactions: hashes, deployment: join(out, 'deployment.json') }));
    } catch (error) {
      state = { ...state, state: existsSync(batchPath) || existsSync(journalPath) ? 'uncertain' : 'failed', message: 'Execution stopped. Preserve the saved signed batch and journal; reconcile the recorded hashes before any further action.', reason: executionMessage(error), hashes };
      console.log(encode({ state: state.state, message: state.message }));
    } finally { running = false; }
  }

  const server = createServer(async (req, res) => {
    const reply = (status, mime, body) => { res.writeHead(status, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'" }); res.end(body); };
    const respond = (status, value) => reply(status, 'application/json', encode(value));
    if (req.headers.host !== host || !req.url?.startsWith(prefix)) return respond(404, { message: 'Unknown signing session.' });
    const route = req.url.slice(prefix.length);
    if (req.method === 'GET' && route === '') return reply(200, 'text/html; charset=utf-8', html);
    if (req.method === 'GET' && route === 'unlock.js') return reply(200, 'text/javascript; charset=utf-8', script);
    if (req.method === 'GET' && route === 'ethers.umd.min.js') return reply(200, 'text/javascript; charset=utf-8', ethersBrowser);
    if (req.method === 'GET' && route === 'plan') return respond(200, review);
    if (req.method === 'GET' && route === 'status') return respond(200, state);
    if (closed()) return respond(409, { message: 'This signing session is closed.' });
    if (req.method === 'GET' && route === 'keystore' && req.headers['sec-fetch-site'] === 'same-origin' && req.headers['sec-fetch-dest'] === 'empty') {
      try { unchanged(); await freshCheck(provider, actions[0]); } catch { return respond(409, { message: 'The plan is no longer fresh. Reconcile wallet activity before starting again.' }); }
      if (closed()) return respond(409, { message: 'This signing session is closed.' });
      return reply(200, 'application/json', encrypted);
    }
    if (req.method !== 'POST' || route !== 'submit' || req.headers.origin !== origin || req.headers['sec-fetch-site'] !== 'same-origin' || req.headers['content-type'] !== 'application/json') return respond(403, { message: 'Use this local signing page.' });
    try {
      let body = '';
      for await (const chunk of req) { body += chunk.toString('utf8'); if (body.length > 2_000_000) { req.destroy(); return; } }
      const input = JSON.parse(body);
      assert.deepEqual(Object.keys(input).sort(), ['planHash', 'rawSignedTransactions']); assert.equal(input.planHash, planHash);
      assert.ok(Array.isArray(input.rawSignedTransactions) && input.rawSignedTransactions.length === actions.length);
      const hashes = input.rawSignedTransactions.map((raw, index) => { assert.match(raw, /^0x[0-9a-fA-F]+$/); return validateSigned(actions[index], raw, SPONSOR).hash; });
      unchanged();
      assert.ok(!closed() && !existsSync(batchPath) && !existsSync(journalPath) && !existsSync(journalPath + '.lock'));
      // Durable complete signed intent precedes the first mainnet broadcast.
      save(out, 'signed-batch.json', { schema: 'gh0st-synapse-signed-batch-v1', planHash, owner: SPONSOR, chainId: 4663, signedAt: new Date().toISOString(), actions: actions.map((action, index) => ({ id: action.id, unsignedHash: action.unsignedHash, hash: hashes[index], rawSignedTransaction: input.rawSignedTransactions[index] })) });
      state = { ...state, state: 'submitted', message: 'Signed plan received. Checking each action before broadcasting it.', hashes };
      respond(202, state);
      void submit(input.rawSignedTransactions, hashes);
    } catch { respond(400, { message: 'Signed transactions do not match the exact reviewed plan, or this session has already been handled.' }); }
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolveListen); });
  host = `127.0.0.1:${server.address().port}`; origin = `http://${host}`;
  const url = `${origin}${prefix}#plan=${planHash}`;
  const timer = setTimeout(() => { if (state.state === 'ready') state = { ...state, state: 'expired', message: 'The signing session expired. Open a fresh session.' }; if (!running) server.close(); }, 4 * 60 * 60 * 1000); timer.unref();
  server.on('close', () => { clearTimeout(timer); if (!running) provider.destroy(); });
  return { server, provider, url, planHash, journalPath, output: out, state: () => state };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = options(process.argv.slice(2));
  if (args.help) { console.log('Usage: node deploy/browser-session.mjs --plan /absolute/plan.json --keystore /absolute/key.json --output /absolute/private/session [--env-file /absolute/.env.local] [--port 0]\nStarting this session enables only manual in-browser unlocking and exact signed-plan submission.'); process.exit(0); }
  try { const session = await startSession({ planPath: args.plan, keystorePath: args.keystore, output: args.output, envFile: args['env-file'], port: Number(args.port ?? 0) }); console.log(`LOCAL_UNLOCK_URL=${session.url}`); console.log(encode({ planHash: session.planHash, actions: 9, output: session.output, expiresInHours: 4, broadcastsAtStartup: 0 })); }
  catch (error) { console.error(encode(safeError(error))); process.exitCode = 1; }
}
