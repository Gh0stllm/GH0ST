import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Journal, DemoEngine, digest, json, ensure } from './engine.mjs';
const req = createRequire('/workspace/gl3/durable/neutral/dispute/package.json');
const { JsonRpcProvider, Wallet, Transaction, Interface, AbiCoder, getCreateAddress, toQuantity, keccak256 } = req('ethers');
export const CHAIN = 4663001;
export const GENESIS = '0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483';
export const FORBIDDEN = ['0x8d6b11cfdf079e27c17e05cb7ea81235887691c6', '0x52cc715ef517ce1933142d2168b43f8fdc54b7c5', '0x0f2a3e06d0b6379a68dfe4a6e636c8e9edd ef5ad'.replaceAll(' ', ''), '0x1e0a95665dc872899eb89018455ef44b27108fcd'];
export function validateConfig(c) {
  ensure(c.schema === 'gh0st.gl3.automated-demo.config.v2' && c.activationApproved === true, 'DEMO_ACTIVATION_NOT_APPROVED');
  ensure(c.chainId === CHAIN && c.genesis === GENESIS && c.rpc === 'http://127.0.0.1:8547', 'CONFIG_CHAIN_BINDING');
  ensure(/^0x[0-9a-fA-F]{40}$/.test(c.signer) && !FORBIDDEN.includes(c.signer.toLowerCase()) && !/^0x0{40}$/i.test(c.signer), 'DEDICATED_DEMO_SIGNER_REQUIRED');
  ensure(c.label === 'AUTOMATED DEMO - NOT ORGANIC ADOPTION OR ECONOMIC VOLUME', 'DEMO_LABEL_REQUIRED');
  ensure(Number.isInteger(c.intervalMs) && c.intervalMs >= 1000 && c.intervalMs <= 60000, 'INVALID_INTERVAL');
  ensure(c.maxPending === 1, 'SINGLE_PENDING_REQUIRED');
  ensure(c.policyVersion === 2 && /^[0-9a-f]{64}$/.test(c.journalIdentityConfigSHA256) && c.journalIdentityConfigSHA256 === '1e203f27e8668824a20fcceb9db75eae9e78f5f800f553e2040cddfc1038ad59', 'POLICY_IDENTITY_ANCHOR_REQUIRED');
  ensure(BigInt(c.budgetWei) === 350000n * 10n ** 18n, 'REVIEWED_CUMULATIVE_350K_BUDGET_REQUIRED');
  ensure(Number.isInteger(c.tokenEveryTicks) && c.tokenEveryTicks >= 2 && Number.isInteger(c.nftEveryTicks) && c.nftEveryTicks >= c.tokenEveryTicks, 'INVALID_DEMO_MIX');
  ensure(Number.isInteger(c.maxRunSeconds) && c.maxRunSeconds > 0 && c.maxRunSeconds <= 86400, 'FINITE_WALL_DEADLINE_REQUIRED');
  ensure(Number.isInteger(c.maxTransactions) && c.maxTransactions >= 3 && c.maxTransactions <= 250000, 'FINITE_TRANSACTION_BOUND_REQUIRED');
  ensure(BigInt(c.budgetWei) > BigInt(c.reserveWei) && BigInt(c.reserveWei) > 0n, 'FINITE_FUNDING_REQUIRED');
  ensure(c.gasMarginBps === 12500 && c.feeMultiplierBps === 20000, 'UNREVIEWED_GAS_POLICY');
  ensure(c.mode === 'counter' || c.mode === 'zero-self-transfer', 'INVALID_PULSE_MODE');
  ensure(c.keyFile?.startsWith('/workspace/gl3/mainnet/private/demo/') && c.stateDir?.startsWith('/workspace/gl3/mainnet/private/demo/'), 'PRIVATE_DEMO_PATHS_REQUIRED');
  for (const p of [c.keyFile, c.stateDir]) ensure(path.resolve(p) === p && !p.includes('..'), 'NONCANONICAL_PRIVATE_PATH');
  for (const field of ['artifactsSHA256', 'engineSHA256', 'workerSHA256']) ensure(/^[0-9a-f]{64}$/.test(c[field]), 'MISSING_SOURCE_PINS');
  ensure(c.tokenRecipient === '0x000000000000000000000000000000000000dEaD', 'DEMO_SINK_ONLY');
  return c;
}
export function tickActions(tick, c) {
  return [tick > 0 && tick % c.nftEveryTicks === 0 ? 'nft' : tick > 0 && tick % c.tokenEveryTicks === 0 ? 'token' : 'pulse'];
}
export class ReceiptPacer {
  constructor(intervalMs, now = () => performance.now()) { this.intervalMs = intervalMs; this.now = now; this.last = now(); }
  waitMs(pending) { return pending ? null : Math.max(0, this.intervalMs - (this.now() - this.last)); }
  submitted() { this.last = this.now(); }
}
export function patchedRuntime(a, signer) {
  const runtime = Buffer.from(a.runtime.slice(2), 'hex');
  for (const refs of Object.values(a.immutableReferences)) for (const ref of refs) {
    ensure(ref.length === 32, 'UNEXPECTED_IMMUTABLE_LAYOUT');
    Buffer.from(signer.slice(2).padStart(64, '0'), 'hex').copy(runtime, ref.start);
  }
  return '0x' + runtime.toString('hex');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const bytes = fs.readFileSync(process.argv[2]);
  ensure(process.env.GL3_DEMO_APPROVAL_SHA256 === digest(bytes), 'EXPLICIT_CONFIG_APPROVAL_SHA_REQUIRED');
  const c = validateConfig(JSON.parse(bytes));
  for (const [file, field] of [['artifacts.json','artifactsSHA256'], ['engine.mjs','engineSHA256'], ['worker.mjs','workerSHA256']])
    ensure(digest(fs.readFileSync(path.join(dir, file))) === c[field], 'SOURCE_OR_ARTIFACT_HASH_MISMATCH');
  const k = fs.lstatSync(c.keyFile);
  ensure(k.isFile() && !k.isSymbolicLink() && k.nlink === 1 && k.uid === process.getuid() && (k.mode & 0o777) === 0o600 && k.size < 8192, 'UNSAFE_KEY_FILE');
  // Only Root's later approved runtime may read this dedicated key. Preparation/tests never read a real key.
  const secret = JSON.parse(fs.readFileSync(c.keyFile));
  ensure(secret.schema === 'gh0st.gl3.demo-secret.v1' && secret.address.toLowerCase() === c.signer.toLowerCase(), 'WRONG_DEMO_KEY_SCHEMA');
  const wallet = new Wallet(secret.privateKey);
  ensure(wallet.address.toLowerCase() === c.signer.toLowerCase(), 'WRONG_DEMO_KEY');
  const provider = new JsonRpcProvider(c.rpc, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  const rpc = (m, a) => provider.send(m, a);
  const journal = new Journal(c.stateDir);
  let stop = false; process.on('SIGTERM', () => { stop = true; }); process.on('SIGINT', () => { stop = true; });
  const engine = new DemoEngine({ rpc, sign: tx => wallet.signTransaction(tx), decode: raw => Transaction.from(raw), journal,
    identity: { chainId: c.chainId, genesis: c.genesis, signer: wallet.address, configSHA256: c.journalIdentityConfigSHA256 }, policy: { configSHA256: digest(bytes) }, budgetWei: c.budgetWei, reserveWei: c.reserveWei, maxPending: c.maxPending });
  const artifacts = JSON.parse(fs.readFileSync(path.join(dir, 'artifacts.json')));
  const names = ['GL3AutomatedDemoPulse', 'GL3AutomatedDemoToken', 'GL3AutomatedDemoNFT'];
  let outcome = 'WALL_DEADLINE'; const started = Date.now();
  const status = () => {
    const report = { schema: 'gh0st.gl3.automated-demo.status.v1', label: c.label, observedUTC: new Date().toISOString(), signer: wallet.address,
      intentCount: engine.intents.length, receiptCount: engine.intents.filter(i => i.receipt).length, pending: engine.pending.length,
      spentWei: engine.spent.toString(), budgetWei: c.budgetWei, running: !stop, stopReason: stop ? outcome : null, policyVersion: 2, firstNewNonce: engine.policyStartNonce,
      postTransitionIntentCount: engine.intents.filter(i => i.nonce >= engine.policyStartNonce).length,
      scope: 'Genuine automated demonstration transactions. Sequenced child receipts are not parent finality or organic adoption.' };
    const tmp = path.join(c.stateDir, 'status.tmp'); fs.writeFileSync(tmp, json(report) + '\n', { mode: 0o600 }); fs.renameSync(tmp, path.join(c.stateDir, 'status.json'));
  };
  async function quote(action) {
    const price = BigInt(await rpc('eth_gasPrice', []));
    const tx = { from: wallet.address, to: action.to ?? undefined, value: '0x0', data: action.data ?? '0x', maxFeePerGas: toQuantity(price * 2n), maxPriorityFeePerGas: '0x0' };
    const estimate = BigInt(await rpc('eth_estimateGas', [tx, 'latest']));
    return { ...action, gasLimit: (estimate * 12500n + 9999n) / 10000n, maxFeePerGas: price * 2n, maxPriorityFeePerGas: 0n, quoteTimeMs: Date.now() };
  }
  try {
    await engine.reconcile();
    ensure(engine.intents.length === 0 ? engine.nextNonce === 0 : engine.intents[0].nonce === 0, 'FRESH_DEDICATED_NONCE_ZERO_REQUIRED');
    const contracts = names.map((name, i) => ({ name, address: getCreateAddress({ from: wallet.address, nonce: i }), artifact: artifacts[name] }));
    // Deploy one at a time; never continue from missing/reverted/mismatched deployment.
    for (let i = 0; i < contracts.length; i++) {
      const d = contracts[i]; const key = 'deploy:' + d.name;
      if (!engine.intents.some(x => x.key === key)) {
        const data = d.artifact.bytecode + AbiCoder.defaultAbiCoder().encode(['address'], [wallet.address]).slice(2);
        await engine.submit(await quote({ key, label: 'AUTOMATED DEMO deployment: ' + d.name, data }));
      }
      while (!engine.intents.find(x => x.key === key).receipt) {
        ensure(!stop && Date.now() - started < c.maxRunSeconds * 1000, 'STOP_DURING_DEPLOYMENT'); await sleep(250); await engine.reconcile();
      }
      ensure(await rpc('eth_getCode', [d.address, 'latest']) === patchedRuntime(d.artifact, wallet.address), 'DEPLOYED_RUNTIME_MISMATCH');
    }
    const definitions = {
      pulse: () => c.mode === 'zero-self-transfer' ? { to: wallet.address, data: '0x' } : { to: contracts[0].address, data: new Interface(contracts[0].artifact.abi).encodeFunctionData('pulse') },
      token: () => ({ to: contracts[1].address, data: new Interface(contracts[1].artifact.abi).encodeFunctionData('transfer', [c.tokenRecipient, 10n ** 18n]) }),
      nft: () => ({ to: contracts[2].address, data: new Interface(contracts[2].artifact.abi).encodeFunctionData('mintDemo') })
    };
    const pacer = new ReceiptPacer(c.intervalMs);
    let tick = Math.max(-1, ...engine.intents.filter(i => i.key.startsWith('activity:')).map(i => Number(i.key.split(':')[1]))) + 1;
    while (!stop && Date.now() - started < c.maxRunSeconds * 1000 && engine.intents.length < c.maxTransactions) {
      await engine.reconcile();
      const wait = pacer.waitMs(engine.pending.length);
      if (wait === null) { await sleep(100); continue; }
      if (wait > 0) await sleep(wait);
      if (stop) break;
      const tickStarted = Date.now();
      // Restart uses unique persistent action keys and skips existing intents; no replay burst or catch-up.
      for (const kind of tickActions(tick, c)) {
        const key = 'activity:' + tick + ':' + kind;
        if (engine.intents.some(i => i.key === key)) continue;
        await engine.reconcile();
        if (engine.pending.length >= c.maxPending) break;
        const free = fs.statfsSync(c.stateDir); ensure(free.bavail * free.bsize >= 6 * 1024 ** 3, 'DISK_FREE_FLOOR');
        const quoted = await quote({ key, label: 'AUTOMATED DEMO ' + kind, ...definitions[kind]() });
        if (stop) break;
        const result = await engine.submit(quoted);
        if (!result.backpressure) pacer.submitted();
        if (result.backpressure || stop || engine.intents.length >= c.maxTransactions) break;
      }
      status(); tick++;
      // One current tick at a time; missed wall-clock slots are never replayed.
      await sleep(Math.max(0, c.intervalMs - (Date.now() - tickStarted)));
    }
    if (stop) outcome = 'OPERATOR_STOP'; else if (engine.intents.length >= c.maxTransactions) outcome = 'TRANSACTION_LIMIT';
    stop = true; status(); journal.append({ type: 'stop', reason: outcome, pending: engine.pending.length, timeMs: Date.now() });
  } catch (e) {
    outcome = /^[A-Z0-9_]+$/.test(e.message) ? e.message : 'RPC_OR_RUNTIME_ERROR_STOP'; stop = true;
    journal.append({ type: 'stop', reason: outcome, pending: engine.pending.length, timeMs: Date.now() }); status();
    process.exitCode = 1;
  } finally { journal.close(); provider.destroy(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) main().catch(() => { console.error('Demo worker refused startup; no automatic retry.'); process.exitCode = 1; });
