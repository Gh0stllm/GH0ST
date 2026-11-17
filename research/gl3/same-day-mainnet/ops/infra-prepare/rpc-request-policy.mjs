// Verbatim method set and request predicate extracted from the existing network RPC handler.
const METHODS = new Set([
  'web3_clientVersion', 'net_version', 'eth_chainId', 'eth_blockNumber',
  'eth_getBalance', 'eth_getCode', 'eth_getStorageAt', 'eth_getTransactionCount',
  'eth_getBlockByHash', 'eth_getBlockByNumber', 'eth_getBlockTransactionCountByHash',
  'eth_getBlockTransactionCountByNumber', 'eth_getTransactionByHash',
  'eth_getTransactionByBlockHashAndIndex', 'eth_getTransactionByBlockNumberAndIndex',
  'eth_getTransactionReceipt', 'eth_call', 'eth_estimateGas', 'eth_gasPrice',
  'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getLogs', 'eth_sendRawTransaction',
  'eth_syncing'
]);

export function validRequest(item) {
  return !!item && typeof item === 'object' && !Array.isArray(item) && item.jsonrpc === '2.0'
    && (typeof item.id === 'string' || (typeof item.id === 'number' && Number.isSafeInteger(item.id)))
    && METHODS.has(item.method) && (item.params === undefined || Array.isArray(item.params));
}

