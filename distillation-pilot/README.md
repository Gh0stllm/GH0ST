# Custom distilled agent model — first local pilot

This is an experimental 56,632,896-parameter student initialized from the Apache-2.0 SmolLM2-135M-Instruct checkpoint pinned in `teacher-lock.json`. It is a **CPU training and quality experiment**, not a deployed on-chain model or complete agent.

## Design

- Eight decoder layers copied from teacher layers 0, 4, 8, 12, 17, 21, 25 and 29. This is a simple depth-pruning baseline, not an optimal layer-selection algorithm.
- Hidden width 576, intermediate width 1536, nine attention heads, three KV heads, 49,152-token vocabulary, tied embedding/output matrix.
- Pretrained tied embeddings are frozen during the pilot; all eight decoder layers and the final norm are trained. Freezing does not remove embeddings from runtime cost.
- Teacher: 134,515,008 parameters. Student: 56,632,896. Trainable student parameters: 28,321,344.
- Training objective: 0.8 × cross entropy on checked answers + 0.2 × teacher-to-student KL, with temperature 2 and the usual T² factor. Only response tokens contribute to either loss. Teacher forwards are local and conditioned on the same gold response prefix.
- This is **logit distillation plus supervised task adaptation**. The targets are hand-authored synthetic examples, not outputs claimed to come from a larger teacher. There is no SFT-only control, so improvements cannot be attributed specifically to the distillation term.

The original, unadapted teacher is an interface baseline. Its score on our custom JSON protocol is not a general intelligence score or a fair comparison against a teacher fine-tuned on the same task data.

## Scope and data

The proposed interface supports short text replies, create/list/complete/check tasks, save/read a preference, clarify missing arguments, and refuse unsupported operations. Replies are carried in JSON and can be displayed as text by the eventual client.

`dataset.py` generates 429 training, 47 validation and 62 test examples. Prompt templates are disjoint across splits. Task titles, numeric IDs and preference values are also held out. The action meanings and limited FAQ answers are shared across splits. The preference keys remain the same supported interface.

Training is class-balanced sampling with replacement. There are 160 planned steps, batch size four, and a 900-second training-only cap; the actual completed steps are recorded. The final checkpoint is fixed before test evaluation. No test-based checkpoint selection or retraining is performed. Validation data is not used for gradients.

Scoring is strict JSON schema plus exact arguments for action cases. For reply/clarify/refuse cases it additionally checks selected words. These are small-domain smoke tests; keyword matches cannot establish semantic correctness, broad chat ability, robustness, or safe autonomous execution. `qualitative-challenges.json` includes unseen conversation, negation and malformed requests for explicit review.

No funds, API inference, GPU rentals or public-chain transactions are used. Training, pruning, and export happen offline. The intended future runtime boundary includes tokenization, inference, memory, decoding and validated action execution on-chain. A user or keeper still submits transactions.

## Reproduce

Use the parent project's pinned Python environment (Python 3.12, torch 2.14.1+cpu, transformers 5.2.0). Download only public teacher model/config/tokenizer files at the revision in `teacher-lock.json`, with remote code disabled. Then:

```bash
python distillation-pilot/check_schema.py
python distillation-pilot/pilot.py --steps 160 --max-seconds 900
python distillation-pilot/assess_checkpoint.py --bits 8 4
```

`pilot.py` expects the pinned teacher in the Hugging Face cache. It runs the unadapted teacher and untrained student on a fixed validation subset, trains, saves BF16-rounded student weights, then evaluates in float32. The save format is not an EVM numeric specification.

`assess_checkpoint.py` reloads that saved checkpoint and tests per-row int8/int4 quantize/dequantize sensitivity. All arithmetic remains float32. It is not full fixed-point inference and does not measure gas.

Generated outputs are only parsed/scored. They never invoke actions. `dataset.validate` is a narrow Python schema check, not an audited smart-contract permission or security system.

## Gate before an on-chain port

1. Review raw generations and establish a broader, independently authored evaluation set for the actual product use case. Current templates are insufficient for a deployment decision.
2. Require reliable action selection, exact arguments and correct clarification behavior. Test negation, unsupported operations, prompt injection, multiple turns, multiple actions and state-dependent answers.
3. Choose precision on measured quality. Then implement integer tokenization/attention/norm/activation/decoding and compare the entire model against the chosen numeric reference.
4. Benchmark a full prompt and complete short reply locally, separating prefill, decode, state, tokenizer and deployment costs. Parameter ratios and CPU timing are not gas estimates.
5. Add independently enforced ownership, action allowlists, argument bounds, state checks and recovery. Generated text cannot grant itself permissions.

The original LFM EVM results remain preserved. **Neither 144 million execution gas nor 17.9 billion deployment gas is a cost estimate for this student.** Those are measurements of a different model's single block.

## Attribution and research

Derived from HuggingFaceTB/SmolLM2-135M-Instruct, revision `12fd25f77366fa6b3b4b768ec3050bf629380bac`. See `UPSTREAM-MODEL-CARD.md` and `APACHE-2.0.txt`. The model is modified by selecting fewer decoder layers and then task-adapting with distillation/SFT. This experiment does not imply endorsement by the original authors.

- https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct
- https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct/blob/12fd25f77366fa6b3b4b768ec3050bf629380bac/config.json
- https://arxiv.org/abs/2408.11796 — pruning/distillation research background; its larger-model results are not evidence of our student's capabilities or EVM costs.
