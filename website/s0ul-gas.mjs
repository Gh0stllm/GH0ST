// Read-only forecasting only. Actual transactions must be estimated again against
// current chain state and signed by the connected wallet. This is not a fee oracle
// or an on-chain spending restriction.
export const OPERATIONAL_GAS_CAP = 31_000_000n;
export const DEFAULT_FINALIZE_GAS = 1_000_000n;
export const DEFAULT_CANCEL_GAS = 250_000n;
const BPS = 10_000n;
const CONTROLLER_OVERHEAD = 100_000n;

export const CALIBRATION = Object.freeze({
  version: 's0ul-mainnet-envelope-v1',
  maxProcessedPosition: 8,
  configuration: Object.freeze({ vocabSize: 512, dim: 128, layers: 4, heads: 4, hiddenDim: 640, maxSeqLen: 128 }),
  sources: Object.freeze([
    's0ul-1m/reports/robinhood-mainnet-inference-check.json',
    's0ul-1m/reports/robinhood-mainnet-agent-check.json',
  ]),
  measuredWaitGas: 892_989_640n,
  measuredMemoryInferenceGas: 1_628_964_578n,
  // Historical receipt gas includes its historical parent-chain posting charge.
  // Do not add another L1 fee to these all-in profiles or to eth_estimateGas.
  includesHistoricalPostingGas: true,
  guaranteed: false,
});

// Maximum observed individual phase costs across the 397 WAIT advance receipts.
// The attention envelope also covers every four-head attention batch in the
// second mainnet request through position 8. Longer contexts are extrapolation.
const PHASE_GAS = Object.freeze({
  1: 593_647n, 2: 851_168n, 3: 2_984_295n, 4: 2_991_801n,
  5: 2_992_983n, 6: 476_790n, 7: 1_491_486n, 9: 2_993_100n,
  10: 861_138n, 11: 3_006_198n, 12: 11_927_948n,
  13: 353_372n, 14: 579_093n, 15: 3_020_101n, 16: 412_013n,
});

function uint(value, name, minimum = 0n) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new RangeError(name + ' must be a safe integer');
  if (!['number', 'bigint', 'string'].includes(typeof value) || value === '') throw new TypeError(name + ' must be an integer');
  let result;
  try { result = BigInt(value); } catch { throw new TypeError(name + ' must be an integer'); }
  if (result < minimum) throw new RangeError(name + ' is out of range');
  return result;
}

function count(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  const result = uint(value, name);
  if (result > BigInt(maximum)) throw new RangeError(name + ' is out of range');
  return Number(result);
}

const ceil = (value, divisor) => (value + divisor - 1n) / divisor;
function margin(value, bps) { return ceil(value * (BPS + BigInt(bps)), BPS); }

function inputs(options) {
  if (!options || typeof options !== 'object') throw new TypeError('Forecast options are required');
  const configuration = options.configuration;
  if (!configuration) throw new TypeError('Read and supply the pinned engine configuration');
  const cfg = {};
  for (const [key, expected] of Object.entries(CALIBRATION.configuration)) {
    cfg[key] = count(configuration[key], 'configuration.' + key, 65535);
    if (cfg[key] !== expected) throw new RangeError('The gas profile does not cover this model configuration');
  }
  const P = count(options.promptTokens, 'promptTokens', cfg.maxSeqLen);
  const N = count(options.maxNewTokens, 'maxNewTokens', 32);
  if (P < 3 || N < 2 || P + N > cfg.maxSeqLen) throw new RangeError('Prompt and output budget exceed the agent context limits');
  const T = P + N - 1;
  const extrapolated = T - 1 > CALIBRATION.maxProcessedPosition;
  const requestedMargin = count(options.gasMarginBps ?? 2500, 'gasMarginBps', 100_000);
  // There are only two measured requests. Use an additional cushion when going
  // beyond their observed positions, without representing it as a hard bound.
  const gasMarginBps = Math.max(requestedMargin, extrapolated ? 5000 : 2500);
  const gasPriceWei = uint(options.gasPriceWei, 'gasPriceWei', 1n);
  const feeCeilingWeiPerGas = uint(options.feeCeilingWeiPerGas ?? ceil(gasPriceWei * 3n, 2n), 'feeCeilingWeiPerGas', 1n);
  if (feeCeilingWeiPerGas < gasPriceWei) throw new RangeError('Fee ceiling is below the current gas price');
  const blockGasLimit = uint(options.blockGasLimit, 'blockGasLimit', 1n);
  const operationalCap = uint(options.operationalGasCap ?? OPERATIONAL_GAS_CAP, 'operationalGasCap', 1n);
  const transactionGasCap = operationalCap < blockGasLimit ? operationalCap : blockGasLimit;
  const rows = 128;
  const positionCalls = 1 + cfg.layers * (5 * Math.ceil(cfg.dim / rows) + Math.ceil(cfg.hiddenDim / rows) + cfg.heads + 5);
  const decisionCalls = 2 + Math.ceil(cfg.vocabSize / rows);
  return { cfg, P, N, T, gasMarginBps, extrapolated, gasPriceWei, feeCeilingWeiPerGas, transactionGasCap, positionCalls, decisionCalls };
}

