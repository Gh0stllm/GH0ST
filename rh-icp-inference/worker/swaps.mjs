import { AbiCoder, Interface, keccak256, toUtf8Bytes } from "ethers";

export const GH0ST_TOKEN = "0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559";
export const SWAP_ABI = [
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
];
const iface = new Interface(SWAP_ABI);
const abi = AbiCoder.defaultAbiCoder();
export const SWAP_TOPIC = keccak256(
  toUtf8Bytes(
    "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)",
  ),
);
export const MAX_SCAN_BLOCKS = 250;

function address(value, name) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value))
    throw Error(`Invalid ${name}`);
  return value.toLowerCase();
}
function hash(value, name) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw Error(`Invalid ${name}`);
  return value.toLowerCase();
}
function integer(value, name, max = Number.MAX_SAFE_INTEGER) {
  let n;
  try {
    if (typeof value === "number" && !Number.isSafeInteger(value))
      throw Error("unsafe integer");
    if (!["number", "string", "bigint"].includes(typeof value))
      throw Error("missing integer");
    n = BigInt(value);
  } catch {
    throw Error(`Invalid ${name}`);
  }
  if (n < 0n || n > BigInt(max)) throw Error(`Invalid ${name}`);
  return Number(n);
}

/// Validates the full PoolKey before trusting a pool ID. Registration still
/// requires deployment/source review; this is not proof of fresh pool state.
export function validatePool(pool, ghostToken = GH0ST_TOKEN) {
  const normalized = {
    manager: address(pool.manager, "pool manager"),
    pool_id: hash(pool.pool_id, "pool ID"),
    currency0: address(pool.currency0, "currency0"),
    currency1: address(pool.currency1, "currency1"),
    fee: integer(pool.fee, "pool fee", 0xffffff),
    tick_spacing: integer(pool.tick_spacing, "tick spacing", 32767),
    hook: address(pool.hook, "hook"),
  };
  const ghost = address(ghostToken, "GH0ST token");
  if (BigInt(normalized.manager) === 0n) throw Error("Zero pool manager");
  if (BigInt(normalized.currency0) >= BigInt(normalized.currency1))
    throw Error("Pool currencies must be distinct and sorted");
  if (![normalized.currency0, normalized.currency1].includes(ghost))
    throw Error("Pool does not contain GH0ST");
  if (normalized.tick_spacing === 0) throw Error("Zero tick spacing");
  if (normalized.fee > 1_000_000 && normalized.fee !== 0x800000)
    throw Error("Invalid v4 fee");
  const computed = keccak256(
    abi.encode(
      ["address", "address", "uint24", "int24", "address"],
      [
        normalized.currency0,
        normalized.currency1,
        normalized.fee,
        normalized.tick_spacing,
        normalized.hook,
      ],
    ),
  );
  if (computed !== normalized.pool_id)
    throw Error("PoolKey does not match pool ID");
  return normalized;
}

export function loadSources(registry, chainId) {
  const expectedChain = integer(chainId, "chain ID");
  if (
    expectedChain === 0 ||
    integer(registry.chain_id, "registry chain ID") !== expectedChain
  )
    throw Error("Swap registry chain mismatch");
  if (!Array.isArray(registry.pools) || registry.pools.length === 0)
    throw Error("Swap registry has no pools");
  const token = registry.token ?? GH0ST_TOKEN;
  if (address(token, "registry token") !== GH0ST_TOKEN)
    throw Error("Swap registry token mismatch");
  const pools = registry.pools.map((pool) => validatePool(pool, token));
  const keys = pools.map((pool) => `${pool.manager}:${pool.pool_id}`);
  if (new Set(keys).size !== keys.length) throw Error("Duplicate source pool");
  return pools;
}

export function swapSourceId(chainId, source) {
  const chain = integer(chainId, "chain ID");
  if (chain === 0) throw Error("Zero chain ID");
  return keccak256(
    abi.encode(
      ["uint256", "address", "bytes32", "bytes32", "uint256"],
      [
        chain,
        address(source.manager, "manager"),
        hash(source.pool_id, "pool ID"),
        hash(source.transaction_hash, "swap transaction"),
        integer(source.log_index, "log index"),
      ],
    ),
  );
}

