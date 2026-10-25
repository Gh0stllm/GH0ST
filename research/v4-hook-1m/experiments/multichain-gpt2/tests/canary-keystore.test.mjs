import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { Wallet } from 'ethers';
import { HERE } from '../scripts/build.mjs';
import { createCanaryKeystore, unlockCanaryKeystore, loadCanarySigner, readHidden, canaryKeystorePath, run as runSetup } from '../scripts/canary-keystore.mjs';
import { cliArguments, checkFunding, runCli } from '../scripts/canary-cli.mjs';
import { CANARY_KIND, CANARY_CONTRACT, CANARY_ROUTE_ID, CANARY_CHAINS } from '../scripts/canary-plan.mjs';

// All keys are ephemeral and created in this test. Never inspect the default signer file.
let directory, keyFile, configFile, wallet, password, encrypted, created;
before(async () => {
  fs.mkdirSync(path.join(HERE, 'deployments'), { recursive: true });
  directory = fs.mkdtempSync(path.join(HERE, 'deployments', 'keystore-test-'));
  keyFile = path.join(directory, 'ephemeral.json'); configFile = path.join(directory, 'public-config.json');
  wallet = new Wallet('0x' + randomBytes(32).toString('hex'));
  password = 'ephemeral-password-' + randomBytes(16).toString('hex');
  fs.writeFileSync(configFile, JSON.stringify({ admin: wallet.address }));
  created = await createCanaryKeystore({ keystoreFile: keyFile, privateKey: wallet.privateKey, password, expectedAddress: wallet.address });
  encrypted = fs.readFileSync(keyFile, 'utf8');
});
after(() => { if (directory) fs.rmSync(directory, { recursive: true, force: true }); wallet = null; password = null; encrypted = null; });

function tty({ raw = false, paused = true } = {}) {
  const input = new EventEmitter(); input.isTTY = true; input.isRaw = raw;
  input.rawCalls = []; input.paused = paused;
  input.isPaused = () => input.paused;
  input.pause = () => { input.paused = true; return input; };
  input.resume = () => { input.paused = false; return input; };
  input.setRawMode = value => { input.rawCalls.push(value); input.isRaw = value; return input; };
  const output = { isTTY: true, text: '', write(value) { this.text += value; return true; } };
  return { input, output };
}
const publicAddress = digit => '0x' + digit.repeat(40);

test('ephemeral signer is encrypted as V3, mode0600, and contains no plaintext credentials', () => {
  assert.equal(created.keystoreFile, keyFile); assert.equal(created.address, wallet.address);
  assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  const data = JSON.parse(encrypted); assert.equal(data.version, 3);
  assert.match((data.Crypto ?? data.crypto).ciphertext, /^[0-9a-f]{64}$/i);
  assert(!encrypted.includes(wallet.privateKey)); assert(!encrypted.includes(wallet.privateKey.slice(2)));
  assert(!encrypted.includes(password));
  for (const field of ['privateKey', 'private_key', 'password', 'mnemonic']) assert(!Object.hasOwn(data, field));
});

test('correct password decrypts only the expected wallet and load uses its injected hidden prompt', async () => {
  const unlocked = await unlockCanaryKeystore({ keystoreFile: keyFile, password, expectedAddress: wallet.address });
  assert.equal(unlocked.privateKey, wallet.privateKey);
  let prompts = 0;
  const loaded = await loadCanarySigner({ configFile, keystoreFile: keyFile, prompt: async prompt => {
    prompts++; assert.equal(prompt, 'Keystore password (hidden): '); return password;
  } });
  assert.equal(loaded.address, wallet.address); assert.equal(prompts, 1);
});

test('wrong password or expected admin fails; wrong key cannot create an admin keystore', async () => {
  await assert.rejects(unlockCanaryKeystore({ keystoreFile: keyFile, password: password + '-wrong', expectedAddress: wallet.address }), /Unable to unlock/);
  await assert.rejects(unlockCanaryKeystore({ keystoreFile: keyFile, password, expectedAddress: publicAddress('2') }), /does not match configured admin/);
  const wrongFile = path.join(directory, 'wrong-admin.json');
  await assert.rejects(createCanaryKeystore({ keystoreFile: wrongFile, privateKey: wallet.privateKey, password, expectedAddress: publicAddress('2') }), /does not match configured admin/);
  assert.equal(fs.existsSync(wrongFile), false);
});

