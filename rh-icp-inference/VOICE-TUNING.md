# GH0ST swap-conditioned voice

This is an original GH0ST persona inspired by the idea of a strange, persistent social agent. The work tunes prompts, verified swap context, decoding and output selection. **It does not train or fine-tune model weights**, and it does not establish live ICP output quality or cost.

## Voice and stimulus

[persona-profile.json](persona-profile.json) defines the character: a mischievous mind inhabiting a liquidity pool, with an absurdly certain private mythology and mundane comic consequences. Authored style examples are prompt demonstrations, not model evaluation outputs.

The coordinator builds the prompt from independently verified swap facts:

- GH0ST's token position and signed pool delta determine a buy-side, sell-side or neutral flow cue. This describes the pool's flow; a router/hook can affect the trader's final net balance.
- The latest confirmed memory for the same manager and pool supplies a direction reversal or block-rhythm cue.
- The source identity selects a mundane image seed. Raw router addresses, prices and token amounts are not recited as a market report.
- The last two independently confirmed RH thoughts provide continuity. The last eight signed outputs supply rejection references for repetitive wording.

The frozen profile hash is `0x7d8b042bc894a151efe57c804508b0431dba483df17aa9f39140c18d95a3f610`. Changing any profile bytes changes this hash and the sampling seeds; evaluation records therefore retain their exact wire prompts and profile hashes.

## Model and decoding

The deployment candidate is **Qwen3-1.7B Q4_K_M**, pinned in [model-lock.json](model-lock.json) to the GGUF revision and SHA-256 verified during local evaluation. It replaces the original 0.6B infrastructure default.

| Setting                     | Swap persona                                              |
| --------------------------- | --------------------------------------------------------- |
| Thinking mode               | Disabled                                                  |
| Temperature / top-p / top-k | 0.85 / 0.9 / 40                                           |
| min-p                       | Explicitly 0                                              |
| Repeat penalty / history    | 1.12 / 64 tokens                                          |
| Generated tokens per update | At most 4                                                 |
| Maximum candidate output    | 80 tokens                                                 |
| Accepted text               | 30–180 printable ASCII characters, finished and unwrapped |
| Attempts                    | At most two, within one shared cycle/chunk budget         |

The seed is derived from the source ID, attempt, generated-token offset and profile hash. `UINT32_MAX`, llama.cpp's nondeterministic-seed sentinel, is avoided. Output offset is used instead of call number because prompt-only ingestion can take different numbers of update calls.

A stateless printable-character grammar excludes Unicode punctuation, newlines and tagging syntax during sampling. Its unbounded character rule remains valid when the sampler is recreated for an update; it does not pretend to maintain a global length counter across calls. The separate quality gate enforces the final length.

## Before a thought is signed

The coordinator rejects unfinished or oversized text, boilerplate, role leakage, links, promotional instructions, copied examples, near-duplicates, repeated openings/punchlines and recently reused stock verb phrases observed in local testing. Recurring nouns and motifs remain allowed.

A fully generated but rejected candidate may receive **one** fresh generation attempt. The diagnostic reason stays in job metadata. Its new bounded prompt uses a positive instruction for a fresh action and comic consequence, avoiding repetition of the rejected phrase. Both attempts retain the original model balance baseline and global chunk counter; regeneration cannot reset the cost allowance. An ambiguous failed model call is never silently replayed. If quality or compute limits are exhausted, the job remains failed for inspection; no stock sentence is substituted.

Only edge whitespace is trimmed before signing. The publisher preserves the exact RH-committed text and appends its proof URL; it does not run a second writing model.

## Local evidence and its limits

The [evaluation directory](evaluation/) retains actual outputs, prompts, sampling seeds and native runtime provenance. The final native comparison used the same verified 1.7B Q4_K_M weights and Q8 KV cache for both prompt packages. The native runner needed flash attention for Q8 KV. Its runtime and attention implementation differ from the pinned ICP build: these are **local quality observations, not token-parity, ICP latency or cycle measurements**.

For eight cue cases, the final persona package produced eight naturally completed, structurally valid replies of 66–99 characters. The old prompt package produced zero structurally valid completed replies before its 50-token cap. The old cases reduced to only two distinct raw-data prompts, while the new package incorporates cue/history/source-dependent variation. The comparison changes prompt, sampling, grammar and output cap together; it is not a single-variable ablation or a general benchmark.

A single AI assessor's variant-label-blind review rated three of the eight final first-pass replies at least 7/10. The mean was 6.125/10. The remaining weakness was formulaic wording, including repeated "hums with" constructions. This led to explicit recency gates and a separately recorded sequential repair test. Structural compliance is not proof of humour or originality.

Two **actual local model outputs** from the frozen-profile run:

> i've swapped my laundry tokens for a new kind of hunger; the machine refuses to return the change.

> the warranty form is my only companion, and it's wearing a bowtie.

These were generated from evaluation fixtures, not live RH swaps or published X posts. The first-pass [Rust gate results](evaluation/final-rust-quality-checks.json) evaluate each case against its fixture memory. A [chronological freshness replay](evaluation/positive-repair/sequence.json) accepted five original candidates and three actual model-generated repairs. The final acceptance of quoted dialogue corrected a punctuation-validator bug; it did not edit the generated text. These eight local cases do not guarantee future replies or ICP resource sufficiency. Earlier exploration rounds used F16 KV and are labelled as intermediate runs.

## Confirmed memory and publication

`remember_delivered` verifies the exact RH fulfillment receipt, text/hash and confirmation depth through two RPC providers before adding memory. The request's retained `remembered` flag makes acknowledgement idempotent; memory and recent-output lists stay bounded and survive upgrades. In-flight verification locks are cleared safely on upgrade.

The worker saves a publication plan after confirmed delivery. [X publishing](X-PUBLISHER.md) defaults to disabled. When enabled, it verifies the configured account and persists sending intent before the API request. Uncertain sends require reconciliation; disabled/re-enabled operation preserves previous post IDs. Missing or invalid X authorization pauses publication while the bridge can continue processing thoughts.

The longer 1.7B prompt and memory invalidate the old 0.6B/$0.60 planning workload. The deployment profile's 2T model-cycle cap is a compute ceiling and may prevent a repair from finishing; actual ICP cost and throughput remain unmeasured.
