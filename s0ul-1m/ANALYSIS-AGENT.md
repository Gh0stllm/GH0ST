# S0UL on-chain observation-report pilot

The separate analysis runtime is deployed on Robinhood Chain mainnet, chain ID
4663. Deployment completed on 2026-10-22 with 51 confirmed creation transactions
and **0.004991091254046 ETH** in recorded receipt fees. Runtime, model, all 48
shard references and immutable dependency checks completed successfully.

This remains a finite capability pilot. It does not establish AIXBT-level
intelligence, general address research, trading competence or security-audit
accuracy. The current release configuration has `serviceVerified: false`:
deployment does not claim that an automatic transaction submitter is running.
The hosted paid-job flow remains disabled and its end-to-end test is incomplete.
A manually submitted mainnet inference job has completed; that proves the
bounded contract pipeline, separately from hosted-service readiness.

## Mainnet contracts

| Component | Address |
| --- | --- |
| Adapted model registry | `0x922AdB3CD39A284813c7Ca74cFA944b0bd49Fe92` |
| Inference engine | `0x672549Ff0C5Be42Df2aA9853b9263463dB8DB796` |
| Facts adapter | `0xBAa48125B0D55044EE495E18A0493CBAe233b0dC` |
| Word codec | `0xcBcd05D9FAb2F2cae0479aCE60D07Ec4Ae916BFC` |
| Funded executor | `0x150e7F441bF5218d00716aD3B25a72D6e22423B5` |
| Reused universal reader | `0x5BE840518fb1Be0851f06d68ac0724fdC4e97768` |

Model ID:
`0xbbebbe2e6ff555505e97c8b674a03f9c1033438e9e73c16661c122b25b47e998`.

Selected checkpoint SHA-256:
`9cf0b5ce17109bda877f21ac08731cd1897bf6d160b4b690de809c750e960716`.

The deployment created 46 data shards and five contracts, reusing two exactly
matching immutable data shards and the existing reader. It did not replace the
original model, byte tokenizer, action controller or earlier deployments.
`deployments/robinhood-mainnet-analysis.json` contains canonical receipts,
constructor arguments, addresses, code hashes, model identity and fee accounting.
Its private RPC token and signing credential are never publication artifacts.

## Planned hosted flow and service boundary

The following wallet flow is not yet enabled as a hosted paid service. The
completed mainnet proof used an explicitly invoked manual transaction submitter.

1. Connect a Robinhood Chain wallet and enter a target address.
2. Calculate the complete inference/execution forecast, separately showing job
   funding and the opening-transaction fee.
3. Approve an ETH job budget and open the job in one wallet transaction.
4. A transaction submitter advances the bound model in bounded transactions.
   It supplies no model states, feature values or report text.
5. Read the actual generated words with captured evidence, model, prompt, token
   and output hashes. The owner can recover unused job funding.

Contracts cannot initiate their own continuation transactions. A functioning
submitter and enough funded gas are necessary. The present configuration keeps
automatic service readiness unverified; the contract addresses alone do not
prove a hosted worker, queue or wallet flow is operational.

Facts, prompt construction, model arithmetic, report storage and budget
accounting execute on-chain. A relayer and queue operate off-chain to submit the
continuation transactions. The whole service is therefore not fully on-chain or
self-initiating; the relayer supplies transaction scheduling, not the analysis.

A forecast is not an exact promise about future fees or every target's output
length. Each funded job has an owner-approved budget, fee ceiling, reward limit
and deadline. These cannot increase implicitly. A job can pause for insufficient
funding or fee changes and may need an explicit top-up. This per-job policy is
separate from the user's uncapped market-price deployment instruction.

Deployment market mode used a fresh RPC gas quote with 5% inclusion headroom,
physical wallet affordability checks and the chain transaction gas limit. The
journal records both the base quote and actual signed price. Deployment fees
above exclude inference funding and any future worker transactions.

## Components and evidence integrity

- `contracts/analysis/S0ULAnalysisFacts.sol` captures the pinned reader's
  current-chain profile and bounded getter results. It derives fourteen
  categorical features and the entire sixteen-token prompt on-chain. The caller
  supplies only the target address.
- `contracts/analysis/S0ULAnalysisCodec.sol` strictly decodes output word IDs
  64–150 followed by terminal EOS. It supplies vocabulary, not report selection.
- `contracts/analysis/S0ULAnalysisExecutor.sol` binds the owner, target code
  hash, evidence, prompt, immutable model and engine request. It escrows a bounded
  job budget, credits verified continuation work and stores generated tokens and
  strictly decoded model bytes. It has no template fallback.
- The existing `S0ULInference` arithmetic runs in a new model/engine instance
  with `tokenizer = address(0)`. The adapter supplies authenticated numeric
  tokens; the earlier action-language domain is not silently reused.

Paid continuation uses exactly 128 rows and one to four engine steps. Lower-row
paid fragmentation is rejected. Direct engine advancement is an unpaid
permissionless contribution. Rewards follow the documented bounded
`gasleft`-based policy; they do not claim to measure exact network receipt or
parent-chain posting fees. Quotes reserve controller overhead per logical step.
Worker and owner credits use guarded pull withdrawals; cancellation/refund
recovery remains available when a dependency fails.

