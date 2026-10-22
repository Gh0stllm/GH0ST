import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CALIBRATION, DEFAULT_CANCEL_GAS, DEFAULT_FINALIZE_GAS,
  OPERATIONAL_GAS_CAP, planGas, forecastRemaining, paddedGasLimit, checkSpendBudget,
} from '../website/s0ul-gas.mjs';

const opts = (overrides = {}) => ({
  promptTokens: 5, maxNewTokens: 5, configuration: { ...CALIBRATION.configuration },
  beginGas: 600_000n, gasPriceWei: 1_000_000_000n, blockGasLimit: 32_000_000n, ...overrides,
});

// Independently follow the deployed Solidity phase transitions with maxRows=128.
// This catches a remaining-work forecast that accepts only an initial snapshot.
function engineStates(P, N) {
  const s = { phase: 1, position: 0, layer: 0, row: 0, head: 0,
    generated: 0, promptLength: P, maxNewTokens: N, done: false, cancelled: false };
  const states = [];
  while (!s.done) {
    states.push({ ...s });
    switch (s.phase) {
      case 1: s.layer = 0; s.row = 0; s.head = 0; s.phase = 2; break;
      case 2: s.phase = 3; break;
      case 3: s.phase = 4; break;
      case 4: s.phase = 5; break;
      case 5: s.phase = 6; break;
      case 6: s.phase = 7; break;
      case 7: s.head = 0; s.phase = 8; break;
      case 8: if (++s.head === 4) { s.head = 0; s.phase = 9; } break;
      case 9: s.phase = 10; break;
      case 10: s.phase = 11; break;
      case 11: s.row += 128; if (s.row === 640) { s.row = 0; s.phase = 12; } break;
      case 12: s.phase = 13; break;
      case 13:
        if (++s.layer < 4) s.phase = 2;
        else { s.layer = 3; if (s.position + 1 < P) { ++s.position; s.layer = 0; s.phase = 1; }
          else s.phase = 14; }
        break;
      case 14: s.phase = 15; break;
      case 15: s.row += 128; if (s.row === 512) { s.row = 0; s.phase = 16; } break;
      case 16:
        ++s.generated;
        if (s.generated === N) { s.done = true; s.phase = 17; }
        else { ++s.position; s.layer = 0; s.phase = 1; }
        break;
      default: throw new Error('Unexpected fixture phase');
    }
  }
  return { states, done: { ...s } };
}

