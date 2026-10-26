import { keccak256, toUtf8Bytes } from "ethers";
import { unwrap } from "./journal.mjs";

export async function acknowledgeVoice(item, job, coordinator) {
  if (item.memoryAcknowledged) return;
  if (!job || job.request.id !== item.id)
    throw Error("Voice memory job identity mismatch");
  const voice = job.voice?.[0];
  if (item.kind !== "swap" || !voice) {
    item.memoryAcknowledged = true;
    item.memorySkipped = "explicit_or_legacy_job";
    return;
  }
  if (voice.remembered) {
    item.memoryAcknowledged = true;
    return;
  }
  const delivery = item.delivery;
  if (
    !("Complete" in job.phase) ||
    !delivery?.confirmed ||
    !/^0x[0-9a-fA-F]{64}$/.test(delivery.transactionHash ?? "") ||
    !Number.isSafeInteger(delivery.logIndex) ||
    delivery.logIndex < 0 ||
    delivery.answer !== job.answer ||
    delivery.answerHash !== keccak256(toUtf8Bytes(job.answer))
  )
    throw Error("Confirmed voice delivery proof is incomplete or mismatched");
  unwrap(
    await coordinator.remember_delivered(
      item.id,
      delivery.transactionHash,
      BigInt(delivery.logIndex),
    ),
  );
  item.memoryAcknowledged = true;
}
