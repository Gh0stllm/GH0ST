# S0UL bounded action agent

`S0ULAgent` connects the existing trained Solidity inference engine to a small set of owner-scoped tools: memory, tasks and balance reads. It pins the deployed engine, model, tokenizer, checkpoint and runtime hashes. Adding the controller does not retrain or replace the model. [Controller source](contracts/S0ULAgent.sol) · [Canonical action parser](contracts/S0ULActionCodec.sol).

The controller holds no funds and exposes no transfers, approvals or arbitrary contract calls. ETH and GH0ST operations read the original request owner's balance. The optional GH0ST token address and runtime hash are fixed at deployment; its `balanceOf` read uses a bounded static call.

## Mainnet controller

The controller is deployed on **Robinhood Chain mainnet, chain ID 4663**, at `0x9F92776e33087DCF0d77b9BE23145efAC6cE695D`, pinned to the existing trained inference engine `0x07bB8455Db0928bEBEb3E7F27A22A0599AF1b650`. Its successful creation transaction is `0x501ddec2dfd2dd834e27b891ced8939e47901e4d139e16f0d8334064b93bd7ce`, using 3,763,595 gas. [Deployment journal and identity pins](deployments/robinhood-mainnet-agent.json) · [Verified source on Sourcify](https://repo.sourcify.dev/4663/0x9F92776e33087DCF0d77b9BE23145efAC6cE695D).

Request `2` completed real mainnet generation and executed the permitted memory write: `theme=dark` → `MEM_SET|theme|dark`, EOS, with output IDs `[261, 279, 420, 365, 2]` and zero saturation. The owner adopted it with mask `8` and the exact action commitment. Finalization emitted exactly one `Executed` event, stored `theme=dark` in that owner's namespace and incremented the owner's state revision from 0 to 1. [Adoption](deployments/agent-adopt-2.json) · [Finalization](deployments/agent-finalize-2.json) · [Independent mainnet check](reports/robinhood-mainnet-agent-check.json).

The read-only checker independently reread **all 2,560 logits across five historical decision states**; every value matched the Python integer reference. It verified memory at the real finalization block and rechecked the block's canonical hash. The checker submitted no transactions.

| Request `2` measurement | Verified value |
| --- | ---: |
| Paid inference transactions | 409: 301 direct + 108 controller batches |
| Engine progress events | 723 `Advanced` + one `Begun` |
| Inference gas | 1,628,964,578 |
| Actual inference fee | 0.033132152590172 ETH |
| Inference + adoption + finalization gas | 1,629,427,951 |
| Inference + adoption + finalization fee | 0.033141583296316 ETH |

The incremental request totals exclude the shared controller deployment, the earlier model deployment and unrelated wallet activity. Receipt fees use `gasUsed × effectiveGasPrice`, with the L1 gas component already included. The same logical 128-row workload requires a calculated 724 transactions without batching; this run adopted the request after 301 direct transactions, then completed it in 108 controller batches. The evidence proves this one permitted memory action.

## Authorization and execution

An owner starts a controller-owned inference request with `beginConstrained`, or binds an existing request they own through `adoptConstrained`. Each binding records the owner, permitted action mask, prompt-token hash, current state revision and expected canonical action hash. Anyone may fund deterministic progress or finalization; results and writes remain in the bound owner's namespace.

For constrained bindings, `expectedActionHash = keccak256(bytes(canonicalAction))`. For example, committing `MEM_SET|theme|dark` permits exactly those UTF-8 bytes. The prompt and generated-output hashes separately use `keccak256(abi.encode(uint16[]))`, including prompt BOS/SEP and output EOS respectively.

Finalization reads the bound engine's completed output. It requires terminal EOS, consistent generated-token counts, supported content token IDs, exact canonical grammar, the corresponding mask bit and the expected action hash when set. It settles each binding once. Memory/task writes also require the owner's state revision to match the revision captured at binding; a successful write increments that revision and makes older concurrent writes stale.

The Solidity API retains unconstrained `begin` and `adopt` entry points. Use the constrained methods for writes. The provided controller CLI enforces `--expect-action` whenever its mask includes `MEM_SET`, `TASK_ADD` or `TASK_DONE`.

| Bit / mask | Canonical action | Effect |
| --- | --- | --- |
| 0 / 1 | `WAIT` | Record completion |
| 1 / 2 | `BALANCE|SELF|ETH` | Read owner's native balance |
| 2 / 4 | `BALANCE|SELF|GH0ST` | Read owner's pinned-token balance |
| 3 / 8 | `MEM_SET|theme|dark` | Write owner memory |
| 4 / 16 | `MEM_GET|theme` | Read owner memory |
| 5 / 32 | `TASK_ADD|audit` | Add an owner task |
| 6 / 64 | `TASK_LIST|SELF` | Read owner tasks |
| 7 / 128 | `TASK_DONE|1` | Mark an existing owner task done |
| 8 / 256 | `CLARIFY|request` | Record a clarification |
| 9 / 512 | `REFUSE|unsupported` | Record a refusal |

Memory keys are `theme`, `language` and `mode`. Values and task titles are lowercase slugs of 1–24 bytes, beginning with a letter and then using letters, digits or `_`. Each owner has a lifetime cap of 64 tasks. Clarification/refusal arguments come from the parser's fixed lists. All stored state is publicly readable on-chain.

## Progress and decision snapshots

Inference remains incremental and gas-funded. `advanceBatch(requestId, rows, steps)` permits 1–128 rows and at most four existing engine steps per transaction. After making progress, it stops before the Select phase so the completed 512-logit decision vector remains available for capture. A later call may perform selection and continue. The controller does not wake itself or run an automatic tool loop.

## Operate with the CLI

Run from `s0ul-1m`. Set `S0UL_RPC_URL` to your chosen mainnet RPC and provision `S0UL_SIGNER_PRIVATE_KEY` through your own secret handling. The commands reference the environment variable by name; they do not load `.env` files.

```bash
node scripts/s0ul-agent.mjs compile

# Deploy a controller only when a new deployment is intended.
node scripts/s0ul-agent.mjs deploy \
  --rpc "$S0UL_RPC_URL" --private-key-env S0UL_SIGNER_PRIVATE_KEY \
  --deployment deployments/robinhood-mainnet.json \
  --output deployments/robinhood-mainnet-agent.json
```

The controller CLI supports `compile`, `deploy`, `adopt` (`bind`), `continue` and `finalize`. A direct engine request may be adopted while running or after completion; use the same wallet that owns it and set `S0UL_REQUEST_ID` from its generation journal. The following commands bind the exact memory-write commitment, continue inference if needed, then finalize only once the engine reports completion:

```bash
node scripts/s0ul-agent.mjs adopt \
  --rpc "$S0UL_RPC_URL" --private-key-env S0UL_SIGNER_PRIVATE_KEY \
  --request-id "$S0UL_REQUEST_ID" --action-mask 8 \
  --expect-action 'MEM_SET|theme|dark' \
  --output deployments/theme-dark-adopt.json

node scripts/s0ul-agent.mjs continue \
  --rpc "$S0UL_RPC_URL" --private-key-env S0UL_SIGNER_PRIVATE_KEY \
  --request-id "$S0UL_REQUEST_ID" --rows 128 \
  --max-step-gas 31000000 --expect-action 'MEM_SET|theme|dark' \
  --output deployments/theme-dark-continue-1.json

node scripts/s0ul-agent.mjs finalize \
  --rpc "$S0UL_RPC_URL" --private-key-env S0UL_SIGNER_PRIVATE_KEY \
  --request-id "$S0UL_REQUEST_ID" --action-mask 8 \
  --expect-action 'MEM_SET|theme|dark' \
  --output deployments/theme-dark-finalize.json
```

`continue` estimates batches from four steps down to one and adds a 20% gas margin within `--max-step-gas`. It captures all 512 logits before each Select phase. `--max-transactions N` bounds an invocation; exit code 2 means the engine is still incomplete.

Every operation saves its exact signed hash before broadcasting and retains its receipt. Resume with `--resume PATH` and the same identity/options to reconcile that recorded hash; an ambiguous pending transaction is not silently replaced. For `continue`, resume reconciles any recorded pending transaction, updates state and returns without sending further steps. If inference is still running, start another `continue` invocation with a fresh output filename and retain all invocation journals. `resultOf(requestId)`, `memoryOf(owner, key)`, `taskOf(owner, id)` and `requests(requestId)` expose the result and settled outcome.

## Model limits and evidence

The selected checkpoint is unchanged: `44bed666c464273e6fff84b10a4977744d9b0e923f5b6a519d7725920b500692`. Exact Solidity/Python arithmetic does not guarantee correct action arguments. In a [local integer-reference probe](reports/agent-reference-probes.json), `Add task audit.` produced the syntactically valid but wrong `TASK_ADD|ee`. A binding committed to `TASK_ADD|audit` rejects that output with `ActionMismatch`; parsing and an action mask alone would accept the wrong title. Constrain write intent explicitly and inspect rejection outcomes.

All 12 [local controller tests](reports/solidity-agent-local.json) passed, including 295 parser vectors, identity pins, EOS/provenance, permissions, exact argument commitments, namespace isolation, stale writes, task limits, bounded token reads and reentrancy. A constructed tiny integer model also produced 1,024 exact logits and two observable Select boundaries through four-step batches. This fixture is separate from the trained checkpoint. The [local CLI regression](reports/solidity-agent-cli-local.json) passed deployment, partial-request adoption, bounded continuation, finalization, hash-before-broadcast and resume checks; it used mocks and did not exercise decision snapshots.

The [memory reference](reports/agent-memory-reference.json) supplies the Python vectors used in the independent mainnet comparison. Local tests and exact execution for request `2` establish the stated behavior for those inputs; they do not establish general model accuracy or autonomous operation.
