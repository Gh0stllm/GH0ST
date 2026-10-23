# Optional v4 PoolManager adapter

`contracts/SentenceSpeakerV4Hook.sol` is a separate adapter. It preserves the original single-pool `SentenceSpeakerHook.sol` and the model's integer inference rules.

## Behavior

- One adapter can serve multiple pools. Each canonical pool ID has its own initialized flag, swap sequence, market context, previous token, and recurrent state.
- Only the configured PoolManager may call the hook. The pool key must name this hook, and swaps require an initialized pool. No callback can import another pool's language state.
- Both swap directions and exact-input/exact-output swaps produce the same six feature conventions as the original model.
- Static fee pools retain their configured fee. Dynamic fee pools receive the constructor's `initialDynamicLPFee` during initialization. That is a fixed starting fee; this adapter does not learn fees or subsequently update them.
- The adapter requests only `afterInitialize` and `afterSwap` permissions (`0x1040`). It returns no custom swap delta and does not receive or spend token allowances.

## Explicit optional-inference policy

Speech is optional. A valid swap continues when inference is unavailable, and `SentenceSkipped` records the pool ID, swap sequence, reason, and input commitment. Reason `1` means insufficient callback gas; reason `2` means a failed model call, changed model code, malformed return, or invalid output.

Every observed swap updates market context. Successful, naturally completed sentences persist language state. A capped sentence or skipped inference resets language state to the start token and zero hidden state. The next sentence therefore does not resume a partial or missing sentence. Swap sequence numbers also include skipped generations.

The model call has a fixed gas budget. The adapter checks that budget plus the EIP-150 margin and 180,000 gas reserve before running inference. It copies at most 4,096 bytes of returndata and decodes in a separate self-only call, validating token ranges, hidden-state bounds, output lengths, and final-token consistency. It pins the model runtime code hash at deployment. These controls apply to the configured direct model contract; they are not a claim that arbitrary upgradeable model implementations or malicious external dependencies are safe.

The reserve covers the adapter's bookkeeping, not an arbitrarily gas-starved transaction or all remaining work in a caller's route. Routers still need enough gas for the complete swap and settlement. With empty hook data, gas estimation can select the cheaper skip path.

Callers who require speech can set the hook data to exactly `0x53504b31` (ASCII `SPK1`). This opt-in mode reverts that caller's swap with `SpeechRequired(reason)` if inference would be skipped. Gas estimation therefore funds a successful inference path. A model failure still causes a revert for a caller explicitly requesting required speech; other callers retain the default optional-inference behavior. Other hook data is ignored by this adapter and keeps inference optional. The integration tests verify estimated-gas execution in required mode and use a 6 million model-call budget.

## Deployment parameters

```text
SentenceSpeakerV4Hook(
    canonicalPoolManager,
    deployedSentenceModel,
    maximumWords,          // 1–16
    inferenceGasLimit,     // 100,000–15,000,000
    initialDynamicLPFee    // < 1,000,000; 3000 = 0.30%
)
```

The address must be mined with CREATE2 to satisfy `address & 0x3fff == 0x1040`. The constructor checks the permission bits. Deployment configuration must use the canonical PoolManager for the target chain and enough transaction gas for the chosen model. Local tests do not establish a public-chain deployment configuration.

## Real PoolManager validation

Run from the research project directory:

```sh
node --test tests/evm/sentence-v4-poolmanager.test.mjs
```

The suite runs an unmodified `@uniswap/v4-core@1.0.2` PoolManager on a local Cancun EVM. PoolManager is compiled with its exact Solidity 0.8.26 pragma; the model, adapter, and test router use Solidity 0.8.30. The suite deploys and byte-checks all 57 model data shards, initializes pools, supplies liquidity, calls real swaps through `unlock`, and completes ERC20/native `sync`, `settle`, and `take` accounting.

It verifies independent integer-model parity, both directions, exact input/output, multiple pool isolation, dynamic starting fees, native currency settlement, elapsed-time clamping, low-gas skipping and recovery, callback authorization, and rollback of state and balances after failed settlement. Failure injection includes a reverting model, malformed ABI, oversized return data, noncanonical booleans, invalid tokens/states/output sizes, exhausted model gas, and changed model runtime code.

The suite writes `reports/v4-poolmanager-integration.json` only after its assertions pass. To validate alternate compatible model artifacts without replacing the original model:

```sh
GH0ST_MODEL_DIR=swap-speaker-535k/candidate/model \
GH0ST_V4_REPORT=swap-speaker-535k/reports/candidate-v4-integration.json \
node --test tests/evm/sentence-v4-poolmanager.test.mjs
```

Reports identify the model directory, onchain artifact hashes, compiler versions, full swap transaction gas, tested behavior, and limitations. Results are local evidence. They are not a public network fork test, periphery-router compatibility guarantee, economic evaluation, or security audit.
