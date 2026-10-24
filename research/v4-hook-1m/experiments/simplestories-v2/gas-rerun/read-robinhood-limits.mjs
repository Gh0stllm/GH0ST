// Read-only public configuration snapshot. No signer, wallet or broadcast method.
import { Interface, keccak256 } from 'ethers';
import { writeFileSync } from 'node:fs';
const endpoint = 'https://rpc.mainnet.chain.robinhood.com';
const allowed = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call']);
async function rpc(method, params = []) {
  if (!allowed.has(method)) throw new Error('Read-only RPC methods only');
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}
const chainId = Number(BigInt(await rpc('eth_chainId')));
if (chainId !== 4663) throw new Error('Unexpected chain');
const blockNumber = await rpc('eth_blockNumber');
const block = await rpc('eth_getBlockByNumber', [blockNumber, false]);
const gasInfo = '0x000000000000000000000000000000000000006c';
const abi = new Interface([
  'function getMaxTxGasLimit() view returns (uint256)',
  'function getMaxBlockGasLimit() view returns (uint64)',
  'function getGasAccountingParams() view returns (uint256,uint256,uint256)',
]);
const settings = {};
for (const name of ['getMaxTxGasLimit', 'getMaxBlockGasLimit', 'getGasAccountingParams']) {
  try {
    const raw = await rpc('eth_call', [{ to: gasInfo, data: abi.encodeFunctionData(name) }, blockNumber]);
    settings[name] = { raw, decoded: Array.from(abi.decodeFunctionResult(name, raw), String) };
  } catch (error) { settings[name] = { error: String(error.message) }; }
}
const poolManager = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
const code = await rpc('eth_getCode', [poolManager, blockNumber]);
const result = {
  checkedAt: new Date().toISOString(), mode: 'READ_ONLY_PUBLIC_NETWORK_CONFIGURATION',
  endpoint, chainId, blockNumber: Number(BigInt(blockNumber)), blockHash: block.hash,
  blockTimestamp: Number(BigInt(block.timestamp)),
  reportedBlockHeaderGasLimit: BigInt(block.gasLimit).toString(),
  warning: 'Arbitrum block header gasLimit is not a substitute for execution limits from ArbGasInfo.',
  settings,
  poolManager: { address: poolManager, runtimeBytes: (code.length - 2) / 2, runtimeCodeHash: keccak256(code) },
  sources: [
    'https://docs.robinhood.com/chain/connecting/',
    'https://docs.robinhood.com/chain/protocol-contracts/',
    'https://raw.githubusercontent.com/OffchainLabs/nitro-precompile-interfaces/main/ArbGasInfo.sol',
    'https://developers.uniswap.org/docs/protocols/v4/deployments',
  ],
  transactionsSubmitted: 0,
};
writeFileSync(new URL('robinhood-limits.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