export function decodeSwapReceipt(receipt, registeredPool, logIndex, chainId) {
  const pool = validatePool(registeredPool);
  if (integer(receipt.status, "receipt status") !== 1)
    throw Error("Swap transaction failed");
  const index = integer(logIndex, "log index");
  const txHash = hash(
    receipt.hash ?? receipt.transactionHash,
    "receipt transaction",
  );
  const blockNumber = integer(receipt.blockNumber, "receipt block");
  const blockHash = hash(receipt.blockHash, "receipt block hash");
  if (!Array.isArray(receipt.logs)) throw Error("Receipt logs missing");
  const matches = receipt.logs.filter(
    (log) => integer(log.index ?? log.logIndex, "receipt log index") === index,
  );
  if (matches.length !== 1) throw Error("Swap log absent or duplicated");
  const log = matches[0];
  if (
    log.removed === true ||
    address(log.address, "log emitter") !== pool.manager
  )
    throw Error("Wrong manager or removed swap log");
  if (
    log.transactionHash != null &&
    hash(log.transactionHash, "log transaction") !== txHash
  )
    throw Error("Log transaction mismatch");
  if (
    log.blockHash != null &&
    hash(log.blockHash, "log block hash") !== blockHash
  )
    throw Error("Log block mismatch");
  if (
    log.blockNumber != null &&
    integer(log.blockNumber, "log block") !== blockNumber
  )
    throw Error("Log block number mismatch");
  if (
    !Array.isArray(log.topics) ||
    log.topics.length !== 3 ||
    hash(log.topics[0], "event topic") !== SWAP_TOPIC ||
    hash(log.topics[1], "event pool") !== pool.pool_id
  )
    throw Error("Wrong Swap event or pool ID");
  const parsed = iface.parseLog(log);
  if (!parsed || parsed.name !== "Swap") throw Error("Invalid Swap ABI");
  const encoded = iface.encodeEventLog(iface.getEvent("Swap"), parsed.args);
  if (
    typeof log.data !== "string" ||
    encoded.data !== log.data.toLowerCase() ||
    encoded.topics.some((topic, i) => topic !== log.topics[i].toLowerCase())
  )
    throw Error("Noncanonical Swap ABI");
  const source = {
    manager: pool.manager,
    pool_id: pool.pool_id,
    transaction_hash: txHash,
    log_index: BigInt(index),
  };
  return {
    kind: "swap",
    id: swapSourceId(chainId, source),
    txHash,
    logIndex: index,
    blockNumber,
    blockHash,
    source,
    context: {
      sender: parsed.args.sender.toLowerCase(),
      amount0: parsed.args.amount0.toString(),
      amount1: parsed.args.amount1.toString(),
      sqrt_price_x96: parsed.args.sqrtPriceX96.toString(),
      liquidity: parsed.args.liquidity.toString(),
      tick: Number(parsed.args.tick),
      fee: Number(parsed.args.fee),
    },
    state: "queued",
  };
}

/// Caller selects a confirmed upper block. Receipts are checked again here;
/// the ICP coordinator remains responsible for independent source verification.
export async function scanSwaps(
  provider,
  registeredPools,
  fromBlock,
  toBlock,
  chainId,
) {
  const from = integer(fromBlock, "scan start");
  const to = integer(toBlock, "scan end");
  if (to < from || to - from + 1 > MAX_SCAN_BLOCKS)
    throw Error(`Scan range must contain 1-${MAX_SCAN_BLOCKS} blocks`);
  if (!Array.isArray(registeredPools) || registeredPools.length === 0)
    throw Error("No registered swap sources");
  const pools = registeredPools.map((pool) => validatePool(pool));
  const registered = new Map(
    pools.map((pool) => [`${pool.manager}:${pool.pool_id}`, pool]),
  );
  if (registered.size !== pools.length) throw Error("Duplicate source pool");
  const groups = new Map();
  for (const pool of pools) {
    if (!groups.has(pool.manager)) groups.set(pool.manager, []);
    groups.get(pool.manager).push(pool.pool_id);
  }
  const logs = [];
  for (const [manager, poolIds] of groups) {
    logs.push(
      ...(await provider.getLogs({
        address: manager,
        topics: [SWAP_TOPIC, poolIds],
        fromBlock: from,
        toBlock: to,
      })),
    );
  }
  const receipts = new Map();
  const jobs = new Map();
  for (const log of logs) {
    const manager = address(log.address, "scan log manager");
    const poolId = hash(log.topics?.[1], "scan log pool");
    const pool = registered.get(`${manager}:${poolId}`);
    if (!pool) throw Error("RPC returned an unregistered swap source");
    const txHash = hash(log.transactionHash, "scan transaction");
    if (!receipts.has(txHash))
      receipts.set(txHash, await provider.getTransactionReceipt(txHash));
    const receipt = receipts.get(txHash);
    if (
      !receipt ||
      hash(receipt.hash ?? receipt.transactionHash, "receipt transaction") !==
        txHash
    )
      throw Error("Scanned swap receipt absent or mismatched");
    const job = decodeSwapReceipt(
      receipt,
      pool,
      log.index ?? log.logIndex,
      chainId,
    );
    if (job.blockNumber < from || job.blockNumber > to)
      throw Error("Receipt outside scan range");
    if (
      log.blockHash != null &&
      hash(log.blockHash, "scanned block hash") !== job.blockHash
    )
      throw Error("Scanned log was reorged");
    jobs.set(job.id, job);
  }
  return [...jobs.values()].sort(
    (a, b) =>
      a.blockNumber - b.blockNumber ||
      a.logIndex - b.logIndex ||
      a.id.localeCompare(b.id),
  );
}
