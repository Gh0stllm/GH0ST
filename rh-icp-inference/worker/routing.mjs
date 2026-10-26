import { swapSourceId } from "./swaps.mjs";

export function callbackFor(item, job, chainId, signed) {
  if (item.id !== job.request.id || item.id !== signed.result.requestId)
    throw Error("Queued, generated and signed request identities differ");
  const source = job.source?.[0];
  if (item.kind === "swap") {
    if (
      !source ||
      swapSourceId(chainId, source) !== item.id ||
      job.request.id !== item.id
    )
      throw Error("Signed job does not match the queued swap source");
    if (item.source && swapSourceId(chainId, item.source) !== item.id)
      throw Error("Queued swap source is inconsistent");
    return {
      method: "fulfillSwapInference",
      args: [
        {
          manager: source.manager,
          poolId: source.pool_id,
          transactionHash: source.transaction_hash,
          logIndex: source.log_index,
        },
        signed.result,
        signed.answer,
        signed.signature,
      ],
    };
  }
  if (source)
    throw Error("Swap result cannot use the explicit-request callback");
  return {
    method: "fulfillInference",
    args: [signed.result, signed.answer, signed.signature],
  };
}