test('existing encrypted file is never overwritten', async () => {
  await assert.rejects(createCanaryKeystore({ keystoreFile: keyFile, privateKey: wallet.privateKey, password, expectedAddress: wallet.address }), /Refusing to overwrite/);
  assert.equal(fs.readFileSync(keyFile, 'utf8'), encrypted);
});

test('unsafe permissions and plaintext-shaped keystores fail before decrypting', async () => {
  const badFile = path.join(directory, 'bad.json'); fs.writeFileSync(badFile, encrypted, { mode: 0o644 }); fs.chmodSync(badFile, 0o644);
  await assert.rejects(unlockCanaryKeystore({ keystoreFile: badFile, password, expectedAddress: wallet.address }), /0600/);
  fs.chmodSync(badFile, 0o600);
  const malformed = { ...JSON.parse(encrypted), privateKey: 'explicit-test-marker' };
  fs.writeFileSync(badFile, JSON.stringify(malformed));
  await assert.rejects(unlockCanaryKeystore({ keystoreFile: badFile, password, expectedAddress: wallet.address }), /Plaintext secrets/);
});

test('keystore paths reject symlinks and files outside ignored deployments', () => {
  assert.throws(() => canaryKeystorePath(path.join(HERE, 'reports', 'not-a-keystore.json')), /deployments JSON/);
  assert.throws(() => canaryKeystorePath(path.join(directory, 'key.txt')), /deployments JSON/);
  const symlink = path.join(directory, 'alias.json'); fs.symlinkSync(keyFile, symlink);
  assert.throws(() => canaryKeystorePath(symlink), /symlink/i);
  const linkedDirectory = path.join(directory, 'linked'); fs.symlinkSync(directory, linkedDirectory);
  assert.throws(() => canaryKeystorePath(path.join(linkedDirectory, 'ephemeral.json')), /symlink/i);
});

test('hidden input rejects non-TTY input/output and multiline prompts without echo', async () => {
  const a = tty(); a.input.isTTY = false;
  await assert.rejects(readHidden('Secret: ', a), /interactive terminal/); assert.equal(a.output.text, '');
  const b = tty(); b.output.isTTY = false;
  await assert.rejects(readHidden('Secret: ', b), /interactive terminal/); assert.equal(b.output.text, '');
  const c = tty(); await assert.rejects(readHidden('Secret:\n', c), /Invalid prompt/); assert.equal(c.output.text, '');
});

test('hidden TTY input emits only prompt/newline and restores raw/paused state', async () => {
  const stream = tty(), result = readHidden('Secret: ', stream);
  assert.equal(stream.input.isRaw, true); assert.equal(stream.input.paused, false);
  stream.input.emit('data', Buffer.from('secret\x7f\x1b[At\r'));
  assert.equal(await result, 'secret'); assert.equal(stream.output.text, 'Secret: \n');
  assert.deepEqual(stream.input.rawCalls, [true, false]); assert.equal(stream.input.paused, true);
  assert.equal(stream.input.listenerCount('data'), 0);
  const unicode = tty(), text = readHidden('Unicode: ', unicode), pi = Buffer.from('π');
  unicode.input.emit('data', pi.subarray(0, 1)); unicode.input.emit('data', pi.subarray(1));
  unicode.input.emit('data', Buffer.from('a\bz\n'));
  assert.equal(await text, 'πz'); assert.equal(unicode.output.text, 'Unicode: \n');
});

