#!/usr/bin/env node
/** Prepare an unsigned, strictly pinned deployment; never sign or broadcast. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
let ContractFactory, getAddress, keccak256, shardLeaf, verifyProof;

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'deployment');
const expected = {
  chainId: 4663,
  publicRPC: 'https://rpc.mainnet.chain.robinhood.com',
  burnToken: '0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559',
  weightIndex: '0x4a5aaa46e02b8cbd3fa2c39802a3e8339c98ada0',
  expectedTokenCodeHash: '0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164',
  expectedIndexCodeHash: '0x837bbe58f9d52bb20e8198019a10b97e706aab9cb9e400ca229b6d1cb390c307',
  shardMerkleRoot: '0x3b327e697b57bae646264f3fe99fb4921c40f44d92ef0173c272f7e3edcb61d2',
  metadataBaseURI: 'ipfs://bafybeiacuudlonut2coevovyc5t5u3hc6bjjf4ekfrzd4d5544mh4o7z2i/',
  collectionURI: 'ipfs://bafkreigrokhivgmp763x3xbwhug5jfvk7i5b2hwlavtzb6rpld3mkwzpsq'
};
const primaryPins = [expected.burnToken, expected.weightIndex,
  expected.expectedTokenCodeHash, expected.expectedIndexCodeHash, expected.shardMerkleRoot];
const escapeHTML = value => String(value).replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function blocked(status, reason) {
  const plan = {
    schemaVersion: 2, status, chainId: 4663,
    royaltyStandard: 'ERC-2981', royaltyBps: 350, royaltyRecipient: null,
    constructorArgs: null, transaction: null, reason,
    disclosure: 'Primary mint tokens are fully burned with 0% protocol cut. Secondary royalties are declared separately at 3.5%. No deployable transaction is present.'
  };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'unsigned-deployment.json'), JSON.stringify(plan, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'deploy-with-wallet.html'),
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>GH0ST Genesis — deployment blocked</title><main><h1>' + escapeHTML(status) + '</h1><p>' + escapeHTML(reason) + '</p>' +
    '<p>Primary mint: burn 200,000 GH0ST per NFT, 0% protocol cut. Secondary royalty: 3.5% declared through ERC-2981.</p>' +
    '<p>No deployment transaction is included. No wallet connection or signing action is available.</p></main></html>\n');
  return plan;
}

function explicitRecipient(value) {
  if (value === null || value === undefined) return null;
  const address = getAddress(value);
  if (BigInt(address) === 0n) throw new Error('Royalty recipient must be an explicit nonzero address.');
  return address;
}

let rpcId = 0;
async function readRPC(method, params = []) {
  if (!['eth_chainId', 'eth_blockNumber', 'eth_getCode'].includes(method))
    throw new Error('Only deployment preflight reads are permitted.');
  const id = ++rpcId;
  const response = await fetch(expected.publicRPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error('Read-only RPC HTTP ' + response.status);
  const result = await response.json();
  if (result.id !== id || result.error || typeof result.result !== 'string')
    throw new Error('Read-only RPC failed: ' + method);
  return result.result;
}

async function main() {
  // Invalidate any earlier creation transaction before reading configuration or artifacts.
  blocked('DEPLOYMENT_PREPARATION_IN_PROGRESS', 'No deployable transaction is available until every current configuration check succeeds.');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config/mainnet.json'), 'utf8'));
  const supplied = process.argv.slice(2).filter(value => value.startsWith('--royalty-recipient='));
  if (supplied.length > 1) throw new Error('Supply --royalty-recipient only once.');
  const rawRecipient = supplied.length ? supplied[0].slice('--royalty-recipient='.length) : config.royaltyRecipient;
  if (rawRecipient === null || rawRecipient === undefined) {
    const plan = blocked('NEEDS_ROYALTY_RECIPIENT', 'Supply an explicit nonzero 3.5% secondary royalty payout address through config/mainnet.json or --royalty-recipient=0x…. No address is inferred from a deployer, holder, or environment variable.');
    console.log(JSON.stringify({ status: plan.status, royaltyBps: 350, royaltyRecipient: null, publicTransactionsSent: 0 }, null, 2));
    process.exitCode = 1;
    return;
  }
  // Third-party dependency failures also occur only after earlier outputs are invalidated.
  ({ ContractFactory, getAddress, keccak256 } = await import('ethers'));
  ({ shardLeaf, verifyProof } = await import('./prepare-config.mjs'));
  const configured = explicitRecipient(config.royaltyRecipient);
  const recipient = explicitRecipient(rawRecipient);
  for (const key of Object.keys(expected)) {
    const normalize = value => /^(burnToken|weightIndex|expectedTokenCodeHash|expectedIndexCodeHash|shardMerkleRoot)$/.test(key)
      ? String(value).toLowerCase() : String(value);
    if (normalize(config[key]) !== normalize(expected[key]))
      throw new Error('Deployment config differs from the published Genesis identity: ' + key);
  }
  if (config.maxLifetimeMintsPerWallet !== 3 || config.maxSupply !== 495 ||
      config.burnAmount !== '200000000000000000000000' || config.protocolShareOfMintTokens !== '0')
    throw new Error('Unexpected primary mint economics.');
  if (config.royaltyStandard !== 'ERC-2981' || config.royaltyBps !== 350)
    throw new Error('The fixed secondary royalty must be ERC-2981 at 350 basis points.');
  const args = [...primaryPins, recipient];
  if (config.constructorArgs !== null) {
    const configuredArgs = [...primaryPins, configured];
    if (!configured || !Array.isArray(config.constructorArgs) || config.constructorArgs.length !== 6 ||
        config.constructorArgs.some((value, i) => String(value).toLowerCase() !== String(configuredArgs[i]).toLowerCase()))
      throw new Error('Configured constructor args do not exactly match the five production pins plus explicit royalty recipient.');
  } else if (!supplied.length) {
    throw new Error('Run prepare:config after configuring the explicit royalty recipient to create six constructor arguments.');
  }
  const compiled = spawnSync(process.execPath, [path.join(root, 'scripts/compile.mjs')], {
    cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 2_000_000,
  });
  if (compiled.error || compiled.status !== 0)
    throw new Error('Current contract compilation failed; earlier deployment files remain invalidated. ' +
      String(compiled.error?.message || compiled.stderr || '').slice(0, 500));
  const artifact = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/GH0STGenesis.json'), 'utf8'));
  if (!artifact.compiler.startsWith('0.8.30+')) throw new Error('Unexpected Solidity compiler.');
  if (artifact.settings?.optimizer?.enabled !== true || artifact.settings.optimizer.runs !== 200 ||
      artifact.settings.evmVersion !== 'shanghai') throw new Error('Unexpected compilation settings.');
  const constructor = artifact.abi.find(item => item.type === 'constructor');
  if (JSON.stringify(constructor?.inputs.map(input => input.type)) !==
      JSON.stringify(['address', 'address', 'bytes32', 'bytes32', 'bytes32', 'address']) ||
      !artifact.abi.some(item => item.type === 'function' && item.name === 'royaltyInfo') ||
      !artifact.abi.some(item => item.type === 'function' && item.name === 'royaltyRecipient'))
    throw new Error('Artifact does not contain the current six-argument ERC-2981 royalty contract. Compile current source first.');
  const proofs = JSON.parse(fs.readFileSync(path.join(root, 'config/shard-proofs.json'), 'utf8'));
  if (proofs.root !== expected.shardMerkleRoot || proofs.records.length !== 495 ||
      !proofs.records.every((record, i) => record.tokenId === i + 1 && record.proof.length === 9 &&
        record.leaf === shardLeaf(record) && verifyProof(record.leaf, record.proof, expected.shardMerkleRoot)))
    throw new Error('Published shard proofs do not match the pinned production root.');
  if (BigInt(await readRPC('eth_chainId')) !== 4663n) throw new Error('RPC is not Robinhood mainnet (4663).');
  const blockHex = await readRPC('eth_blockNumber');
  const block = Number(BigInt(blockHex));
  const [tokenRuntime, indexRuntime] = await Promise.all([
    readRPC('eth_getCode', [expected.burnToken, blockHex]),
    readRPC('eth_getCode', [expected.weightIndex, blockHex])
  ]);
  if (keccak256(tokenRuntime) !== expected.expectedTokenCodeHash || keccak256(indexRuntime) !== expected.expectedIndexCodeHash)
    throw new Error('Live token or weight-index code changed.');
  const factory = new ContractFactory(artifact.abi, artifact.bytecode);
  const tx = await factory.getDeployTransaction(...args);
  const plan = {
    schemaVersion: 2, status: 'UNSIGNED_NOT_DEPLOYED',
    chainId: 4663, network: 'Robinhood Chain mainnet', contractName: 'GH0STGenesis',
    maxSupply: 495, maxLifetimeMintsPerWallet: 3, burnTokensPerNFT: 200000,
    protocolShareOfMintTokens: 0, mintRecipient: 'Caller only',
    royaltyStandard: 'ERC-2981', royaltyBps: 350, royaltyRecipient: recipient,
    royaltyRecipientSource: supplied.length ? 'Explicit command-line argument' : 'Explicit configuration',
    secondaryRoyaltyEnforcement: 'Declared royalty; marketplace payment is not enforced by this NFT contract.',
    constructorArgs: args, checkedAtBlock: block,
    creationBytecodeKeccak256: keccak256(artifact.bytecode),
    deploymentCalldataKeccak256: keccak256(tx.data),
    transaction: { chainId: '0x1237', value: '0x0', data: tx.data },
    pins: { tokenAddress: getAddress(expected.burnToken), indexAddress: getAddress(expected.weightIndex),
      tokenRuntime, indexRuntime, tokenCodeHash: expected.expectedTokenCodeHash,
      indexCodeHash: expected.expectedIndexCodeHash, shardMerkleRoot: expected.shardMerkleRoot },
    metadataBaseURI: config.metadataBaseURI, collectionURI: config.collectionURI,
    disclosure: 'Contract creation requires a wallet signature and network deployment gas. Public mint opens immediately. Primary mint tokens are fully burned with 0% protocol cut; the separate 3.5% secondary royalty is declared through ERC-2981. No private key is included or requested.'
  };
  const template = fs.readFileSync(path.join(root, 'scripts/deploy-template.html'), 'utf8');
  if (!template.includes('__DEPLOYMENT_PLAN__')) throw new Error('Deployment template has no plan placeholder.');
  fs.writeFileSync(path.join(out, 'unsigned-deployment.json'), JSON.stringify(plan, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'deploy-with-wallet.html'), template.replace('__DEPLOYMENT_PLAN__', JSON.stringify(plan).replaceAll('<', '\\u003c')));
  console.log(JSON.stringify({ status: plan.status, chainId: plan.chainId, checkedAtBlock: block,
    royaltyBps: 350, royaltyRecipient: recipient, deploymentCalldataKeccak256: plan.deploymentCalldataKeccak256,
    unsignedPlan: 'deployment/unsigned-deployment.json', walletHelper: 'deployment/deploy-with-wallet.html', publicTransactionsSent: 0 }, null, 2));
}

main().catch(error => {
  blocked('INVALID_DEPLOYMENT_CONFIGURATION', String(error?.message || 'Deployment preparation failed').slice(0, 500));
  console.error('Deployment preparation stopped: ' + error.message);
  process.exitCode = 1;
});
