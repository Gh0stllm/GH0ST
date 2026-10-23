// User-run CLI. Importing this module never connects, prompts, signs, or broadcasts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { JsonRpcProvider, Wallet, formatEther, getCreate2Address, keccak256 } from 'ethers';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PIN = Object.freeze({
  chain: 4663n,
  sender: '0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6',
  factory: '0x4e59b44847b379578588920cA78FbF26c0B4956C',
  manager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
  modelHash: '0x03047f3adb84443ebbd6f1ba45d948fe4872f51ce0f6326e3f35a434c5b02f62',
  planSha256: '2d4f3d60ef3208c92d0dff3295cc4cc0b89d53d6ebb4da7dd63324cc5b4b7911',
});
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
export const gasWithHeadroom = estimate => (BigInt(estimate) * 150n + 99n) / 100n;

export function loadReviewedPlan(bytes) {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), PIN.planSha256, 'Deployment plan differs from the reviewed file.');
  const plan = JSON.parse(bytes);
  assert.equal(BigInt(plan.chain_id), PIN.chain);
  assert(same(plan.sender.address, PIN.sender), 'Wrong deployment wallet.');
  assert(same(plan.dependencies.create2_deployer, PIN.factory), 'Wrong deployment factory.');
  assert(same(plan.dependencies.pool_manager, PIN.manager), 'Wrong PoolManager.');
  assert.equal(plan.selected_model.model_hash, PIN.modelHash);
  assert.equal(plan.transactions.length, 59);
  for (const entry of plan.transactions) {
    const tx = entry.unsigned_transaction;
    assert.equal(BigInt(tx.chainId), PIN.chain);
    assert(same(tx.to, PIN.factory) && BigInt(tx.value) === 0n, 'Unexpected deployment target or value.');
    assert.equal(tx.data.slice(0, 66), entry.salt);
    assert.equal(keccak256('0x' + tx.data.slice(66)), entry.init_code_hash);
    assert(same(getCreate2Address(PIN.factory, entry.salt, entry.init_code_hash), entry.predicted_address));
  }
  return plan;
}

export async function verifyNetwork(provider, plan) {
  assert.equal(BigInt(await provider.send('eth_chainId', [])), PIN.chain, 'RPC is not Robinhood mainnet (4663).');
  for (const [address, expected] of [[PIN.factory, plan.dependencies.create2_deployer_code_hash],
    [PIN.manager, plan.dependencies.pool_manager_code_hash]]) {
    assert.equal(keccak256(await provider.getCode(address)), expected, 'Dependency runtime does not match.');
  }
}

export async function inspectEntry(provider, entry, state) {
  const code = await provider.getCode(entry.predicted_address);
  if (code !== '0x') {
    assert.equal(keccak256(code), entry.runtime_code_hash, `Conflicting contract at ${entry.predicted_address}.`);
    return true;
  }
  const row = state.transactions?.[entry.order];
  if (row) {
    assert(row.hash, 'A previous submission has an unknown outcome. Inspect wallet activity before retrying.');
    const receipt = await provider.getTransactionReceipt(row.hash);
    assert(receipt, `Transaction ${row.hash} is pending or replaced; inspect before retrying.`);
    assert.equal(Number(receipt.status), 1, `Transaction ${row.hash} failed; inspect before retrying.`);
    throw Error(`Confirmed transaction ${row.hash} has no expected contract. Stop and inspect.`);
  }
  return false;
}

export async function deployEntries({ provider, signer, plan, state, save, log = () => {} }) {
  assert(same(await signer.getAddress(), PIN.sender), 'Key does not belong to the confirmed deployment wallet.');
  await verifyNetwork(provider, plan);
  assert.equal(await provider.getTransactionCount(PIN.sender, 'pending'), await provider.getTransactionCount(PIN.sender, 'latest'),
    'This wallet has pending transactions. Wait for them before starting or resuming.');
  for (const entry of plan.transactions) {
    if (await inspectEntry(provider, entry, state)) { log(`Verified ${entry.kind}: ${entry.predicted_address}`); continue; }
    await verifyNetwork(provider, plan);
    const request = { from: PIN.sender, to: PIN.factory, data: entry.unsigned_transaction.data, value: 0n, chainId: PIN.chain };
    const gasLimit = gasWithHeadroom(await signer.estimateGas(request));
    const fees = await provider.getFeeData(), price = fees.maxFeePerGas ?? fees.gasPrice;
    assert(price !== null, 'Cannot estimate current network fee.');
    assert(await provider.getBalance(PIN.sender, 'pending') >= gasLimit * price, 'Insufficient ETH for the current gas estimate.');
    // Record before sending so an ambiguous RPC outcome cannot cause a blind duplicate retry.
    state.transactions[entry.order] = { status: 'submitting', expected_address: entry.predicted_address };
    save(state);
    const tx = await signer.sendTransaction({ ...request, gasLimit });
    state.transactions[entry.order] = { ...state.transactions[entry.order], status: 'pending', hash: tx.hash };
    save(state); log(`Submitted ${entry.kind}: ${tx.hash}`);
    const receipt = await tx.wait();
    assert.equal(Number(receipt.status), 1, 'Deployment transaction failed.');
    assert.equal(keccak256(await provider.getCode(entry.predicted_address)), entry.runtime_code_hash, 'Deployed runtime mismatch.');
    state.transactions[entry.order].status = 'verified'; save(state);
    log(`Verified ${entry.kind}: ${entry.predicted_address}`);
  }
}

