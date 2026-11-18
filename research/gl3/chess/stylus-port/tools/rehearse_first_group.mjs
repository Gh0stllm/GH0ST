// Exercise one authenticated 40-quantum call on a disposable stock Nitro
// node. Only the isolated chain and ephemeral genesis signer are accepted.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

const CHAIN = 412346n;
const MAX_SIGNED = 95_000;
const MAX_GAS = 32_000_000n;
const NODE_INTERFACE = '0x00000000000000000000000000000000000000c8';
const CONTRACT_CREATION = '0x0000000000000000000000000000000000000000';
const ARB_SYS = '0x0000000000000000000000000000000000000064';
const ARB_WASM = '0x0000000000000000000000000000000000000071';
const HEAD_SLOT = '0x' + '6d'.repeat(32);
const PUBLIC_GENESIS = '0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483';

const args = process.argv.slice(2);
const activationOnly = args[0] === '--activation-only';
if (activationOnly) args.shift();
if (args.length !== (activationOnly ? 5 : 7)) {
  throw new Error('Pass [--activation-only] ETHERS_PACKAGE_JSON PRIVATE_RPC IMPORT_DIR SEARCH_PACKAGE [WITNESS_BIN TRACE_REPORT] NEW_RESULT');
}
const [ethersPackage, url, importDir, wasmPath, witnessPath, tracePath] = args;
const output = args.at(-1);
const endpoint = new URL(url);
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port
    || endpoint.pathname !== '/' || endpoint.search || endpoint.username || endpoint.password || endpoint.hash) {
  throw new Error('Private rehearsal requires a plain IPv4 loopback address and port');
}

const { Wallet, Interface, id, getBytes, hexlify, keccak256 } = createRequire(path.resolve(ethersPackage))('ethers');
const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const setup = readJson(path.join(importDir, 'rehearsal.json'));
const program = readJson(wasmPath);
const config = fs.readFileSync(path.join(importDir, 'config.bin'));
const head = fs.readFileSync(path.join(importDir, 'checkpoint.bin'));
const witness = activationOnly ? null : fs.readFileSync(witnessPath);
const trace = activationOnly ? null : readJson(tracePath);
if (head.length !== 72 || !program.initializedSearch || program.configCommitment !== setup.configCommitment
    || program.initialCheckpoint !== setup.initialCheckpoint
    || (witness && witness.subarray(0, 4).toString() !== 'GW01')) {
  throw new Error('Wrong rehearsal inputs or initialized package');
}
if (trace && (trace.quanta !== 40 || !trace.packetWritten || trace.archivedWitnessBytes !== witness.length
    || !/^[a-f0-9]{64}$/.test(trace.journalSHA256))) {
  throw new Error('Trace differs from the first-group witness');
}
const prefix = Buffer.alloc(3);
prefix[0] = 1;
prefix.writeUInt16BE(config.length, 1);
const calldata = witness ? Buffer.concat([prefix, config, head, witness]) : null;
if (calldata && calldata.length >= MAX_SIGNED) throw new Error('The first group calldata alone exceeds admission');
const signer = new Wallet(process.env.GH0ST_PRIVATE_REHEARSAL_SIGNER || '');
if (signer.address.toLowerCase() !== setup.signerAddress) throw new Error('Signer differs from the ephemeral funded address');
if (fs.existsSync(output)) throw new Error('New result path required');

let sequence = 0;
async function rpc(method, params = []) {
  const result = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error',
    body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!result.ok) throw new Error(`${method} HTTP error ${result.status}`);
  const reply = await result.json();
  if (reply.error) throw new Error(`${method}: ${String(reply.error.message).slice(0, 180)}`);
  return reply.result;
}

const arbSys = new Interface(['function arbOSVersion() view returns (uint256)']);
const arbWasm = new Interface(['function activateProgram(address) payable returns (uint16,uint256)',
  'function programVersion(address) view returns (uint16)']);
const nodeInterface = new Interface(['function gasEstimateL1Component(address,bool,bytes) returns (uint64,uint256,uint256)']);
const genesis = await rpc('eth_getBlockByNumber', ['0x0', false]);
if (BigInt(await rpc('eth_chainId')) !== CHAIN || !/^0x[0-9a-f]{64}$/i.test(genesis?.hash || '')
    || genesis.hash.toLowerCase() === PUBLIC_GENESIS
    || BigInt(await rpc('eth_call', [{ to: ARB_SYS, data: arbSys.encodeFunctionData('arbOSVersion') }, 'latest'])) !== 116n) {
  throw new Error('RPC did not confirm the isolated ArbOS 61 chain');
}

