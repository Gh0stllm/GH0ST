// Publication and ingress ambiguity must stay recoverable even when ordinary
// model failures are skipped. These predicates never submit or retry a call.
export function publicationUncertain(item) {
  const publication = item.publication;
  if (publication && ((publication.attempt ?? 0) > 0 || publication.startedAt != null ||
      publication.postId != null || publication.httpStatus != null ||
      !["ready", "disabled"].includes(publication.status))) return true;
  return ["uploading", "upload_received", "metadata_sending", "blocked", "needs_reconciliation"]
    .includes(item.media?.status);
}

export function deliveryUncertain(item) {
  return item.delivery?.confirmed !== true && Boolean(item.rawTransaction || item.transactionHash ||
    ["awaiting_confirmation", "callback_reverted"].includes(item.state));
}

export function qualityRetryReason(job) {
  const voice = job.voice?.[0];
  if (!voice) return null;
  const generation = voice.generation?.[0] ?? voice.attempt ?? 1;
  if (BigInt(generation) > 1n || (typeof voice.quality_error === "string" && voice.quality_error.length))
    return "single_attempt_policy: " + (voice.quality_error || "another model attempt was requested");
  return null;
}

export function failurePolicyDecision(item, job) {
  if (!job || job.request?.id !== item.id) throw Error("Failure policy job belongs to another source");
  const failed = Object.hasOwn(job.phase ?? {}, "Failed");
  const reason = failed ? (job.error || "model job failed") : qualityRetryReason(job);
  if (!reason) return { action: "continue" };
  if (job.busy !== false) return { action: "wait", reason: "job_in_flight" };
  if (item.pendingUpdate || item.pendingResume || item.buyHalt)
    return { action: "wait", reason: "unresolved_ingress" };
  if (job.recovery?.some(value => value.accounting_uncertain))
    return { action: "wait", reason: "uncertain_model_accounting" };
  if (deliveryUncertain(item)) return { action: "wait", reason: "unresolved_delivery" };
  if (publicationUncertain(item)) return { action: "wait", reason: "unresolved_publication" };
  const actualCycles = String(job.model_cycles);
  if (!/^(0|[1-9]\d*)$/.test(actualCycles)) throw Error("Invalid settled model cost");
  return { action: failed ? "settle_failed" : Object.hasOwn(job.phase, "Complete") ? "reject_result" : "abort",
    reason, actualCycles };
}
