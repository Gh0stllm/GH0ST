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
  ZeroHash,
} from "ethers";
import { compile } from "../scripts/compile.mjs";
import {
  quoteTypes,
  resultTypes,
  quoteDomain,
  resultDomain,
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
    wallet: { totalAccounts: 5 },
  });
  engines.push(engine);
  const provider = new BrowserProvider(engine, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  const [owner, user, other, relayer, treasury] = await Promise.all(
    [0, 1, 2, 3, 4].map((n) => provider.getSigner(n)),
  );
  const deploy = async (name, args = []) => {
    const a = artifacts[name],
      c = await new ContractFactory(a.abi, a.evm.bytecode.object, owner).deploy(
        ...args,
      );
    await c.waitForDeployment();
    return c;
  };
  const registry = await deploy("AgentRegistryMock");
  await (await registry.mint(user.address, 111)).wait();
  await (await registry.mint(other.address, 222)).wait();
  const passport = await deploy("GH0STPassport", [await registry.getAddress()]);
  await (await passport.connect(user).mint(111)).wait();
  const icp = Wallet.createRandom(),
    quoter = Wallet.createRandom();
  const model = id("qwen3-1.7b"),
    artifact = id("existing-gh0st-artifacts"),
    rhGateway = Wallet.createRandom().address;
  const access = await deploy("GH0STAccess", [
    [
      await passport.getAddress(),
      icp.address,
      rhGateway,
      model,
      artifact,
      quoter.address,
      treasury.address,
      10n,
      2n,
      100n,
    ],
  ]);
  return {
    engine,
    provider,
    owner,
    user,
    other,
    relayer,
    treasury,
    registry,
    passport,
    access,
    icp,
    quoter,
    model,
    artifact,
    rhGateway,
  };
}
async function makeQuote(c, prompt = "What does GH0ST remember?", change = {}) {
  const now = (await c.provider.getBlock("latest")).timestamp;
  const quote = {
    requester: c.user.address,
    passportId: 1n,
    promptHash: keccak256(toUtf8Bytes(prompt)),
    maxTokens: 50,
    fee: 1000n,
    validUntil: now + 120,
    deadline: now + 3600,
    nonce: id(Math.random().toString()),
    ...change,
  };
  return {
    prompt,
    quote,
    signature: await c.quoter.signTypedData(
      quoteDomain(await c.access.getAddress()),
      quoteTypes,
      quote,
    ),
  };
}
async function request(c, change = {}) {
  const q = await makeQuote(c, undefined, change);
  const receipt = await (
    await c.access
      .connect(c.user)
      .requestThought(q.prompt, q.quote, q.signature, { value: q.quote.fee })
  ).wait();
  const requestId = TypedDataEncoder.hash(
    quoteDomain(await c.access.getAddress()),
    quoteTypes,
    q.quote,
  );
  const originPrompt = transportPrompt(
    await c.access.getAddress(),
    requestId,
    q.prompt,
  );
  const answer = "the chain remembers every borrowed spark";
  const result = {
    requestId: id(`RH-${requestId}`),
    promptHash: keccak256(toUtf8Bytes(originPrompt)),
    modelId: c.model,
    artifactHash: c.artifact,
    answerHash: keccak256(toUtf8Bytes(answer)),
    inputTokens: 32,
    outputTokens: 8,
    modelCycles: 900000000000n,
  };
  const signature = await c.icp.signTypedData(
    resultDomain(c.rhGateway),
    resultTypes,
    result,
  );
  return {
    ...q,
    requestId,
    originPrompt,
    answer,
    result,
    signature,
    quoteSignature: q.signature,
    receipt,
  };
}
const deliver = async (c, r) =>
  (
    await c.access
      .connect(c.relayer)
      .fulfill(r.requestId, r.result, r.answer, r.signature)
  ).wait();
