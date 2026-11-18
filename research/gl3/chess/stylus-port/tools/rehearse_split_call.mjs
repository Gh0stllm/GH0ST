// Measure a packed Stylus-to-Stylus delegate boundary on private Nitro only.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

const [dependencies, url, signerFile, boundary, output] = process.argv.slice(2);
const endpoint = new URL(url);
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port
  || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
  throw new Error('Private loopback endpoint required');
}
if (fs.existsSync(output) || (fs.statSync(signerFile).mode & 0o077) !== 0) {
  throw new Error('A new report and a private disposable key file are required');
}
const { Interface, Wallet, getBytes } = createRequire(path.resolve(dependencies))('ethers');
const signer = new Wallet(fs.readFileSync(signerFile, 'utf8').trim());
const CHAIN = 412346n;
const GAS_CAP = 32_000_000n;
const SIGNED_CAP = 95_000;
const ARB_SYS = '0x0000000000000000000000000000000000000064';
const ARB_WASM = '0x0000000000000000000000000000000000000071';
const PUBLIC_GENESIS = '0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483';
const system = new Interface(['function arbOSVersion() view returns (uint256)']);
const wasm = new Interface(['function activateProgram(address) payable returns (uint16,uint256)',
  'function programVersion(address) view returns (uint16)', 'function inkPrice() view returns (uint32)']);
const node = new Interface(['function gasEstimateL1Component(address,bool,bytes) returns (uint64,uint256,uint256)']);

let request = 0;
async function rpc(method, params = []) {
  const response = await fetch(endpoint, { method: 'POST', redirect: 'error',
    headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: ++request, method, params }) });
  if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
  const reply = await response.json();
  if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
  return reply.result;
}

async function query(to, data) {
  return rpc('eth_call', [{ from: signer.address, to, data }, 'latest']);
}

const genesis = await rpc('eth_getBlockByNumber', ['0x0', false]);
if (BigInt(await rpc('eth_chainId')) !== CHAIN || !/^0x[0-9a-f]{64}$/i.test(genesis?.hash || '')
  || genesis.hash.toLowerCase() === PUBLIC_GENESIS
  || BigInt(await query(ARB_SYS, system.encodeFunctionData('arbOSVersion'))) !== 116n
  || BigInt(await rpc('eth_getBalance', [signer.address, '0x0'])) < 10n ** 20n) {
  throw new Error('The disposable signer and private ArbOS 61 genesis must match');
}
const report = { scope: 'Private Nitro two-contract data boundary and gas canary',
  chainId: Number(CHAIN), genesis: genesis.hash, client: await rpc('web3_clientVersion'),
  inkPerGas: Number(BigInt(await query(ARB_WASM, wasm.encodeFunctionData('inkPrice')))),
  programs: {}, samples: [], transactions: {}, fullStockfishMove: false, publicDeployment: false,
  passed: false };
let nonce = Number(BigInt(await rpc('eth_getTransactionCount', [signer.address, 'pending'])));

async function send(label, data, to, value = 0n) {
  const create = !to;
  const l1 = await query('0x00000000000000000000000000000000000000c8',
    node.encodeFunctionData('gasEstimateL1Component', [to ?? '0x' + '00'.repeat(20), create, data]));
  const [poster] = node.decodeFunctionResult('gasEstimateL1Component', l1);
  const gasLimit = GAS_CAP + poster * 102n / 100n + 10_000n;
  const gasPrice = BigInt(await rpc('eth_gasPrice'));
  const raw = await signer.signTransaction({ chainId: CHAIN, type: 0, nonce, data, to, value, gasLimit, gasPrice });
  const signedBytes = getBytes(raw).length;
  if (signedBytes >= SIGNED_CAP) throw new Error(`${label} exceeded the signed size envelope`);
  const began = performance.now();
  const hash = await rpc('eth_sendRawTransaction', [raw]);
  nonce++;
  for (let attempt = 0; attempt < 400; attempt++) {
    const receipt = await rpc('eth_getTransactionReceipt', [hash]);
    if (receipt) {
      const gas = BigInt(receipt.gasUsed) - BigInt(receipt.gasUsedForL1);
      report.transactions[label] = { hash, signedBytes, computeGas: Number(gas),
        elapsedMs: performance.now() - began, block: receipt.blockNumber, status: receipt.status };
      if (receipt.status !== '0x1' || gas <= 0n || gas > GAS_CAP) throw new Error(`${label} failed`);
      return receipt;
    }
    await sleep(50);
  }
  throw new Error(`${label} receipt semaphore expired`);
}

try {
  for (const [role, variant] of Object.entries({ worker: 0, coordinator: 1 })) {
    const pkg = JSON.parse(fs.readFileSync(path.join(boundary, `part-${variant}.json`), 'utf8'));
    if (pkg.initializedSearch || pkg.fragments || !/^0x[0-9a-f]+$/.test(pkg.initCode)) {
      throw new Error('An uninitialized single-fragment canary package is required');
    }
    const address = (await send(`deploy-${role}`, pkg.initCode)).contractAddress;
    await send(`activate-${role}`, wasm.encodeFunctionData('activateProgram', [address]), ARB_WASM, 10n ** 18n);
    const version = Number(BigInt(await query(ARB_WASM, wasm.encodeFunctionData('programVersion', [address]))));
    if (version !== 3) throw new Error(`${role} activation check failed`);
    report.programs[role] = { address, version, wasmBytes: pkg.inputWasmBytes, wasmSHA256: pkg.inputWasmSHA256 };
  }
  const child = report.programs.worker.address;
  const parent = report.programs.coordinator.address;
  const direct = await query(child, '0x01');
  if (direct !== '0x0000') throw new Error('Unexpected child storage outside the delegated context');
  report.directWorkerState = direct;
  for (const count of [0, 1, 64, 256, 512]) {
    const data = child + count.toString(16).padStart(4, '0');
    const answer = await query(parent, data);
    if (answer.slice(0, 8) !== '0x4c00a7' || answer.length !== 24) {
      throw new Error('Storage or per-call linear memory differs from the expected ABI');
    }
    await send(`handoffs-${count}`, data, parent);
    report.samples.push({ count, handshake: answer.slice(0, 8), innerLoopGas: Number(BigInt('0x' + answer.slice(8))) });
  }
  const from = report.samples.at(-2);
  const to = report.samples.at(-1);
  report.measuredGasPerAdditionalTinyHandoff = (to.innerLoopGas - from.innerLoopGas) / (to.count - from.count);
  if (report.measuredGasPerAdditionalTinyHandoff <= 100) throw new Error('Cross-call metering was inconsistent');
  report.storageSharedThroughDelegatecall = true;
  report.wasmLinearMemorySharedThroughDelegatecall = false;
  report.passed = true;
} catch (error) {
  report.error = String(error.message || error);
  throw error;
} finally {
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
