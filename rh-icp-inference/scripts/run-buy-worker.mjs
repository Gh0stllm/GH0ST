import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JsonRpcProvider, getAddress, parseEther, parseUnits } from "ethers";
import { installInjectedRelayer, LOCAL_RELAYER_POLICY as P } from "../worker/local-relayer.mjs";
import { unlockKeystore } from "./execute-rh.mjs";
import { nativeMacPasswordPrompt } from "./native-unlock.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
class LauncherError extends Error {}
const stop = message => { throw new LauncherError(message); };
const outsideRepo = file => {
  const relative = path.relative(root, file);
  return relative.startsWith(".." + path.sep) || path.isAbsolute(relative);
};

export function validateBuyWorkerConfig(env = process.env) {
  if (env.BUY_ONLY !== "1" || env.WATCH_SWAPS !== "1" || env.X_ENABLED !== "1" || env.ONCE !== "0")
    stop("Buy worker requires BUY_ONLY=1, WATCH_SWAPS=1, X_ENABLED=1 and ONCE=0.");
  if (env.X_POST_FORMAT && env.X_POST_FORMAT !== "afterimage")
    stop("New buy posts require X_POST_FORMAT=afterimage (or leave it unset).");
  if ((env.RH_RELAYER_PRIVATE_KEY ?? "") !== "") stop("Raw relayer keys are forbidden in the environment.");
  if (!env.X_OAUTH_TOKEN_FILE || (env.X_USER_ACCESS_TOKEN ?? "") !== "")
    stop("Buy worker requires the private OAuth token file, not a raw environment token.");
  if (env.X_EXPECTED_USERNAME && env.X_EXPECTED_USERNAME.toLowerCase() !== "llmgh0st")
    stop("Buy worker can publish only to llmgh0st.");
  if (env.TARGET_SWAP_TX_HASH?.trim() || env.TARGET_SWAP_LOG_INDEX?.trim()) stop("Buy worker must not retain the one-pilot target filters.");
  if (env.RH_CHAIN_ID !== "4663" || env.RH_GATEWAY?.toLowerCase() !== P.gateway.toLowerCase() ||
      env.ICP_COORDINATOR !== "6jacx-5yaaa-aaaaj-a65jq-cai" || !env.RH_RPC_URL || !env.ICP_IDENTITY_FILE)
    stop("Buy worker is not bound to the approved RH/ICP deployment.");
  if (!/^(0|[1-9]\d*)$/.test(env.START_BLOCK ?? "") || !Number.isSafeInteger(Number(env.START_BLOCK)) || !env.JOURNAL)
    stop("An explicit activation block and dedicated worker journal are required.");
  let address;
  try { address = getAddress(env.RH_RELAYER_ADDRESS); } catch { stop("Set the dedicated RH_RELAYER_ADDRESS."); }
  if ([P.mainWallet, P.icpSigner, P.gateway].some(value => value.toLowerCase() === address.toLowerCase()) || BigInt(address) === 0n)
    stop("The main wallet cannot be the background relayer.");
  if (!env.RH_RELAYER_KEYSTORE_FILE || !path.isAbsolute(env.RH_RELAYER_KEYSTORE_FILE) || !outsideRepo(path.resolve(env.RH_RELAYER_KEYSTORE_FILE)))
    stop("The dedicated encrypted keystore must be an absolute path outside this repository.");
  let maxFee, maxGas, dailyBudgetWei;
  try {
    maxFee = parseUnits(env.RELAY_MAX_FEE_GWEI ?? "0.05", "gwei");
    maxGas = BigInt(env.RELAY_GAS_LIMIT_CAP ?? "500000");
    dailyBudgetWei = env.RH_RELAYER_DAILY_BUDGET_ETH ? parseEther(env.RH_RELAYER_DAILY_BUDGET_ETH) : null;
  } catch { stop("Invalid relayer gas or daily budget configuration."); }
  if (maxFee <= 0n || maxFee > P.maxFeePerGas || maxGas <= 0n || maxGas > P.maxGas ||
      (dailyBudgetWei !== null && dailyBudgetWei <= 0n))
    stop("Relayer gas, fee or daily budget exceeds the permitted bounds.");
  return Object.freeze({ address, keystoreFile: path.resolve(env.RH_RELAYER_KEYSTORE_FILE),
    feeLedgerPath: path.resolve(env.RH_RELAYER_FEE_LEDGER ?? path.join(root, ".state/buy-relayer-fees.json")),
    maxFeeGwei: env.RELAY_MAX_FEE_GWEI ?? "0.05", maxGas: maxGas.toString(), dailyBudgetWei });
}

function checkKeystoreLocation(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid()) || !outsideRepo(fs.realpathSync(file)))
    stop("Dedicated keystore must be private, owned by this user, and outside the repository.");
}

/** A setup process may pass its newly generated dedicated wallet in memory. */
export async function runBuyWorker({ signer, provider, env = process.env,
  importWorker = () => import("../worker/main.mjs") } = {}) {
  const config = validateBuyWorkerConfig(env);
  checkKeystoreLocation(config.keystoreFile);
  const client = provider ?? new JsonRpcProvider(env.RH_RPC_URL, 4663, { staticNetwork: true, cacheTimeout: -1 });
  try {
    if (!signer) signer = await unlockKeystore(config.keystoreFile, config.address,
      () => nativeMacPasswordPrompt({ purpose: "worker" }));
    await installInjectedRelayer({ signer, provider: client, expectedAddress: config.address,
      feeLedgerPath: config.feeLedgerPath, dailyBudgetWei: config.dailyBudgetWei });
    // Only public limits are populated here; no secret enters process.env.
    env.RELAY_MAX_FEE_GWEI = config.maxFeeGwei;
    env.RELAY_GAS_LIMIT_CAP = config.maxGas;
    if (env !== process.env) Object.assign(process.env, env);
    console.log("Dedicated buy relayer unlocked locally. Watching new Pons buys with one thought active at a time.");
    await importWorker();
  } finally { signer = undefined; if (!provider) client.destroy(); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Launch using a private env file: node --env-file=/private/path/buy-worker.env scripts/run-buy-worker.mjs\nRequired public settings: RH_RELAYER_ADDRESS, RH_RELAYER_KEYSTORE_FILE, explicit START_BLOCK/JOURNAL; BUY_ONLY=1 WATCH_SWAPS=1 X_ENABLED=1 ONCE=0. A native macOS dialog unlocks only the dedicated wallet. Raw key env vars and pilot target filters are rejected.");
    return;
  }
  if (args.length) stop("The buy worker accepts no secrets or wallet arguments.");
  await runBuyWorker();
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => {
    console.error(error instanceof LauncherError ? error.message : "Buy worker stopped on a keystore, relayer or runtime check. No secret details were logged.");
    process.exitCode = 1;
  });
