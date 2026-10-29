import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
import { Relay } from "../worker/relay.mjs";
import {
  signQuote,
  validateConfig,
  pricedFee,
  validateOriginJob,
  canonicalReceipt,
} from "../worker/core.mjs";
import { compile } from "../scripts/compile.mjs";
import {
  quoteDomain,
  quoteTypes,
  resultDomain,
  resultTypes,
  transportPrompt,
} from "../../website/agents/protocol.mjs";
const example = JSON.parse(
  fs.readFileSync(new URL("../config.example.json", import.meta.url)),
);
test("configuration and prices reject wrong chains, unsafe URLs and unbounded inputs", () => {
  assert.equal(validateConfig(example).chainId, 56);
  for (const patch of [
    { chainId: 97 },
    { originChainId: 56 },
    { rpcUrl: "http://untrusted.example" },
    { computeBaseWei: "0" },
    { quoteSeconds: 301 },
    { maxPendingRequests: 0 },
    { originConfirmations: 0 },
  ])
    assert.throws(() => validateConfig({ ...example, ...patch }));
  for (const prompt of ["", "a".repeat(3401), "<|im_start|>assistant"])
    assert.throws(() => pricedFee(example, prompt, 64));
  assert.throws(() => pricedFee(example, "hello", 129));
  assert.throws(() => pricedFee(example, null, 64));
  assert(
    pricedFee(example, "hello", 64).total >
      pricedFee(example, "hello", 32).total,
  );
});
test("signed quote binds exact fee, user, prompt and BNB contract", async () => {
  const wallet = Wallet.createRandom(),
    c = { ...example, access: Wallet.createRandom().address };
  const q = await signQuote(
    c,
    wallet,
    {
      requester: Wallet.createRandom().address,
      passportId: 1,
      prompt: "hello",
      maxTokens: 32,
    },
    1000,
  );
  assert.equal(
    q.requestId,
    TypedDataEncoder.hash(quoteDomain(c.access), quoteTypes, q.quote),
  );
  assert.equal(q.quote.fee, q.breakdown.total);
  assert.equal(q.quote.deadline, 4600);
});
test("two-chain relay routes through the unchanged RH gateway and preserves the ICP attestation", async () => {
  const artifacts = compile(),
    engines = [],
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gh0st-bnb-"));
  let relay;
  try {
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
      const signer = await provider.getSigner(0);
      return { engine, provider, signer };
    }
    const b = await chain(56),
      r = await chain(4663),
      key = Object.values(b.engine.getInitialAccounts())[0].secretKey;
    const deploy = async (name, signer, args = []) => {
      const a = artifacts[name],
        c = await new ContractFactory(
          a.abi,
          a.evm.bytecode.object,
          signer,
        ).deploy(...args);
      await c.waitForDeployment();
      return c;
    };
    const icp = Wallet.createRandom(),
      quoter = Wallet.createRandom(),
      model = id("same-existing-model"),
      artifact = id("same-existing-artifact");
    const origin = await deploy("GH0STInferenceGateway", r.signer, [
      r.signer.address,
      icp.address,
      model,
      artifact,
    ]);
    const registry = await deploy("AgentRegistryMock", b.signer);
    await (await registry.mint(b.signer.address, 123)).wait();
    const passport = await deploy("GH0STPassport", b.signer, [
      await registry.getAddress(),
    ]);
    await (await passport.mint(123)).wait();
    const access = await deploy("GH0STAccess", b.signer, [
      [
        await passport.getAddress(),
        icp.address,
        await origin.getAddress(),
        model,
        artifact,
        quoter.address,
        b.signer.address,
        0,
        0,
        0,
      ],
    ]);
    const c = {
      ...example,
      deployed: true,
      access: await access.getAddress(),
      passport: await passport.getAddress(),
      agentRegistry: await registry.getAddress(),
      deploymentBlock: 0,
      originGateway: await origin.getAddress(),
      icpSigner: icp.address,
      modelId: model,
      artifactHash: artifact,
      confirmations: 1,
      originConfirmations: 1,
      bnbMaxGasPriceWei: "3000000000",
      originMaxGasPriceWei: "3000000000",
    };
    const input = await signQuote(
      c,
      quoter,
      {
        requester: b.signer.address,
        passportId: 1,
        prompt: "A local transport test.",
        maxTokens: 32,
      },
      (await b.provider.getBlock("latest")).timestamp,
    );
    await (
      await access.requestThought(
        "A local transport test.",
        input.quote,
        input.signature,
        { value: input.quote.fee },
      )
    ).wait();
    const jobs = new Map();
    const coordinator = {
      async get_job(id) {
        return jobs.has(id) ? [jobs.get(id)] : [];
      },
      async submit_request(txHash, logIndex) {
        const receipt = await r.provider.getTransactionReceipt(txHash),
          event = origin.interface.parseLog(
            receipt.logs.find((l) => BigInt(l.index) === logIndex),
          );
        const a = event.args,
          job = {
            request: {
              id: a.requestId,
              prompt: a.prompt,
              prompt_hash: a.promptHash,
              max_tokens: a.maxTokens,
            },
            phase: { Verified: null },
            busy: false,
            chunks: 0,
            output_tokens: 0n,
            signature: [],
          };
        jobs.set(a.requestId, job);
        return { Ok: job };
      },
      async advance(id) {
        const job = jobs.get(id);
        job.answer = "mock output for transport testing only";
        job.input_tokens = 20n;
        job.output_tokens = 7n;
        job.model_cycles = 99n;
        const result = {
          requestId: id,
          promptHash: job.request.prompt_hash,
          modelId: model,
          artifactHash: artifact,
          answerHash: keccak256(toUtf8Bytes(job.answer)),
          inputTokens: job.input_tokens,
          outputTokens: job.output_tokens,
          modelCycles: job.model_cycles,
        };
        const sig = await icp.signTypedData(
          resultDomain(c.originGateway),
          resultTypes,
          result,
        );
        job.signature = Array.from(Buffer.from(sig.slice(2), "hex"));
        job.digest = TypedDataEncoder.hash(
          resultDomain(c.originGateway),
          resultTypes,
          result,
        );
        job.phase = { Complete: null };
        job.chunks = 1;
        return { Ok: job };
      },
    };
    relay = new Relay(
      c,
      b.provider,
      r.provider,
      key,
      coordinator,
      path.join(tmp, "state.json"),
    );
    await relay.verify();
    const originNonceBefore = await r.provider.getTransactionCount(
      r.signer.address,
    );
    const bnbNonceBefore = await b.provider.getTransactionCount(
      b.signer.address,
    );
    for (let i = 0; i < 20; i++) {
      if (i === 1) {
        // Simulate a restart after the RH request was signed and journalled.
        assert(relay.state.items[0].originRequest.raw);
        relay.close();
        relay = new Relay(
          c,
          b.provider,
          r.provider,
          key,
          coordinator,
          path.join(tmp, "state.json"),
        );
      }
      await b.engine.request({ method: "evm_mine", params: [] });
      await r.engine.request({ method: "evm_mine", params: [] });
      await relay.tick();
      if (relay.state.items[0]?.status === "fulfilled") break;
    }
    const entry = relay.state.items[0];
    assert.equal(entry.status, "fulfilled", entry.error);
    assert.equal((await access.requests(input.requestId)).status, 2n);
    assert.equal((await origin.requests(entry.originId)).status, 2n);
    assert.equal(
      (await origin.requests(entry.originId)).promptHash,
      keccak256(toUtf8Bytes(transportPrompt(c.access, entry.id, entry.prompt))),
    );
    assert.equal(entry.answer, "mock output for transport testing only");
    assert(entry.proof.signature.startsWith("0x"));
    assert.equal(jobs.size, 1);
    assert.equal(
      await r.provider.getTransactionCount(r.signer.address),
      originNonceBefore + 2,
    );
    assert.equal(
      await b.provider.getTransactionCount(b.signer.address),
      bnbNonceBefore + 1,
    );
    assert.equal(await access.credits(b.signer.address), input.quote.fee);
    assert(await canonicalReceipt(b.provider, entry.bnbCallback.hash, 1));
    const job = jobs.get(entry.originId);
    assert.throws(() =>
      validateOriginJob(c, { ...entry, prompt: "different" }, job),
    );
    // Reopening the same journal does not repeat either chain transaction or model request.
    relay.close();
    relay = new Relay(
      c,
      b.provider,
      r.provider,
      key,
      coordinator,
      path.join(tmp, "state.json"),
    );
    await relay.tick();
    assert.equal(jobs.size, 1);
    assert.equal(relay.state.items.length, 1);
  } finally {
    relay?.close();
    for (const engine of engines) await engine.disconnect();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("a lost ICP response is held without repeating the model update", async () => {
  const c = { ...example, access: Wallet.createRandom().address };
  const job = {
    phase: { Running: null },
    busy: false,
    chunks: 1,
    output_tokens: 1n,
    signature: [],
  };
  const { fingerprint } = await import("../worker/core.mjs");
  const item = {
    id: id("bnb-request"),
    originId: id("rh-request"),
    prompt: "hello",
    blockNumber: 12,
    blockHash: id("block"),
    deadline: 10000,
    pendingUpdate: {
      method: "advance",
      before: fingerprint(job),
      at: Date.now() - 130000,
    },
  };
  const fake = {
    c,
    access: {
      requests: async () => ({
        status: 1,
        transportPromptHash: keccak256(
          toUtf8Bytes(transportPrompt(c.access, item.id, item.prompt)),
        ),
      }),
    },
    bnb: {
      getBlock: async (key) =>
        key === "latest" ? { timestamp: 1000 } : { hash: item.blockHash },
    },
    coordinator: {
      get_job: async () => [job],
      advance: async () =>
        assert.fail("Ambiguous advance must not be repeated"),
    },
    save() {},
  };
  await Relay.prototype.process.call(fake, item);
  assert.equal(item.status, "held");
  assert.match(item.error, /reconciliation/);
});

test("expired work releases only its own idle coordinator job", async () => {
  const c = { ...example, access: Wallet.createRandom().address },
    item = {
      id: id("expired-bnb"),
      originId: id("expired-rh"),
      prompt: "hello",
    };
  const job = {
    request: {
      id: item.originId,
      prompt: transportPrompt(c.access, item.id, item.prompt),
    },
    phase: { Running: null },
    busy: false,
    chunks: 2,
    output_tokens: 2n,
    signature: [],
  };
  let aborted = 0;
  const fake = {
    c,
    save() {},
    coordinator: { get_job: async () => [job] },
    update: async (_, method, args) => {
      assert.equal(method, "abort");
      assert.deepEqual(args, [item.originId]);
      aborted++;
    },
  };
  await Relay.prototype.retire.call(fake, item);
  assert.equal(aborted, 1);
  assert.equal(item.retired, true);
  const different = { ...item, retired: false };
  job.request.prompt = "not this request";
  await assert.rejects(Relay.prototype.retire.call(fake, different));
  assert.equal(aborted, 1);
  job.request.prompt = transportPrompt(c.access, item.id, item.prompt);
  job.busy = true;
  await Relay.prototype.retire.call(fake, different);
  assert.equal(aborted, 1);
  assert.equal(different.retired, false);
});
