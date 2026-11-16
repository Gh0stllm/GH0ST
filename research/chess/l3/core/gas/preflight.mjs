// Safe to run against Robinhood: allowlisted reads and eth_call simulations only.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Interface, keccak256, toBeHex, id, ZeroAddress } from 'ethers';
import { createReader, resolveEndpoint } from './rpc.mjs';
import { evaluateGasReadiness } from './parameters.mjs';

const erc20 = new Interface([
  'function name() view returns (string)', 'function symbol() view returns (string)',
  'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'function approve(address,uint256) returns (bool)',
  'function transferFrom(address,address,uint256) returns (bool)',
]);
const pricerABI = new Interface(['function getExchangeRate() returns (uint256)', 'function owner() view returns (address)']);
const arbSysABI = new Interface(['function arbChainID() view returns (uint256)',
  'function arbBlockNumber() view returns (uint256)', 'function arbOSVersion() view returns (uint256)']);
const slots = Object.fromEntries(['implementation', 'admin', 'beacon'].map(name =>
  [`eip1967.${name}`, toBeHex(BigInt(id(`eip1967.proxy.${name}`)) - 1n, 32)]));
slots.eip1822Proxiable = id('PROXIABLE');

// Inspect opcode boundaries rather than matching bytes that may be PUSH data.
// This is a proxy heuristic, not proof that every possible proxy design is absent.
export function runtimeOpcodeCounts(code) {
  let bytes = Buffer.from(code.slice(2), 'hex');
  if (bytes.length >= 3) {
    const length = bytes.readUInt16BE(bytes.length - 2);
    const start = bytes.length - 2 - length;
    if (start >= 0 && [0xa1, 0xa2].includes(bytes[start])) bytes = bytes.subarray(0, start);
  }
  const counts = { delegatecall: 0, callcode: 0 };
  for (let pc = 0; pc < bytes.length; pc++) {
    const op = bytes[pc];
    if (op === 0xf4) counts.delegatecall++;
    if (op === 0xf2) counts.callcode++;
    if (op >= 0x60 && op <= 0x7f) pc += op - 0x5f;
  }
  return counts;
}