const report = { scope: activationOnly ? 'private stock Nitro activation only' : 'private stock Nitro first Stockfish group',
  genesis: genesis.hash, chainId: Number(CHAIN), witnessBytes: witness?.length ?? null, transactions: {},
  activationPassed: false, fullMove: false, publicDeployment: false, passed: false };
let nonce = Number(BigInt(await rpc('eth_getTransactionCount', [signer.address, 'pending'])));

async function send(label, inputs) {
  const gasPrice = BigInt(await rpc('eth_gasPrice'));
  const posterCall = nodeInterface.encodeFunctionData('gasEstimateL1Component',
    [inputs.to ?? CONTRACT_CREATION, !inputs.to, inputs.data ?? '0x']);
  const estimate = await rpc('eth_call', [{ from: signer.address, to: NODE_INTERFACE, data: posterCall }, 'latest']);
  const [posterGasEstimate] = nodeInterface.decodeFunctionResult('gasEstimateL1Component', estimate);
  const gasLimit = MAX_GAS + posterGasEstimate * 102n / 100n + 10_000n;
  const raw = await signer.signTransaction({ chainId: CHAIN, type: 0, gasLimit,
    nonce, gasPrice, ...inputs });
  const signedTransactionBytes = getBytes(raw).length;
  if (signedTransactionBytes >= MAX_SIGNED) throw new Error(`${label} signed size ${signedTransactionBytes} exceeds admission`);
  const at = performance.now();
  const hash = await rpc('eth_sendRawTransaction', [raw]);
  nonce += 1;
  const row = { hash, signedTransactionBytes, posterGasEstimate: posterGasEstimate.toString(), gasLimit: gasLimit.toString() };
  report.transactions[label] = row;
  for (let attempt = 0; attempt < 600; attempt++) {
    const receipt = await rpc('eth_getTransactionReceipt', [hash]);
    if (receipt) {
      row.wallMs = performance.now() - at;
      row.receipt = receipt;
      const gasUsed = BigInt(receipt.gasUsed);
      const posterGas = BigInt(receipt.gasUsedForL1 ?? '0x0');
      if (posterGas < 0n || posterGas >= gasUsed) throw new Error(`${label} returned invalid gas components`);
      row.computeGas = Number(gasUsed - posterGas);
      if (receipt.status !== '0x1') throw new Error(`${label} reverted, compute gas used=${row.computeGas}`);
      if (label === 'first40' && gasUsed - posterGas > MAX_GAS) throw new Error('First group exceeded the L2 compute gas cap');
      return receipt;
    }
    await sleep(100);
  }
  throw new Error(`${label} receipt deadline`);
}

function verifyJournal(logs, committedHead, expectedCount) {
  const hash = createHash('sha256');
  let previousIndex = -1;
  let count = 0;
  let length = 0;
  for (const log of logs) {
    const chunk = Buffer.from(getBytes(log.data));
    if (log.topics.length !== 2 || log.topics[1] !== committedHead || chunk.length === 0
        || chunk.length > 12_288 - 64) throw new Error('Wrong checkpoint page log');
    for (let offset = 0; offset < chunk.length;) {
      if (chunk.length - offset < 7) throw new Error('Incomplete checkpoint page header');
      const index = chunk.readUInt32BE(offset);
      const size = chunk.readUInt16BE(offset + 5);
      const end = offset + 7 + size;
      if (index <= previousIndex || index >= 196_608 || end > chunk.length) {
        throw new Error('Out-of-order or incomplete checkpoint page');
      }
      previousIndex = index;
      count++;
      offset = end;
    }
    length += chunk.length;
    hash.update(chunk);
  }
  const digest = hash.digest('hex');
  if (count !== expectedCount || count !== trace.changedPages || length !== trace.journalDataBytes
      || digest !== trace.journalSHA256) throw new Error('Published journal differs from the exact interpreter trace');
  return { changedPages: count, bytes: length, sha256: digest };
}

