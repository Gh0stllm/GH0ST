import { before, afterEach, test } from "node:test";
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
import {
  quoteDomain,
  quoteTypes,
  tokenQuoteTypes,
  resultDomain,
  resultTypes,
  transportPrompt,
} from "../../website/agents/protocol.mjs";
let artifacts,
  engines = [];
before(() => {
  artifacts = compile();
});
afterEach(async () => {
  for (const e of engines) await e.disconnect();
  engines = [];
});
async function setup() {
  const engine = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 56 },
    wallet: { totalAccounts: 4 },
  });
  engines.push(engine);
  const provider = new BrowserProvider(engine, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  const owner = await provider.getSigner(0),
    user = await provider.getSigner(1),
    treasury = await provider.getSigner(2),
    icp = Wallet.createRandom(),
    quoter = Wallet.createRandom();
  async function deploy(name, args = []) {
    const a = artifacts[name],
      c = await new ContractFactory(a.abi, a.evm.bytecode.object, owner).deploy(
        ...args,
      );
    await c.waitForDeployment();
    return c;
  }
  const registry = await deploy("AgentRegistryMock");
  await (await registry.mint(user.address, 1)).wait();
  const passport = await deploy("GH0STPassport", [registry.target]);
  await (await passport.connect(user).mint(1)).wait();
  const token = await deploy("BridgeTokenMock"),
    model = id("existing-model"),
    artifact = id("existing-artifact"),
    rhGateway = Wallet.createRandom().address;
  const access = await deploy("GH0STAccess", [
    [
      passport.target,
      icp.address,
      rhGateway,
      model,
      artifact,
      quoter.address,
      treasury.address,
      0,
      0,
      0,
    ],
  ]);
  await (await access.bindPaymentToken(token.target)).wait();
  await (await token.mint(user.address, 100000)).wait();
  await (await token.connect(user).approve(access.target, 100000)).wait();
  return {
    engine,
    provider,
    owner,
    user,
    treasury,
    icp,
    quoter,
    token,
    access,
    model,
    artifact,
    rhGateway,
  };
}
async function quoted(c, changes = {}) {
  const now = (await c.provider.getBlock("latest")).timestamp,
    q = {
      requester: c.user.address,
      passportId: 1,
      promptHash: keccak256(toUtf8Bytes("hello")),
      maxTokens: 32,
      fee: 1000,
      validUntil: now + 120,
      deadline: now + 3600,
      nonce: id(Math.random().toString()),
      ...changes,
    };
  const tq = { request: q, paymentToken: c.token.target };
  return {
    q,
    tq,
    signature: await c.quoter.signTypedData(
      quoteDomain(c.access.target),
      tokenQuoteTypes,
      tq,
    ),
    requestId: TypedDataEncoder.hash(
      quoteDomain(c.access.target),
      tokenQuoteTypes,
      tq,
    ),
  };
}
async function paid(c) {
  const x = await quoted(c);
  await (
    await c.access
      .connect(c.user)
      .requestThoughtWithToken("hello", x.tq, x.signature)
  ).wait();
  return x;
}
async function delivered(c, x) {
  const answer = "a signed reply",
    result = {
      requestId: id("origin" + x.requestId),
      promptHash: keccak256(
        toUtf8Bytes(transportPrompt(c.access.target, x.requestId, "hello")),
      ),
      modelId: c.model,
      artifactHash: c.artifact,
      answerHash: keccak256(toUtf8Bytes(answer)),
      inputTokens: 12,
      outputTokens: 4,
      modelCycles: 100,
    };
  const sig = await c.icp.signTypedData(
    resultDomain(c.rhGateway),
    resultTypes,
    result,
  );
  await (await c.access.fulfill(x.requestId, result, answer, sig)).wait();
}
test("GH0ST payment binding is owner-only and cannot be replaced", async () => {
  const c = await setup();
  await assert.rejects(
    c.access.connect(c.user).bindPaymentToken(c.token.target),
  );
  await assert.rejects(c.access.bindPaymentToken(c.owner.address));
  await assert.rejects(c.access.bindPaymentToken(c.token.target));
  assert.equal(await c.access.paymentToken(), c.token.target);
});
test("token request escrows exact GH0ST while preserving native accounting", async () => {
  const c = await setup(),
    x = await paid(c);
  assert.equal(await c.access.requestPaymentToken(x.requestId), c.token.target);
  assert.equal(await c.access.tokenEscrowed(), 1000n);
  assert.equal(await c.access.escrowed(), 0n);
  assert.equal(await c.token.balanceOf(c.access.target), 1000n);
  await delivered(c, x);
  assert.equal(await c.access.tokenCredits(c.treasury.address), 1000n);
  assert.equal(await c.access.credits(c.treasury.address), 0n);
  await (await c.access.connect(c.treasury).withdrawToken()).wait();
  assert.equal(await c.token.balanceOf(c.treasury.address), 1000n);
  assert.equal(await c.access.totalTokenCredits(), 0n);
});
test("token denomination, signature and request method cannot be substituted", async () => {
  const c = await setup(),
    x = await quoted(c);
  await assert.rejects(
    c.access
      .connect(c.user)
      .requestThoughtWithToken(
        "hello",
        { ...x.tq, paymentToken: c.owner.address },
        x.signature,
      ),
  );
  const nativeSignature = await c.quoter.signTypedData(
    quoteDomain(c.access.target),
    quoteTypes,
    x.q,
  );
  await assert.rejects(
    c.access
      .connect(c.user)
      .requestThoughtWithToken("hello", x.tq, nativeSignature),
  );
  await assert.rejects(
    c.access
      .connect(c.user)
      .requestThought("hello", x.q, x.signature, { value: 1000 }),
  );
  await (
    await c.access
      .connect(c.user)
      .requestThoughtWithToken("hello", x.tq, x.signature)
  ).wait();
  await assert.rejects(
    c.access
      .connect(c.user)
      .requestThoughtWithToken("hello", x.tq, x.signature),
  );
});
test("expired GH0ST request refunds GH0ST, never BNB, to the original payer", async () => {
  const c = await setup(),
    x = await paid(c);
  await c.engine.request({ method: "evm_increaseTime", params: [3601] });
  await c.engine.request({ method: "evm_mine", params: [] });
  await (await c.access.refund(x.requestId)).wait();
  assert.equal(await c.access.tokenCredits(c.user.address), 1000n);
  assert.equal(await c.access.credits(c.user.address), 0n);
  await (await c.access.connect(c.user).withdrawToken()).wait();
  assert.equal(await c.token.balanceOf(c.user.address), 100000n);
  await assert.rejects(c.access.refund(x.requestId));
});
test("fee-on-transfer token cannot create an undercollateralized payment", async () => {
  const c = await setup(),
    x = await quoted(c);
  await (await c.token.setTax(true)).wait();
  await assert.rejects(
    c.access
      .connect(c.user)
      .requestThoughtWithToken("hello", x.tq, x.signature),
  );
  assert.equal(await c.access.tokenEscrowed(), 0n);
  assert.equal(await c.token.balanceOf(c.user.address), 100000n);
  assert.equal((await c.access.requests(x.requestId)).status, 0n);
});
test("native and GH0ST requests settle in separate balances", async () => {
  const c = await setup(),
    token = await paid(c),
    native = await quoted(c);
  const sig = await c.quoter.signTypedData(
    quoteDomain(c.access.target),
    quoteTypes,
    native.q,
  );
  await (
    await c.access
      .connect(c.user)
      .requestThought("hello", native.q, sig, { value: 1000 })
  ).wait();
  assert.equal(await c.access.escrowed(), 1000n);
  await delivered(c, token);
  assert.equal(await c.access.escrowed(), 1000n);
  assert.equal(await c.access.tokenEscrowed(), 0n);
  assert.equal(await c.access.tokenCredits(c.treasury.address), 1000n);
  assert.equal(await c.access.credits(c.treasury.address), 0n);
});

test("a transfer tax introduced before withdrawal cannot silently reduce a refund", async () => {
  const c = await setup(),
    x = await paid(c);
  await c.engine.request({ method: "evm_increaseTime", params: [3601] });
  await c.engine.request({ method: "evm_mine", params: [] });
  await (await c.access.refund(x.requestId)).wait();
  await (await c.token.setTax(true)).wait();
  await assert.rejects(c.access.connect(c.user).withdrawToken());
  assert.equal(await c.access.tokenCredits(c.user.address), 1000n);
  assert.equal(await c.token.balanceOf(c.access.target), 1000n);
});
