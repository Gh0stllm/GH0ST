import { getAddress, getCreateAddress, parseUnits, Transaction, toQuantity } from "ethers";

export const RH_CHAIN_ID = 4663n;

export function requireAddress(value, label) {
  if (typeof value !== "string") throw Error(`Missing ${label}`);
  const address = getAddress(value);
  if (BigInt(address) === 0n) throw Error(`${label} cannot be the zero address`);
  return address;
}

export function requireHash(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value) || BigInt(value) === 0n)
    throw Error(`Invalid or missing ${label}`);
  return value.toLowerCase();
}

export async function assertRhChain(provider) {
  if (BigInt(await provider.send("eth_chainId", [])) !== RH_CHAIN_ID)
    throw Error("Refusing transaction preparation: RPC is not Robinhood chain 4663");
}

export function paddedGas(estimate, cap = 5_000_000n) {
  const gas = BigInt(estimate);
  if (gas <= 0n) throw Error("Gas estimate must be positive");
  const limit = (gas * 120n + 99n) / 100n;
  if (limit > BigInt(cap)) throw Error("Padded gas estimate exceeds gas-limit cap");
  return limit;
}

export async function prepareUnsigned(provider, { owner, to, data, feeCapGwei, nonce, gasLimitCap = 5_000_000n }) {
  const from = requireAddress(owner, "owner");
  if (to != null) to = requireAddress(to, "transaction destination");
  if (typeof data !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(data))
    throw Error("Missing or invalid transaction calldata");
  if (feeCapGwei == null) throw Error("Missing explicit --fee-cap-gwei");
  const feeCap = parseUnits(String(feeCapGwei), "gwei");
  if (feeCap <= 0n) throw Error("Fee cap must be positive");
  await assertRhChain(provider);
  const fees = await provider.getFeeData();
  if (fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null)
    throw Error("RPC did not provide EIP-1559 fee data");
  if (fees.maxFeePerGas > feeCap)
    throw Error("Current suggested max fee exceeds explicit fee cap");
  if (fees.maxPriorityFeePerGas < 0n || fees.maxPriorityFeePerGas > fees.maxFeePerGas)
    throw Error("Invalid priority fee returned by RPC");
  const base = { from, ...(to ? { to } : {}), data, value: 0n };
  const gasEstimate = await provider.estimateGas(base);
  const gasLimit = paddedGas(gasEstimate, gasLimitCap);
  const nextNonce = nonce ?? await provider.getTransactionCount(from, "pending");
  if (!Number.isSafeInteger(nextNonce) || nextNonce < 0) throw Error("Invalid pending nonce");
  const maxCostWei = gasLimit * fees.maxFeePerGas;
  const balanceWei = await provider.getBalance(from);
  if (balanceWei < maxCostWei) throw Error("Owner balance is below the maximum transaction cost");
  const transaction = {
    type: 2, chainId: RH_CHAIN_ID, nonce: nextNonce,
    to: to ?? null, data, value: 0n, gasLimit,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  };
  const unsigned = Transaction.from(transaction);
  const walletTransaction = {
    from, ...(to ? { to } : {}), data, value: "0x0", type: "0x2",
    chainId: toQuantity(RH_CHAIN_ID), nonce: toQuantity(nextNonce),
    gas: toQuantity(gasLimit), maxFeePerGas: toQuantity(fees.maxFeePerGas),
    maxPriorityFeePerGas: toQuantity(fees.maxPriorityFeePerGas),
  };
  return {
    walletRequest: { method: "eth_sendTransaction", params: [walletTransaction] },
    unsignedSerialized: unsigned.unsignedSerialized,
    unsignedHash: unsigned.unsignedHash,
    ...(to ? {} : { predictedGateway: getCreateAddress({ from, nonce: nextNonce }) }),
    cost: { gasEstimate, gasLimit, maxFeePerGas: fees.maxFeePerGas, maxCostWei, balanceWei },
    nonce: nextNonce,
  };
}

export function sameRuntime(artifact, actualCode) {
  const expected = Buffer.from(artifact.evm.deployedBytecode.object, "hex");
  const actual = Buffer.from(actualCode.replace(/^0x/, ""), "hex");
  if (!actual.length || actual.length !== expected.length) return false;
  const references = artifact.evm.deployedBytecode.immutableReferences;
  if (references == null) throw Error("Compile output lacks immutable references");
  for (const entries of Object.values(references)) {
    for (const { start, length } of entries) {
      if (start < 0 || length < 0 || start + length > expected.length)
        throw Error("Invalid immutable reference in build artifact");
      expected.copy(actual, start, start, start + length);
    }
  }
  return actual.equals(expected);
}

export function receiptCost(receipt) {
  const gasUsed = BigInt(receipt.gasUsed);
  const gasPrice = BigInt(receipt.effectiveGasPrice ?? receipt.gasPrice);
  if (gasUsed < 0n || gasPrice < 0n) throw Error("Invalid receipt cost");
  return { gasUsed, effectiveGasPrice: gasPrice, feeWei: gasUsed * gasPrice };
}

export async function confirmedReceipt(provider, txHash, confirmations = 12) {
  requireHash(txHash, "transaction hash");
  if (!Number.isSafeInteger(confirmations) || confirmations < 1)
    throw Error("Confirmations must be a positive integer");
  await assertRhChain(provider);
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) throw Error("Transaction receipt is not available yet");
  if (Number(receipt.status) !== 1) throw Error("Transaction reverted");
  const block = await provider.getBlock(receipt.blockNumber);
  if (!block || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase())
    throw Error("Transaction receipt is not on the canonical chain");
  const head = await provider.getBlockNumber();
  if (head - receipt.blockNumber < confirmations)
    throw Error(`Receipt needs ${confirmations} descendant blocks; currently ${head - receipt.blockNumber}`);
  return receipt;
}
