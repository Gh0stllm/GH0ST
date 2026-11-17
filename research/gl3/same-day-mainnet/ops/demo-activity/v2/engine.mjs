import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const digest = b => createHash('sha256').update(b).digest('hex');
export const json = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x);
export function ensure(ok, code) { if (!ok) throw new Error(code); }
const hash = s => /^0x[0-9a-fA-F]{64}$/.test(s ?? '');

// One append+fsync contains the exact signed bytes before any broadcast attempt.
// Interrupted/truncated records fail closed. No automatic journal repair/resend.
export class Journal {
  constructor(dir, maxBytes = 128 * 1024 * 1024) {
    this.dir = dir; this.maxBytes = maxBytes; this.closed = false;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(dir);
    ensure(st.isDirectory() && !st.isSymbolicLink() && (st.mode & 0o077) === 0 && st.uid === process.getuid(), 'UNSAFE_STATE_DIRECTORY');
    this.lockPath = path.join(dir, 'worker.lock');
    this.lock = fs.openSync(this.lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeSync(this.lock, json({ pid: process.pid, startedUTC: new Date().toISOString() }) + '\n'); fs.fsyncSync(this.lock);
    try {
      this.file = path.join(dir, 'intents.jsonl');
      this.fd = fs.openSync(this.file, fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
      const s = fs.fstatSync(this.fd);
      ensure(s.isFile() && s.nlink === 1 && (s.mode & 0o077) === 0 && s.uid === process.getuid() && s.size <= maxBytes, 'UNSAFE_OR_FULL_JOURNAL');
      this.bytes = s.size; this.prev = '0'.repeat(64); this.events = [];
      const content = fs.readFileSync(this.fd, 'utf8');
      ensure(content.length === 0 || content.endsWith('\n'), 'TRUNCATED_JOURNAL_REQUIRES_REVIEW');
      for (const line of content.split('\n').filter(Boolean)) {
        const row = JSON.parse(line); const { sha256, ...body } = row;
        ensure(body.prev === this.prev && sha256 === digest(json(body)), 'JOURNAL_HASH_CHAIN_INVALID');
        this.prev = sha256; this.events.push(body.event);
      }
      // Durably create directory entries as well as the append itself.
      const d = fs.openSync(dir, fs.constants.O_RDONLY); fs.fsyncSync(d); fs.closeSync(d);
    } catch (e) { this.close(); throw e; }
  }
  append(event) {
    ensure(!this.closed, 'JOURNAL_CLOSED');
    const body = { prev: this.prev, event };
    const sha256 = digest(json(body)); const line = json({ ...body, sha256 }) + '\n';
    ensure(this.bytes + Buffer.byteLength(line) <= this.maxBytes, 'JOURNAL_SIZE_LIMIT');
    const buffer = Buffer.from(line); let offset = 0;
    while (offset < buffer.length) offset += fs.writeSync(this.fd, buffer, offset, buffer.length - offset);
    fs.fsyncSync(this.fd);
    this.bytes += Buffer.byteLength(line); this.prev = sha256; this.events.push(JSON.parse(json(event)));
  }
  close() {
    if (this.closed) return; this.closed = true;
    if (this.fd !== undefined) fs.closeSync(this.fd);
    if (this.lock !== undefined) { fs.closeSync(this.lock); fs.unlinkSync(this.lockPath); }
  }
}

export class DemoEngine {
  constructor({ rpc, sign, decode, journal, identity, budgetWei, reserveWei, maxPending = 4, now = () => Date.now(), pendingTimeoutMs = 30_000, policy = null }) {
    this.rpc = rpc; this.sign = sign; this.decode = decode; this.journal = journal; this.identity = identity;
    this.budget = BigInt(budgetWei); this.reserve = BigInt(reserveWei); this.maxPending = maxPending; this.now = now; this.pendingTimeoutMs = pendingTimeoutMs;
    ensure(this.budget > this.reserve && this.reserve >= 0n && maxPending >= 1 && maxPending <= 8, 'INVALID_BOUNDS');
    this.intents = []; this.spent = 0n; this.busy = false;
    for (const e of journal.events) {
      if (e.type === 'identity') ensure(json(e.identity) === json(identity), 'JOURNAL_IDENTITY_MISMATCH');
      else if (e.type === 'intent') {
        ensure(!this.intents.some(i => i.hash === e.hash || i.nonce === e.nonce), 'DUPLICATE_INTENT');
        const d = decode(e.raw);
        ensure(d.hash === e.hash && d.from.toLowerCase() === identity.signer.toLowerCase() && d.chainId === BigInt(identity.chainId)
          && d.nonce === e.nonce && d.value === 0n && d.gasLimit * d.maxFeePerGas === BigInt(e.maxCost), 'INTENT_DECODE_MISMATCH');
        this.intents.push({ ...e, receipt: null });
      } else if (e.type === 'receipt') {
        const i = this.intents.find(i => i.hash === e.hash);
        ensure(i && !i.receipt && hash(e.blockHash), 'INVALID_RECEIPT_RECORD');
        i.receipt = e; this.spent += BigInt(e.paidWei);
      }
    }
    if (!journal.events.length) journal.append({ type: 'identity', identity });
    ensure(journal.events[0]?.type === 'identity', 'IDENTITY_RECORD_MISSING');
    this.policyStartNonce = null;
    if (policy) {
      const transition = journal.events.filter(e => e.type === 'policy-transition').at(-1);
      const prior = transition ? journal.events.slice(0, journal.events.lastIndexOf(transition)).filter(e => e.type === 'intent') : [];
      ensure(transition && transition.version === 2 && transition.oldConfigSHA256 === identity.configSHA256 && transition.newConfigSHA256 === policy.configSHA256
        && transition.oldBudgetWei === String(100000n * 10n ** 18n) && transition.newBudgetWei === String(this.budget)
        && Number.isSafeInteger(transition.firstNewNonce) && transition.firstNewNonce >= 3 && transition.firstNewNonce === (prior.at(-1)?.nonce ?? -1) + 1, 'APPROVED_POLICY_TRANSITION_REQUIRED');
      this.policyStartNonce = transition.firstNewNonce;
      const seen = new Set();
      for (const i of this.intents.filter(i => i.receipt && i.nonce >= this.policyStartNonce)) {
        ensure(!seen.has(i.receipt.blockNumber), 'DEMO_BLOCK_DUPLICATE_STOP'); seen.add(i.receipt.blockNumber);
      }
    }
    this.nextNonce = this.intents.length ? this.intents.at(-1).nonce + 1 : null;
    for (let i = 1; i < this.intents.length; i++) ensure(this.intents[i].nonce === this.intents[i - 1].nonce + 1, 'NONCONTIGUOUS_NONCES');
  }
  get pending() { return this.intents.filter(i => !i.receipt); }
  async checkIdentity() {
    ensure(BigInt(await this.rpc('eth_chainId', [])) === BigInt(this.identity.chainId), 'WRONG_CHAIN');
    const genesis = await this.rpc('eth_getBlockByNumber', ['0x0', false]);
    ensure(genesis?.hash === this.identity.genesis, 'WRONG_GENESIS');
  }
  async reconcile() {
    await this.checkIdentity();
    // Recent receipt checks are sequencing/canonicality checks, not parent finality.
    for (const i of this.intents.filter(i => i.receipt).slice(-64)) {
      const b = await this.rpc('eth_getBlockByNumber', [i.receipt.blockNumber, false]);
      ensure(b?.hash === i.receipt.blockHash, 'REORG_REQUIRES_REVIEW');
      ensure(i.receipt.status === '0x1', 'FAILED_TRANSACTION_REQUIRES_REVIEW');
    }
    for (const i of this.pending) {
      const r = await this.rpc('eth_getTransactionReceipt', [i.hash]);
      if (r) {
        ensure(r.transactionHash === i.hash && hash(r.blockHash), 'RECEIPT_HASH_MISMATCH');
        const b = await this.rpc('eth_getBlockByNumber', [r.blockNumber, false]);
        ensure(b?.hash === r.blockHash, 'NONCANONICAL_RECEIPT');
        const paidWei = BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice);
        ensure(paidWei <= BigInt(i.maxCost), 'RECEIPT_COST_EXCEEDS_INTENT');
        const event = { type: 'receipt', hash: i.hash, nonce: i.nonce, blockNumber: r.blockNumber, blockHash: r.blockHash,
          status: r.status, gasUsed: r.gasUsed, effectiveGasPrice: r.effectiveGasPrice, paidWei: paidWei.toString(), observedUTC: new Date(this.now()).toISOString() };
        this.journal.append(event); i.receipt = event; this.spent += paidWei;
        ensure(r.status === '0x1', 'FAILED_TRANSACTION_REQUIRES_REVIEW');
        if (this.policyStartNonce !== null && i.nonce >= this.policyStartNonce)
          ensure(!this.intents.some(other => other !== i && other.receipt && other.nonce >= this.policyStartNonce && other.receipt.blockNumber === r.blockNumber), 'DEMO_BLOCK_DUPLICATE_STOP');
      } else {
        const tx = await this.rpc('eth_getTransactionByHash', [i.hash]);
        ensure(tx && tx.hash === i.hash && tx.from.toLowerCase() === this.identity.signer.toLowerCase() && Number(BigInt(tx.nonce)) === i.nonce && !tx.blockHash, 'UNCERTAIN_INTENT_NO_AUTOMATIC_RESEND');
        ensure(this.now() - i.timeMs <= this.pendingTimeoutMs, 'PENDING_TIMEOUT_NO_REPLACEMENT');
      }
    }
    const latest = Number(BigInt(await this.rpc('eth_getTransactionCount', [this.identity.signer, 'latest'])));
    const pending = Number(BigInt(await this.rpc('eth_getTransactionCount', [this.identity.signer, 'pending'])));
    if (this.nextNonce === null) { ensure(latest === pending, 'UNOWNED_PENDING_TRANSACTIONS'); this.nextNonce = latest; }
    const expectedLatest = this.pending.length ? this.pending[0].nonce : this.nextNonce;
    ensure(latest === expectedLatest && pending >= latest && pending <= this.nextNonce, 'NONCE_DRIFT_REQUIRES_REVIEW');
    return { pending: this.pending.length, nextNonce: this.nextNonce, spentWei: this.spent.toString() };
  }
  async submit(action) {
    ensure(!this.busy, 'CONCURRENT_SUBMISSION'); this.busy = true;
    try {
      await this.reconcile();
      if (this.pending.length >= this.maxPending) return { backpressure: true };
      ensure(!this.intents.some(i => i.key === action.key), 'DUPLICATE_ACTION');
      ensure(this.now() - action.quoteTimeMs <= 5000, 'STALE_FEE_QUOTE');
      const gasLimit = BigInt(action.gasLimit), maxFee = BigInt(action.maxFeePerGas), maxCost = gasLimit * maxFee;
      ensure(gasLimit > 0n && maxFee > 0n && BigInt(action.value ?? 0) === 0n, 'INVALID_DEMO_TRANSACTION');
      const pendingCost = this.pending.reduce((n, i) => n + BigInt(i.maxCost), 0n);
      const balance = BigInt(await this.rpc('eth_getBalance', [this.identity.signer, 'latest']));
      ensure(balance >= this.reserve + pendingCost + maxCost && this.budget >= this.reserve + this.spent + pendingCost + maxCost, 'LOW_BALANCE_OR_FINITE_BUDGET_STOP');
      const tx = { type: 2, chainId: this.identity.chainId, nonce: this.nextNonce, to: action.to ?? null, data: action.data ?? '0x', value: 0n,
        gasLimit, maxFeePerGas: maxFee, maxPriorityFeePerGas: BigInt(action.maxPriorityFeePerGas ?? 0) };
      ensure(tx.maxPriorityFeePerGas <= maxFee, 'INVALID_PRIORITY_FEE');
      const raw = await this.sign(tx); const d = this.decode(raw);
      ensure(hash(d.hash) && d.from.toLowerCase() === this.identity.signer.toLowerCase() && d.chainId === BigInt(tx.chainId) && d.nonce === tx.nonce
        && d.to?.toLowerCase() === tx.to?.toLowerCase() && d.data === tx.data && d.value === 0n && d.gasLimit === gasLimit
        && d.maxFeePerGas === maxFee && d.maxPriorityFeePerGas === tx.maxPriorityFeePerGas, 'SIGNER_RETURNED_DIFFERENT_TRANSACTION');
      const intent = { type: 'intent', key: action.key, label: action.label, nonce: tx.nonce, hash: d.hash, raw, maxCost: maxCost.toString(), timeMs: this.now() };
      this.journal.append(intent); this.intents.push({ ...intent, receipt: null }); this.nextNonce++;
      // A crash or any RPC error after this point never causes automatic rebroadcast.
      let returned;
      try { returned = await this.rpc('eth_sendRawTransaction', [raw]); }
      catch { this.journal.append({ type: 'uncertain', hash: d.hash, timeMs: this.now() }); throw new Error('BROADCAST_UNCERTAIN_STOP_AND_RECONCILE'); }
      ensure(returned === d.hash, 'BROADCAST_HASH_MISMATCH');
      this.journal.append({ type: 'accepted', hash: d.hash, timeMs: this.now() });
      return { hash: d.hash, nonce: tx.nonce };
    } finally { this.busy = false; }
  }
}
