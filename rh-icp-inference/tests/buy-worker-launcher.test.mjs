import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Wallet } from "ethers";
import { validateBuyWorkerConfig, runBuyWorker } from "../scripts/run-buy-worker.mjs";
import { LOCAL_RELAYER_POLICY as P, getInjectedRelayer } from "../worker/local-relayer.mjs";

const valid = () => ({ BUY_ONLY: "1", WATCH_SWAPS: "1", X_ENABLED: "1", ONCE: "0", RH_CHAIN_ID: "4663",
  RH_GATEWAY: P.gateway, ICP_COORDINATOR: "6jacx-5yaaa-aaaaj-a65jq-cai", RH_RPC_URL: "https://rpc.invalid",
  ICP_IDENTITY_FILE: "/private/identity.json", START_BLOCK: "123", JOURNAL: ".state/buy-worker.json",
  X_OAUTH_TOKEN_FILE: "/private/x-oauth.json", X_USER_ACCESS_TOKEN: "",
  RH_RELAYER_ADDRESS: Wallet.createRandom().address, RH_RELAYER_KEYSTORE_FILE: "/private/relayer.v3.json",
  RH_RELAYER_PRIVATE_KEY: "", TARGET_SWAP_TX_HASH: "", TARGET_SWAP_LOG_INDEX: "" });

test("launcher accepts only dedicated-wallet every-buy mode with bounded public settings", () => {
  const config = validateBuyWorkerConfig(valid());
  assert.equal(config.maxFeeGwei, "0.05"); assert.equal(config.maxGas, "500000");
  assert.equal(config.dailyBudgetWei, null);
  assert.equal(Object.hasOwn(config, "rpc"), false);
});

test("launcher refuses main-wallet, raw-key, pilot-filter and inactive-mode configurations", () => {
  for (const change of [{ BUY_ONLY: "0" }, { WATCH_SWAPS: "0" }, { X_ENABLED: "0" }, { ONCE: "1" },
    { RH_CHAIN_ID: "1" }, { RH_GATEWAY: Wallet.createRandom().address }, { START_BLOCK: "-1" }, { JOURNAL: "" },
    { RH_RELAYER_ADDRESS: P.mainWallet }, { RH_RELAYER_ADDRESS: P.icpSigner },
    { RH_RELAYER_PRIVATE_KEY: "must-not-be-accepted" }, { TARGET_SWAP_TX_HASH: "0x1234" },
    { X_USER_ACCESS_TOKEN: "must-not-be-accepted" }, { X_OAUTH_TOKEN_FILE: "" }, { X_EXPECTED_USERNAME: "other" },
    { X_POST_FORMAT: "thought-only" },
    { TARGET_SWAP_LOG_INDEX: "0" }, { RH_RELAYER_KEYSTORE_FILE: "relative.json" },
    { RELAY_MAX_FEE_GWEI: "0.051" }, { RELAY_GAS_LIMIT_CAP: "500001" },
    { RH_RELAYER_DAILY_BUDGET_ETH: "0" }, { RH_RELAYER_DAILY_BUDGET_ETH: "-0.1" }])
    assert.throws(() => validateBuyWorkerConfig({ ...valid(), ...change }));
});

test("launcher cannot read a keystore located inside the repository", () => {
  const file = new URL("../ignored-wallet.json", import.meta.url).pathname;
  assert.throws(() => validateBuyWorkerConfig({ ...valid(), RH_RELAYER_KEYSTORE_FILE: file }), /outside this repository/);
});

test("a configured daily ETH budget is parsed without placing any key in config", () => {
  const config = validateBuyWorkerConfig({ ...valid(), RH_RELAYER_DAILY_BUDGET_ETH: "0.001" });
  assert.equal(config.dailyBudgetWei, 1000000000000000n);
  assert.equal(Object.keys(config).some(name => /privateKey|password|secret/i.test(name)), false);
});

test("setup can inject its dedicated in-memory wallet without another unlock or raw key env", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh0st-launcher-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wallet = Wallet.createRandom(), file = path.join(dir, "dedicated.v3.json");
  // Intentionally not decryptable: an injected signer must not read/unlock it.
  fs.writeFileSync(file, "{}", { mode: 0o600 });
  const env = { ...valid(), RH_RELAYER_ADDRESS: wallet.address, RH_RELAYER_KEYSTORE_FILE: file,
    RH_RELAYER_FEE_LEDGER: path.join(dir, "fees.json") };
  const prior = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  let started = false;
  try {
    await runBuyWorker({ signer: wallet, provider: { send: async () => "0x1237" }, env,
      importWorker: async () => {
        started = true; assert.equal(getInjectedRelayer().address, wallet.address);
        assert.equal(Object.values(process.env).includes(wallet.privateKey), false);
      } });
  } finally {
    for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    if (!Object.hasOwn(prior, "RELAY_MAX_FEE_GWEI")) delete process.env.RELAY_MAX_FEE_GWEI;
    if (!Object.hasOwn(prior, "RELAY_GAS_LIMIT_CAP")) delete process.env.RELAY_GAS_LIMIT_CAP;
  }
  assert.equal(started, true);
});
