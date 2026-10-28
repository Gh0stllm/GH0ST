import { keccak256, toUtf8Bytes } from "ethers";

export function inspectFulfillment(
  receipt,
  canonicalBlock,
  gatewayAddress,
  iface,
  requestId,
  expectedHash,
  expectedAnswer,
  safeBlock,
) {
  if (
    !receipt ||
    Number(receipt.status) !== 1 ||
    receipt.blockNumber > safeBlock ||
    !canonicalBlock ||
    canonicalBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase()
  )
    return null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== gatewayAddress.toLowerCase()) continue;
    let event;
    try {
      event = iface.parseLog(log);
    } catch {
      continue;
    }
    if (
      event?.name !== "InferenceFulfilled" ||
      event.args.requestId !== requestId
    )
      continue;
    if (
      keccak256(toUtf8Bytes(event.args.answer)) !== event.args.answerHash ||
      (expectedHash && event.args.answerHash !== expectedHash) ||
      (expectedAnswer !== undefined && event.args.answer !== expectedAnswer)
    )
      throw Error(
        "Confirmed callback answer differs from the committed result",
      );
    const logIndex = Number(log.index ?? log.logIndex);
    if (!Number.isSafeInteger(logIndex) || logIndex < 0)
      throw Error("Callback log index is missing");
    const gasUsed = receipt.gasUsed == null ? null : BigInt(receipt.gasUsed);
    const gasPrice = receipt.effectiveGasPrice ?? receipt.gasPrice;
    const fee = gasUsed != null && gasPrice != null
      ? gasUsed * BigInt(gasPrice)
      : receipt.fee == null ? null : BigInt(receipt.fee);
    if ((gasUsed != null && gasUsed < 0n) || (fee != null && fee < 0n))
      throw Error("Invalid callback receipt cost");
    return {
      confirmed: true,
      transactionHash: receipt.hash ?? receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      answer: event.args.answer,
      answerHash: event.args.answerHash,
      logIndex,
      ...(gasUsed == null ? {} : { gasUsed: gasUsed.toString() }),
      ...(fee == null ? {} : { feeWei: fee.toString() }),
    };
  }
  throw Error(
    "Successful callback receipt lacks the expected fulfillment event",
  );
}

export async function findFulfillment(
  provider,
  gateway,
  item,
  expectedHash,
  expectedAnswer,
  safeBlock,
  startBlock,
) {
  const address = await gateway.getAddress();
  const inspect = async (receipt) => {
    if (!receipt || receipt.blockNumber > safeBlock) return null;
    return inspectFulfillment(
      receipt,
      await provider.getBlock(receipt.blockNumber),
      address,
      gateway.interface,
      item.id,
      expectedHash,
      expectedAnswer,
      safeBlock,
    );
  };
  if (item.transactionHash) {
    const receipt = await provider.getTransactionReceipt(item.transactionHash);
    if (receipt && Number(receipt.status) === 1) return inspect(receipt);
  }
  const from = item.deliveryScanNext ?? item.blockNumber ?? startBlock;
  if (from > safeBlock) return null;
  const end = Math.min(safeBlock, from + 249);
  const logs = await gateway.queryFilter(
    gateway.filters.InferenceFulfilled(item.id),
    from,
    end,
  );
  for (const log of logs) {
    const found = await inspect(
      await provider.getTransactionReceipt(log.transactionHash),
    );
    if (found) return found;
  }
  item.deliveryScanNext = end + 1;
  return null;
}