The submitter defaults to strict reimbursement coverage. This pilot explicitly
sets `worker.maxReimbursementShortfallBps = 5`: successful paid work must receive
a positive credit, and any reimbursement gap must be at most
`floor(actual transaction fee × 5 / 10,000)` (0.05%). The core accepts no larger
tolerance. Within the worker's aggregate 0.5 ETH network-fee cap, tolerated gaps
on paid work total at most 0.00025 ETH; withdrawal fees remain ordinary worker
operating costs. This policy does not change the owner's escrow, fee ceiling,
reward cap or refund rights, and does not enable the hosted service.

Capture timestamps identify the observation used for generation, which can be
older than report completion. Nitro's Solidity EVM block counter is distinct
from the RPC L2 receipt block number; EVM `BLOCKHASH` output is not presented as
a canonical parent-chain block hash.

## Model experiment and limits

The original 984,192-parameter model was trained to emit a small action grammar.
Its balance/memory/task success did not make that checkpoint an address analyst.
`analysis-model/` adapts its recovered quantized export to a separate finite
reporting task. The original floating checkpoint was unavailable: initialization
dequantizes the saved integer arrays, verifies exact re-quantization, and
explicitly remaps embeddings for the feature/word domain.

Inputs encode code and native-funding presence, reported interfaces, bounded
owner/pause/implementation/asset getter classes, supply/reserve classes, selected
opcode-pattern presence and scan completeness. They contain no transaction
history, holder inventory, USD valuation, social feed, hidden storage, verified
source logic or forecast. Getters can misrepresent semantics; bytecode patterns
do not prove reachability or a vulnerability.

The vocabulary has 87 output words and the maximum generation budget is 32
tokens including EOS. All 768 synthetic held-out feature vectors matched the
authored policy in float and integer evaluation. The deterministic policy also
scores 100% and is much cheaper. This measures learned policy reproduction,
not new factual knowledge or real-world analyst accuracy.

Training, validation and test feature vectors are disjoint; a reserved
three-field combination is held out separately. The two exhaustive no-code
states are known training/development regressions. An earlier candidate failed
them despite strong contract-only validation; that failure and the corrected
wording/curriculum are retained.

## Validation and cost limits

The first real mainnet job targeted GH0ST at
`0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559`. It completed with 850 canonical
receipts: one open, 752 continuation transactions, one finalization, 95
withdrawals and one owner refund. Its 22 generated tokens include terminal EOS;
all **11,264 logits across 22 decisions** matched the independent integer
reference. This is one address and one captured observation, not a general
accuracy result.

| Mainnet job accounting | ETH |
| --- | ---: |
| Initial escrow | 0.3436704762571 |
| Worker reimbursement credits | 0.1533462271636 |
| Unused budget returned to the owner | 0.1903242490935 |
| Actual network fees across all 850 receipts | 0.15286452125325 |

After settlement, the job's remaining budget, owner and worker credits, and
executor ETH balance were all zero. The actual model output repeated
**"Positive supply reported." twice**. That duplication remains in the public
proof and demonstrates a model-quality limitation; arithmetic parity does not
establish useful general research or AIXBT-like capability.

`reports/analysis-mainnet-generation-proof.json.gz`,
`reports/analysis-mainnet-integer-parity.json` and
`reports/analysis-mainnet-final-validation.json` preserve the receipt, parity
and settlement evidence. The hosted service remains disabled despite this
successful manually submitted job.

- Executor and facts/codec suites passed 36 local contract checks, including
  ownership, gas/budget limits, hostile getters, strict EOS and real-codec
  integration. Mock-engine accounting tests are not trained-model evidence.
- `reports/analysis-real-model-validation.json` records one known no-code job
  completed in a local native EVM: all 17 generated decisions and 8,704 logits
  matched the integer reference, with conserved escrow/credits.
- That local job consumed **6,413,204,411 gas across 647 continuation batches**;
  its largest transaction used 20,209,833 gas. This single-case measurement
  does not establish arbitrary-address cost or accuracy.
- `reports/analysis-release-*.json` and the phase/client/worker validation
  reports separately document application integration and its limits.
- `analysis-model/evaluation-v2/evaluation-report.json` explicitly keeps
  `production_analyst_capability_established: false`.

Model usefulness, Python arithmetic parity, EVM parity, funded-job accounting
and hosted-service readiness are separate claims. The deployment is a working
contract foundation for this bounded report task; it is not evidence that a
general autonomous research service is ready.

Large JSON evidence is published as deterministic `.json.gz` files because the
GitHub connector could not upload the originals. Restore the exact original
bytes before replaying checks that read those JSON paths:

```sh
python s0ul-1m/scripts/restore-analysis-release-evidence.py
```

The helper checks both archive and original SHA-256 identities and refuses to
overwrite a differing report. `--check` validates without writing.