test("gas-only passport binds registry owner and remains non-transferable", async () => {
  const c = await setup();
  assert.equal(await c.passport.passportOf(c.user.address), 1n);
  assert.equal(await c.passport.isActive(c.user.address), true);
  await assert.rejects(c.passport.connect(c.other).mint(111));
  await assert.rejects(c.passport.connect(c.user).mint(111));
  await assert.rejects(
    c.passport.connect(c.user).transferFrom(c.user.address, c.other.address, 1),
  );
  await assert.rejects(c.passport.connect(c.user).approve(c.other.address, 1));
  assert.equal(await c.passport.locked(1), true);
  assert.equal(await c.passport.supportsInterface("0xb45a3c0e"), true);
  const metadata = JSON.parse(
    Buffer.from(
      (await c.passport.tokenURI(1)).split(",")[1],
      "base64",
    ).toString(),
  );
  assert.match(metadata.image, /^data:image\/svg\+xml;base64,/);
  assert.match(metadata.name, /Passport #1/);
});
test("upstream identity transfer disables access and cannot mint the same identity twice", async () => {
  const c = await setup();
  await (
    await c.registry
      .connect(c.user)
      .transferFrom(c.user.address, c.other.address, 111)
  ).wait();
  assert.equal(await c.passport.isActive(c.user.address), false);
  await assert.rejects(c.passport.connect(c.other).mint(111));
  const q = await makeQuote(c);
  await assert.rejects(
    c.access
      .connect(c.user)
      .requestThought(q.prompt, q.quote, q.signature, { value: q.quote.fee }),
  );
});
test("paid request reuses the exact RH/ICP signature and settles only after delivery", async () => {
  const c = await setup(),
    r = await request(c);
  assert.equal(await c.access.escrowed(), 1000n);
  assert.equal(await c.access.credits(c.treasury.address), 0n);
  assert.equal(
    (await c.access.requests(r.requestId)).transportPromptHash,
    keccak256(toUtf8Bytes(r.originPrompt)),
  );
  const receipt = await deliver(c, r);
  assert.equal((await c.access.requests(r.requestId)).status, 2n);
  assert.equal(await c.access.credits(c.treasury.address), 1000n);
  assert.equal(await c.access.escrowed(), 0n);
  assert.equal(await c.access.completed(1), 1n);
  assert.equal(await c.access.requestCount(1), 1n);
  assert.deepEqual(Array.from(await c.access.requestPage(1, 0, 50)), [
    r.requestId,
  ]);
  assert.equal(
    c.access.interface.parseLog(receipt.logs.at(-1)).args.answer,
    r.answer,
  );
});
test("quote is bound to payer, prompt, payment, chain, contract and nonce", async () => {
  const c = await setup(),
    q = await makeQuote(c);
  await assert.rejects(
    c.access
      .connect(c.other)
      .requestThought(q.prompt, q.quote, q.signature, { value: 1000n }),
  );
  await assert.rejects(
    c.access
      .connect(c.user)
      .requestThought("tampered", q.quote, q.signature, { value: 1000n }),
  );
  await assert.rejects(
    c.access
      .connect(c.user)
      .requestThought(q.prompt, q.quote, q.signature, { value: 999n }),
  );
  for (const domain of [
    { ...quoteDomain(await c.access.getAddress()), chainId: 4663 },
    quoteDomain(c.other.address),
  ]) {
    const sig = await c.quoter.signTypedData(domain, quoteTypes, q.quote);
    await assert.rejects(
      c.access
        .connect(c.user)
        .requestThought(q.prompt, q.quote, sig, { value: 1000n }),
    );
  }
  await (
    await c.access
      .connect(c.user)
      .requestThought(q.prompt, q.quote, q.signature, { value: 1000n })
  ).wait();
  await assert.rejects(
    c.access
      .connect(c.user)
      .requestThought(q.prompt, q.quote, q.signature, { value: 1000n }),
  );
});
test("result replay and substituted prompts, models, manifests, answers and token counts fail", async () => {
  const c = await setup(),
    r = await request(c);
  for (const patch of [
    { promptHash: id("other") },
    { modelId: id("other") },
    { artifactHash: id("other") },
    { outputTokens: 51 },
    { outputTokens: 0 },
    { requestId: ZeroHash },
  ]) {
    const result = { ...r.result, ...patch },
      sig = await c.icp.signTypedData(
        resultDomain(c.rhGateway),
        resultTypes,
        result,
      );
    await assert.rejects(c.access.fulfill(r.requestId, result, r.answer, sig));
  }
  await assert.rejects(
    c.access.fulfill(r.requestId, r.result, "changed text", r.signature),
  );
  await assert.rejects(
    c.access.fulfill(
      r.requestId,
      r.result,
      r.answer,
      await Wallet.createRandom().signTypedData(
        resultDomain(c.rhGateway),
        resultTypes,
        r.result,
      ),
    ),
  );
  await assert.rejects(
    c.access.fulfill(
      r.requestId,
      r.result,
      r.answer,
      await c.icp.signTypedData(
        { ...resultDomain(c.rhGateway), chainId: 56 },
        resultTypes,
        r.result,
      ),
    ),
  );
  await deliver(c, r);
  await assert.rejects(
    c.access.fulfill(r.requestId, r.result, r.answer, r.signature),
  );
});
test("one signed answer cannot satisfy a different BNB request", async () => {
  const c = await setup(),
    a = await request(c),
    b = await request(c);
  await assert.rejects(
    c.access.fulfill(b.requestId, a.result, a.answer, a.signature),
  );
});
test("deadline refunds return all escrow; late fulfillment and duplicate refunds fail", async () => {
  const c = await setup(),
    r = await request(c);
  await assert.rejects(c.access.refund(r.requestId));
  await c.engine.request({ method: "evm_increaseTime", params: [3601] });
  await c.engine.request({ method: "evm_mine", params: [] });
  await assert.rejects(
    c.access.fulfill(r.requestId, r.result, r.answer, r.signature),
  );
  await (await c.access.connect(c.other).refund(r.requestId)).wait();
  assert.equal(await c.access.credits(c.user.address), 1000n);
  assert.equal(await c.access.escrowed(), 0n);
  await assert.rejects(c.access.refund(r.requestId));
  await (await c.access.connect(c.user).withdraw()).wait();
  assert.equal(await c.access.credits(c.user.address), 0n);
  await assert.rejects(c.access.connect(c.user).withdraw());
});
test("rewards are separately funded, capped and cannot consume pending escrow", async () => {
  const c = await setup();
  await (await c.access.fundRewards({ value: 30n })).wait();
  for (let i = 0; i < 3; i++) await deliver(c, await request(c));
  assert.equal(await c.access.credits(c.user.address), 20n);
  assert.equal(await c.access.rewarded(1), 2n);
  assert.equal(await c.access.rewardPool(), 10n);
  await assert.rejects(c.access.fundRewards({ value: 71n }));
  await request(c);
  assert.equal(
    await c.provider.getBalance(await c.access.getAddress()),
    (await c.access.escrowed()) +
      (await c.access.totalCredits()) +
      (await c.access.rewardPool()),
  );
});
test("an unfunded reward pool never blocks delivery or spends user escrow", async () => {
  const c = await setup();
  await deliver(c, await request(c));
  assert.equal(await c.access.rewarded(1), 0n);
  assert.equal(await c.access.credits(c.user.address), 0n);
});
test("pause stops new requests while allowing existing delivery and refunds", async () => {
  const c = await setup(),
    r = await request(c);
  await assert.rejects(c.access.connect(c.user).setPaused(true));
  await (await c.access.setPaused(true)).wait();
  await assert.rejects(request(c));
  await deliver(c, r);
  assert.equal(await c.access.completed(1), 1n);
});
test("prompt, token, quote-expiry and deadline bounds reject invalid requests", async () => {
  const c = await setup(),
    now = (await c.provider.getBlock("latest")).timestamp;
  for (const changes of [
    { maxTokens: 0 },
    { maxTokens: 129 },
    { validUntil: now - 1 },
    { deadline: now + 100 },
    { deadline: now + 90000 },
    { fee: 0n },
  ]) {
    const q = await makeQuote(c, undefined, changes);
    await assert.rejects(
      c.access
        .connect(c.user)
        .requestThought(q.prompt, q.quote, q.signature, { value: q.quote.fee }),
    );
  }
  for (const prompt of ["", "x".repeat(3401)]) {
    const q = await makeQuote(c, prompt);
    await assert.rejects(
      c.access
        .connect(c.user)
        .requestThought(prompt, q.quote, q.signature, { value: q.quote.fee }),
    );
  }
  await assert.rejects(c.access.requestPage(1, 0, 51));
});