async function deploymentData() {
  if (program.schema !== 'gh0st.stylus-fragment-package.v1') return program.initCode;
  const parts = program.fragments;
  const root = program.rootInitCodeTemplate;
  if (parts.length < 2 || parts.length > 4 || !root.endsWith('00'.repeat(20 * parts.length))
      || program.rootRuntimeBytes !== 8 + 20 * parts.length) throw new Error('Invalid root or fragment manifest');
  const addresses = [];
  for (const [index, part] of parts.entries()) {
    const receipt = await send('fragment' + index, { data: part.initCode });
    const address = receipt.contractAddress;
    const data = Buffer.from(getBytes(await rpc('eth_getCode', [address, 'latest'])));
    if (!address || data.length !== part.runtimeBytes
        || createHash('sha256').update(data).digest('hex') !== part.runtimeSHA256) {
      throw new Error('Deployed fragment differs from its manifest');
    }
    addresses.push(address.slice(2));
  }
  const linkOffset = root.length - 40 * addresses.length;
  return root.slice(0, linkOffset) + addresses.join('');
}

try {
  const deployed = await send('deploy', { data: await deploymentData() });
  const address = deployed.contractAddress;
  report.address = address;
  await send('activate', { to: ARB_WASM, data: arbWasm.encodeFunctionData('activateProgram', [address]),
    value: 1_000_000_000_000_000_000n });
  const active = await rpc('eth_call', [{ to: ARB_WASM, data: arbWasm.encodeFunctionData('programVersion', [address]) }, 'latest']);
  const oldHead = await rpc('eth_getStorageAt', [address, HEAD_SLOT, 'latest']);
  if (BigInt(active) !== 3n || oldHead.toLowerCase() !== `0x${setup.initialCheckpoint}`) {
    throw new Error('Activation or constructor checkpoint mismatch');
  }
  report.activationPassed = true;
  if (!activationOnly) {
    const receipt = await send('first40', { to: address, data: hexlify(calldata) });
    const ownLogs = receipt.logs.filter(log => log.address.toLowerCase() === address.toLowerCase());
    const events = ownLogs.filter(log => log.topics[0] === id('GL3StockfishCheckpointHeadV1')
      && log.topics[1] === `0x${setup.job}`);
    if (events.length !== 1) throw new Error('Expected exactly one authenticated head event');
    const event = Buffer.from(getBytes(events[0].data));
    const newHead = await rpc('eth_getStorageAt', [address, HEAD_SLOT, receipt.blockNumber]);
    if (event.length !== 166 || `0x${event.subarray(0, 32).toString('hex')}` !== oldHead || newHead === oldHead
        || `0x${event.subarray(32, 64).toString('hex')}` !== newHead || event.readUInt32BE(96) !== 40 || event[136] !== 0) {
      throw new Error('Committed head differs from the exact 40-quantum boundary');
    }
    const checkpoint = event.subarray(64, 136);
    const fields = Buffer.alloc(41);
    fields.writeUInt32LE(checkpoint.readUInt32BE(32), 0);
    for (const offset of [4, 12, 20, 28]) fields.writeBigUInt64LE(checkpoint.readBigUInt64BE(32 + offset), offset);
    fields.writeUInt32LE(checkpoint.readUInt32BE(68), 36);
    const commitment = keccak256(Buffer.concat([Buffer.from('GL3_STYLUS_CHECKPOINT_V1'),
      Buffer.from(setup.configCommitment + setup.job, 'hex'), checkpoint.subarray(0, 32), fields]));
    report.observedNodes = Number(checkpoint.readBigUInt64BE(36));
    report.guestInstructions = event.readBigUInt64BE(158).toString();
    if (commitment !== newHead || checkpoint.readUInt32BE(68) !== trace.logicalMemoryBytes
        || report.observedNodes !== trace.observedNodes
        || report.guestInstructions !== String(trace.guestInstructions)) {
      throw new Error('Header commitment or exact trace counters differ');
    }
    const pagesTopic = id('GL3StockfishCheckpointPagesV1');
    report.journal = verifyJournal(ownLogs.filter(log => log.topics[0] === pagesTopic), newHead, event.readUInt32BE(154));
    report.nextCheckpoint = hexlify(checkpoint);
    report.passed = true;
  }
} catch (error) {
  report.error = String(error.message).slice(0, 240);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ activationPassed: report.activationPassed, passed: report.passed,
    error: report.error, fullMove: false }));
}
