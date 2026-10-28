// An optional exact source selector for a single measured swap. Both fields
// are required so a multi-swap transaction cannot silently queue extra jobs.
export function parseSwapTarget(env) {
  const transactionHash = env.TARGET_SWAP_TX_HASH?.trim() ?? "";
  const index = env.TARGET_SWAP_LOG_INDEX?.trim() ?? "";
  if (!transactionHash && !index) return null;
  if (!transactionHash || !index)
    throw Error("Set both TARGET_SWAP_TX_HASH and TARGET_SWAP_LOG_INDEX");
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash) || /^0x0{64}$/.test(transactionHash))
    throw Error("Invalid TARGET_SWAP_TX_HASH");
  if (!/^(0|[1-9][0-9]*)$/.test(index) || !Number.isSafeInteger(Number(index)))
    throw Error("Invalid TARGET_SWAP_LOG_INDEX; use a nonnegative decimal integer");
  return { transactionHash: transactionHash.toLowerCase(), logIndex: Number(index) };
}

export function matchesSwapTarget(item, target) {
  if (!target) return true;
  return item.kind === "swap" &&
    typeof item.txHash === "string" &&
    item.txHash.toLowerCase() === target.transactionHash &&
    item.logIndex === target.logIndex;
}
