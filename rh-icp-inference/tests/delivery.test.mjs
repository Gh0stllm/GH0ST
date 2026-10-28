import test from "node:test";
import assert from "node:assert/strict";
import { Interface, id, keccak256, toUtf8Bytes } from "ethers";
import { inspectFulfillment, findFulfillment } from "../worker/delivery.mjs";
const iface = new Interface([
  "event InferenceFulfilled(bytes32 indexed requestId,bytes32 indexed answerHash,string answer,uint64 inputTokens,uint64 outputTokens,uint128 modelCycles)",
]);
const address = "0x1111111111111111111111111111111111111111",
  requestId = id("request"),
  answer = "Hello from ICP",
  answerHash = keccak256(toUtf8Bytes(answer)),
  blockHash = id("canonical-block");
const encoded = iface.encodeEventLog(iface.getEvent("InferenceFulfilled"), [
  requestId,
  answerHash,
  answer,
  12,
  5,
  200000000000n,
]);
const receipt = {
  status: 1,
  hash: id("callback"),
  blockNumber: 100,
  blockHash,
  logs: [{ address, index: 7, ...encoded }],
};
test("delivery waits for configured depth and checks canonical block and exact answer", () => {
  const inspect = (r, b, h = answerHash, a = answer, safe = 100) =>
    inspectFulfillment(r, b, address, iface, requestId, h, a, safe);
  assert.equal(
    inspect(receipt, { hash: blockHash }, answerHash, answer, 99),
    null,
  );
  assert.equal(inspect(receipt, { hash: id("reorg") }), null);
  assert.equal(inspect({ ...receipt, status: 0 }, { hash: blockHash }), null);
  assert.equal(inspect(receipt, { hash: blockHash }).answer, answer);
  assert.throws(() => inspect(receipt, { hash: blockHash }, id("wrong")));
  assert.throws(() =>
    inspect(receipt, { hash: blockHash }, answerHash, "rewritten"),
  );
  assert.throws(() => inspect({ ...receipt, logs: [] }, { hash: blockHash }));
});
test("external-relayer delivery is reconciled from confirmed events and bounded scans", async () => {
  const item = { id: requestId, blockNumber: 90 };
  const provider = {
    getTransactionReceipt: async () => receipt,
    getBlock: async () => ({ hash: blockHash }),
  };
  const gateway = {
    getAddress: async () => address,
    interface: iface,
    filters: { InferenceFulfilled: () => ({}) },
    queryFilter: async (_, from, to) => {
      assert.equal(from, 90);
      assert.equal(to, 100);
      return [{ transactionHash: receipt.hash }];
    },
  };
  assert.equal(
    (await findFulfillment(provider, gateway, item, answerHash, answer, 100, 0))
      .transactionHash,
    receipt.hash,
  );
  gateway.queryFilter = async () => [];
  assert.equal(
    await findFulfillment(provider, gateway, item, answerHash, answer, 100, 0),
    null,
  );
  assert.equal(item.deliveryScanNext, 101);
});

test("confirmed manual callback cost is computed from its receipt", () => {
  const result = inspectFulfillment(
    { ...receipt, gasUsed: 45678n, gasPrice: 24000000n },
    { hash: blockHash }, address, iface, requestId, answerHash, answer, 100,
  );
  assert.equal(result.gasUsed, "45678");
  assert.equal(result.feeWei, "1096272000000");
  const rpcResult = inspectFulfillment(
    { ...receipt, gasUsed: "0xb26e", effectiveGasPrice: "0x16e3600" },
    { hash: blockHash }, address, iface, requestId, answerHash, answer, 100,
  );
  assert.equal(rpcResult.feeWei, result.feeWei);
});
