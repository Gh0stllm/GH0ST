# Solidity 32M bounded continuation: independent test plan

This is a local research test plan. It is not an external audit or a deployment approval.

The user's approved behavior is a bounded continuation fragment on each successful swap. A fragment can finish a sentence naturally but must not be represented as a complete sentence merely because the word or gas budget was reached. The unchanged neural model supplies every generated word and all punctuation.

## Required invariants

- The callback authorizes the configured PoolManager and exact N0VA/native-ETH pool before reading or changing context.
- At least one model step must complete successfully; insufficient gas before the first step reverts the entire trade.
- Every attempted step must pass model-code identity, bounded return-length, canonical ABI, hidden-state, score, vocabulary/text and terminal/punctuation checks. A later failed or malformed step reverts every earlier step from the same trade and all pool/token/ETH changes and logs.
- Voluntary stopping for the fixed word cap or insufficient *next-step* reserve is permitted only after at least one valid step. It is not an inference exception handler.
- Between steps and swaps, token, punctuation, sequence and all 768 recurrent-state values must be the exact prior neural result. Hook data and traders must not select or replace that state.
- A fragment event declares its exact word range and natural terminal flag. `sentenceCount` advances only on natural terminal punctuation. Existing global word sequence advances once per accepted model word.
- The callback retains the same conservative forwarding allowance (`budget + budget/63`) and 2M reserve, with one fixed bounded call per attempted word. No unchecked gas forwarding or fail-open mode is added.
- Fixed token supply and locked liquidity remain unchanged. Slippage failure after callback execution must roll back the generated fragment.

## Local adversarial fixture

`NovaBoundedMockModel.sol` supports failures at any configured word ordinal. It verifies recurrent state and prior-token progression and can deliberately revert, exhaust its call budget, return out-of-range hidden state or scores, falsify text, corrupt terminal status, or return malformed ABI. Optional deterministic gas work tests the next-step reserve boundary. These controls exist only in the test fixture, never in production model code.

Required integration cases include failures on word 1, 2 and 3 for both buy and sell; natural terminal at word 1, 2 and 3; no terminal within the cap; continuation into the next transaction; state and event hash continuity; slippage and insufficient-first-step rollback; changed model-code rejection; pending swaps preserving order; and eventual successful recovery after each group of failures.

## Limits of the result

A successful inexpensive mock test validates control flow and state atomicity, not the actual 8M model gas cost. The real model must separately demonstrate its maximum complete transaction gas under a 32,000,000-gas block and transaction ceiling. Existing gas measurements cannot establish 10 swaps per second; gas-per-second chain capacity also constrains throughput.
