# GH0ST Watch optimization study

3 November 2026. Research only. No Watch service, paid inference, production change or measured ICP saving is claimed.

## First findings

The highest-confidence saving is to avoid unnecessary model executions. Preserve every qualifying factual alert, then offer AI for selected events or on demand. This changes explanation coverage; it is not a faster model producing the same number of explanations.

| Priority | Change | Expected benefit | Constraint |
| --- | --- | --- | --- |
| 1 | Render amounts, thresholds, event labels and transaction links directly from validated data | Routine alerts need zero inference | Clearly label template text; do not present it as model output |
| 2 | Compute one public explanation per event/context, then share it across subscribers | Avoid repeated inference for identical public inputs | Cache key must include chain/block identity, facts, rule semantics, model/prompt version and language; invalidate on reorganization |
| 3 | Select AI by explicit rules or user request; cap the queue budget | Lower variable spend while factual alerts remain available | Fewer AI explanations is a product choice; hard caps can reject work |
| 4 | Use a short factual prompt and generate only a short observation | Reduce input decoding and output generation | Token reductions need a quality test; they are not automatically cycle savings |
| 5 | Share scans and verify each unique candidate once before subscriber fan-out | Lower duplicated RPC work | Keep independent verification, canonical-block checks and durable recovery |
| 6 | Evaluate a stable prompt-prefix cache | Reuse input computation across jobs | Model-specific; copy, storage and isolation costs may outweigh savings for short prompts |
| 7 | Remove artificial waits after confirmed successful work | Improve latency | Does not remove model arithmetic or prove a material cycle saving |

Shared scans were already part of the initial design. The naive per-watch comparison below quantifies why to retain them; it is not an additional saving over the original shared-scan budget.

## Monitoring arithmetic and a provider-limit trap

[Alchemy's current EVM cost table](https://www.alchemy.com/docs/reference/compute-unit-costs) lists 10 compute units (CU) for `eth_blockNumber`, 60 for `eth_getLogs`, and 20 each for receipts and blocks. A JSON-RPC batch is billed as its individual methods; one HTTP request does not mean one billable operation. Rates are an illustrative provider model, not a guarantee for any account or chain.

For 30 days at a 30-second interval, there are 86,400 scan ticks. With one head query and one log query per tick:

- One shared scanner: **6.048M CU per primary provider** before verification, retries or backfill.
- Twenty-five separate scanners: **151.2M CU** under the same assumptions.
- Shared scanning removes **96% of that duplicated scan work**, if all filters fit one permitted query.

[Provider plan limits](https://support.alchemy.com/articles/1883074130-why-do-i-see-a-free-tier-error-when-calling-eth-getlogs-with-a-large-block-range) can force each range into multiple requests. If, hypothetically, 300 new blocks require 30 ten-block queries, the shared scanner becomes **156.384M CU/month**, before verification. Those are sensitivity assumptions, not measurements of Robinhood's current block rate or a verified ten-block limit. Probe the selected provider's allowed ranges before assigning a free-tier budget.

For a continuously advancing chain under tight block-range limits, increasing the polling interval can reduce head queries but leave total log-query volume almost unchanged. It can also increase detection latency. Split ranges adaptively; never silently skip a failed range or advance the durable cursor past it.

Filtered WebSocket logs plus bounded periodic range reconciliation are another candidate. [Robinhood documents WebSocket endpoints](https://docs.robinhood.com/chain/connecting/), but subscription support and billing must be checked. Account for stream delivery, reconnects and reconciliation; do not call WebSockets free or replace recovery with a subscription alone. Keep two-provider verification for the same alert policy. A slower witness scan can additionally detect omissions; verifying only events returned by the primary cannot prove completeness.

## AI workload and total operating budget

Retain the original **$25-100/month infrastructure** and **$3-5/completed short explanation** planning allowances until a Watch-specific ICP benchmark replaces them. Token counts and local CPU timing will not be used to invent a lower on-chain price.

| Scenario | AI outputs / month | Modeled operating cost |
| --- | ---: | ---: |
| Explain every one of 10 unique qualifying events/day | 300 | $925-1,600 |
| Keep all factual alerts; select 10% for AI | 30 | $115-250 |
| Keep all factual alerts; AI disabled | 0 | $25-100 |

At unchanged per-output cost, selecting 10% reduces AI executions by 90% and total modeled spend by about **84-88%**, comparing the same low/high cost assumptions. It does not provide an explanation for every event. The figures exclude setup, development, taxes and the other exclusions in [the initial study](README.md#proposed-monthly-budget). They assume reduced AI demand does not require extra fixed infrastructure.

If one public event is shown to 20 subscribers with identical public context, one cached explanation can replace 20 identical jobs (95% fewer jobs for that case). This is a fan-out comparison, not a measured cache-hit rate, and must not be multiplied blindly with event-selection savings. Personalized context requires separate keys and may eliminate sharing. A cache miss still pays the full job cost.

## Runtime-specific findings

The inspected pinned runtime is `onicai/llama_cpp_canister` commit `4276f526970b7916cc7105c357ad2f2ed018ed37`. Its local `icpp.toml` already contains `-msimd128`. “Enable SIMD” is therefore not a new optimization for that source build, and current live binaries have not been rechecked. [ICP's profiling guidance](https://docs.internetcomputer.org/guides/canister-management/optimization/) supports measuring instruction costs before changing kernels.

The source exposes `copy_prompt_cache`, contrary to one older local audit's statement that no clone operation exists. `src/promptcache.cpp` checks a busy destination but not a busy source, copies within the caller's namespace, replaces an existing destination, and copies cache stamps. `src/main_.cpp` compares the cached token prefix with the full new prompt and removes its later tokens. A Watch experiment must use an immutable completed seed and a genuinely fresh destination, versioned by model, prompt and layout; never overwrite active or recovery caches. Measure copy and storage overhead, seed amortization and output correctness. Identical output is not guaranteed when generation boundaries change.

Source references: [cache copy](https://github.com/onicai/llama_cpp_canister/blob/4276f526970b7916cc7105c357ad2f2ed018ed37/src/promptcache.cpp), [prefix matching](https://github.com/onicai/llama_cpp_canister/blob/4276f526970b7916cc7105c357ad2f2ed018ed37/src/main_.cpp), [build configuration](https://github.com/onicai/llama_cpp_canister/blob/4276f526970b7916cc7105c357ad2f2ed018ed37/icpp.toml).

Smaller models, alternative quantization, changed chunk sizes and prefix caching are benchmark candidates, not established savings. Running inference on a normal server could change costs substantially but changes the execution/trust model, so it is not the default recommendation for this on-chain research direction.

## Local validation results

[Model screening](MODEL-SELECTION.md) now includes 48 local generations across pinned Qwen3-1.7B and 0.6B Q4_K_M files, three prompts and eight synthetic cases. The first shortened prompt failed the complete-output checks for both models. A clearer revision reduced mean input tokens from 206.75 to 94.75 (54.2%), but the 1.7B output still contained an invented extra quantity in one case. Its lexical guard missed that error. Do not ship that guard as production validation or accept prompt savings based on token counts alone.

The native runtime differs from deployed ICP Wasm. Local timing is a machine-specific screening result, not ICP latency, cycle cost, verified model parity or general language-quality evidence. No paid benchmark occurred. [cost_model.py](cost_model.py) reproduces the modeled scenarios in [cost-scenarios.json](cost-scenarios.json), including range splitting and matched-bound budget reductions.

For contract vulnerability auditing, use the separate [audit-model recommendation](CONTRACT-AUDIT-MODELS.md). These small Qwen tests provide no evidence of auditing ability.