function workSchedule(P, N, cfg) {
  const work = [];
  const add = (phase, position, layer = 0, row = 0, head = 0) => work.push({ phase, position, layer, row, head,
    generated: Math.max(0, position - P + 1), gas: phase === 8 ? 550_000n + 112_000n * BigInt(position) : PHASE_GAS[phase] });
  for (let p = 0; p < P + N - 1; ++p) {
    add(1, p);
    for (let l = 0; l < cfg.layers; ++l) {
      for (const phase of [2, 3, 4, 5, 6, 7]) add(phase, p, l);
      for (let head = 0; head < cfg.heads; ++head) add(8, p, l, 0, head);
      add(9, p, l); add(10, p, l);
      for (let row = 0; row < cfg.hiddenDim; row += 128) add(11, p, l, row);
      add(12, p, l); add(13, p, l);
    }
    if (p >= P - 1) {
      add(14, p, cfg.layers - 1);
      for (let row = 0; row < cfg.vocabSize; row += 128) add(15, p, cfg.layers - 1, row);
      add(16, p, cfg.layers - 1);
    }
  }
  return work;
}

function batches(work, cap = null) {
  let index = 0, transactions = 0;
  while (index < work.length) {
    let steps = 0, gas = CONTROLLER_OVERHEAD;
    while (steps < 4 && index < work.length) {
      if (steps > 0 && work[index].phase === 16) break; // Preserve the ready logits.
      const candidate = gas + work[index].gas;
      if (cap !== null && margin(candidate, 2000) > cap) {
        if (steps === 0) return { transactions: null, feasible: false, blockingPhase: work[index].phase };
        break;
      }
      gas = candidate; ++steps; ++index;
    }
    ++transactions;
  }
  return { transactions, feasible: true, blockingPhase: null };
}

function forecast(options, normal, work, { begin, finalized = false, completed = 0 } = {}) {
  const beginGas = begin ? uint(options.beginGas, 'beginGas', 1n) : 0n;
  const finalizeGas = finalized ? 0n : uint(options.finalizeGas ?? DEFAULT_FINALIZE_GAS, 'finalizeGas');
  const extraGas = uint(options.extraGas ?? 0n, 'extraGas');
  const extraTransactions = count(options.extraTransactions ?? (extraGas > 0n ? 1 : 0), 'extraTransactions', 1000);
  const cancellationReserveGas = finalized || options.includeCancellationReserve === false ? 0n : DEFAULT_CANCEL_GAS;
  const ideal = batches(work);
  const fitted = batches(work, normal.transactionGasCap);
  const phaseGas = work.reduce((sum, step) => sum + step.gas, 0n);
  // Reserve controller overhead even if every logical step needs its own tx.
  // A successful four-step batch will usually cost less than this forecast.
  const controllerOverheadGas = BigInt(work.length) * CONTROLLER_OVERHEAD;
  const inferenceGas = phaseGas + controllerOverheadGas;
  const baseGas = beginGas + inferenceGas + finalizeGas + extraGas;
  const totalGas = margin(baseGas, normal.gasMarginBps) + cancellationReserveGas;
  const extraCount = Number(begin) + Number(finalizeGas > 0n) + extraTransactions;
  return {
    method: CALIBRATION.version,
    guaranteed: false,
    promptTokens: normal.P,
    maxNewTokens: normal.N,
    processedPositions: normal.T,
    maxProcessedPosition: normal.T - 1,
    positionCalls: normal.positionCalls,
    decisionCalls: normal.decisionCalls,
    totalLogicalCalls: normal.positionCalls * normal.T + normal.decisionCalls * normal.N,
    completedLogicalCalls: completed,
    logicalCalls: work.length,
    idealBatchTransactions: ideal.transactions,
    estimatedBatchTransactions: fitted.transactions,
    maxBatchTransactions: work.length,
    totalTransactionsIdeal: ideal.transactions + extraCount,
    totalTransactionsEstimated: fitted.transactions === null ? null : fitted.transactions + extraCount,
    totalTransactionsMax: work.length + extraCount,
    feasible: fitted.feasible,
    blockingPhase: fitted.blockingPhase,
    transactionGasCap: normal.transactionGasCap,
    phaseGas,
    controllerOverheadGas,
    inferenceGas,
    beginGas,
    finalizeGas,
    extraGas,
    baseGas,
    estimatedGas: baseGas,
    gasMarginBps: normal.gasMarginBps,
    cancellationReserveGas,
    totalGas,
    gasPriceWei: normal.gasPriceWei,
    feeCeilingWeiPerGas: normal.feeCeilingWeiPerGas,
    estimatedFeeWei: baseGas * normal.gasPriceWei,
    budgetFeeWei: totalGas * normal.feeCeilingWeiPerGas,
    extrapolated: normal.extrapolated,
    calibrationMaxProcessedPosition: CALIBRATION.maxProcessedPosition,
    includesHistoricalPostingGas: true,
  };
}

