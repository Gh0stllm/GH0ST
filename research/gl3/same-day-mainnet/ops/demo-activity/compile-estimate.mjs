import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const req = createRequire('/workspace/gl3/durable/neutral/dispute/package.json');
const solc = req('solc');
const { Interface, JsonRpcProvider, AbiCoder, keccak256, toBeHex, toQuantity, zeroPadValue, getCreateAddress, formatUnits, ZeroAddress } = req('ethers');
const dir = path.dirname(new URL(import.meta.url).pathname);
const sha = b => createHash('sha256').update(b).digest('hex');
const source = fs.readFileSync(path.join(dir, 'AutomatedDemo.sol'), 'utf8');
const input = { language: 'Solidity', sources: { 'AutomatedDemo.sol': { content: source } }, settings: {
  optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai',
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences', 'storageLayout'] } }
} };
const output = JSON.parse(solc.compile(JSON.stringify(input)));
if (output.errors?.some(e => e.severity === 'error')) throw new Error(output.errors.map(e => e.formattedMessage).join('\n'));
const artifacts = Object.fromEntries(Object.entries(output.contracts['AutomatedDemo.sol']).filter(([n]) => n.startsWith('GL3')).map(([name, c]) => [name, {
  name, abi: c.abi, bytecode: '0x' + c.evm.bytecode.object, runtime: '0x' + c.evm.deployedBytecode.object,
  immutableReferences: c.evm.deployedBytecode.immutableReferences, storageLayout: c.storageLayout,
  sourceSHA256: sha(source), compiler: solc.version(), settings: input.settings
}]));
fs.writeFileSync(path.join(dir, 'artifacts.json'), JSON.stringify(artifacts, null, 2) + '\n');
if (process.argv.includes('--compile-only')) process.exit(0);
const provider = new JsonRpcProvider('http://127.0.0.1:8547', undefined, { cacheTimeout: -1, batchMaxCount: 1 });
const from = '0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6'; // PUBLIC funded account, read-only simulations only.
const rpc = (m, a) => provider.send(m, a);
const net = await rpc('eth_chainId', []);
if (BigInt(net) !== 4663001n) throw new Error('wrong chain');
const genesis = await rpc('eth_getBlockByNumber', ['0x0', false]);
if (genesis.hash !== '0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483') throw new Error('wrong genesis');
const gasPrice = BigInt(await rpc('eth_gasPrice', []));
const results = [];
const nodeInterface = new Interface(['function gasEstimateComponents(address to,bool contractCreation,bytes data) returns (uint64 gasEstimate,uint64 gasEstimateForL1,uint256 baseFee,uint256 l1BaseFeeEstimate)']);
async function estimate(label, tx, overrides) {
  const args = [{ from, value: '0x0', gasPrice: toQuantity(gasPrice), ...tx }, 'latest'];
  if (overrides) args.push(overrides);
  try {
    const estimatedGas = BigInt(await rpc('eth_estimateGas', args));
    const row = { label, estimateGas: estimatedGas.toString(), gasPrice: gasPrice.toString(), feeAtEstimateGH0ST: formatUnits(estimatedGas * gasPrice,18), stateOverride: !!overrides };
    const callArgs = [{ from, to: '0x00000000000000000000000000000000000000C8', data: nodeInterface.encodeFunctionData('gasEstimateComponents', [tx.to ?? ZeroAddress, !tx.to, tx.data ?? '0x']) }, 'latest'];
    if (overrides) callArgs.push(overrides);
    try { if (overrides) throw new Error('NodeInterface component estimator is not accepted for override-mode inner calls; total eth_estimateGas remains the simulation result');
      const v = nodeInterface.decodeFunctionResult('gasEstimateComponents', await rpc('eth_call', callArgs));
      row.components = { totalGas: String(v[0]), postingGas: String(v[1]), computeGas: String(v[0]-v[1]), baseFee: String(v[2]), l1BaseFeeEstimate: String(v[3]) };
    } catch(e) { row.componentsError = e.info?.error?.message ?? e.shortMessage ?? e.message; }
    results.push(row);
  } catch (e) { results.push({ label, error: e.info?.error?.message ?? e.shortMessage ?? e.message, stateOverride: !!overrides }); }
}
await estimate('zero-value-self-transfer', { to: from });
const slot = n => zeroPadValue(toBeHex(n), 32);
const coder = AbiCoder.defaultAbiCoder();
const allocs = {};
let nonce = 123456789;
for (const [name, a] of Object.entries(artifacts)) {
  const address = getCreateAddress({ from, nonce: nonce++ });
  if (await rpc('eth_getCode', [address, 'latest']) !== '0x') throw new Error('simulation address occupied');
  const constructorData = a.bytecode + coder.encode(['address'], [from]).slice(2);
  await estimate(name + ':deployment', { data: constructorData });
  let runtime = Buffer.from(a.runtime.slice(2), 'hex');
  for (const refs of Object.values(a.immutableReferences)) for (const ref of refs)
    Buffer.from(from.slice(2).padStart(64, '0'), 'hex').copy(runtime, ref.start, 0, ref.length);
  const storage = {};
  if (name.endsWith('Token')) storage[keccak256(coder.encode(['address', 'uint256'], [from, 0]))] = slot(10n ** 24n);
  const iface = new Interface(a.abi);
  const method = name.endsWith('Pulse') ? 'pulse' : name.endsWith('Token') ? 'transfer' : 'mintDemo';
  const args = method === 'transfer' ? ['0x000000000000000000000000000000000000dEaD', 10n ** 18n] : [];
  const data = iface.encodeFunctionData(method, args);
  const override = { [address]: { code: '0x' + runtime.toString('hex'), stateDiff: storage } };
  await estimate(name + ':first', { to: address, data }, override);
  if (name.endsWith('Pulse')) storage[slot(0)] = slot(1);
  if (name.endsWith('Token')) storage[keccak256(coder.encode(['address', 'uint256'], ['0x000000000000000000000000000000000000dEaD', 0]))] = slot(10n ** 18n);
  if (name.endsWith('NFT')) {
    storage[slot(0)] = slot(1);
    storage[keccak256(coder.encode(['address', 'uint256'], [from, 2]))] = slot(1);
  }
  await estimate(name + ':steady', { to: address, data }, override);
  allocs[name] = { address, code: override[address].code, stateDiff: storage };
}
const gasInfo = new Interface(['function getL1GasPriceEstimate() view returns (uint256)', 'function getPricesInWei() view returns (uint256,uint256,uint256,uint256,uint256,uint256)']);
const gasInfoReadback = {};
for (const method of ['getL1GasPriceEstimate', 'getPricesInWei']) {
  try { gasInfoReadback[method] = Array.from(gasInfo.decodeFunctionResult(method, await rpc('eth_call', [{ to: '0x000000000000000000000000000000000000006c', data: gasInfo.encodeFunctionData(method) }, 'latest']))).map(String); }
  catch (e) { gasInfoReadback[method] = { error: e.info?.error?.message ?? e.shortMessage ?? e.message }; }
}
const result = { schema: 'gh0st.gl3.automated-demo.estimate.v1', observedUTC: new Date().toISOString(), chainId: 4663001, genesis: genesis.hash,
  block: await rpc('eth_blockNumber', []), sourceSHA256: sha(source), artifactsSHA256: sha(fs.readFileSync(path.join(dir, 'artifacts.json'))),
  compiler: solc.version(), compilerSoljsonSHA256: sha(fs.readFileSync(req.resolve('solc/soljson.js'))), fromPublicAccountOnly: from, gasPrice: gasPrice.toString(), transactionsSigned: 0, transactionsSent: 0,
  scope: 'Live read-only RPC estimates. Runtime/state overrides model first and steady demo calls, not mined deployment or throughput. No wallet/key read.', results, gasInfoReadback };
fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true });
fs.writeFileSync(path.join(dir, 'evidence/estimates.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ estimates: results, gasInfoReadback }));
provider.destroy();