test('whole-job work matches both verified mainnet runs and includes all output decisions', async () => {
  const [wait, memory] = await Promise.all([
    readFile(new URL('../s0ul-1m/reports/robinhood-mainnet-inference-check.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../s0ul-1m/reports/robinhood-mainnet-agent-check.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);
  for (const [report, expected] of [[wait, 397], [memory, 723]]) {
    const P = report.prompt_ids.length, N = report.generated_token_ids.length;
    const q = planGas(opts({ promptTokens: P, maxNewTokens: N }));
    assert.equal(q.positionCalls, 77);
    assert.equal(q.decisionCalls, 6);
    assert.equal(q.totalLogicalCalls, 77 * (P + N - 1) + 6 * N);
    assert.equal(q.logicalCalls, expected);
    assert.equal(q.completedLogicalCalls, 0);
    assert.equal(q.maxBatchTransactions, expected);
  }
});

test('four-step transaction counts preserve the Select boundary and include begin/finalize', () => {
  const q = planGas(opts());
  assert.equal(q.idealBatchTransactions, 183);
  assert.equal(q.totalTransactionsIdeal, 185);
  assert.ok(q.idealBatchTransactions > Math.ceil(q.logicalCalls / 4));
  assert.equal(q.totalTransactionsMax, 725);
  const wait = planGas(opts({ promptTokens: 4, maxNewTokens: 2 }));
  assert.equal(wait.idealBatchTransactions, 101);
  assert.equal(wait.totalTransactionsIdeal, 103);
  const extra = planGas(opts({ extraGas: 700_000n, extraTransactions: 2 }));
  assert.equal(extra.totalTransactionsIdeal, 187);
  assert.equal(extra.baseGas - q.baseGas, 700_000n);
});

test('gas uses the complete historical envelope without dividing it by four', () => {
  const wait = planGas(opts({ promptTokens: 4, maxNewTokens: 2 }));
  const memory = planGas(opts());
  assert.ok(wait.inferenceGas > CALIBRATION.measuredWaitGas);
  assert.ok(memory.inferenceGas > CALIBRATION.measuredMemoryInferenceGas);
  assert.equal(memory.controllerOverheadGas, BigInt(memory.logicalCalls) * 100_000n);
  assert.equal(memory.baseGas, memory.inferenceGas + memory.beginGas + DEFAULT_FINALIZE_GAS);
  assert.equal(memory.totalGas, (memory.baseGas * 12_500n + 9_999n) / 10_000n + DEFAULT_CANCEL_GAS);
  assert.equal(memory.estimatedFeeWei, memory.baseGas * memory.gasPriceWei);
  assert.equal(memory.budgetFeeWei, memory.totalGas * memory.feeCeilingWeiPerGas);
  assert.equal(memory.guaranteed, false);
  assert.equal(memory.includesHistoricalPostingGas, true);
});

test('calibration boundary is position eight and longer contexts get at least fifty percent padding', () => {
  const known = planGas(opts({ gasMarginBps: 0 }));
  assert.equal(known.maxProcessedPosition, 8);
  assert.equal(known.extrapolated, false);
  assert.equal(known.gasMarginBps, 2500);
  const longer = planGas(opts({ promptTokens: 6, gasMarginBps: 0 }));
  assert.equal(longer.maxProcessedPosition, 9);
  assert.equal(longer.extrapolated, true);
  assert.equal(longer.gasMarginBps, 5000);
  assert.equal(longer.guaranteed, false);
  assert.ok(longer.baseGas > known.baseGas);
  assert.equal(planGas(opts({ gasMarginBps: 7500 })).gasMarginBps, 7500);
});

test('gas caps affect fitted batch count, never the full amount of arithmetic', () => {
  const normal = planGas(opts());
  const reduced = planGas(opts({ blockGasLimit: 16_000_000n }));
  assert.equal(normal.transactionGasCap, OPERATIONAL_GAS_CAP);
  assert.equal(reduced.transactionGasCap, 16_000_000n);
  assert.ok(reduced.estimatedBatchTransactions >= normal.estimatedBatchTransactions);
  assert.equal(reduced.inferenceGas, normal.inferenceGas);
  const impossible = planGas(opts({ blockGasLimit: 10_000_000n }));
  assert.equal(impossible.feasible, false);
  assert.equal(impossible.blockingPhase, 12);
  assert.equal(impossible.estimatedBatchTransactions, null);
  assert.equal(impossible.totalTransactionsEstimated, null);
});

test('padded gas rounds up and rejects a cap instead of silently discarding its margin', () => {
  assert.equal(paddedGasLimit(1n), 2n);
  assert.equal(paddedGasLimit(25_000_000n), 30_000_000n);
  assert.throws(() => paddedGasLimit(26_000_000n), /exceeds the cap/);
  assert.throws(() => paddedGasLimit(0n));
  assert.throws(() => paddedGasLimit(Number.MAX_SAFE_INTEGER + 1));
  assert.throws(() => paddedGasLimit(100n, { marginBps: -1 }));
});

test('wei accounting stays exact above Number.MAX_SAFE_INTEGER and reserves pending spend', () => {
  const price = 9_007_199_254_740_993n;
  const q = planGas(opts({ gasPriceWei: price, feeCeilingWeiPerGas: price * 2n }));
  assert.equal(q.estimatedFeeWei, q.baseGas * price);
  assert.equal(q.budgetFeeWei, q.totalGas * price * 2n);
  const reserve = 1_200_000n * price;
  const budget = 300n + reserve;
  const exact = checkSpendBudget({ spentWei: 100n, pendingReserveWei: 200n,
    gasLimit: 1_200_000n, maxFeePerGas: price, budgetWei: budget });
  assert.equal(exact.allowed, true);
  assert.equal(exact.totalReservedWei, budget);
  assert.equal(exact.shortfallWei, 0n);
  const short = checkSpendBudget({ spentWei: 100n, pendingReserveWei: 201n,
    gasLimit: 1_200_000n, maxFeePerGas: price, budgetWei: budget });
  assert.equal(short.allowed, false);
  assert.equal(short.shortfallWei, 1n);
  const exhausted = checkSpendBudget({ spentWei: budget + 1n,
    gasLimit: 1n, maxFeePerGas: 1n, budgetWei: budget });
  assert.equal(exhausted.remainingWei, 0n);
});

test('invalid model/context/output and unsafe numeric inputs fail before quoting', () => {
  const invalid = [
    { promptTokens: 2 }, { promptTokens: 127, maxNewTokens: 2 },
    { maxNewTokens: 1 }, { maxNewTokens: 33 }, { maxNewTokens: 2.5 },
    { gasPriceWei: 0n }, { gasPriceWei: 2n, feeCeilingWeiPerGas: 1n },
    { beginGas: -1n }, { beginGas: Number.MAX_SAFE_INTEGER + 1 },
    { blockGasLimit: 0n }, { gasMarginBps: -1 },
    { configuration: { ...CALIBRATION.configuration, dim: 64 } },
    { configuration: null }, { promptTokens: '5.0' },
  ];
  for (const override of invalid) assert.throws(() => planGas(opts(override)), JSON.stringify(override, (_, v) => typeof v === 'bigint' ? String(v) : v));
  assert.equal(planGas(opts({ promptTokens: 96, maxNewTokens: 32 })).totalLogicalCalls, 77 * 127 + 192);
});

test('remaining-work forecast accepts every real phase state and deducts exact completed work', () => {
  for (const [P, N] of [[4, 2], [5, 5]]) {
    const { states } = engineStates(P, N);
    const full = planGas(opts({ promptTokens: P, maxNewTokens: N }));
    assert.equal(states.length, full.logicalCalls);
    let previous = full.baseGas;
    for (const [index, status] of states.entries()) {
      const q = forecastRemaining(opts({ promptTokens: P, maxNewTokens: N, status }));
      assert.equal(q.completedLogicalCalls, index);
      assert.equal(q.logicalCalls, full.logicalCalls - index);
      assert.equal(q.beginGas, 0n);
      assert.ok(q.baseGas < previous);
      previous = q.baseGas;
    }
  }
});

test('EOS completion uses actual generated count and only reserves unfinalized work', () => {
  const { done } = engineStates(5, 5);
  const early = { ...done, position: 4, generated: 1 };
  const q = forecastRemaining(opts({ status: early }));
  assert.equal(q.completedLogicalCalls, 77 * 5 + 6);
  assert.equal(q.logicalCalls, 0);
  assert.equal(q.totalTransactionsIdeal, 1);
  assert.equal(q.baseGas, DEFAULT_FINALIZE_GAS);
  const final = forecastRemaining(opts({ status: early, finalized: true }));
  assert.equal(final.baseGas, 0n);
  assert.equal(final.totalGas, 0n);
  assert.equal(final.totalTransactionsIdeal, 0);
});

test('remaining forecasts reject stale, mismatched, cancelled, or impossible snapshots', () => {
  const s = engineStates(5, 5).states[0];
  for (const status of [
    { ...s, promptLength: 4 }, { ...s, maxNewTokens: 2 }, { ...s, phase: 18 },
    { ...s, cancelled: true }, { ...s, phase: 0 }, { ...s, position: 99 },
    { ...s, head: 4 }, { ...s, row: 1 }, { ...s, generated: 1 },
    { ...s, done: true }, { ...s, phase: 17, done: true, generated: 0 },
  ]) assert.throws(() => forecastRemaining(opts({ status })));
  assert.throws(() => forecastRemaining(opts({ status: s, finalized: true })));
});