/** Forecast the complete job before beginConstrained is sent. N includes EOS. */
export function planGas(options) {
  const normal = inputs(options);
  return forecast(options, normal, workSchedule(normal.P, normal.N, normal.cfg), { begin: true });
}

/** Forecast only unexecuted work from an independently read engine status. */
export function forecastRemaining(options) {
  const status = options?.status;
  if (!status) throw new TypeError('An engine status snapshot is required');
  const opts = { ...options, promptTokens: options.promptTokens ?? status.promptLength,
    maxNewTokens: options.maxNewTokens ?? status.maxNewTokens };
  const normal = inputs(opts), work = workSchedule(normal.P, normal.N, normal.cfg);
  if (count(status.promptLength, 'status.promptLength') !== normal.P
      || count(status.maxNewTokens, 'status.maxNewTokens') !== normal.N) throw new RangeError('Status does not match the quoted request');
  const phase = count(status.phase, 'status.phase', 18);
  if (status.cancelled || phase === 18) throw new RangeError('The engine request is cancelled');
  if (status.done) {
    if (phase !== 17) throw new RangeError('Inconsistent completed engine state');
    const generated = count(status.generated, 'status.generated', normal.N);
    if (generated === 0) throw new RangeError('A completed engine request must have an output');
    const completed = normal.positionCalls * (normal.P + generated - 1) + normal.decisionCalls * generated;
    return forecast(opts, normal, [], { begin: false, finalized: Boolean(options.finalized), completed });
  }
  if (options.finalized) throw new RangeError('An unfinished request cannot be finalized');
  const fields = ['position', 'layer', 'row', 'head', 'generated'];
  const match = Object.fromEntries(fields.map(key => [key, count(status[key], 'status.' + key, 65535)]));
  const index = work.findIndex(step => step.phase === phase && fields.every(key => step[key] === match[key]));
  if (index < 0) throw new RangeError('Engine status does not match the pinned phase schedule');
  return forecast(opts, normal, work.slice(index), { begin: false, completed: index });
}

/** Do not silently clamp below the requested safety margin: try fewer steps. */
export function paddedGasLimit(estimate, { marginBps = 2000, cap = OPERATIONAL_GAS_CAP } = {}) {
  const value = uint(estimate, 'estimate', 1n);
  const result = margin(value, count(marginBps, 'marginBps', 100_000));
  if (result > uint(cap, 'cap', 1n)) throw new RangeError('Padded transaction gas exceeds the cap; reduce the batch');
  return result;
}

/** A browser guard; the immutable deployed controller does not enforce this cap. */
export function checkSpendBudget({ spentWei, pendingReserveWei = 0n, gasLimit, maxFeePerGas, budgetWei }) {
  const spent = uint(spentWei, 'spentWei'), pending = uint(pendingReserveWei, 'pendingReserveWei');
  const budget = uint(budgetWei, 'budgetWei');
  const nextReserveWei = uint(gasLimit, 'gasLimit', 1n) * uint(maxFeePerGas, 'maxFeePerGas', 1n);
  const remainingWei = budget > spent + pending ? budget - spent - pending : 0n;
  const totalReservedWei = spent + pending + nextReserveWei;
  return { allowed: totalReservedWei <= budget, nextReserveWei, totalReservedWei, remainingWei,
    shortfallWei: totalReservedWei > budget ? totalReservedWei - budget : 0n };
}
