import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory } from 'ethers';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(`${root}benchmarks/Int8DotBenchmark.sol`, 'utf8');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pack = weights => '0x' + Buffer.from(weights.map(w => w & 255)).toString('hex');
const oracle = (w, a) => w.reduce((acc, x, i) => acc + BigInt(x) * BigInt(a[i]), 0n);
const build = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity', sources: { 'Int8DotBenchmark.sol': { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } },
})));
const errors = (build.errors ?? []).filter(e => e.severity === 'error');
assert.equal(errors.length, 0, errors.map(e => e.formattedMessage).join('\n'));
const artifact = build.contracts['Int8DotBenchmark.sol'].Int8DotBenchmark;
const rpc = ganache.provider({ logging: { quiet: true },
  chain: { hardfork: 'shanghai' }, wallet: { deterministic: true } });
const provider = new BrowserProvider(rpc);
provider.pollingInterval = 10;
let seed = 20261023;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; }
function vector(width) {
  const w = [], a = [];
  for (let i = 0; i < width; i++) {
    w.push((random() >>> 24) - 128);
    a.push(random() | 0);
  }
  return { w, a };
}
const vectors = [
  { w: [-128], a: [-2147483648] },
  { w: [127], a: [2147483647] },
  { w: [-128, 127, 0, -1, 1], a: [-2147483648, 2147483647, 0, -1, 1] },
  ...[7, 31, 32, 33, 63, 64, 65, 127, 128, 129, 511, 512, 513, 1023, 1024].map(vector),
  ...Array.from({ length: 12 }, () => vector(1 + (random() % 1024))),
];
const receipts = [], parity = [], rejected = [];
try {
  const signer = await provider.getSigner(0);
  const contract = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy();
  await contract.waitForDeployment();
  async function shard(w) {
    const runtime = '00' + pack(w).slice(2);
    const len = (runtime.length / 2).toString(16).padStart(4, '0');
    const receipt = await (await signer.sendTransaction({ data: `0x61${len}600e60003961${len}6000f3${runtime}` })).wait();
    assert.equal(await provider.getCode(receipt.contractAddress), '0x' + runtime);
    return { address: receipt.contractAddress, deploymentGas: receipt.gasUsed.toString() };
  }
  for (const { w, a } of vectors) {
    const expected = oracle(w, a);
    const deployed = await shard(w);
    for (const [method, args] of [
      ['scalar', [pack(w), a]], ['packed', [pack(w), a]],
      ['scalarFromCode', [deployed.address, 1, a]], ['packedFromCode', [deployed.address, 1, a]],
    ]) {
      assert.equal(await contract[method](...args), expected, `${method}, width=${w.length}`);
    }
    parity.push({ width: w.length, expected: expected.toString(), methods_matched: 4 });
  }
  for (const method of ['scalar', 'packed']) {
    for (const [label, args] of [['empty', ['0x', []]], ['mismatch', ['0x01', [1, 2]]],
      ['oversize', [pack(Array(1025).fill(1)), Array(1025).fill(1)]]]) {
      await assert.rejects(contract[method](...args));
      rejected.push(`${method}:${label}`);
    }
  }
  const small = await shard([1, 2]);
  // Typed JS encoders reject these before sending; mutate raw ABI words to
  // prove both implementations enforce canonical signed INT32 encoding.
  for (const method of ['scalar', 'packed', 'scalarFromCode', 'packedFromCode']) {
    const args = method.endsWith('FromCode') ? [small.address, 1, [1]] : ['0x01', [1]];
    const request = await contract[method].populateTransaction(...args);
    const arrayHeadWord = method.endsWith('FromCode') ? 2 : 1;
    const arrayOffset = Number(BigInt('0x' + request.data.slice(10 + arrayHeadWord * 64, 10 + (arrayHeadWord + 1) * 64)));
    const activationStart = 10 + (arrayOffset + 32) * 2;
    for (const bad of [0x100000001n, 0x80000000n, (1n << 256n) - (1n << 31n) - 1n]) {
      const data = request.data.slice(0, activationStart) + bad.toString(16).padStart(64, '0') + request.data.slice(activationStart + 64);
      await assert.rejects(provider.call({ to: await contract.getAddress(), data }));
      rejected.push(`${method}:noncanonical-int32:${bad.toString(16)}`);
    }
  }
  for (const method of ['scalarFromCode', 'packedFromCode']) {
    for (const [label, args] of [
      ['absent-code', [await signer.getAddress(), 0, [1]]],
      ['end-of-code', [small.address, 3, [1]]],
      ['cross-boundary', [small.address, 2, [1, 2]]],
      ['overflow-offset', [small.address, (1n << 256n) - 1n, [1]]],
      ['empty', [small.address, 1, []]],
      ['oversize', [small.address, 1, Array(1025).fill(1)]],
    ]) {
      await assert.rejects(contract[method](...args));
      rejected.push(`${method}:${label}`);
    }
  }
  for (const width of [32, 64, 128, 512, 1024]) {
    const { w, a } = vector(width);
    const deployed = await shard(w);
    for (const [method, args] of [
      ['scalar', [pack(w), a]], ['packed', [pack(w), a]],
      ['scalarFromCode', [deployed.address, 1, a]], ['packedFromCode', [deployed.address, 1, a]],
    ]) {
      const request = await contract[method].populateTransaction(...args);
      const receipt = await (await signer.sendTransaction(request)).wait();
      assert.equal(await contract[method](...args), oracle(w, a));
      receipts.push({ method, width, transaction_gas: Number(receipt.gasUsed),
        calldata_bytes: (request.data.length - 2) / 2,
        weights_sha256: hash(Buffer.from(pack(w).slice(2), 'hex')),
        activations_sha256: hash(JSON.stringify(a)),
        standalone_weight_shard_deployment_gas: Number(deployed.deploymentGas),
        includes_intrinsic_gas_and_abi_decode: true });
    }
  }
  const comparisons = [];
  for (const width of [32, 64, 128, 512, 1024]) {
    for (const [baseline, candidate] of [['scalar', 'packed'], ['scalarFromCode', 'packedFromCode']]) {
      const base = receipts.find(x => x.width === width && x.method === baseline).transaction_gas;
      const next = receipts.find(x => x.width === width && x.method === candidate).transaction_gas;
      comparisons.push({ width, baseline, candidate, baseline_gas: base, candidate_gas: next,
        reduction_pct: Math.round((base - next) / base * 10000) / 100 });
    }
  }
  const report = {
    schema_version: 1, date_utc: new Date().toISOString(),
    scope: 'Local EVM signed INT8/INT32 row dot-product kernel only; not full TTM inference or a swap benchmark.',
    network: 'in-process Ganache; no public-chain transactions',
    limitations: [
      'TTM also requires normalization, GELU, gating, reshaping, forecast scaling and repeated matrix evaluations.',
      'No full-model gas, market performance, Robinhood-chain receipt or production readiness is implied.',
      'The isolated primitive accepts caller-selected shards; an authenticated model runtime must pin identities.',
      'Gas includes transaction calldata, intrinsic gas and ABI decoding; do not multiply by parameter count.',
    ],
    compiler: solc.version(), optimizer: { enabled: true, runs: 200 }, evm_version: 'shanghai',
    source_sha256: hash(source), runtime_sha256: hash(Buffer.from(artifact.evm.deployedBytecode.object, 'hex')),
    random_seed: 20261023, parity, invalid_cases_rejected: rejected, receipts, comparisons,
  };
  mkdirSync(`${root}reports`, { recursive: true });
  writeFileSync(`${root}reports/kernel-benchmark.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ parity_vectors: parity.length, method_comparisons: parity.length * 4,
    rejected: rejected.length, measured_transactions: receipts.length, comparisons }, null, 2));
} finally {
  await provider.destroy();
  await rpc.disconnect();
}
