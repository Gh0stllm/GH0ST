import fs from "node:fs";
import path from "node:path";
import { Contract, Wallet, Transaction, keccak256, toUtf8Bytes } from "ethers";
import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { idlFactory } from "../../rh-icp-inference/worker/candid.mjs";
import {
  accessAbi,
  originAbi,
  transportPrompt,
} from "../../website/agents/protocol.mjs";
import {
  canonicalReceipt,
  fingerprint,
  same,
  stringify,
  validateOriginJob,
} from "./core.mjs";

// A durable journal precedes every signed transaction or potentially ambiguous ICP update.
export class Relay {
  static async open(c, bnb, rh, { key, identityFile, stateFile }) {
    if (!path.isAbsolute(stateFile) || !path.isAbsolute(identityFile))
      throw Error("Absolute private state/identity paths required");
    const st = fs.lstatSync(identityFile);
    if (
      !st.isFile() ||
      st.isSymbolicLink() ||
      (st.mode & 0o077) !== 0 ||
      st.size > 16384 ||
      st.uid !== process.getuid()
    )
      throw Error("Identity must be a private owned regular file");
    const identity = Ed25519KeyIdentity.fromJSON(
      fs.readFileSync(identityFile, "utf8"),
    );
    const agent = await HttpAgent.create({
      host: "https://icp-api.io",
      identity,
    });
    const coordinator = Actor.createActor(idlFactory, {
      agent,
      canisterId: c.coordinator,
    });
    const actual = await coordinator.get_config();
    if (
      !same(actual.gateway, c.originGateway) ||
      BigInt(actual.chain_id) !== 4663n ||
      !same(actual.model_id, c.modelId) ||
      !same(actual.artifact_hash, c.artifactHash) ||
      actual.model_canister.toText() !== c.modelCanister ||
      actual.worker.toText() !== identity.getPrincipal().toText()
    )
      throw Error(
        "Use the existing limited GH0ST worker identity and pinned runtime",
      );
    const relay = new Relay(c, bnb, rh, key, coordinator, stateFile);
    try {
      await relay.verify();
      return relay;
    } catch (error) {
      relay.close();
      throw error;
    }
  }
  constructor(c, bnb, rh, key, coordinator, stateFile) {
    this.c = c;
    this.bnb = bnb;
    this.rh = rh;
    this.coordinator = coordinator;
    this.stateFile = stateFile;
    this.bnbWallet = new Wallet(key, bnb);
    this.rhWallet = new Wallet(key, rh);
    this.access = new Contract(c.access, accessAbi, bnb);
    this.origin = new Contract(c.originGateway, originAbi, rh);
    this.binding = keccak256(
      toUtf8Bytes(
        stringify({
          access: c.access,
          origin: c.originGateway,
          signer: c.icpSigner,
          model: c.modelId,
          artifact: c.artifactHash,
          relayer: this.rhWallet.address,
        }),
      ),
    );
    fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
    this.lock = fs.openSync(stateFile + ".lock", "wx", 0o600);
    fs.writeFileSync(this.lock, String(process.pid));
    this.state = fs.existsSync(stateFile)
      ? JSON.parse(fs.readFileSync(stateFile, "utf8"))
      : { binding: this.binding, nextBlock: c.deploymentBlock, items: [] };
    if (this.state.binding !== this.binding) {
      this.close();
      throw Error("Journal is bound to a different deployment");
    }
    this.save();
  }
  close() {
    if (this.lock != null) {
      fs.closeSync(this.lock);
      fs.unlinkSync(this.stateFile + ".lock");
      this.lock = null;
    }
  }
  save() {
    const tmp = this.stateFile + ".tmp";
    fs.writeFileSync(tmp, stringify(this.state), { mode: 0o600 });
    fs.renameSync(tmp, this.stateFile);
  }
  async verify() {
    if (!(await this.origin.authorizedRequester(this.rhWallet.address)))
      throw Error("Relay wallet must be authorized on the existing RH gateway");
    for (const [provider, chain] of [
      [this.bnb, 56n],
      [this.rh, 4663n],
    ])
      if (BigInt(await provider.send("eth_chainId", [])) !== chain)
        throw Error("Relay chain mismatch");
    if (
      !same(await this.origin.icpSigner(), this.c.icpSigner) ||
      !same(await this.origin.modelId(), this.c.modelId) ||
      !same(await this.origin.artifactHash(), this.c.artifactHash)
    )
      throw Error("Origin gateway changed");
  }
  async send(item, slot, wallet, to, data, cap, limit, confirmations) {
    const provider = wallet.provider;
    if (!item[slot]) {
      const network = await provider.getNetwork(),
        gas = await provider.estimateGas({
          from: wallet.address,
          to,
          data,
          value: 0n,
        });
      const gasLimit = (gas * 120n + 99n) / 100n,
        fees = await provider.getFeeData();
      if (gasLimit > BigInt(limit))
        throw Error("Gas estimate exceeds relay cap");
      if (!fees.gasPrice || fees.gasPrice > BigInt(cap))
        throw Error("Gas price exceeds quoted relay policy");
      // BNB legacy and RH EIP-1559 are signed with their own native transaction format.
      const feeFields =
        network.chainId === 4663n
          ? {
              type: 2,
              maxFeePerGas: BigInt(cap),
              maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n,
            }
          : { type: 0, gasPrice: fees.gasPrice };
      if (feeFields.maxPriorityFeePerGas > BigInt(cap))
        throw Error("Priority fee exceeds relay cap");
      if ((await provider.getBalance(wallet.address)) < gasLimit * BigInt(cap))
        throw Error("Relay wallet needs gas funding");
      const raw = await wallet.signTransaction({
        to,
        data,
        value: 0n,
        chainId: network.chainId,
        nonce: await provider.getTransactionCount(wallet.address, "pending"),
        gasLimit,
        ...feeFields,
      });
      item[slot] = { raw, hash: keccak256(raw) };
      this.save();
    }
    const signed = Transaction.from(item[slot].raw);
    if (
      !same(signed.to, to) ||
      signed.data !== data ||
      signed.value !== 0n ||
      !same(signed.from, wallet.address) ||
      signed.chainId !== (await provider.getNetwork()).chainId
    )
      throw Error("Saved transaction differs from the intended operation");
    const r = await canonicalReceipt(provider, item[slot].hash, confirmations);
    if (r) return r;
    if (!(await provider.getTransaction(item[slot].hash))) {
      if (
        (await provider.getTransactionCount(wallet.address, "latest")) >
        signed.nonce
      )
        throw Error("Relay nonce was replaced externally; reconcile journal");
      await provider.broadcastTransaction(item[slot].raw);
    }
    return null;
  }
  async scan() {
    const safe = (await this.bnb.getBlockNumber()) - this.c.confirmations;
    if (this.state.nextBlock > safe) return;
    const end = Math.min(safe, this.state.nextBlock + 249);
    for (const log of await this.access.queryFilter(
      this.access.filters.ThoughtRequested(),
      this.state.nextBlock,
      end,
    )) {
      if (this.state.items.some((x) => same(x.id, log.args.requestId)))
        continue;
      const block = await this.bnb.getBlock(log.blockNumber);
      if (!same(block?.hash, log.blockHash))
        throw Error("Source block reorganized");
      this.state.items.push({
        id: log.args.requestId,
        prompt: log.args.prompt,
        maxTokens: String(log.args.maxTokens),
        deadline: String(log.args.deadline),
        passportId: String(log.args.passportId),
        bnbRequestTx: log.transactionHash,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        status: "queued",
      });
    }
    this.state.nextBlock = end + 1;
    this.save();
  }
  async update(item, method, args, job) {
    item.pendingUpdate = { method, before: fingerprint(job), at: Date.now() };
    this.save();
    const result = await this.coordinator[method](...args);
    delete item.pendingUpdate;
    this.save();
    if ("Err" in result) throw Error(result.Err);
    return result.Ok;
  }
  async retire(item) {
    if (item.retired || !item.originId) return;
    const job = (await this.coordinator.get_job(item.originId))[0];
    if (!job) {
      item.retired = true;
      this.save();
      return;
    }
    if (
      !same(job.request.id, item.originId) ||
      job.request.prompt !==
        transportPrompt(this.c.access, item.id, item.prompt)
    )
      throw Error("Refusing to retire a job outside this BNB request");
    if (job.busy) return;
    if (item.pendingUpdate) {
      if (fingerprint(job) === item.pendingUpdate.before) return;
      delete item.pendingUpdate;
      this.save();
    }
    if (!("Complete" in job.phase))
      await this.update(item, "abort", [item.originId], job);
    item.retired = true;
    this.save();
  }
  async process(item) {
    const state = await this.access.requests(item.id);
    if (Number(state.status) !== 1) {
      const safe = (await this.bnb.getBlockNumber()) - this.c.confirmations;
      if (safe < 0) return;
      const settled = await this.access.requests(item.id, { blockTag: safe });
      if (Number(settled.status) !== Number(state.status)) return;
      if (Number(state.status) === 2) {
        if (!item.originId)
          throw Error("Completed request lacks its origin journal entry");
        const job = (await this.coordinator.get_job(item.originId))[0],
          proof = validateOriginJob(this.c, item, job);
        if (!same(state.answerHash, proof.result.answerHash))
          throw Error("BNB settlement differs from the signed result");
        item.status = "fulfilled";
        item.answer = proof.answer;
        item.proof = proof;
      } else if (Number(state.status) === 3) {
        item.status = "refunded";
        await this.retire(item);
      } else throw Error("Unknown BNB request state");
      delete item.error;
      this.save();
      return;
    }
    if (
      !same((await this.bnb.getBlock(item.blockNumber))?.hash, item.blockHash)
    )
      throw Error("BNB source reorganized; hold for reconciliation");
    if (
      !same(
        state.transportPromptHash,
        keccak256(
          toUtf8Bytes(transportPrompt(this.c.access, item.id, item.prompt)),
        ),
      )
    )
      throw Error("Source prompt mismatch");
    const chainTime = (await this.bnb.getBlock("latest")).timestamp;
    if (chainTime >= Number(item.deadline) - 150) {
      item.status = "awaiting_refund";
      this.save();
      await this.retire(item);
      return;
    }
    if (!item.originId) {
      const data = this.origin.interface.encodeFunctionData(
        "requestInference",
        [
          transportPrompt(this.c.access, item.id, item.prompt),
          item.maxTokens,
          item.deadline,
        ],
      );
      const receipt = await this.send(
        item,
        "originRequest",
        this.rhWallet,
        this.c.originGateway,
        data,
        this.c.originMaxGasPriceWei,
        this.c.originGasLimit,
        this.c.originConfirmations,
      );
      if (!receipt) return;
      const event = receipt.logs
        .filter((l) => same(l.address, this.c.originGateway))
        .map((l) => this.origin.interface.parseLog(l))
        .find((l) => l?.name === "InferenceRequested");
      if (!event || !same(event.args.promptHash, state.transportPromptHash))
        throw Error("Origin request receipt does not bind the BNB prompt");
      item.originId = event.args.requestId;
      item.originLogIndex = receipt.logs.find(
        (l) =>
          same(l.address, this.c.originGateway) &&
          this.origin.interface.parseLog(l)?.name === "InferenceRequested",
      ).index;
      this.save();
    }
    let job = (await this.coordinator.get_job(item.originId))[0];
    if (item.pendingUpdate) {
      if (
        (job && item.pendingUpdate.method === "submit_request") ||
        (job && !job.busy && fingerprint(job) !== item.pendingUpdate.before)
      ) {
        delete item.pendingUpdate;
        this.save();
      } else {
        if (Date.now() - item.pendingUpdate.at > 120000) {
          item.status = "held";
          item.error = "Ambiguous ICP update; operator reconciliation required";
          this.save();
        }
        return;
      }
    }
    if (!job) {
      await this.update(
        item,
        "submit_request",
        [item.originRequest.hash, BigInt(item.originLogIndex)],
        job,
      );
      return;
    }
    if (job.busy) return;
    if ("Failed" in job.phase) {
      item.status = "awaiting_refund";
      item.error = "Inference failed; payment remains refundable at deadline";
      this.save();
      await this.retire(item);
      return;
    }
    if (!("Complete" in job.phase)) {
      await this.update(item, "advance", [item.originId], job);
      return;
    }
    const proof = validateOriginJob(this.c, item, job);
    const original = await this.origin.requests(item.originId);
    if (Number(original.status) !== 2) {
      const receipt = await this.send(
        item,
        "originCallback",
        this.rhWallet,
        this.c.originGateway,
        this.origin.interface.encodeFunctionData("fulfillInference", [
          proof.result,
          proof.answer,
          proof.signature,
        ]),
        this.c.originMaxGasPriceWei,
        this.c.originGasLimit,
        this.c.originConfirmations,
      );
      if (!receipt) return;
    } else if (!same(original.answerHash, proof.result.answerHash))
      throw Error("Origin settlement has a different answer");
    // Even an external delivery must be confirmed on RH before we submit the BNB mirror.
    const safeRh =
      (await this.rh.getBlockNumber()) - this.c.originConfirmations;
    if (safeRh < 0) return;
    const confirmed = await this.origin.requests(item.originId, {
      blockTag: safeRh,
    });
    if (
      Number(confirmed.status) !== 2 ||
      !same(confirmed.answerHash, proof.result.answerHash)
    )
      return;
    const receipt = await this.send(
      item,
      "bnbCallback",
      this.bnbWallet,
      this.c.access,
      this.access.interface.encodeFunctionData("fulfill", [
        item.id,
        proof.result,
        proof.answer,
        proof.signature,
      ]),
      this.c.bnbMaxGasPriceWei,
      this.c.callbackGasLimit,
      this.c.confirmations,
    );
    if (receipt) {
      item.status = "fulfilled";
      item.answer = proof.answer;
      item.proof = proof;
      delete item.error;
      this.save();
    }
  }
  async tick() {
    await this.scan();
    for (const old of this.state.items
      .filter(
        (x) =>
          ["awaiting_refund", "refunded"].includes(x.status) &&
          !x.retired &&
          x.originId,
      )
      .slice(0, 1)) {
      try {
        await this.retire(old);
      } catch (error) {
        old.error = error.message;
        this.save();
      }
    }
    const item = this.state.items.find(
      (x) =>
        !["fulfilled", "refunded", "awaiting_refund", "held"].includes(
          x.status,
        ),
    );
    if (item)
      try {
        await this.process(item);
      } catch (error) {
        item.error = error.message;
        this.save();
      }
  }
}
