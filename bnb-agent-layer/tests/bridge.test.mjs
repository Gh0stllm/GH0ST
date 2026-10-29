import { before, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import ganache from "ganache";
import {
  BrowserProvider,
  ContractFactory,
  AbiCoder,
  Wallet,
  id,
  ZeroAddress,
  ZeroHash,
  TypedDataEncoder,
  keccak256,
  toUtf8Bytes,
} from "ethers";
import { compile } from "../scripts/compile.mjs";
import {
  quoteDomain,
  tokenQuoteTypes,
  resultDomain,
  resultTypes,
  transportPrompt,
} from "../../website/agents/protocol.mjs";
let artifacts,
  engines = [];
const rhSelector = 6180753054346818345n,
  bnbSelector = 11344663589394136015n,
  abi = AbiCoder.defaultAbiCoder();
before(() => {
  artifacts = compile();
});
afterEach(async () => {
  for (const e of engines) await e.disconnect();
  engines = [];
});
async function setup({ sameAddresses = false } = {}) {
  async function chain(chainId) {
    const engine = ganache.provider({
      logging: { quiet: true },
      chain: { chainId },
      wallet: { deterministic: true, totalAccounts: 3 },
    });
    engines.push(engine);
    const provider = new BrowserProvider(engine, undefined, {
      cacheTimeout: -1,
    });
    provider.pollingInterval = 10;
    return {
      engine,
      provider,
      owner: await provider.getSigner(0),
      user: await provider.getSigner(1),
    };
  }
  async function deploy(name, signer, args = []) {
    const a = artifacts[name],
      c = await new ContractFactory(
        a.abi,
        a.evm.bytecode.object,
        signer,
      ).deploy(...args);
    await c.waitForDeployment();
    return c;
  }
  const rh = await chain(4663),
    bnb = await chain(56),
    rr = await deploy("CCIPRouterMock", rh.owner),
    br = await deploy("CCIPRouterMock", bnb.owner),
    token = await deploy("BridgeTokenMock", rh.owner);
  const escrow = await deploy("GH0STRobinhoodEscrow", rh.owner, [
    await rr.getAddress(),
    rhSelector,
    bnbSelector,
    await token.getAddress(),
    rh.owner.address,
    10000,
  ]);
  if (sameAddresses) await deploy("BridgeTokenMock", bnb.owner);
  const wrapped = await deploy("GH0STBridgedToken", bnb.owner, [
    await br.getAddress(),
    bnbSelector,
    rhSelector,
    await token.getAddress(),
    bnb.owner.address,
    10000,
    100000,
  ]);
  await (await escrow.bindPeer(await wrapped.getAddress())).wait();
  await (await wrapped.bindPeer(await escrow.getAddress())).wait();
  await (await escrow.setPaused(false)).wait();
  await (await wrapped.setPaused(false)).wait();
  await (await token.mint(rh.user.address, 20000)).wait();
  await (
    await token.connect(rh.user).approve(await escrow.getAddress(), 20000)
  ).wait();
  return { rh, bnb, rr, br, token, escrow, wrapped, deploy };
}
async function packet(router, tx, selector) {
  const receipt = await tx.wait(),
    log = receipt.logs
      .filter((x) => x.address.toLowerCase() === router.target.toLowerCase())
      .map((x) => router.interface.parseLog(x))
      .find((x) => x?.name === "Packet");
  return {
    messageId: log.args.id,
    sourceChainSelector: selector,
    sender: abi.encode(["address"], [log.args.sender]),
    data: log.args.data,
    destTokenAmounts: [],
  };
}
const lock = async (c, amount = 1000) =>
  packet(
    c.rr,
    await c.escrow
      .connect(c.rh.user)
      .bridge(amount, c.bnb.user.address, 10, { value: 10 }),
    rhSelector,
  );
test("identical contract addresses on different chains remain distinct peers", async () => {
  const c = await setup({ sameAddresses: true });
  assert.equal(await c.escrow.getAddress(), await c.wrapped.getAddress());
  const message = await lock(c);
  await (await c.br.deliver(await c.wrapped.getAddress(), message)).wait();
  assert.equal(await c.escrow.lockedBacking(), 1000n);
  assert.equal(await c.wrapped.balanceOf(c.bnb.user.address), 1000n);
});
test("lock → mint → transfer → burn → release preserves backing and user balances", async () => {
  const c = await setup(),
    message = await lock(c);
  assert.equal(await c.escrow.lockedBacking(), 1000n);
  assert.equal(await c.wrapped.totalSupply(), 0n);
  await (await c.br.deliver(await c.wrapped.getAddress(), message)).wait();
  assert.equal(await c.wrapped.balanceOf(c.bnb.user.address), 1000n);
  await (
    await c.wrapped.connect(c.bnb.user).transfer(c.bnb.owner.address, 400)
  ).wait();
  const back = await packet(
    c.br,
    await c.wrapped.bridge(400, c.rh.user.address, 10, { value: 10 }),
    bnbSelector,
  );
  assert.equal(await c.wrapped.totalSupply(), 600n);
  await (await c.rr.deliver(await c.escrow.getAddress(), back)).wait();
  assert.equal(await c.escrow.lockedBacking(), 600n);
  assert.equal(await c.token.balanceOf(c.rh.user.address), 19400n);
  assert.equal(await c.token.balanceOf(await c.escrow.getAddress()), 600n);
  const policy = await c.wrapped.getCCVsAndFinalityConfig(
    rhSelector,
    message.sender,
  );
  assert.equal(policy.allowedFinalityConfig, "0x00000000");
});
test("only the pinned CCIP router and remote peer can mint or release", async () => {
  const c = await setup(),
    m = await lock(c);
  await assert.rejects(c.wrapped.ccipReceive(m));
  await assert.rejects(
    c.br.deliver(await c.wrapped.getAddress(), {
      ...m,
      sender: abi.encode(["address"], [c.bnb.owner.address]),
    }),
  );
  await assert.rejects(
    c.br.deliver(await c.wrapped.getAddress(), {
      ...m,
      sourceChainSelector: 1,
    }),
  );
  await assert.rejects(
    c.br.deliver(await c.wrapped.getAddress(), { ...m, sender: "0x" }),
  );
  await assert.rejects(
    c.br.deliver(await c.wrapped.getAddress(), {
      ...m,
      destTokenAmounts: [{ token: c.wrapped.target, amount: 1 }],
    }),
  );
  assert.equal(await c.wrapped.totalSupply(), 0n);
});
test("duplicate message IDs and duplicate source nonces cannot mint twice", async () => {
  const c = await setup(),
    m = await lock(c);
  await (await c.br.deliver(c.wrapped.target, m)).wait();
  await assert.rejects(c.br.deliver(c.wrapped.target, m));
  await assert.rejects(
    c.br.deliver(c.wrapped.target, {
      ...m,
      messageId: id("different-message"),
    }),
  );
  assert.equal(await c.wrapped.totalSupply(), 1000n);
});
test("wrong action, native token, recipient, version and amount are rejected", async () => {
  const c = await setup(),
    m = await lock(c),
    decode = Array.from(
      abi.decode(
        ["uint8", "uint8", "address", "uint256", "address", "uint256"],
        m.data,
      ),
    );
  for (const [index, value] of [
    [0, 2],
    [1, 2],
    [2, Wallet.createRandom().address],
    [4, ZeroAddress],
    [5, 0],
    [5, 10001],
  ]) {
    const values = [...decode];
    values[index] = value;
    await assert.rejects(
      c.br.deliver(c.wrapped.target, {
        ...m,
        data: abi.encode(
          ["uint8", "uint8", "address", "uint256", "address", "uint256"],
          values,
        ),
      }),
    );
  }
  await assert.rejects(
    c.br.deliver(c.wrapped.target, { ...m, messageId: ZeroHash }),
  );
});
test("CCIP send failure and fee movement roll back locked tokens and nonce", async () => {
  const c = await setup();
  await (await c.rr.setFail(true)).wait();
  await assert.rejects(lock(c));
  assert.equal(await c.escrow.lockedBacking(), 0n);
  assert.equal(await c.escrow.outboundNonce(), 0n);
  assert.equal(await c.token.balanceOf(c.rh.user.address), 20000n);
  await (await c.rr.setFail(false)).wait();
  await (await c.rr.setFee(11)).wait();
  await assert.rejects(lock(c));
  assert.equal(await c.escrow.lockedBacking(), 0n);
});
test("reordered independent messages settle once without requiring FIFO delivery", async () => {
  const c = await setup(),
    one = await lock(c, 500),
    two = await lock(c, 600);
  await (await c.br.deliver(c.wrapped.target, two)).wait();
  await (await c.br.deliver(c.wrapped.target, one)).wait();
  assert.equal(await c.wrapped.totalSupply(), 1100n);
});
test("peer cannot change after binding, owner cannot directly mint, pause still permits incoming redemptions", async () => {
  const c = await setup(),
    m = await lock(c);
  await assert.rejects(c.escrow.bindPeer(c.rh.owner.address));
  await assert.rejects(c.wrapped.bindPeer(c.bnb.owner.address));
  await assert.rejects(c.escrow.connect(c.rh.user).setPaused(true));
  await (await c.wrapped.setPaused(true)).wait();
  await (await c.br.deliver(c.wrapped.target, m)).wait();
  assert.equal(await c.wrapped.balanceOf(c.bnb.user.address), 1000n);
  await assert.rejects(
    c.wrapped
      .connect(c.bnb.user)
      .bridge(100, c.rh.user.address, 10, { value: 10 }),
  );
  await assert.rejects(
    c.bnb.owner.sendTransaction({
      to: c.wrapped.target,
      data:
        id("mint(address,uint256)").slice(0, 10) +
        abi.encode(["address", "uint256"], [c.bnb.owner.address, 1]).slice(2),
    }),
  );
});
test("overpaid native fees are credited without exposing token backing", async () => {
  const c = await setup();
  await (
    await c.escrow
      .connect(c.rh.user)
      .bridge(100, c.bnb.user.address, 20, { value: 20 })
  ).wait();
  assert.equal(await c.escrow.nativeCredits(c.rh.user.address), 10n);
  await (await c.escrow.connect(c.rh.user).withdrawNativeCredit()).wait();
  assert.equal(await c.escrow.nativeCredits(c.rh.user.address), 0n);
  assert.equal(await c.escrow.lockedBacking(), 100n);
});
test("fee-on-transfer deposits revert without creating unbacked supply", async () => {
  const c = await setup();
  await (await c.token.setTax(true)).wait();
  await assert.rejects(lock(c));
  assert.equal(await c.escrow.lockedBacking(), 0n);
  assert.equal(await c.token.balanceOf(c.rh.user.address), 20000n);
});

test("real bridged GH0ST pays for inference and treasury can redeem the same backing", async () => {
  const c = await setup();
  await (await c.br.deliver(c.wrapped.target, await lock(c))).wait();
  const registry = await c.deploy("AgentRegistryMock", c.bnb.owner);
  await (await registry.mint(c.bnb.user.address, 9)).wait();
  const passport = await c.deploy("GH0STPassport", c.bnb.owner, [
    registry.target,
  ]);
  await (await passport.connect(c.bnb.user).mint(9)).wait();
  const icp = Wallet.createRandom(),
    quoter = Wallet.createRandom(),
    gateway = Wallet.createRandom().address,
    model = id("gh0st-model"),
    artifact = id("gh0st-artifact");
  const access = await c.deploy("GH0STAccess", c.bnb.owner, [
    [
      passport.target,
      icp.address,
      gateway,
      model,
      artifact,
      quoter.address,
      c.bnb.owner.address,
      0,
      0,
      0,
    ],
  ]);
  await (await access.bindPaymentToken(c.wrapped.target)).wait();
  await (
    await c.wrapped.connect(c.bnb.user).approve(access.target, 200)
  ).wait();
  const now = (await c.bnb.provider.getBlock("latest")).timestamp,
    q = {
      requester: c.bnb.user.address,
      passportId: 1,
      promptHash: keccak256(toUtf8Bytes("hello")),
      maxTokens: 32,
      fee: 200,
      validUntil: now + 120,
      deadline: now + 3600,
      nonce: id("integration"),
    },
    tq = { request: q, paymentToken: c.wrapped.target };
  const requestId = TypedDataEncoder.hash(
      quoteDomain(access.target),
      tokenQuoteTypes,
      tq,
    ),
    sig = await quoter.signTypedData(
      quoteDomain(access.target),
      tokenQuoteTypes,
      tq,
    );
  await (
    await access.connect(c.bnb.user).requestThoughtWithToken("hello", tq, sig)
  ).wait();
  assert.equal(await access.tokenEscrowed(), 200n);
  assert.equal(await c.wrapped.totalSupply(), 1000n);
  assert.equal(await c.escrow.lockedBacking(), 1000n);
  const answer = "mock inference for payment validation",
    result = {
      requestId: id("origin-integration"),
      promptHash: keccak256(
        toUtf8Bytes(transportPrompt(access.target, requestId, "hello")),
      ),
      modelId: model,
      artifactHash: artifact,
      answerHash: keccak256(toUtf8Bytes(answer)),
      inputTokens: 2,
      outputTokens: 7,
      modelCycles: 100,
    };
  await (
    await access.fulfill(
      requestId,
      result,
      answer,
      await icp.signTypedData(resultDomain(gateway), resultTypes, result),
    )
  ).wait();
  await (await access.withdrawToken()).wait();
  const back = await packet(
    c.br,
    await c.wrapped.bridge(200, c.rh.user.address, 10, { value: 10 }),
    bnbSelector,
  );
  await (await c.rr.deliver(c.escrow.target, back)).wait();
  assert.equal(await c.escrow.lockedBacking(), 800n);
  assert.equal(await c.wrapped.totalSupply(), 800n);
  assert.equal(await c.token.balanceOf(c.rh.user.address), 19200n);
});
