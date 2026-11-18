// Exercise one authenticated 40-quantum call on a disposable stock Nitro
// node. Only the isolated chain and ephemeral genesis signer are accepted.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

const CHAIN = 412346n;
const MAX_SIGNED = 95_000;
const MAX_GAS = 32_000_000n;
const ARB_SYS = '0x0000000000000000000000000000000000000064';
const ARB_WASM = '0x0000000000000000000000000000000000000071';
const HEAD_SLOT = '0x' + '6d'.repeat(32);
const PUBLIC_GENESIS = '0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483';

const args = process.argv.slice(2);
if (args.length !== 6) {
  throw new Error('Pass ETHERS_PACKAGE_JSON PRIVATE_RPC IMPORT_DIR SEARCH_PACKAGE WITNESS_BIN NEW_RESULT');
}
const [ethersPackage, url, importDir, wasmPath, witnessPath, output] = args;
const endpoint = new URL(url);
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port
    || endpoint.pathname !== '/' || endpoint.search || endpoint.username || endpoint.password || endpoint.hash) {
  throw new Error('Private rehearsal requires a plain IPv4 loopback address and port');
}

const { Wallet, Interface, id, getBytes, hexlify } = createRequire(path.resolve(ethersPackage))('ethers');
const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const setup = readJson(path.join(importDir, 'rehearsal.json'));
const program = readJson(wasmPath);
const config = fs.readFileSync(path.join(importDir, 'config.bin'));
const head = fs.readFileSync(path.join(importDir, 'checkpoint.bin'));
const witness = fs.readFileSync(witnessPath);
if (head.length !== 72 || !program.initializedSearch || program.configCommitment !== setup.configCommitment
    || program.initialCheckpoint !== setup.initialCheckpoint || witness.subarray(0, 4).toString() !== 'GW01') {
  throw new Error('Wrong rehearsal inputs or initialized package');
}
const prefix = Buffer.alloc(3);
prefix[0] = 1;
prefix.writeUInt16BE(config.length, 1);
const calldata = Buffer.concat([prefix, config, head, witness]);
if (calldata.length >= MAX_SIGNED) throw new Error('The first group calldata alone exceeds admission');
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
const genesis = await rpc('eth_getBlockByNumber', ['0x0', false]);
if (BigInt(await rpc('eth_chainId')) !== CHAIN || !/^0x[0-9a-f]{64}$/i.test(genesis?.hash || '')
    || genesis.hash.toLowerCase() === PUBLIC_GENESIS
    || BigInt(await rpc('eth_call', [{ to: ARB_SYS, data: arbSys.encodeFunctionData('arbOSVersion') }, 'latest'])) !== 116n) {
  throw new Error('RPC did not confirm the isolated ArbOS 61 chain');
}

const report = { scope: 'private stock Nitro first Stockfish group', genesis: genesis.hash, chainId: Number(CHAIN),
  witnessBytes: witness.length, transactions: {}, fullMove: false, publicDeployment: false, passed: false };
let nonce = Number(BigInt(await rpc('eth_getTransactionCount', [signer.address, 'pending'])));

async function send(label, inputs) {
  const gasPrice = BigInt(await rpc('eth_gasPrice'));
  const raw = await signer.signTransaction({ chainId: CHAIN, type: 0, gasLimit: MAX_GAS,
    nonce, gasPrice, ...inputs });
  const signedTransactionBytes = getBytes(raw).length;
  if (signedTransactionBytes >= MAX_SIGNED) throw new Error(`${label} signed size ${signedTransactionBytes} exceeds admission`);
  const at = performance.now();
  const hash = await rpc('eth_sendRawTransaction', [raw]);
  nonce += 1;
  const row = { hash, signedTransactionBytes };
  report.transactions[label] = row;
  for (let attempt = 0; attempt < 600; attempt++) {
    const receipt = await rpc('eth_getTransactionReceipt', [hash]);
    if (receipt) {
      row.wallMs = performance.now() - at;
      row.receipt = receipt;
      if (receipt.status !== '0x1') throw new Error(`${label} reverted, gasUsed=${receipt.gasUsed}`);
      return receipt;
    }
    await sleep(100);
  }
  throw new Error(`${label} receipt deadline`);
}

try {
  const deployed = await send('deploy', { data: program.initCode });
  const address = deployed.contractAddress;
  report.address = address;
  await send('activate', { to: ARB_WASM, data: arbWasm.encodeFunctionData('activateProgram', [address]),
    value: 1_000_000_000_000_000_000n });
  const active = await rpc('eth_call', [{ to: ARB_WASM, data: arbWasm.encodeFunctionData('programVersion', [address]) }, 'latest']);
  const oldHead = await rpc('eth_getStorageAt', [address, HEAD_SLOT, 'latest']);
  if (BigInt(active) !== 3n || oldHead.toLowerCase() !== `0x${setup.initialCheckpoint}`) {
    throw new Error('Activation or constructor checkpoint mismatch');
  }
  const receipt = await send('first40', { to: address, data: hexlify(calldata) });
  const headTopic = id('GL3StockfishCheckpointHeadV1');
  const events = receipt.logs.filter(log => log.address.toLowerCase() === address.toLowerCase()
    && log.topics[0] === headTopic && log.topics[1] === `0x${setup.job}`);
  if (events.length !== 1) throw new Error('Expected exactly one authenticated head event');
  const event = Buffer.from(getBytes(events[0].data));
  const newHead = await rpc('eth_getStorageAt', [address, HEAD_SLOT, receipt.blockNumber]);
  if (event.length !== 166 || `0x${event.subarray(0, 32).toString('hex')}` !== oldHead || newHead === oldHead
      || `0x${event.subarray(32, 64).toString('hex')}` !== newHead || event.readUInt32BE(96) !== 40 || event[136] !== 0) {
    throw new Error('Committed head differs from the exact 40-quantum boundary');
  }
  report.observedNodes = Number(event.readBigUInt64BE(100));
  report.guestInstructions = event.readBigUInt64BE(158).toString();
  report.passed = true;
} catch (error) {
  report.error = String(error.message).slice(0, 240);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ passed: report.passed, error: report.error, fullMove: false }));
}
