# Recovery result: gas fits; requested language quality remains unmet

24 October 2026. All model training and chain tests were local. The Mac GPU was used after its Metal/MPS access was verified outside the process sandbox. No public-chain transaction or website update was performed.

## Outcome

This round did **not** reliably fix grammar, semantic repetition or the requested witty first-person voice. It produced working alternative tokenization and training paths, broader grammar replay, faster GPU training, and a new locally measured checkpoint. These are experimental artifacts, not an approved replacement for a live model.

The selected technical benchmark is the GPU top-two-layer model at `runs/gpu-top2-voice-2m/checkpoint-000282`, SHA256 `5601eb5f19797811279933b70e26f03bb80d7513800c7efbc3a9d6f73f945808`. It retains all 1,235,968 parameters and the original 4,019-entry WordPiece vocabulary. A read-only tensor comparison confirms that the embeddings/output head, lower two layers and final norm stayed byte-identical to the original pretrained weights. Only the upper two transformer layers changed.

## Completed experiments

| Experiment | Actual supervised tokens | Finding |
|---|---:|---|
| First whole-word training | 4,000,284 | Avoids malformed subword concatenation but not broken clause connections; validation worsened after the early phase. |
| Broader replay, ordinary CE | 4,523,763 | Stopped early after full-output and per-source reviews failed; original target was 6M. |
| Broader replay, content unlikelihood | 3,883,587 | Stopped for the same reason. The auxiliary term on supplied contexts was too small to resolve free-generation loops. |
| GPU, upper two layers only | 2,003,433 | Completed in 23.10 recorded training/evaluation seconds; more grammatical clauses in places, but story drift and repetition remain. |
| GPU, all four layers, fixed embeddings | 2,003,433 | Completed in 32.93 seconds; did not supply a reliable coherent-voice replacement. |

The interrupted CE/UL runners record `FAILED` because they catch KeyboardInterrupt. Their `STOP-REASON.json` files document the deliberate early stop, actual work, and quality evidence. This was not a numerical failure. CPU and GPU time comparisons are workload-specific: the GPU runs also trained fewer parameters than the initial full-model CPU runs. A separate full-model benchmark measured about 51–53k targets/sec on MPS versus about 28k/sec on the concurrently loaded CPU. The GPU result is not a universal acceleration factor.

## Data and evaluation controls

- 250 new independently authored short monologues, with 190/30/30 whole-theme splits; 20–33 words each.
- A bounded sample of 25,000 upstream SimpleStories stories. The pinned upstream card declares MIT; source-completion groups remain wholly within one split. This is grammar replay and probably overlaps original pretraining.
- No runtime phrase catalog, template lookup, remote model call or external sentence correction was introduced.
- Whole-word vocabulary was fitted on training text only. Out-of-vocabulary filtering removed substantial held-out material, which is reported explicitly in the preparation audits. Its scores apply to the retained subset.
- Original WordPiece GPU trials retain the original token mapping. Single-token `i` conditioning is an explicit prompt, not a generated word and not a sentence bank.
- Complete, unedited quote and first-person continuations, causal prompts, repetition screens and per-source validation were reviewed. A low repeated-n-gram count does not establish coherent meaning. The new corpus cannot establish originality relative to all original pretraining.

## Exact integer/local v4 result

The selected upper-two-layer checkpoint was exported to Q12 and tested with initial prompt token 40 (`i`), top-k 8 and temperature 800. It produced **142 new tokens in 128 successful local Uniswap v4 PoolManager swaps**, with no context reset. Every checked token, terminal flag and full 4,019-logit hash matched the independent reference.

- Maximum whole-swap gas: **28,416,204**, leaving 3,583,796 below 32,000,000.
- 79 full-window swaps: **28,191,077–28,416,204** gas.
- Model/history tampering, unauthorized/malformed/stale/forged input, insufficient gas, post-inference rollback and caller/pool isolation checks passed.
- The fresh node was unforked local Anvil chain 31337. Data runtimes were installed locally after hash checks; their public deployment costs are excluded.

The two-seed Q12 export checked 160 tokens per seed with zero observed signed17 input violations. Those observations are bounded tests, not a claim covering every possible history.

Read `../recovery-v5-bpe/RESULTS.md` and `../recovery-v5-bpe/evm/gpu-top2-i40-local.json` for exact evidence. Main swap-report SHA256: `46fb1ac333bdc14116a9fbd0c87b3b71a58d460e288e8488c202faf60131208a`.

## Release decision

**Not approved for release.** The technical execution target is met in the local benchmark, while the requested language behavior is not. The sampled voice still drifts into a boy/flower/river story and recycles ideas. No claim of 10,000 coherent unique sentences, reliable question answering or Truth Terminal-level behavior is supported by this round. Additional training on the same narrow objectives should not be described as a proven fix.