test('empty Enter and split CRLF never submit an empty hidden value', async () => {
  const stream=tty();let settled=false;
  const first=readHidden('First: ',stream);first.then(()=>{settled=true;});
  stream.input.emit('data',Buffer.from('\r\n\r'));await Promise.resolve();assert.equal(settled,false);
  stream.input.emit('data',Buffer.from('first-value\r'));assert.equal(await first,'first-value');
  const second=readHidden('Second: ',stream);settled=false;second.then(()=>{settled=true;});
  stream.input.emit('data',Buffer.from('\n'));await Promise.resolve();assert.equal(settled,false);
  stream.input.emit('data',Buffer.from('second-value\r\n'));assert.equal(await second,'second-value');
  assert.equal(stream.output.text,'First: \nSecond: \n');
});

test('short passwords retry without asking for the verified private key again', async () => {
  const file=path.join(directory,'retry-short.json'),answers=[wallet.privateKey,'short',password,password],prompts=[],shown=[];
  const oldLog=console.log;console.log=value=>shown.push(value);
  try{await runSetup(['--config='+configFile,'--keystore='+file],{prompt:async label=>{prompts.push(label);assert(answers.length>0);return answers.shift();}});}
  finally{console.log=oldLog;}
  assert.equal(prompts.length,4);assert.equal(prompts.filter(x=>x.startsWith('Private key')).length,1);
  assert(shown.includes('Use a password of at least 12 characters.'));assert(shown.includes('Verified wallet: '+wallet.address));
  assert(shown.every(x=>!x.includes(wallet.privateKey)&&!x.includes(password)));
  assert.equal((await unlockCanaryKeystore({keystoreFile:file,password,expectedAddress:wallet.address})).address,wallet.address);
});

test('password mismatch retries both password prompts and cancellation still aborts', async () => {
  const file=path.join(directory,'retry-mismatch.json'),answers=[wallet.privateKey,password,password+'x',password,password],prompts=[];
  const oldLog=console.log;console.log=()=>{};
  try{await runSetup(['--config='+configFile,'--keystore='+file],{prompt:async label=>{prompts.push(label);assert(answers.length>0);return answers.shift();}});}
  finally{console.log=oldLog;}
  assert.equal(prompts.length,5);assert.equal(prompts.filter(x=>x.startsWith('Private key')).length,1);
  const canceled=path.join(directory,'canceled-after-short.json');let count=0;console.log=()=>{};
  try{await assert.rejects(runSetup(['--config='+configFile,'--keystore='+canceled],{prompt:async()=>{count++;if(count===1)return wallet.privateKey;if(count===2)return 'short';throw Object.assign(Error('Private terminal input canceled'),{code:'KEYSTORE_INPUT_CANCELED'});}}),/Private terminal input/);}
  finally{console.log=oldLog;}
  assert.equal(fs.existsSync(canceled),false);
});

test('cancel/end/error restore terminal state and remove all input and signal listeners', async () => {
  for (const failure of ['cancel', 'end', 'error']) {
    const stream = tty({ raw: true, paused: false });
    const sigint = process.listenerCount('SIGINT'), sigterm = process.listenerCount('SIGTERM');
    const pending = readHidden('Unlock: ', stream);
    stream.input.emit('data', Buffer.from('never-echo-this'));
    if (failure === 'cancel') stream.input.emit('data', Buffer.from([3]));
    else if (failure === 'end') stream.input.emit('end');
    else stream.input.emit('error', Error('ephemeral terminal failure'));
    await assert.rejects(pending, /Private terminal input/);
    assert.equal(stream.input.isRaw, true); assert.equal(stream.input.paused, false);
    assert.equal(stream.output.text, 'Unlock: \n');
    for (const event of ['data', 'error', 'end']) assert.equal(stream.input.listenerCount(event), 0);
    assert.equal(process.listenerCount('SIGINT'), sigint); assert.equal(process.listenerCount('SIGTERM'), sigterm);
  }
});

