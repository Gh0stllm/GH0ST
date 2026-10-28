import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { AbiCoder, Interface, id, keccak256 } from "ethers";
import {
  SWAP_ABI,
  SWAP_TOPIC,
  validatePool,
  loadSources,
  swapSourceId,
  decodeSwapReceipt,
  scanSwaps,
} from "../worker/swaps.mjs";

const registry = JSON.parse(
  fs.readFileSync(new URL("./fixtures/swap-sources.json", import.meta.url)),
);
const pools = loadSources(registry, 4663);
const pool = pools[0];
const iface = new Interface(SWAP_ABI);
const sender = "0x3333333333333333333333333333333333333333";
const txHash = id("gh0st-existing-pool-swap-fixture");
const blockHash = id("gh0st-existing-pool-block");
function fixture(index = 7, tx = txHash, selectedPool = pool, block = 100) {
  const event = iface.encodeEventLog(iface.getEvent("Swap"), [
    selectedPool.pool_id,
    sender,
    -1230000000000000n,
    987000000000000000n,
    1n << 96n,
    123456789n,
    -60,
    selectedPool.fee,
  ]);
  const log = {
    address: selectedPool.manager,
    transactionHash: tx,
    logIndex: `0x${index.toString(16)}`,
    blockNumber: `0x${block.toString(16)}`,
    blockHash,
    removed: false,
    ...event,
  };
  return {
    status: "0x1",
    transactionHash: tx,
    blockNumber: `0x${block.toString(16)}`,
    blockHash,
    logs: [log],
  };
}

test("saved PoolKeys hash to both registered GH0ST pool IDs", () => {
  assert.equal(pools.length, 2);
  assert.equal(pools[0].pool_id, registry.pools[0].pool_id);
  assert.equal(pools[1].pool_id, registry.pools[1].pool_id);
  assert.throws(() => loadSources(registry, 1), /chain mismatch/);
  assert.throws(
    () => loadSources({ ...registry, token: sender }, 4663),
    /token mismatch/,
  );
  assert.throws(
    () =>
      loadSources(
        { ...registry, pools: [registry.pools[0], registry.pools[0]] },
        4663,
      ),
    /Duplicate/,
  );
});
test("PoolKey validation rejects altered IDs, absent GH0ST and invalid ordering", () => {
  assert.throws(
    () => validatePool({ ...pool, pool_id: id("wrong") }),
    /PoolKey/,
  );
  assert.throws(
    () => validatePool({ ...pool, currency1: sender }),
    /contain GH0ST/,
  );
  assert.throws(
    () =>
      validatePool({
        ...pool,
        currency0: pool.currency1,
        currency1: pool.currency0,
      }),
    /sorted/,
  );
  assert.throws(
    () => validatePool({ ...pool, manager: "0x" + "00".repeat(20) }),
    /Zero pool manager/,
  );
  assert.throws(() => validatePool({ ...pool, tick_spacing: 0 }), /Zero tick/);
  assert.throws(
    () => validatePool({ ...pool, fee: 1000001 }),
    /Invalid v4 fee/,
  );
});
test("canonical source ID includes chain, manager, pool, transaction and log index", () => {
  const source = {
    manager: pool.manager,
    pool_id: pool.pool_id,
    transaction_hash: txHash,
    log_index: 7n,
  };
  const expected = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "bytes32", "bytes32", "uint256"],
      [4663, pool.manager, pool.pool_id, txHash, 7],
    ),
  );
  assert.equal(swapSourceId(4663, source), expected);
  for (const changed of [
    { ...source, manager: sender },
    { ...source, pool_id: id("pool") },
    { ...source, transaction_hash: id("tx") },
    { ...source, log_index: 8 },
  ])
    assert.notEqual(swapSourceId(4663, changed), expected);
  assert.notEqual(swapSourceId(1, source), expected);
});
test("receipt decoder derives bounded swap context and normalized proof", () => {
  const result = decodeSwapReceipt(fixture(), pool, 7, 4663);
  assert.equal(result.kind, "swap");
  assert.equal(result.source.log_index, 7n);
  assert.equal(result.context.amount0, "-1230000000000000");
  assert.equal(result.context.amount1, "987000000000000000");
  assert.equal(result.context.tick, -60);
  assert.equal(result.blockNumber, 100);
  assert.equal(result.context.sender, sender);
  assert.equal(result.id, swapSourceId(4663, result.source));
});
test("receipt decoder rejects failed, removed, wrong-manager/pool and malformed logs", () => {
  assert.throws(
    () => decodeSwapReceipt({ ...fixture(), status: "0x0" }, pool, 7, 4663),
    /failed/,
  );
  for (const mutate of [
    (r) => (r.logs[0].removed = true),
    (r) => (r.logs[0].address = sender),
    (r) => (r.logs[0].topics[1] = id("wrong pool")),
    (r) => (r.logs[0].topics[0] = id("wrong event")),
    (r) => (r.logs[0].data += "00"),
    (r) => (r.logs[0].transactionHash = id("another transaction")),
    (r) => (r.logs[0].blockHash = id("another block")),
  ]) {
    const receipt = fixture();
    mutate(receipt);
    assert.throws(() => decodeSwapReceipt(receipt, pool, 7, 4663));
  }
  assert.throws(() => decodeSwapReceipt(fixture(), pool, 8, 4663), /absent/);
});
test("scanner deduplicates observations but preserves multiple swap logs in one transaction", async () => {
  const receipt = fixture();
  receipt.logs.push(...fixture(8, txHash, pools[1]).logs);
  let receiptCalls = 0;
  let filter;
  const provider = {
    getLogs: async (input) => {
      filter = input;
      return [receipt.logs[1], receipt.logs[0], receipt.logs[0]];
    },
    getTransactionReceipt: async () => {
      receiptCalls++;
      return receipt;
    },
  };
  const jobs = await scanSwaps(provider, pools, 100, 100, 4663);
  assert.equal(jobs.length, 2);
  assert.deepEqual(
    jobs.map((j) => j.logIndex),
    [7, 8],
  );
  assert.notEqual(jobs[0].id, jobs[1].id);
  assert.equal(receiptCalls, 1);
  assert.equal(filter.address, pool.manager);
  assert.equal(filter.topics[0], SWAP_TOPIC);
  assert.equal(filter.topics[1].length, 2);
  await assert.rejects(scanSwaps(provider, pools, 0, 250, 4663), /1-250/);
});
test("scanner rejects stale receipts and an unregistered pool returned by RPC", async () => {
  const receipt = fixture();
  const provider = {
    getLogs: async () => receipt.logs,
    getTransactionReceipt: async () => null,
  };
  await assert.rejects(
    scanSwaps(provider, pools, 100, 100, 4663),
    /receipt absent/,
  );
  provider.getTransactionReceipt = async () => receipt;
  receipt.logs[0].topics[1] = id("unexpected pool");
  await assert.rejects(
    scanSwaps(provider, pools, 100, 100, 4663),
    /unregistered/,
  );
});
