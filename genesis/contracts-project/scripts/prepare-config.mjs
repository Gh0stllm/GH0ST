#!/usr/bin/env node
/**
 * Rebuild immutable Genesis bindings and read-only Robinhood mainnet preflight.
 * This script never signs, sends, or funds transactions.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AbiCoder, Interface, concat, getAddress, keccak256 } from "ethers";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OFFICIAL_RPC = "https://rpc.mainnet.chain.robinhood.com";
const TOKEN = "0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559";
const TOKEN_HASH = "0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164";
const HOLDER = "0x8d6b11cfdf079e27c17e05cb7ea81235887691c6";
const INDEX = "0x4a5aaa46e02b8cbd3fa2c39802a3e8339c98ada0";
const INDEX_HASH = "0x837bbe58f9d52bb20e8198019a10b97e706aab9cb9e400ca229b6d1cb390c307";
const MODEL_SHA = "9cc5e90880d96ff15bf4110f7970a7ea473c9b86576298691ade1e745672e7a9";
const MODEL_BYTES = 48_626_528;
const PAYLOAD_BYTES = 98_303;
const COUNT = 495;
const MERKLE_ROOT = "0x3b327e697b57bae646264f3fe99fb4921c40f44d92ef0173c272f7e3edcb61d2";
const ROYALTY_PREFLIGHT = "../deployment/royalty-mainnet-preflight.json";
const BURN_AMOUNT = 200_000n * 10n ** 18n;
const coder = AbiCoder.defaultAbiCoder();
const READ_ONLY_METHODS = new Set([
  "eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getCode", "eth_call",
]);

export const LEAF_TYPES = ["uint256", "address", "bytes32", "uint256", "uint256"];
export function shardLeaf(record) {
  const values = [
    record.tokenId ?? record.token_id,
    record.shardAddress ?? record.shard_address,
    record.runtimeCodeHash ?? record.runtime_code_hash,
    record.offset ?? record.payload_offset_bytes,
    record.length ?? record.payload_length_bytes,
  ];
  return keccak256(keccak256(coder.encode(LEAF_TYPES, values)));
}
export function hashPair(a, b) {
  return keccak256(concat(a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]));
}
export function merkleTree(leaves) {
  if (!leaves.length) throw new Error("A Merkle tree requires leaves");
  const layers = [leaves.slice()];
  while (layers.at(-1).length > 1) {
    const layer = layers.at(-1);
    const parent = [];
    for (let i = 0; i < layer.length; i += 2)
      parent.push(hashPair(layer[i], layer[i + 1] ?? layer[i]));
    layers.push(parent);
  }
  const proofs = leaves.map((_, position) => {
    const proof = [];
    for (let level = 0; level < layers.length - 1; level++) {
      const layer = layers[level];
      proof.push(layer[position ^ 1] ?? layer[position]);
      position = Math.floor(position / 2);
    }
    return proof;
  });
  return { root: layers.at(-1)[0], proofs, height: layers.length - 1 };
}
export function verifyProof(leaf, proof, root) {
  return proof.reduce(hashPair, leaf).toLowerCase() === root.toLowerCase();
}

async function writeJSON(name, data) {
  const file = path.join(ROOT, "config", name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n");
}
function explicitRecipient(value) {
  if (value === null || value === undefined) return null;
  const address = getAddress(value);
  if (BigInt(address) === 0n) throw new Error("Royalty recipient must be an explicit nonzero address");
  return address;
}
async function configuredRecipient(argv) {
  const supplied = argv.filter(value => value.startsWith("--royalty-recipient="));
  if (supplied.length > 1) throw new Error("Supply --royalty-recipient only once");
  if (supplied.length) return { address: explicitRecipient(supplied[0].slice("--royalty-recipient=".length)), source: "Explicit command-line argument" };
  try {
    const current = JSON.parse(await fs.readFile(path.join(ROOT, "config/mainnet.json"), "utf8"));
    return { address: explicitRecipient(current.royaltyRecipient), source: "Existing explicit configuration" };
  } catch (error) {
    if (error.code === "ENOENT") return { address: null, source: "Not supplied" };
    throw error;
  }
}
async function rpcBatch(calls, endpoint) {
  if (!calls.every(call => READ_ONLY_METHODS.has(call.method)))
    throw new Error("Refusing a non-read-only public RPC method");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "GH0ST-Genesis-ReadOnly-Preflight/1.0" },
    body: JSON.stringify(calls.map((call, id) => ({
      jsonrpc: "2.0", id, method: call.method, params: call.params,
    }))),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Read-only RPC HTTP " + response.status);
  const values = await response.json();
  if (!Array.isArray(values)) throw new Error("RPC rejected the read-only batch");
  const byID = new Map(values.map(value => [value.id, value]));
  return Object.fromEntries(calls.map((call, id) => {
    const value = byID.get(id);
    if (!value) throw new Error("RPC omitted a response: " + call.label);
    return [call.label, value.error ? { error: value.error } : { result: value.result }];
  }));
}
function requireResult(batch, label) {
  if (batch[label]?.error || batch[label]?.result === undefined)
    throw new Error("Read-only preflight failed: " + label);
  return batch[label].result;
}
function indexAddresses(runtime, source) {
  const code = Buffer.from(runtime.slice(2), "hex");
  if (code.length !== 49 + 20 * COUNT || code[0] !== 0 ||
      code.subarray(1, 5).toString("ascii") !== "G4IX" ||
      code.readUInt32BE(5) !== PAYLOAD_BYTES ||
      code.readBigUInt64BE(9) !== BigInt(MODEL_BYTES) ||
      code.subarray(17, 49).toString("hex") !== MODEL_SHA)
    throw new Error("Mainnet weight index header or layout differs from the pinned export");
  const addresses = source.records.map((record, i) => {
    const address = "0x" + code.subarray(49 + i * 20, 69 + i * 20).toString("hex");
    if (address !== record.shard_address.toLowerCase())
      throw new Error("Live weight index differs at token ID " + record.token_id);
    return getAddress(address);
  });
  if (new Set(addresses).size !== COUNT) throw new Error("Duplicate index shard addresses");
  return addresses;
}

export async function main(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const offline = args.has("--offline");
  const royalty = await configuredRecipient(argv);
  const sourceArg = argv.find(value => value.startsWith("--source="));
  const sourcePath = sourceArg ? path.resolve(sourceArg.slice("--source=".length)) :
    path.join(ROOT, "config", "source-shards.json");
  const sourceBytes = await fs.readFile(sourcePath);
  const source = JSON.parse(sourceBytes);
  if (source.supply !== COUNT || source.chain_id !== 4663 ||
      source.weight_export_sha256 !== MODEL_SHA ||
      source.weight_index_address.toLowerCase() !== INDEX ||
      source.weight_index_runtime_keccak256.toLowerCase() !== INDEX_HASH ||
      source.weight_export_length_bytes !== MODEL_BYTES ||
      source.full_shard_payload_length_bytes !== PAYLOAD_BYTES)
    throw new Error("Unexpected source model, chain, supply or weight-index pin");
  const ordered = source.records.slice().sort((a, b) => a.token_id - b.token_id);
  if (ordered.length !== COUNT) throw new Error("Source must contain exactly 495 records");
  let nextOffset = 0;
  for (let i = 0; i < ordered.length; i++) {
    const r = ordered[i];
    if (r.token_id !== i + 1 || r.shard_index !== i || r.payload_offset_bytes !== nextOffset ||
        r.runtime_length_bytes !== r.payload_length_bytes + 1 ||
        r.payload_length_bytes !== Math.min(PAYLOAD_BYTES, MODEL_BYTES - nextOffset))
      throw new Error("Invalid shard identity, offset or byte length at token ID " + (i + 1));
    nextOffset += r.payload_length_bytes;
  }
  if (nextOffset !== MODEL_BYTES) throw new Error("Shard records do not cover the complete export");
  const leaves = ordered.map(shardLeaf);
  const tree = merkleTree(leaves);
  if (tree.height !== 9) throw new Error("Expected nine-level proofs");
  if (tree.root !== MERKLE_ROOT) throw new Error("Shard Merkle root differs from the frozen production identity");
  const proofs = {
    schemaVersion: 1,
    root: tree.root,
    leafTypes: LEAF_TYPES,
    leafEncoding: "keccak256(bytes.concat(keccak256(abi.encode(tokenId, shardAddress, runtimeCodeHash, offset, length))))",
    pairHashing: "Sort the two bytes32 values ascending, then keccak256 their 64-byte concatenation.",
    oddNodes: "Duplicate the final node when a level has an odd number of nodes.",
    height: tree.height,
    records: ordered.map((record, i) => ({
      tokenId: record.token_id,
      shardIndex: record.shard_index,
      shardAddress: getAddress(record.shard_address),
      runtimeCodeHash: record.runtime_code_hash.toLowerCase(),
      offset: record.payload_offset_bytes,
      length: record.payload_length_bytes,
      leaf: leaves[i],
      proof: tree.proofs[i],
    })),
  };
  if (!proofs.records.every(record => verifyProof(record.leaf, record.proof, tree.root)))
    throw new Error("Proof round-trip failed");
  const proofFile = path.join(ROOT, "config/shard-proofs.json");
  const proofText = JSON.stringify(proofs, null, 2) + "\n";
  const existingProofText = await fs.readFile(proofFile, "utf8").catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existingProofText !== proofText) await writeJSON("shard-proofs.json", proofs);
  const snapshot = {
    schemaVersion: 1,
    checkedAtUTC: new Date().toISOString(),
    rpcPublicEndpoint: OFFICIAL_RPC,
    rpcOfficialDocumentation: "https://docs.robinhood.com/chain/connecting/",
    readOnly: true,
    publicTransactionsSent: 0,
    merkleRoot: tree.root,
    all495MerkleProofsVerified: true,
    royaltyStandard: "ERC-2981",
    royaltyBps: 350,
    royaltyRecipient: royalty.address,
    royaltyRecipientSource: royalty.address ? royalty.source : "Not supplied; deployment blocked",
    deploymentReadiness: royalty.address ? "NOT_DEPLOYED" : "NEEDS_ROYALTY_RECIPIENT",
    scope: "Read-only chain preflight; not a validation of deployed NFT code or royalty payment enforcement.",
    sourceRepository: source.repository,
    sourceCommit: source.repository_commit,
    sourceManifest: source.repository_manifest_path,
    sourceManifestUTC: source.repository_manifest_as_of_utc,
    limitations: [
      "A zero-amount call is a capability check, not a complete burn-accounting audit.",
      "All 495 shard addresses are checked against the live pinned index; only first and last shard bytecodes are downloaded live.",
      "Remaining shard hashes come from the pinned deployment journal and are checked against actual shard code on each future NFT mint.",
      "No wallet credentials are needed or used by this preflight.",
    ],
  };
  if (offline) {
    snapshot.status = "OFFLINE_PROOFS_ONLY";
    await writeJSON(ROYALTY_PREFLIGHT, snapshot);
    console.log(JSON.stringify({ status: snapshot.status, merkleRoot: tree.root, proofs: proofs.records.length }, null, 2));
    return;
  }
  const endpoint = process.env.ROBINHOOD_RPC_URL || OFFICIAL_RPC;
  try {
    const head = await rpcBatch([
      { label: "chain", method: "eth_chainId", params: [] },
      { label: "blockNumber", method: "eth_blockNumber", params: [] },
    ], endpoint);
    const chainId = Number(BigInt(requireResult(head, "chain")));
    if (chainId !== 4663) throw new Error("RPC chain ID is not Robinhood mainnet (4663)");
    const block = requireResult(head, "blockNumber");
    const iface = new Interface([
      "function decimals() view returns (uint8)",
      "function totalSupply() view returns (uint256)",
      "function balanceOf(address) view returns (uint256)",
      "function burn(uint256)",
      "function burnFrom(address,uint256)",
    ]);
    const call = (label, data) => ({
      label, method: "eth_call", params: [{ from: HOLDER, to: TOKEN, data }, block],
    });
    const live = await rpcBatch([
      { label: "block", method: "eth_getBlockByNumber", params: [block, false] },
      { label: "tokenCode", method: "eth_getCode", params: [TOKEN, block] },
      { label: "indexCode", method: "eth_getCode", params: [INDEX, block] },
      call("decimals", iface.encodeFunctionData("decimals")),
      call("totalSupply", iface.encodeFunctionData("totalSupply")),
      call("holderBalance", iface.encodeFunctionData("balanceOf", [HOLDER])),
      call("burnZero", iface.encodeFunctionData("burn", [0])),
      call("burnFromZero", iface.encodeFunctionData("burnFrom", [HOLDER, 0])),
      call("unknownSelectorControl", "0xdeadbeef"),
      { label: "firstShardCode", method: "eth_getCode", params: [ordered[0].shard_address, block] },
      { label: "lastShardCode", method: "eth_getCode", params: [ordered.at(-1).shard_address, block] },
    ], endpoint);
    const tokenCode = requireResult(live, "tokenCode");
    const indexCode = requireResult(live, "indexCode");
    if (tokenCode === "0x") throw new Error("No token code at the fixed GH0ST address");
    const tokenHash = keccak256(tokenCode);
    if (tokenHash !== TOKEN_HASH) throw new Error("GH0ST runtime hash differs from the frozen production identity");
    const indexHash = keccak256(indexCode);
    if (indexHash.toLowerCase() !== INDEX_HASH) throw new Error("Mainnet index code hash differs from the pinned manifest");
    const decimals = Number(BigInt(requireResult(live, "decimals")));
    if (decimals !== 18) throw new Error("GH0ST no longer reports 18 decimals");
    indexAddresses(indexCode, source);
    const sample = [
      { tokenId: 1, record: ordered[0], code: requireResult(live, "firstShardCode") },
      { tokenId: COUNT, record: ordered.at(-1), code: requireResult(live, "lastShardCode") },
    ].map(({ tokenId, record, code }) => {
      if (keccak256(code).toLowerCase() !== record.runtime_code_hash.toLowerCase() ||
          (code.length - 2) / 2 !== record.runtime_length_bytes)
        throw new Error("Live shard bytecode/hash differs from source, token ID " + tokenId);
      return { tokenId, address: getAddress(record.shard_address), runtimeCodeHash: keccak256(code), runtimeBytes: (code.length - 2) / 2 };
    });
    requireResult(live, "burnZero");
    requireResult(live, "burnFromZero");
    if (!live.unknownSelectorControl.error) throw new Error("Unknown selector did not revert; capability calls are ambiguous");
    const supply = BigInt(requireResult(live, "totalSupply"));
    const holderBalance = BigInt(requireResult(live, "holderBalance"));
    Object.assign(snapshot, {
      status: "PASS",
      chainId,
      blockNumber: Number(BigInt(block)),
      blockHash: requireResult(live, "block").hash,
      token: getAddress(TOKEN),
      tokenRuntimeBytes: (tokenCode.length - 2) / 2,
      tokenCodeHash: tokenHash,
      tokenDecimals: decimals,
      totalSupplyRaw: supply.toString(),
      burnZeroSimulation: live.burnZero,
      burnFromZeroSimulation: live.burnFromZero,
      unknownSelectorControl: live.unknownSelectorControl,
      tokenBurnSelectorObserved: tokenCode.includes("42966c68"),
      tokenBurnFromSelectorObserved: tokenCode.includes("79cc6790"),
      indexAddress: getAddress(INDEX),
      indexCodeHash: indexHash,
      indexRuntimeBytes: (indexCode.length - 2) / 2,
      all495IndexAddressesMatch: true,
      indexHeaderMatches: true,
      liveShardBytecodeSamples: sample,
      localForkCandidate: {
        address: getAddress(HOLDER),
        tokenBalanceRaw: holderBalance.toString(),
        canFundOneMintBeforeGas: holderBalance >= BURN_AMOUNT,
        canFundThreeMintsBeforeGas: holderBalance >= BURN_AMOUNT * 3n,
        scope: "Public balance read only. Impersonation, if used by tests, must occur only inside a local fork.",
      },
    });
    if (holderBalance >= BURN_AMOUNT) {
      const positive = await rpcBatch([{
        label: "positiveBurnSimulation", method: "eth_call",
        params: [{ from: HOLDER, to: TOKEN, data: iface.encodeFunctionData("burn", [BURN_AMOUNT]) }, block],
      }], endpoint);
      snapshot.positiveDirectBurnSimulation = positive.positiveBurnSimulation;
    }
    const config = {
      schemaVersion: 1,
      chainId: 4663,
      network: "Robinhood Chain mainnet",
      publicRPC: OFFICIAL_RPC,
      rpcDocumentation: "https://docs.robinhood.com/chain/connecting/",
      explorer: "https://robinhoodchain.blockscout.com",
      burnToken: getAddress(TOKEN),
      burnTokenDecimals: 18,
      burnAmount: BURN_AMOUNT.toString(),
      burnTokensPerNFT: 200000,
      maxSupply: COUNT,
      maxLifetimeMintsPerWallet: 3,
      mintRecipient: "The transaction sender; self-mint only.",
      maximumCollectionBurn: (BURN_AMOUNT * BigInt(COUNT)).toString(),
      protocolShareOfMintTokens: "0",
      royaltyStandard: "ERC-2981",
      royaltyBps: 350,
      royaltyRecipient: royalty.address,
      secondaryRoyaltyEnforcement: "Declared royalty; marketplace payment is not enforced by this NFT contract.",
      weightIndex: getAddress(INDEX),
      expectedTokenCodeHash: tokenHash,
      expectedIndexCodeHash: indexHash,
      shardMerkleRoot: tree.root,
      metadataBaseURI: "ipfs://bafybeiacuudlonut2coevovyc5t5u3hc6bjjf4ekfrzd4d5544mh4o7z2i/",
      tokenURIFilenameFormat: "{tokenId:03d}.json",
      collectionURI: "ipfs://bafkreigrokhivgmp763x3xbwhug5jfvk7i5b2hwlavtzb6rpld3mkwzpsq",
      sourceRepository: source.repository,
      sourceCommit: source.repository_commit,
      sourceExportSHA256: source.weight_export_sha256,
      sourceExportBytes: MODEL_BYTES,
      fullShardPayloadBytes: PAYLOAD_BYTES,
      preflightBlockNumber: snapshot.blockNumber,
      preflightBlockHash: snapshot.blockHash,
      constructorArgs: royalty.address ? [getAddress(TOKEN), getAddress(INDEX), tokenHash, indexHash, tree.root, royalty.address] : null,
      deployedNFTAddress: null,
      deploymentStatus: royalty.address ? "NOT_DEPLOYED" : "NEEDS_ROYALTY_RECIPIENT",
      proofsFile: "shard-proofs.json",
      preflightFile: ROYALTY_PREFLIGHT,
    };
    await writeJSON("mainnet.json", config);
    await writeJSON(ROYALTY_PREFLIGHT, snapshot);
    console.log(JSON.stringify({
      status: snapshot.status, chainId, blockNumber: snapshot.blockNumber,
      merkleRoot: tree.root, proofs: COUNT, tokenCodeHash: tokenHash,
      indexCodeHash: indexHash, all495IndexAddressesMatch: true,
      sampleShardCodeHashesMatch: true, holderCanFundOneLocalForkMint: holderBalance >= BURN_AMOUNT,
      royaltyBps: 350, royaltyRecipient: royalty.address, deploymentReadiness: config.deploymentStatus,
    }, null, 2));
  } catch (error) {
    snapshot.status = "FAILED";
    // Avoid persisting arbitrary provider error text or credential-bearing URLs.
    snapshot.failure = error?.name === "TimeoutError" ? "Read-only RPC request timed out" :
      String(error?.message || "Preflight failed").replaceAll(endpoint, "[configured RPC]").slice(0, 500);
    await writeJSON(ROYALTY_PREFLIGHT, snapshot);
    throw new Error(snapshot.failure);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error => { console.error("Configuration preparation failed: " + error.message); process.exitCode = 1; });