test('CLI arguments reject unknown operations and funding detects wrong chain and reports zero balances', async () => {
  assert.deepEqual(cliArguments(['relay', '--config=deployments/test.json', '--keystore=deployments/test-key.json']),
    { action: 'relay', config: 'deployments/test.json', keystore: 'deployments/test-key.json' });
  assert.throws(() => cliArguments(['broadcast']), /Choose setup/);
  assert.throws(() => cliArguments(['check', '--private-key=not-accepted']), /Unknown option/);
  const names = ['KEYSTORE_TEST_RH_RPC', 'KEYSTORE_TEST_OPBNB_RPC'], previous = names.map(name => process.env[name]);
  names.forEach((name, i) => { process.env[name] = 'http://local-test.invalid/' + i; });
  const config = { admin: wallet.address, chains: CANARY_CHAINS.map((chain, i) => ({ ...chain, rpcEnv: names[i] })) };
  try {
    const balances = await checkFunding(config, { request: async (url, method) => {
      if (method === 'eth_chainId') return url.endsWith('/0') ? '0x1237' : '0xcc';
      if (method === 'eth_getBalance' || method === 'eth_getTransactionCount') return '0x0';
      throw Error('Unexpected request');
    } });
    assert.deepEqual(balances.map(row => row.balanceWei), ['0', '0']);
    await assert.rejects(checkFunding(config, { request: async () => '0x1' }), /Wrong RPC network/);
  } finally { names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; }); }
});

test('zero-balance paid CLI stops before reading or decrypting any signer', async () => {
  const file = path.join(directory, 'funding-config.json');
  const envNames = ['KEYSTORE_TEST_CLI_RH', 'KEYSTORE_TEST_CLI_OPBNB'];
  const envKeys = [...envNames, 'RH_RPC_URL', 'OPBNB_RPC_URL']; const oldEnv = envKeys.map(name => process.env[name]);
  const config = { schemaVersion: 1, routeKind: CANARY_KIND, routerContract: CANARY_CONTRACT, routeId: CANARY_ROUTE_ID,
    executorMode: 'self-relay', spendingPolicy: 'uncapped', enabled: true, messagingReviewed: true, budgetApproved: true,
    admin: wallet.address, requester: wallet.address, sessionId: '0x' + randomBytes(32).toString('hex'), challenge: '0x' + randomBytes(32).toString('hex'),
    deadline: Math.floor(Date.now() / 1000) + 3600, keyEnv: 'KEYSTORE_TEST_NEVER_READ', verificationFile: 'verified-canary.json',
    chains: CANARY_CHAINS.map((chain, i) => ({ ...chain, requiredDVNs: [...chain.requiredDVNs], rpcEnv: envNames[i],
      router: publicAddress(i ? '4' : '3'), selfRelayExecutor: publicAddress(i ? '6' : '5'), routerDeploymentTx: null,
      selfRelayExecutorDeploymentTx: null, deploymentBlock: 0, confirmations: 2, dvnConfirmations: 20,
      maxTransactionGas: '16777216', maxFeePerGasWei: null, maxMessageFeeWei: null, maxTotalSpendWei: null, maxPostingFeeWei: null })) };
  fs.writeFileSync(file, JSON.stringify(config));
  envNames.forEach((name, i) => { process.env[name] = 'http://local-test.invalid/' + i; });
  process.env.RH_RPC_URL = process.env[envNames[0]]; process.env.OPBNB_RPC_URL = process.env[envNames[1]];
  const oldFetch = globalThis.fetch, oldLog = console.log; let reads = 0;
  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body); reads++;
    assert(['eth_chainId', 'eth_getBalance', 'eth_getTransactionCount'].includes(request.method));
    const result = request.method === 'eth_chainId' ? (url.endsWith('/0') ? '0x1237' : '0xcc') : '0x0';
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  };
  console.log = () => {};
  try {
    await assert.rejects(runCli(['deploy', '--config=' + file, '--keystore=' + path.join(directory, 'deliberately-absent.json')]), /FUND_BOTH_CHAINS/);
    assert.equal(reads, 6);
  } finally {
    globalThis.fetch = oldFetch; console.log = oldLog;
    envKeys.forEach((name, i) => { if (oldEnv[i] === undefined) delete process.env[name]; else process.env[name] = oldEnv[i]; });
  }
});
