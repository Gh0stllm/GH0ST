// Read-only public Robinhood inventory. No signer, secret loader or send method.
import fs from 'node:fs';
import {Interface, keccak256} from '/root/dispute/node_modules/ethers/lib.esm/index.js';

const endpoint = 'https://rpc.mainnet.chain.robinhood.com';
const token = '0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
const manager = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
const slot = '0xd1e1449381bd39ab9322335b9a3cbc64c41aa5592ccfd6b15edf295a43bc4d57';
const methods = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_gasPrice']);
let requests = 0;
async function rpc(method, params = []) {
  if (!methods.has(method)) throw Error('method not permitted');
  const response = await fetch(endpoint, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++requests, method, params}),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw Error('RPC HTTP ' + response.status);
  const json = await response.json();
  if (json.error) throw Error(JSON.stringify(json.error));
  return json.result;
}
if (BigInt(await rpc('eth_chainId')) !== 4663n) throw Error('incorrect parent chain');
const block = await rpc('eth_getBlockByNumber', ['latest', false]);
const tokenRuntime = await rpc('eth_getCode', [token, block.number]);
if (keccak256(tokenRuntime) !== '0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164') throw Error('GH0ST runtime pin mismatch');
const poolABI = new Interface(['function extsload(bytes32) view returns(bytes32)']);
const encodedSlot = await rpc('eth_call', [{to: manager, data: poolABI.encodeFunctionData('extsload', [slot])}, block.number]);
const slot0 = poolABI.decodeFunctionResult('extsload', encodedSlot)[0];
const sqrtPriceX96 = BigInt(slot0) & ((1n << 160n) - 1n);
if (sqrtPriceX96 === 0n) throw Error('uninitialized pool');
const rate = sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n / (1n << 192n);
const gasABI = new Interface(['function getL1BaseFeeEstimate() view returns(uint256)']);
const l1FeeBytes = await rpc('eth_call', [{to: '0x000000000000000000000000000000000000006c', data: gasABI.encodeFunctionData('getL1BaseFeeEstimate')}, block.number]);
const inheritedL1Fee = gasABI.decodeFunctionResult('getL1BaseFeeEstimate', l1FeeBytes)[0];
const gasPrice = BigInt(await rpc('eth_gasPrice'));
const finalBlock = await rpc('eth_getBlockByNumber', [block.number, false]);
if (finalBlock.hash !== block.hash) throw Error('block changed during observation');
const report = {
  schema: 'gh0st.gl3.same-day.parent-observation.v1', checkedUTC: new Date().toISOString(),
  scope: 'Read-only same-block token/pool/pricing observation; no quote, trade or deployment',
  parentChainId: 4663, blockNumber: Number(BigInt(block.number)), blockHash: block.hash,
  blockRechecked: true, finalityProven: false,
  GH0ST: {address: token, decimals: 18, runtimeKeccak256: keccak256(tokenRuntime)},
  marketReference: {manager, poolId: '0x42ce003822cbaa9eb94e9e07ef8d988e5a998ded86b189fd4f3e25b68f001d01',
    slot, slot0, sqrtPriceX96: String(sqrtPriceX96), gh0stTokensPerEthScaled1e18: String(rate),
    actualQuoteCurrency: 'native ETH', representsExecutableQuote: false, productionOracle: false},
  parentGas: {rpcGasPriceWei: String(gasPrice), rpcBlockBaseFeeWei: String(BigInt(block.baseFeePerGas)),
    inheritedL1BaseFeeEstimateWei: String(inheritedL1Fee),
    dataCostAtObservedSpot: String((BigInt(block.baseFeePerGas) + inheritedL1Fee) * rate / 10n ** 18n)},
  signersCreated: 0, privateKeysRead: false, transactionsSubmitted: 0, RPCRequests: requests,
};
fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
