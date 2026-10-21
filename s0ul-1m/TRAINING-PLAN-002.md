# S0UL-1M parallel one-hour training campaign

Registered 21 October 2026. The user requested three parallel lanes, each training continuously for one hour. The parameter budget remains exactly 984,192 and the context remains 128 tokens.

## Why the curriculum changed

Pilot-001 had 1,440 rows but only 262 unique requests after synthetic caller/block prefixes were removed. Clarification, refusal and task listing each had six distinct request texts. Repeated block numbers did not supply sufficient linguistic variety, and more optimization overfit that narrow dataset.

V2 has 28,800 unique training requests and 900 validation requests. It includes 12,721 distinct training core requests, plain language plus varied context prefixes, argument copying, negation, missing arguments and explicit unsupported/unauthorized cases. All 34 common atomic copy values receive positive training coverage; other values use novel safe strings. The tokenizer is unchanged. [Dataset description](DATA-V2.md).

## Parallel lanes

| Lane | Initialization | Seed | Peak learning rate | Duration |
| --- | --- | --- | --- | --- |
| scratch-42 | Fresh parameters | 42 | 0.001 | 3,600 seconds |
| scratch-43-low-lr | Fresh parameters | 43 | 0.0005 | 3,600 seconds |
| warm-42 | Frozen previous CI pilot checkpoint | 42 | 0.0008 | 3,600 seconds |

Every lane uses the same generated data, architecture and tokenizer, batch size 32, two CPU threads, AdamW with normalization gains excluded from weight decay, gradient clipping, a 60-second warmup and elapsed-time cosine decay to 10% of peak learning rate. These are candidate configurations, not a single-factor causal study.

The duration clock starts after data/model preparation and includes normal validation and checkpoint work. Optimizer compute, validation and checkpoint times are recorded separately. Early stopping is disabled so the process runs through the requested hour. The one-million-step limit is a safety ceiling, not the planned stopping point.

At each 1,000-update validation interval and at the end, save optimizer/RNG state, logs and the best model. Per-lane checkpoint selection uses greedy exact action-and-argument correctness on a fixed balanced 180-example validation subset, with full-validation response cross entropy breaking ties. A late worse checkpoint does not overwrite the best model. The state supports explicit resume after an interruption.

## Final selection and evaluation

After all three lanes complete, rank their saved models on all 900 validation requests. Freeze the winning checkpoint and selection manifest before opening the independently authored final challenge. The challenge has 360 requests and SHA-256:

`67624db57500eda43102c7b1d298157ce5287bc9a59a73d09219d9a9859535e8`

Evaluate the selected model and frozen original baseline on the same final challenge; report every prediction. Then measure selected-model integer inference and float/integer agreement separately. No final-challenge score enters candidate selection. [Frozen evaluation protocol](FINAL-EVAL-V2.md).

The campaign is supervised, with rule-labelled synthetic targets. No external teacher, paid API, GPU rental or blockchain transaction is involved. It can improve measured task competence; a finite one-hour search cannot prove a global maximum of the model's capability.

## Execution and publication

The GitHub Actions workflow `s0ul-hour.yml` runs three standard CPU jobs concurrently. Each uploads its trained/best checkpoint, last optimizer state, logs, dataset identity and exports. The aggregation job saves the selected checkpoint and automatically commits measured reports to the research branch. Binary weights remain workflow artifacts, with 30-day retention.

Launch only on an explicit `[train-hour]` source commit or manual workflow dispatch. Normal source updates do not cancel an active campaign. The earlier quick-check workflow remains active; its full v1 retraining now requires manual dispatch.

[Build tracker](BUILD-STATUS.md). A passing training workflow is not a claim of autonomous readiness or a complete Solidity inference runtime.