export async function inspectGasToken(read, policy, endpointSource = 'injected read-only transport') {
  if (BigInt(await read('eth_chainId')) !== 4663n) throw Error('Wrong parent chain');
  const head = BigInt(await read('eth_blockNumber'));
  if (head < 12n) throw Error('Parent chain too short');
  const tag = '0x' + (head - 12n).toString(16);
  const token = policy.nativeToken;
  const probeAccount = process.env.GH0ST_L3_TOKEN_PROBE_ACCOUNT || '0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6';
  const receiver = '0x000000000000000000000000000000000000dEaD';
  async function call(abi, address, name, args = [], from) {
    const result = await read('eth_call', [{ to: address, data: abi.encodeFunctionData(name, args), ...(from ? { from } : {}) }, tag]);
    return abi.decodeFunctionResult(name, result)[0];
  }
  const tasks = [
    read('eth_getBlockByNumber', [tag, false]), read('eth_getCode', [token, tag]), read('eth_gasPrice'),
    ...['name', 'symbol', 'decimals', 'totalSupply'].map(name => call(erc20, token, name)),
    call(erc20, token, 'balanceOf', [probeAccount]),
    ...Object.values(slots).map(slot => read('eth_getStorageAt', [token, slot, tag])),
    call(erc20, token, 'transfer', [probeAccount, 0n], probeAccount),
    call(erc20, token, 'approve', [receiver, 0n], probeAccount),
    call(erc20, token, 'transferFrom', [probeAccount, probeAccount, 0n], probeAccount),
  ];
  const settled = await Promise.allSettled(tasks);
  if (settled.some(x => x.status === 'rejected')) throw Error('Basic token RPC check failed');
  const values = settled.map(x => x.value);
  const [block, code, gasPrice, name, symbol, decimals, supply, probeBalance] = values;
  const slotValues = Object.fromEntries(Object.keys(slots).map((key, n) => [key, values[8 + n]]));
  const [selfTransferZero, approveZero, transferFromZero] = values.slice(8 + Object.keys(slots).length);
  const parentNitroChecks = await Promise.allSettled(['arbChainID', 'arbBlockNumber', 'arbOSVersion']
    .map(name => call(arbSysABI, '0x0000000000000000000000000000000000000064', name)));
  const parentNitro = { allArbSysReadsSucceeded: parentNitroChecks.every(x => x.status === 'fulfilled') };
  if (parentNitro.allArbSysReadsSucceeded) {
    const [arbChainID, arbBlockNumber, versionRaw] = parentNitroChecks.map(x => x.value);
    Object.assign(parentNitro, { arbChainID: String(arbChainID), arbBlockNumber: String(arbBlockNumber),
      arbOSVersionRaw: String(versionRaw), arbOSVersionDecoded: versionRaw >= 55n ? String(versionRaw - 55n) : null,
      versionEncoding: 'ArbSys reports ArbOS version + 55; raw value is not an ArbOS version',
      matchesRobinhoodChainId: arbChainID === 4663n,
      rpcHeightIsNotAssumedToBeEVMBlockNumber: true });
  }
  let selfTransferPositive = null;
  if (probeBalance > 0n) selfTransferPositive = await call(erc20, token, 'transfer', [probeAccount, 1n], probeAccount);
  const proxySlotsClear = Object.values(slotValues).every(value => BigInt(value) === 0n);
  const opcodes = runtimeOpcodeCounts(code);
  const runtimeHash = keccak256(code);
  const tokenIdentityMatches = runtimeHash === policy.expectedTokenRuntimeKeccak256 && Number(decimals) === policy.nativeTokenDecimals;
  const report = {
    scope: 'Read-only parent ERC20 identity, partial custom-gas compatibility and optional pricer checks; not a full token audit or deployment',
    checkedAtUTC: new Date().toISOString(), chainId: 4663,
    blockNumber: Number(BigInt(block.number)), blockHash: block.hash,
    blockIsHeadMinus12: true, finalityProven: false, endpointSource, credentialURLLogged: false,
    parentNitro,
    token, name, symbol, decimals: Number(decimals), totalSupplyUnits: String(supply), runtimeKeccak256: runtimeHash,
    tokenIdentityMatches, proxySlots: slotValues, proxySlotsClear, opcodeHeuristic: opcodes,
    simulations: { statePersisted: false, probeAccount, probeBalanceUnits: String(probeBalance),
      selfTransferZero, approveZero, transferFromZero, selfTransferOneBaseUnit: selfTransferPositive,
      positiveSelfTransferSkippedReason: selfTransferPositive === null ? 'Probe has no GH0ST balance' : null },
    basicTokenChecksPassed: tokenIdentityMatches && proxySlotsClear && opcodes.delegatecall === 0 && opcodes.callcode === 0 &&
      selfTransferZero === true && approveZero === true && transferFromZero === true && selfTransferPositive !== false,
    unprovenRequirements: ['No transfer fee or rebase under all states', 'No callbacks or hooks under all states',
      'No nonstandard proxy/upgrade path', 'All nonzero transfer and approval cases', 'Canonical bridge round trip'],
    fullTokenAuditComplete: false, currentParentGasPriceWei: String(BigInt(gasPrice)),
    pricer: null, batchPosters: [], privateKeysAccessed: false, transactionRequestsCreated: 0, transactionsSubmitted: 0,
  };
  if (policy.feeTokenPricer && policy.feeTokenPricer !== ZeroAddress) {
    const pricer = policy.feeTokenPricer;
    const [pricerCode, rate] = await Promise.all([
      read('eth_getCode', [pricer, tag]), call(pricerABI, pricer, 'getExchangeRate'),
    ]);
    if (pricerCode === '0x' || rate <= 0n) throw Error('Pricer has no runtime or positive rate');
    const pricerHash = keccak256(pricerCode);
    report.pricer = { address: pricer, runtimeKeccak256: pricerHash,
      runtimeMatches: pricerHash === policy.expectedFeeTokenPricerRuntimeKeccak256,
      gh0stPerEthX18: String(rate), rateMatchesEvidence: String(rate) === policy.rateEvidence?.gh0stPerEthX18,
      oracleFreshnessProvenByEthCall: false };
    if (policy.expectedFeeTokenPricerOwner) {
      const owner = await call(pricerABI, pricer, 'owner');
      report.pricer.owner = owner;
      report.pricer.ownerMatches = owner.toLowerCase() === policy.expectedFeeTokenPricerOwner.toLowerCase();
    }
  }
  report.batchPosters = await Promise.all((policy.batchPosterAccounts ?? []).map(async address => ({
    address, ethBalanceWei: String(BigInt(await read('eth_getBalance', [address, tag]))),
  })));
  // Reject if the sampled block changed while the checks were running.
  const recheck = await read('eth_getBlockByNumber', [tag, false]);
  if (recheck.hash !== block.hash) throw Error('Parent snapshot changed');
  Object.assign(report, evaluateGasReadiness(policy, report));
  return report;
}

async function main() {
  const policyArg = process.argv.indexOf('--policy');
  const policyURL = policyArg >= 0 ? pathToFileURL(process.argv[policyArg + 1]) : new URL('./policy.json', import.meta.url);
  const policy = JSON.parse(readFileSync(policyURL, 'utf8'));
  const { endpoint, source } = resolveEndpoint();
  const report = await inspectGasToken(createReader(endpoint), policy, source);
  if (process.argv.includes('--write')) writeFileSync(new URL('./evidence/token-preflight.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!report.basicTokenChecksPassed || (process.argv.includes('--require-gas-ready') && !report.gasPrerequisitesReady)) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Read-only GH0ST gas preflight failed; no transaction was sent and no state changed.');
    process.exitCode = 1;
  });
}
