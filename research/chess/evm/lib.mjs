import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));
export const solc = require('solc');
export const ethers = require('ethers');
export const versions = { solc: require('solc/package.json').version,
  ethers: JSON.parse(readFileSync(join(dirname(require.resolve('ethers')), '../package.json'))).version,
  ganache: require('ganache/package.json').version };
assert.deepEqual(versions, { solc: '0.8.30', ethers: '6.13.5', ganache: '7.9.2' });
export const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
export function save(path, value) {
  mkdirSync(dirname(join(ROOT, path)), { recursive: true });
  writeFileSync(join(ROOT, path), json(value));
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const receiptTypes = { GameResult: [
  { name: 'gameId', type: 'bytes32' }, { name: 'player', type: 'address' },
  { name: 'principalHash', type: 'bytes32' }, { name: 'nonce', type: 'uint256' },
  { name: 'finalPositionHash', type: 'bytes32' }, { name: 'transcriptHash', type: 'bytes32' },
  { name: 'result', type: 'uint8' }, { name: 'engineConfigHash', type: 'bytes32' },
  { name: 'completedAt', type: 'uint64' }, { name: 'issuedAt', type: 'uint64' },
  { name: 'validUntil', type: 'uint64' },
] };
export const domain = (chainId, verifyingContract) => ({
  name: 'GH0ST RH Chess Challenge', version: '1', chainId, verifyingContract,
});
export const resultCodes = Object.freeze({ NONE: 0, HUMAN_CHECKMATE: 1, BOT_CHECKMATE: 2,
  DRAW: 3, HUMAN_RESIGNED: 4, PLAYER_TIMEOUT: 5, SERVICE_FAULT: 6,
  ENGINE_ABORT: 7, RECONCILIATION_EXPIRED_REFUND_INTERNAL_ONLY: 8 });

export function compile(includeTests = false) {
  const source = 'contracts/RHChessChallengeVault.sol';
  const main = readFileSync(join(ROOT, source), 'utf8');
  const sources = { [source]: { content: main } };
  if (includeTests) sources['evm-tests/fixtures.sol'] = { content: readFileSync(join(ROOT, 'evm-tests/fixtures.sol'), 'utf8') };
  const settings = {
    optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai',
    metadata: { bytecodeHash: 'none' },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings })));
  const errors = (output.errors ?? []).filter(error => error.severity === 'error');
  assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join('\n'));
  const artifacts = {};
  for (const [file, contracts] of Object.entries(output.contracts)) {
    for (const [name, contract] of Object.entries(contracts)) artifacts[name] = {
      source: file, name, abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object,
      deployedBytecode: '0x' + contract.evm.deployedBytecode.object,
      immutableReferences: contract.evm.deployedBytecode.immutableReferences,
      creationBytes: contract.evm.bytecode.object.length / 2,
      runtimeBytes: contract.evm.deployedBytecode.object.length / 2,
    };
  }
  save('evm/artifacts.json', { format: 'GH0ST_RH_CHESS_VAULT_V1', compiler: solc.version(),
    versions, settings, sourceSha256: sha256(main), localOnly: true,
    contracts: Object.fromEntries(Object.entries(artifacts).filter(([, item]) => item.source === source)) });
  save('evm/RHChessChallengeVault.abi.json', artifacts.RHChessChallengeVault.abi);
  save('evm/receipt-schema.json', { domain: { name: 'GH0ST RH Chess Challenge', version: '1',
    chainId: 'deployment chain ID', verifyingContract: 'deployment vault address' },
    types: receiptTypes, resultCodes, principalHash: 'SHA256(raw ICP Principal bytes)',
    nonce: 'Exactly the uint256 entry nonce, unique per player within this vault',
    amounts: { decimals: 18, entryFee: '25000000000000000000000',
      totalCheckmatePayout: '100000000000000000000000', winnerNetBeforeGas: '75000000000000000000000' },
    expiry: { gameSeconds: 86400, reconciliationSeconds: 604800,
      rule: 'completedAt in [openedAt,gameDeadline]; completedAt<=issuedAt<=now<=validUntil<=reconciliationDeadline; permissionless 25k refund strictly after reconciliationDeadline' },
    trust: 'Pinned ECDSA attestor trusted for ICP principal authentication, RH entry verification and chess result. EVM does not prove ICP execution or Stockfish correctness.',
  });
  return artifacts;
}

export async function localChain(chainId = 31337) {
  const eip1193 = require('ganache').provider({
    logging: { quiet: true },
    wallet: { mnemonic: 'test test test test test test test test test test test junk', totalAccounts: 8, defaultBalance: 1000 },
    chain: { chainId, hardfork: 'shanghai', time: new Date('2026-01-01T00:00:00Z') },
    miner: { blockGasLimit: 30_000_000, timestampIncrement: 1 },
  });
  const provider = new ethers.BrowserProvider(eip1193, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  const signers = await Promise.all(Array.from({ length: 8 }, (_, index) => provider.getSigner(index)));
  const addresses = await Promise.all(signers.map(signer => signer.getAddress()));
  return { eip1193, provider, signers, addresses, close: () => eip1193.disconnect() };
}
