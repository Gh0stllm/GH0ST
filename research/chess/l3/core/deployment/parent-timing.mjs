// Anonymous block-header reads only. Nitro reports inherited L1 block numbers
// separately from its fast RPC block height. No contract or state is changed.
import { writeFileSync } from 'node:fs';
import { createReader, resolveEndpoint } from '../gas/rpc.mjs';
const { endpoint, source } = resolveEndpoint();
const read = createReader(endpoint);
try {
  if (BigInt(await read('eth_chainId')) !== 4663n) throw Error('Unexpected parent');
  const head = BigInt(await read('eth_blockNumber'));
  const samples = [];
  for (const age of [10000n, 1000n, 12n]) {
    const tag = '0x' + (head - age).toString(16);
    const block = await read('eth_getBlockByNumber', [tag, false]);
    if (!block?.l1BlockNumber) throw Error('Inherited block number unavailable');
    samples.push({ rpcBlockNumber: Number(BigInt(block.number)), rpcBlockHash: block.hash,
      headerL1BlockNumber: Number(BigInt(block.l1BlockNumber)), rpcTimestamp: Number(BigInt(block.timestamp)) });
  }
  const first = samples[0], last = samples.at(-1);
  if (last.headerL1BlockNumber <= first.headerL1BlockNumber || last.rpcTimestamp <= first.rpcTimestamp) throw Error('Invalid observed timing range');
  const report = {
    scope: 'Read-only observed Robinhood RPC height versus reported inherited L1 block numbers; not direct EVM execution, settlement/finality proof or chosen challenge parameters',
    checkedAtUTC: new Date().toISOString(), parentChainId: 4663, endpointSource: source,
    credentialURLLogged: false, samples,
    observedSecondsPerReportedL1BlockNumber: (last.rpcTimestamp - first.rpcTimestamp) / (last.headerL1BlockNumber - first.headerL1BlockNumber),
    observedSecondsPerRPCBlock: (last.rpcTimestamp - first.rpcTimestamp) / (last.rpcBlockNumber - first.rpcBlockNumber),
    signedOrBroadcast: false, stateOverridesUsed: false, contractsPersisted: false,
    productionChallengeParametersApproved: false,
  };
  writeFileSync(new URL('./evidence/parent-timing.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch {
  console.error('Read-only parent timing probe failed; no chain state changed.');
  process.exitCode = 1;
}
