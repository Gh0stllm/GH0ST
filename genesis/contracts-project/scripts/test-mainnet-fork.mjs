#!/usr/bin/env node
/**
 * Battle-test the actual GH0ST token and Genesis shards inside an in-memory fork.
 * Upstream access is guarded by a read-only JSON-RPC proxy. Public broadcasts,
 * signing methods, and state mutations are refused before reaching mainnet.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ganache from "ganache";
import { BrowserProvider, Contract, ContractFactory, getAddress, keccak256, parseEther, toBeHex } from "ethers";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "deployment", "royalty-mainnet-fork-validation.json");
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const HOLDER = getAddress("0x8d6b11cfdf079e27c17e05cb7ea81235887691c6");
const READ_METHODS = new Set([
  "eth_chainId", "eth_blockNumber", "eth_call", "eth_getBalance", "eth_getCode",
  "eth_getStorageAt", "eth_getTransactionCount", "eth_getProof",
  "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getTransactionByHash",
  "eth_getTransactionReceipt", "eth_getLogs", "eth_getBlockTransactionCountByNumber",
  "eth_getBlockTransactionCountByHash", "net_version", "web3_clientVersion",
]);
const report = {
  schemaVersion: 1,
  status: "RUNNING",
  startedAtUTC: new Date().toISOString(),
  executionEnvironment: "In-process Ganache fork; all transactions and ETH balance changes are local only.",
  officialReadOnlyRPC: RPC,
  upstreamWriteMethodsPermitted: false,
  upstreamMethodCounts: {},
  blockedUpstreamMethods: [],
  publicTransactionsSent: 0,
  royaltyStandard: "ERC-2981",
  royaltyBps: 350,
  primaryProtocolShareOfMintTokens: 0,
  assertions: [],
};
function save() {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + "\n");
}
const deadline = setTimeout(() => {
  report.status = "TIMEOUT";
  report.failure = "Local mainnet-fork validation exceeded its 180-second bound.";
  report.finishedAtUTC = new Date().toISOString();
  save();
  console.error(report.failure);
  process.exit(2);
}, 180_000);
deadline.unref();

async function readOnlyProxy() {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== "POST") throw new Error("Only JSON-RPC POST is supported");
      let body = "";
      for await (const chunk of req) {
        body += chunk.toString("utf8");
        if (body.length > 2_000_000) throw new Error("Unexpected large upstream RPC request");
      }
      const parsed = JSON.parse(body);
      const calls = Array.isArray(parsed) ? parsed : [parsed];
      for (const call of calls) {
        if (!READ_METHODS.has(call.method)) {
          report.blockedUpstreamMethods.push(call.method);
          throw new Error("Refusing a non-read-only upstream method");
        }
        report.upstreamMethodCounts[call.method] = (report.upstreamMethodCounts[call.method] || 0) + 1;
      }
      const upstream = await fetch(RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "GH0ST-Genesis-LocalFork-Readonly/1.0" },
        body,
        signal: AbortSignal.timeout(25_000),
      });
      if (!upstream.ok) throw new Error("Read-only RPC returned HTTP " + upstream.status);
      const value = await upstream.text();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(value);
    } catch (error) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: String(error.message).slice(0, 250) } }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { server, url: "http://127.0.0.1:" + server.address().port };
}

async function expectedLimit(nft, id, proof) {
  try {
    await nft.mint.staticCall(id, proof);
    throw new Error("Fourth lifetime mint unexpectedly succeeded");
  } catch (error) {
    const parsed = error.data ? nft.interface.parseError(error.data) : error.revert;
    assert.equal(parsed?.name, "WalletMintLimit", "Expected the lifetime wallet quota to reject mint four");
    return "WalletMintLimit";
  }
}

async function main() {
  const config = JSON.parse(await fsp.readFile(path.join(ROOT, "config", "mainnet.json"), "utf8"));
  const proofs = JSON.parse(await fsp.readFile(path.join(ROOT, "config", "shard-proofs.json"), "utf8"));
  const artifact = JSON.parse(await fsp.readFile(path.join(ROOT, "artifacts", "GH0STGenesis.json"), "utf8"));
  assert.equal(config.chainId, 4663);
  assert.equal(config.deployedNFTAddress, null);
  assert.equal(config.royaltyStandard, "ERC-2981");
  assert.equal(config.royaltyBps, 350);
  assert.equal(artifact.abi.find(item => item.type === "constructor")?.inputs.length, 6,
    "Compile the current six-argument royalty contract before running its fork validation");
  report.creationBytecodeKeccak256 = keccak256(artifact.bytecode);
  report.productionRoyaltyRecipient = config.royaltyRecipient ?? null;
  report.forkBlockNumber = config.preflightBlockNumber;
  report.forkBlockHash = config.preflightBlockHash;
  report.mainnetToken = config.burnToken;
  report.mainnetWeightIndex = config.weightIndex;
  report.merkleRoot = config.shardMerkleRoot;
  report.holder = HOLDER;
  const { server, url } = await readOnlyProxy();
  let local;
  let provider;
  try {
    console.log("Starting read-only-proxied local fork at block " + report.forkBlockNumber);
    local = ganache.provider({
      fork: { url, blockNumber: report.forkBlockNumber, disableCache: true },
      chain: { chainId: 4663, networkId: 4663, hardfork: "shanghai", allowUnlimitedContractSize: true },
      wallet: { deterministic: true, totalAccounts: 3, defaultBalance: 100, unlockedAccounts: [HOLDER] },
      miner: { blockGasLimit: 30_000_000, defaultGasPrice: 1_000_000_000 },
      logging: { quiet: true },
    });
    provider = new BrowserProvider(local, undefined, { cacheTimeout: -1 });
    provider.pollingInterval = 10;
    assert.equal(Number((await provider.getNetwork()).chainId), 4663);
    const forkBlock = await provider.send("eth_getBlockByNumber", [toBeHex(report.forkBlockNumber), false]);
    assert.equal(forkBlock.hash.toLowerCase(), report.forkBlockHash.toLowerCase());
    assert.equal(keccak256(await provider.getCode(config.burnToken)), config.expectedTokenCodeHash);
    assert.equal(keccak256(await provider.getCode(config.weightIndex)), config.expectedIndexCodeHash);
    report.assertions.push("Pinned mainnet block, actual GH0ST bytecode hash and immutable index hash match");
    await provider.send("evm_setAccountBalance", [HOLDER, toBeHex(parseEther("100"))]);
    const deployer = await provider.getSigner(0);
    const holder = await provider.getSigner(HOLDER);
    const recipient = await (await provider.getSigner(1)).getAddress();
    // This fallback exists only inside Ganache. It is never a production payout default.
    const royaltyRecipient = config.royaltyRecipient ? getAddress(config.royaltyRecipient) : await deployer.getAddress();
    assert.notEqual(BigInt(royaltyRecipient), 0n);
    report.localRoyaltyRecipient = royaltyRecipient;
    report.royaltyRecipientScope = config.royaltyRecipient
      ? "Explicit production-configured recipient exercised in a local fork only."
      : "LOCAL TEST ONLY: ephemeral deterministic Ganache deployer; not a production royalty recipient or recommendation. Config remains null and production deployment stays blocked.";
    const localConstructorArgs = [config.burnToken, config.weightIndex, config.expectedTokenCodeHash,
      config.expectedIndexCodeHash, config.shardMerkleRoot, royaltyRecipient];
    report.localConstructorArgs = localConstructorArgs;
    const token = new Contract(config.burnToken, [
      "function totalSupply() view returns(uint256)",
      "function balanceOf(address) view returns(uint256)",
      "function allowance(address,address) view returns(uint256)",
      "function approve(address,uint256) returns(bool)",
    ], holder);
    const originalSupply = await token.totalSupply();
    const originalBalance = await token.balanceOf(HOLDER);
    const amount = BigInt(config.burnAmount);
    assert(originalBalance >= amount * 3n, "Pinned holder balance cannot fund three local-fork mints");
    report.originalSupplyRaw = originalSupply.toString();
    report.originalHolderBalanceRaw = originalBalance.toString();
    console.log("Deploying Genesis only into the local fork");
    const nft = await new ContractFactory(artifact.abi, artifact.bytecode, deployer)
      .deploy(...localConstructorArgs, { gasLimit: 8_000_000, gasPrice: 1_000_000_000n });
    await nft.waitForDeployment();
    report.localNFTAddress = await nft.getAddress();
    report.localDeploymentTransactionHash = nft.deploymentTransaction().hash;
    report.localDeploymentGas = (await nft.deploymentTransaction().wait()).gasUsed.toString();
    assert.equal(await nft.royaltyRecipient(), royaltyRecipient);
    assert.equal(await nft.ROYALTY_BPS(), 350n);
    assert.equal(await nft.supportsInterface("0x2a55205a"), true);
    report.royaltyChecks = [];
    for (const salePrice of [0n, 10_000n, 123_456_789n, (1n << 256n) - 1n]) {
      const quote = await nft.royaltyInfo(1, salePrice);
      const expectedAmount = salePrice * 350n / 10_000n;
      assert.equal(quote[0], royaltyRecipient);
      assert.equal(quote[1], expectedAmount);
      report.royaltyChecks.push({ salePriceRaw: salePrice.toString(), receiver: quote[0], royaltyAmountRaw: quote[1].toString() });
    }
    report.assertions.push("Current six-argument contract declares ERC-2981 at immutable 350 basis points with explicit local recipient; royalty quotes handle zero, ordinary and maximum uint256 sale prices correctly");
    await (await token.approve(report.localNFTAddress, amount * 3n, { gasLimit: 100_000, gasPrice: 1_000_000_000n })).wait();
    report.mints = [];
    const ids = [1, 2, 495];
    for (const [position, id] of ids.entries()) {
      const binding = proofs.records.find(record => record.tokenId === id);
      assert.equal(await nft.shardLeaf(id), binding.leaf);
      const receipt = await (await nft.connect(holder).mint(id, binding.proof, {
        gasLimit: 1_000_000, gasPrice: 1_000_000_000n,
      })).wait();
      const supply = await token.totalSupply({ blockTag: receipt.blockNumber });
      const balance = await token.balanceOf(HOLDER, { blockTag: receipt.blockNumber });
      const allowance = await token.allowance(HOLDER, report.localNFTAddress, { blockTag: receipt.blockNumber });
      const n = BigInt(position + 1);
      assert.equal(supply, originalSupply - amount * n);
      assert.equal(balance, originalBalance - amount * n);
      assert.equal(allowance, amount * (3n - n));
      assert.equal(await nft.ownerOf(id), HOLDER);
      assert.equal(await nft.totalMinted(), n);
      assert.equal(await nft.mintedBy(HOLDER), n);
      assert.equal(await nft.totalBurned(), amount * n);
      assert.equal(await nft.tokenURI(id), config.metadataBaseURI + String(id).padStart(3, "0") + ".json");
      const info = await nft.shardInfo(id);
      assert.equal(info[0].toLowerCase(), binding.shardAddress.toLowerCase());
      assert.equal(info[1], binding.runtimeCodeHash);
      assert.equal(info[2], BigInt(binding.offset));
      assert.equal(info[3], BigInt(binding.length));
      report.mints.push({
        tokenId: id, localTransactionHash: receipt.hash, gasUsed: receipt.gasUsed.toString(),
        supplyAfterRaw: supply.toString(), holderBalanceAfterRaw: balance.toString(),
        allowanceAfterRaw: allowance.toString(), tokensBurnedRaw: amount.toString(),
      });
      console.log("Actual-token local-fork mint " + n + "/3 passed for token " + id);
    }
    report.assertions.push("Three actual GH0ST burnFrom calls each reduce totalSupply and payer balance by exactly 200,000e18");
    report.assertions.push("Allowance, NFT ownership, wallet lifetime counter, aggregate burn total and metadata URI match after each mint");
    report.assertions.push("Actual live shard addresses, runtime hashes and logical byte ranges match all minted IDs, including partial final shard 495");
    const fourth = proofs.records.find(record => record.tokenId === 3);
    report.fourthMintRevert = await expectedLimit(nft.connect(holder), 3, fourth.proof);
    await (await nft.connect(holder).transferFrom(HOLDER, recipient, 1, {
      gasLimit: 200_000, gasPrice: 1_000_000_000n,
    })).wait();
    assert.equal(await nft.ownerOf(1), recipient);
    assert.equal(await nft.mintedBy(HOLDER), 3n);
    assert.equal(await nft.balanceOf(HOLDER), 2n);
    const royaltyAfterTransfer = await nft.royaltyInfo(1, 10_000n);
    assert.equal(royaltyAfterTransfer[0], royaltyRecipient);
    assert.equal(royaltyAfterTransfer[1], 350n);
    report.assertions.push("Secondary royalty recipient and 3.5% quote remain unchanged after transfer; primary mint supply/balance burns remain exactly 200,000 GH0ST each with zero protocol cut");
    report.afterTransferMintRevert = await expectedLimit(nft.connect(holder), 3, fourth.proof);
    report.assertions.push("Fourth lifetime mint reverts WalletMintLimit before and after transferring a minted NFT away");
    assert.equal(report.blockedUpstreamMethods.length, 0);
    assert(Object.keys(report.upstreamMethodCounts).every(method => READ_METHODS.has(method)));
    report.assertions.push("All public-node requests were permitted read-only methods; no public transaction or signing method was sent");
    report.status = "PASS";
  } finally {
    clearTimeout(deadline);
    if (provider) await provider.destroy();
    if (local) await local.disconnect();
    await new Promise(resolve => server.close(resolve));
    report.finishedAtUTC = new Date().toISOString();
    save();
  }
}

main().then(() => {
  console.log(JSON.stringify({
    status: report.status,
    forkBlockNumber: report.forkBlockNumber,
    localMints: report.mints?.length ?? 0,
    publicTransactionsSent: report.publicTransactionsSent,
    fourthMintRevert: report.fourthMintRevert,
    afterTransferMintRevert: report.afterTransferMintRevert,
    report: OUTPUT,
  }, null, 2));
}).catch(error => {
  clearTimeout(deadline);
  report.status = "FAILED";
  report.failure = String(error?.message || error).slice(0, 1500);
  report.finishedAtUTC = new Date().toISOString();
  save();
  console.error("Local mainnet-fork test failed: " + report.failure);
  process.exitCode = 1;
});
