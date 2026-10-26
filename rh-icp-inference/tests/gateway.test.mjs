import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import ganache from "ganache";
import {
  BrowserProvider,
  ContractFactory,
  Wallet,
  id,
  keccak256,
  toUtf8Bytes,
  TypedDataEncoder,
} from "ethers";
import { compile } from "../scripts/compile.mjs";
import { resultTypes } from "../worker/protocol.mjs";

let engine, provider, owner, other, relayer, artifact;
const icp = Wallet.createRandom();
const model = id("qwen3-0.6b-q8_0"),
  manifest = id("pinned-artifact-manifest");
before(async () => {
  engine = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 4663 },
    wallet: { totalAccounts: 4 },
  });
  provider = new BrowserProvider(engine, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  owner = await provider.getSigner(0);
  other = await provider.getSigner(1);
  relayer = await provider.getSigner(2);
  artifact = compile();
});
after(async () => engine?.disconnect());
async function setup(maxTokens = 50) {
  const gateway = await new ContractFactory(
    artifact.abi,
    artifact.evm.bytecode.object,
    owner,
  ).deploy(owner.address, icp.address, model, manifest);
  await gateway.waitForDeployment();
  const block = await provider.getBlock("latest");
  const receipt = await (
    await gateway.requestInference(
      "What is GH0ST?",
      maxTokens,
      block.timestamp + 3600,
    )
  ).wait();
  const event = receipt.logs
    .map((l) => gateway.interface.parseLog(l))
    .find((l) => l?.name === "InferenceRequested");
  const answer = "An onchain inference research protocol.";
  const value = {
    requestId: event.args.requestId,
    promptHash: keccak256(toUtf8Bytes("What is GH0ST?")),
    modelId: model,
    artifactHash: manifest,
    answerHash: keccak256(toUtf8Bytes(answer)),
    inputTokens: 12,
    outputTokens: 7,
    modelCycles: 280_000_000_000n,
  };
  const domain = {
    name: "GH0ST ICP Inference",
    version: "1",
    chainId: 4663,
    verifyingContract: await gateway.getAddress(),
  };
  return {
    gateway,
    event,
    answer,
    value,
    domain,
    signature: await icp.signTypedData(domain, resultTypes, value),
    receipt,
  };
}
test("complete request → signed result → permissionless RH callback", async () => {
  const c = await setup();
  assert.equal(
    await c.gateway.resultDigest(c.value),
    TypedDataEncoder.hash(c.domain, resultTypes, c.value),
  );
  const receipt = await (
    await c.gateway
      .connect(relayer)
      .fulfillInference(c.value, c.answer, c.signature)
  ).wait();
  assert.equal((await c.gateway.requests(c.value.requestId)).status, 2n);
  assert.equal(
    (await c.gateway.requests(c.value.requestId)).answerHash,
    c.value.answerHash,
  );
  const event = c.gateway.interface.parseLog(receipt.logs[0]);
  assert.equal(event.args.answer, c.answer);
});
test("signed result cannot replay on same or another gateway", async () => {
  const c = await setup();
  await (
    await c.gateway.fulfillInference(c.value, c.answer, c.signature)
  ).wait();
  await assert.rejects(async () =>
    (await c.gateway.fulfillInference(c.value, c.answer, c.signature)).wait(),
  );
  const d = await setup();
  const moved = { ...c.value, requestId: d.value.requestId };
  await assert.rejects(
    d.gateway.fulfillInference(
      moved,
      c.answer,
      await icp.signTypedData(c.domain, resultTypes, moved),
    ),
  );
});
test("wrong signer and wrong chain signatures rejected", async () => {
  const c = await setup();
  await assert.rejects(
    c.gateway.fulfillInference(
      c.value,
      c.answer,
      await Wallet.createRandom().signTypedData(c.domain, resultTypes, c.value),
    ),
  );
  await assert.rejects(
    c.gateway.fulfillInference(
      c.value,
      c.answer,
      await icp.signTypedData(
        { ...c.domain, chainId: 1 },
        resultTypes,
        c.value,
      ),
    ),
  );
});
test("prompt, artifact, model, answer and output cap are bound", async () => {
  const c = await setup();
  for (const value of [
    { ...c.value, promptHash: id("wrong") },
    { ...c.value, artifactHash: id("wrong") },
    { ...c.value, modelId: id("wrong") },
    { ...c.value, outputTokens: 51 },
  ]) {
    await assert.rejects(
      c.gateway.fulfillInference(
        value,
        c.answer,
        await icp.signTypedData(c.domain, resultTypes, value),
      ),
    );
  }
  await assert.rejects(
    c.gateway.fulfillInference(c.value, "tampered", c.signature),
  );
});
test("pilot request access and pause block unapproved compute", async () => {
  const c = await setup();
  const deadline = (await provider.getBlock("latest")).timestamp + 3600;
  await assert.rejects(
    c.gateway.connect(other).requestInference("hi", 1, deadline),
  );
  await (await c.gateway.setRequester(other.address, true)).wait();
  await (
    await c.gateway.connect(other).requestInference("hi", 1, deadline)
  ).wait();
  await (await c.gateway.setPaused(true)).wait();
  await assert.rejects(c.gateway.requestInference("hi", 1, deadline));
  await assert.rejects(c.gateway.connect(other).setPaused(false));
});
test("cancelled and expired requests cannot be fulfilled", async () => {
  const c = await setup();
  await (await c.gateway.cancel(c.value.requestId)).wait();
  await assert.rejects(
    c.gateway.fulfillInference(c.value, c.answer, c.signature),
  );
  const d = await setup();
  await engine.request({ method: "evm_increaseTime", params: [3601] });
  await engine.request({ method: "evm_mine", params: [] });
  await assert.rejects(
    d.gateway.fulfillInference(d.value, d.answer, d.signature),
  );
  await (await d.gateway.connect(other).cancel(d.value.requestId)).wait();
});
test("bounds reject empty/oversized prompts, tokens and deadlines", async () => {
  const c = await setup();
  const now = (await provider.getBlock("latest")).timestamp;
  for (const [prompt, tokens, deadline] of [
    ["", 1, now + 100],
    ["x".repeat(4097), 1, now + 100],
    ["x", 0, now + 100],
    ["x", 129, now + 100],
    ["x", 1, now - 1],
    ["x", 1, now + 86401],
  ])
    await assert.rejects(c.gateway.requestInference(prompt, tokens, deadline));
});
test("malformed and high-s signatures are rejected", async () => {
  const c = await setup();
  await assert.rejects(c.gateway.fulfillInference(c.value, c.answer, "0x1234"));
  const bytes = Buffer.from(c.signature.slice(2), "hex");
  bytes.fill(255, 32, 64);
  await assert.rejects(
    c.gateway.fulfillInference(c.value, c.answer, "0x" + bytes.toString("hex")),
  );
});
