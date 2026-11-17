// Runpod only. Fresh unfunded TEST roles exclusively. Never opens production
// operators.json. The child FS guard rejects every /workspace/gl3/mainnet access.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
assert.equal(os.platform(), 'linux'); process.umask(0o077);
const { Wallet } = createRequire('/workspace/gl3/durable/neutral/dispute/package.json')('ethers');
const ROOT = process.env.GL3_RUNTIME_TEST_ROOT || '/workspace/gl3/same-day-network/operator-runtime-tests/' + randomBytes(12).toString('hex');
assert(ROOT.startsWith('/workspace/gl3/same-day-network/operator-runtime-tests/') && !ROOT.includes('/mainnet'));
assert(!fs.existsSync(ROOT), 'Use a fresh test namespace');
fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
const source = path.resolve(process.argv[2]);
assert(source.startsWith('/workspace/gl3/same-day-network/20261117/'));
const sha = b => createHash('sha256').update(b).digest('hex');
const sourceSha256 = sha(fs.readFileSync(source));
const checks = [], audits = [];
const write = (p, data) => fs.writeFileSync(p, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data), { mode: 0o600, flag: 'wx' });
const test = async (name, run) => { await run(); checks.push(name); };
const guardPath = path.join(ROOT, 'fs-guard.mjs');
write(guardPath, `import fs from 'node:fs';import {fileURLToPath} from 'node:url';
let attempts=0,reads=0;const audit=process.env.GL3_TEST_AUDIT;const rawWrite=fs.writeFileSync.bind(fs);
for(const name of ['readFileSync','lstatSync','statSync','openSync','readdirSync','realpathSync']){const original=fs[name].bind(fs);fs[name]=function(p,...args){const s=p instanceof URL?fileURLToPath(p):String(p);if(s==='/workspace/gl3/mainnet'||s.startsWith('/workspace/gl3/mainnet/')){attempts++;throw Error('Production mainnet access forbidden in fresh TEST namespace');}reads++;return original(p,...args);};}
process.on('exit',()=>{if(audit)rawWrite(audit,JSON.stringify({mainnetAccessAttempts:attempts,fileOperations:reads}),{mode:0o600});});`);
async function fixture(name) {
  const root = path.join(ROOT, name); assert(!root.includes('/mainnet'));
  fs.mkdirSync(root, { mode: 0o700 });
  for (const dir of ['private', 'identities']) fs.mkdirSync(path.join(root, dir), { mode: 0o700 });
  const batch = Wallet.createRandom(), validator = Wallet.createRandom(), cold = Wallet.createRandom();
  const operators = { schema: 'gh0st.gl3.operator-secrets.v1', roles: {
    batchPoster: { address: batch.address, privateKey: batch.privateKey }, validator: { address: validator.address, privateKey: validator.privateKey } } };
  // Backup-hash/reference fixture, not a claim that age decryption was tested.
  const backup = randomBytes(128), pub = { schema: 'gh0st.gl3.operator-identities.v1', parentChainId: 4663, childChainId: 4663001,
    coldOwner: cold.address, addresses: { batchPoster: batch.address, validator: validator.address }, encryptedBackupSHA256: sha(backup) };
  write(path.join(root, 'private/operators.json'), operators); write(path.join(root, 'private/operators.age'), backup);
  write(path.join(root, 'identities/operators.public.json'), pub);
  const receipt = path.join(root, 'offpod-test-receipt.json'); write(receipt, { verified: true, encryptedBackupSHA256: pub.encryptedBackupSHA256 });
  return { root, pub, operators, batch, validator, receipt, spec: { mode: 'prepare', testOnly: true, root, offPodBackupReceipt: receipt } };
}
async function run(spec, expected, secrets = [], storageRoot = spec.root) {
  assert(spec.testOnly === true && storageRoot.startsWith(ROOT + '/'));
  assert(spec.root.startsWith(ROOT + '/') || spec.root === '/workspace/gl3/mainnet');
  const id = randomBytes(6).toString('hex'), file = path.join(storageRoot, 'spec-' + id + '.json'), audit = path.join(storageRoot, 'audit-' + id + '.json');
  write(file, spec);
  const child = spawn(process.execPath, ['--max-old-space-size=192', '--import', guardPath, source, file], {
    env: { ...process.env, GL3_TEST_AUDIT: audit }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b.toString(); }); child.stderr.on('data', b => { stderr += b.toString(); });
  const cmdline = fs.readFileSync('/proc/' + child.pid + '/cmdline', 'utf8');
  const exitCode = await new Promise(resolve => child.on('exit', resolve));
  for (const secret of secrets) assert(!stdout.includes(secret) && !stderr.includes(secret) && !cmdline.includes(secret), 'Secret leaked in output/argv');
  assert.equal(exitCode, expected, 'Unexpected child exit code (raw output withheld)');
  const a = JSON.parse(fs.readFileSync(audit)); assert.equal(a.mainnetAccessAttempts, 0); audits.push(a);
  if (expected !== 0) assert(stderr.includes('Operator runtime preparation stopped.'), 'Expected sanitized rejection');
  return { stdout, stderr };
}
const mode = p => fs.statSync(p).mode & 0o777;
let result;
try {
  const good = await fixture('successful');
  const fixtureKeys = [good.batch.privateKey, good.validator.privateKey];
  await test('testOnly production namespace rejects before any mainnet file/metadata access', async () => {
    await run({ ...good.spec, root: '/workspace/gl3/mainnet' }, 1, fixtureKeys, good.root);
  });
  await test('symlink test root and symlink private source path reject', async () => {
    const f = await fixture('symlink-root'), link = path.join(ROOT, 'linked-root'); fs.symlinkSync(f.root, link, 'dir');
    await run({ ...f.spec, root: link }, 1, [f.batch.privateKey, f.validator.privateKey], f.root);
    const g = await fixture('symlink-private'); fs.renameSync(path.join(g.root, 'private'), path.join(g.root, 'private-real'));
    fs.symlinkSync(path.join(g.root, 'private-real'), path.join(g.root, 'private'), 'dir');
    await run(g.spec, 1, [g.batch.privateKey, g.validator.privateKey]);
  });
  await test('actual V3 encryption/decryption roundtrip uses fresh TEST roles only', async () => {
    const out = await run(good.spec, 0, fixtureKeys);
    const report = JSON.parse(out.stdout); assert.equal(report.testOnly, true); assert.equal(report.transactionsSigned, 0); assert.equal(report.transactionsSubmitted, 0); assert.equal(report.serviceStarted, false);
    const passwords = JSON.parse(fs.readFileSync(path.join(good.root, 'secrets/passwords.json')));
    for (const [role, folder, wallet] of [['batchPoster', 'batch-poster-keystore', good.batch], ['validator', 'validator-keystore', good.validator]]) {
      const text = fs.readFileSync(path.join(good.root, 'secrets', folder, 'operator.json'), 'utf8'), k = JSON.parse(text);
      assert.equal(k.version, 3); const decoded = await Wallet.fromEncryptedJson(text, passwords[role]);
      assert(decoded.address === wallet.address && decoded.privateKey === wallet.privateKey, 'Private key/address roundtrip mismatch');
      assert(!out.stdout.includes(passwords[role]) && !out.stderr.includes(passwords[role]), 'Password leaked');
    }
  });
  await test('keystores passwords JWT and reports are0600; directories are0700', async () => {
    for (const d of ['secrets', 'secrets/batch-poster-keystore', 'secrets/validator-keystore']) assert.equal(mode(path.join(good.root, d)), 0o700);
    for (const f of ['secrets/passwords.json', 'secrets/validator.jwt', 'secrets/batch-poster-keystore/operator.json', 'secrets/validator-keystore/operator.json', 'identities/runtime-prepared.json']) assert.equal(mode(path.join(good.root, f)), 0o600);
  });
  await test('prepare refuses overwrite and preserves encrypted output', async () => {
    const file = path.join(good.root, 'secrets/batch-poster-keystore/operator.json'), before = sha(fs.readFileSync(file));
    await run(good.spec, 1, fixtureKeys); assert.equal(sha(fs.readFileSync(file)), before);
  });
  await test('wrong role/address rejects without signing or publishing secrets', async () => {
    const f = await fixture('wrong-role'); f.operators.roles.batchPoster.address = f.validator.address;
    fs.writeFileSync(path.join(f.root, 'private/operators.json'), JSON.stringify(f.operators), { mode: 0o600 });
    await run(f.spec, 1, [f.batch.privateKey, f.validator.privateKey]); assert(!fs.existsSync(path.join(f.root, 'secrets')));
  });
  await test('wrong encrypted-backup hash and unverified off-pod receipt reject', async () => {
    for (const change of ['hash', 'receipt']) {
      const f = await fixture('bad-backup-' + change);
      if (change === 'hash') fs.writeFileSync(path.join(f.root, 'private/operators.age'), randomBytes(32), { mode: 0o600 });
      else fs.writeFileSync(f.receipt, JSON.stringify({ verified: false, encryptedBackupSHA256: f.pub.encryptedBackupSHA256 }), { mode: 0o600 });
      await run(f.spec, 1, [f.batch.privateKey, f.validator.privateKey]);
    }
  });
  await test('nonprivate source-key permissions reject', async () => {
    const f = await fixture('wrong-permissions'); fs.chmodSync(path.join(f.root, 'private/operators.json'), 0o644);
    await run(f.spec, 1, [f.batch.privateKey, f.validator.privateKey]);
  });
  const dir = good.root, secretDir = path.join(dir, 'secrets');
  const genesis = path.join(dir, 'test-genesis.json'), info = path.join(dir, 'test-chain-info.json'); write(genesis, { testOnly: true }); write(info, { testOnly: true, chainId: 4663001 });
  const node = { chain: { id: 4663001 }, 'parent-chain': { id: 4663, connection: { url: '$GL3_PARENT_RPC' } }, http: { addr: '127.0.0.1' },
    execution: { rpc: { 'tx-fee-cap': 1000 } }, node: {
      'batch-poster': { 'parent-chain-wallet': { account: good.batch.address, pathname: path.join(secretDir, 'batch-poster-keystore'), password: '$GL3_BATCH_POSTER_PASSWORD' } },
      staker: { 'parent-chain-wallet': { account: good.validator.address, pathname: path.join(secretDir, 'validator-keystore'), password: '$GL3_VALIDATOR_PASSWORD' } },
      bold: { 'minimum-gap-to-parent-assertion': '0s', 'assertion-posting-interval': '5s' },
      'block-validator': { 'validation-server': { jwtsecret: path.join(secretDir, 'validator.jwt') } } } };
  const backend = { auth: { addr: '127.0.0.1', jwtsecret: path.join(secretDir, 'validator.jwt') }, validation: { 'api-auth': true, 'api-public': false } };
  const nodeFile = path.join(dir, 'node-template.json'), backendFile = path.join(dir, 'backend-template.json'), rpc = path.join(dir, 'rpc-url.private');
  const rpcValue = 'https://fresh-test.invalid/' + randomBytes(16).toString('hex'); write(nodeFile, node); write(backendFile, backend); write(rpc, rpcValue);
  const passwords = JSON.parse(fs.readFileSync(path.join(secretDir, 'passwords.json'))), sensitive = [...fixtureKeys, rpcValue, ...Object.values(passwords)];
  const render = { mode: 'render', testOnly: true, root: dir, receiptBindingsVerified: true,
    genesisFile: genesis, genesisSHA256: sha(fs.readFileSync(genesis)), chainInfoFile: info, chainInfoSHA256: sha(fs.readFileSync(info)), nodeTemplate: nodeFile, validatorTemplate: backendFile, parentRpcUrlFile: rpc };
  await test('wrong genesis hash rejects before effective config writes', async () => {
    await run({ ...render, genesisSHA256: '0'.repeat(64) }, 1, sensitive); assert(!fs.existsSync(path.join(dir, 'config/node.effective.json')));
  });
  await test('render resolves private references in0600 files without argv/log leakage', async () => {
    await run(render, 0, sensitive); const effective = JSON.parse(fs.readFileSync(path.join(dir, 'config/node.effective.json')));
    assert(effective['parent-chain'].connection.url === rpcValue, 'RPC reference mismatch');
    assert(effective.node['batch-poster']['parent-chain-wallet'].password === passwords.batchPoster, 'Password reference mismatch');
    assert.equal(mode(path.join(dir, 'config')), 0o700);
    for (const file of ['genesis.json', 'chain-info.json', 'node.effective.json', 'validator.effective.json']) assert.equal(mode(path.join(dir, 'config', file)), 0o600);
  });
  await test('render refuses effective-config overwrite', async () => {
    const file = path.join(dir, 'config/node.effective.json'), before = sha(fs.readFileSync(file));
    await run(render, 1, sensitive); assert.equal(sha(fs.readFileSync(file)), before);
  });
  await test('render rejects permissive output directory before private config placement', async () => {
    fs.renameSync(path.join(dir, 'config'), path.join(dir, 'config-prior'));
    fs.mkdirSync(path.join(dir, 'config'), { mode: 0o700 }); fs.chmodSync(path.join(dir, 'config'), 0o755);
    await run(render, 1, sensitive);
    assert(!fs.existsSync(path.join(dir, 'config/node.effective.json')));
    fs.rmdirSync(path.join(dir, 'config'));
  });
  await test('render rejects symlink output directory before private config placement', async () => {
    fs.mkdirSync(path.join(dir, 'diverted-config'), { mode: 0o700 });
    fs.symlinkSync(path.join(dir, 'diverted-config'), path.join(dir, 'config'), 'dir');
    await run(render, 1, sensitive);
    assert(!fs.existsSync(path.join(dir, 'diverted-config/node.effective.json')));
  });
  result = { passed: checks.length, checks, sourceSha256, scope: 'Fresh unfunded TEST roles only; actual ethers V3 crypto and filesystem checks; backup reference/hash gates, not age decryption or production-key inspection',
    productionOperatorsFileRead: false, mainnetAccessAttempts: audits.reduce((a, b) => a + b.mainnetAccessAttempts, 0), childRuns: audits.length,
    transactionSigned: 0, transactionsSubmitted: 0, serviceStarted: false, ownedBackgroundProcesses: 0 };
} catch (e) {
  result = { passed: false, completedChecks: checks, sourceSha256, sanitizedFailure: e.message, scope: 'Fresh TEST namespace only; raw crypto/config output withheld',
    productionOperatorsFileRead: false, mainnetAccessAttempts: audits.reduce((a, b) => a + b.mainnetAccessAttempts, 0), childRuns: audits.length, ownedBackgroundProcesses: 0 };
  process.exitCode = 1;
} finally { fs.rmSync(ROOT, { recursive: true, force: true }); }
console.log(JSON.stringify({ ...result, freshTestPrivateMaterialRemoved: true }, null, 2));