function rpcUrl() {
  const envFile = path.join(root, '.env.local');
  const line = existsSync(envFile) ? readFileSync(envFile, 'utf8').split(/\r?\n/).find(x => x.startsWith('ROBINHOOD_MAINNET_RPC_URL=')) : null;
  const value = process.env.ROBINHOOD_MAINNET_RPC_URL || line?.slice(line.indexOf('=') + 1).trim();
  assert(value && new URL(value).protocol === 'https:', 'Set an HTTPS ROBINHOOD_MAINNET_RPC_URL in the private .env.local file.');
  return value;
}

function hiddenKey() {
  assert(process.stdin.isTTY && process.stdout.isTTY, 'Enter the key in your own interactive terminal; piped keys are not accepted.');
  process.stdout.write('Private key (hidden; never saved): ');
  return new Promise((resolve, reject) => {
    let value = '';
    const wasRaw = process.stdin.isRaw;
    const finish = (error) => {
      process.stdin.off('data', onData); process.stdin.setRawMode(!!wasRaw); process.stdin.pause();
      process.stdout.write('\n');
      if (error) { value = ''; reject(error); } else { const result = value; value = ''; resolve(result); }
    };
    const onData = chunk => {
      for (const char of chunk.toString()) {
        if (char === '\u0003') return finish(Error('Cancelled.'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (/[0-9a-fA-FxX]/.test(char)) value += char;
      }
    };
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', onData);
  });
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('Read-only check: node scripts/deploy-reviewed-plan.mjs\nUser-run deployment: node scripts/deploy-reviewed-plan.mjs --broadcast\nReads the private RPC from .env.local. Broadcast mode prompts for your key without echoing or storing it.\nDeploys only the 59 reviewed contracts; pool funding stays in the separate signing page.');
    return;
  }
  assert(args.every(x => x === '--broadcast'), 'Unknown option. Use --help.');
  const plan = loadReviewedPlan(readFileSync(path.join(root, 'deployment/robinhood-mainnet-plan.json')));
  const provider = new JsonRpcProvider(rpcUrl(), PIN.chain, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
  let lockFile, lockFd;
  try {
    await verifyNetwork(provider, plan);
    const directory = path.join(root, 'deployment/.local');
    const stateFile = path.join(directory, 'cli-deploy-receipts.json');
    const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile)) : { planSha256: PIN.planSha256, transactions: {} };
    assert.equal(state.planSha256, PIN.planSha256, 'Saved receipts belong to another plan.');
    let done = 0;
    for (const entry of plan.transactions) if (await inspectEntry(provider, entry, state)) done++;
    console.log(`Robinhood mainnet verified. Wallet: ${PIN.sender}\nContracts verified: ${done}/59\nETH balance: ${formatEther(await provider.getBalance(PIN.sender))}\nGas limit: 150% of each fresh estimate; network fee pricing. No liquidity is funded by this command.`);
    if (!args.includes('--broadcast') || done === 59) return;
    assert(process.stdin.isTTY, 'Broadcast requires your interactive terminal.');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    lockFile = path.join(directory, 'cli-deploy.lock');
    lockFd = openSync(lockFile, 'wx', 0o600); writeFileSync(lockFd, String(process.pid));
    const question = createInterface({ input: process.stdin, output: process.stdout });
    let answer;
    try { answer = await question.question(`Type DEPLOY to send up to ${59 - done} reviewed contract transactions: `); } finally { question.close(); }
    assert.equal(answer, 'DEPLOY', 'Cancelled.');
    let key = await hiddenKey(), signer;
    try { signer = new Wallet(key, provider); } catch (_) { throw Error('Invalid private key.'); } finally { key = ''; }
    const save = current => { const tmp = stateFile + '.tmp'; writeFileSync(tmp, JSON.stringify(current, null, 2) + '\n', { mode: 0o600 }); renameSync(tmp, stateFile); };
    await deployEntries({ provider, signer, plan, state, save, log: console.log });
    console.log(`All 59 contracts verified. Model: ${plan.model_address}\nHook: ${plan.hook_address}`);
  } finally {
    provider.destroy();
    if (lockFd !== undefined) { closeSync(lockFd); unlinkSync(lockFile); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const text = String(error.shortMessage || error.message).replace(/https?:\/\/[^\s)"']+/g, '[RPC URL redacted]')
      .replace(/(?:alch_|nfp_)[A-Za-z0-9]+/g, '[credential redacted]').replace(/0x[0-9a-fA-F]{64}/g, '[hash redacted]');
    console.error(text.slice(0, 1000)); process.exitCode = 1;
  });
}
