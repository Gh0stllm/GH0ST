const phases = ["Verified", "Running", "ReadyToSign", "Complete"];
const count = value => {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) return BigInt(value);
  return null;
};

// Capture values before the ingress call: callers and test adapters may reuse
// the returned job object. Cost changes alone never establish model progress.
export function generationProgress(job) {
  const voice = job?.voice?.[0];
  return {
    id: job?.request?.id,
    phase: Object.keys(job?.phase ?? {})[0],
    input: count(job?.input_tokens),
    output: count(job?.output_tokens),
    ingested: job?.prompt_ingested === true,
    generation: count(voice?.generation?.[0] ?? voice?.attempt ?? 1),
  };
}

// Only remove the between-step pause while the same generation is making
// confirmed progress. Completion, waits and recovery retain normal polling.
export function canContinueGeneration(before, job, nowMs = Date.now()) {
  const after = generationProgress(job), recovery = job?.recovery?.[0];
  if (job?.busy !== false || !["Running", "ReadyToSign"].includes(after.phase) ||
      !before.id || before.id !== after.id || before.generation !== after.generation ||
      before.generation === null || after.generation === null ||
      before.input === null || before.output === null || after.input === null || after.output === null ||
      after.input < before.input || after.output < before.output ||
      (before.ingested && !after.ingested) ||
      recovery && (recovery.requires_owner || recovery.accounting_uncertain || recovery.parked ||
        Number(recovery.retry_after) > Math.floor(nowMs / 1000))) return false;
  const earlier = phases.indexOf(before.phase), later = phases.indexOf(after.phase);
  if (earlier < 0 || later < earlier) return false;
  return later > earlier || after.input > before.input || after.output > before.output ||
    (!before.ingested && after.ingested);
}
