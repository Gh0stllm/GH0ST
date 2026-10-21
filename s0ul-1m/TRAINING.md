# Advanced supervised training

`s0ul/train_advanced.py` preserves the original **984,192-parameter** model,
512-slot tokenizer and strict action grammar. It changes the training procedure,
not the architecture. The original trainer and pilot reports remain unchanged.

The objective remains response-token supervised cross entropy on checked
synthetic labels. This implementation does not claim distillation, pretrained
teacher knowledge, broad conversational competence or a deployed agent.

## One-hour research lane

```bash
python -m s0ul.train_advanced \
  --data data-v2 --output runs/scratch-42 \
  --steps 1000000 --duration-seconds 3600 --warmup-seconds 60 \
  --batch-size 32 --threads 2 --seed 42 --eval-every 250 \
  --learning-rate 0.001 --min-lr-ratio 0.1 --weight-decay 0.01 \
  --selection-examples 180 --patience 0
```

`--duration-seconds` uses actual monotonic run walltime, including validation
and checkpoint work after data/model preparation. Learning-rate warmup and
cosine decay use this observed elapsed time. The trainer stops after the
budget has elapsed, normally at the next optimizer boundary, and validates
the final state. Evaluation and file writes may cause a small overrun.
`--steps` is a safety ceiling in this mode: use a ceiling well above the
expected number of updates. Hitting the ceiling early reports
`step_limit_reached`, **not** a completed duration budget.

Duration mode requires `--patience 0`. No loss plateau can silently turn a
one-hour lane into a shorter run. An error, external cancellation or an
explicit `--max-run-steps` limit can still interrupt the run. A successful
one-hour report must show `status: duration_completed`,
`duration_budget_complete: true` and at least 3,600 observed elapsed seconds.
Optimizer-compute, validation and checkpoint timing diagnostics are reported
separately; their sum does not include every Python/logging overhead.

Run independent lanes in separate output directories. For example, compare a
scratch model at seed 42 and peak LR 0.001, another scratch model at seed 43
and LR 0.0005, and a warm-started model. Add
`--init-checkpoint runs/pilot-001/checkpoint.pt` for a warm start: its frozen
tokenizer and architecture must match. This starts a fresh optimizer and
schedule and records the source checkpoint hash. It is not teacher
distillation.

## Fixed-step training and controlled pause

```bash
python -m s0ul.train_advanced \
  --data data-v2 --output runs/step-lane \
  --steps 10000 --max-run-steps 2500 --warmup-steps 200 \
  --batch-size 32 --threads 4 --seed 42 --eval-every 250 \
  --learning-rate 0.001 --min-lr-ratio 0.1 --patience 0

python -m s0ul.train_advanced \
  --data data-v2 --output runs/step-lane \
  --steps 10000 --warmup-steps 200 \
  --batch-size 32 --threads 4 --seed 42 --eval-every 250 \
  --learning-rate 0.001 --min-lr-ratio 0.1 --patience 0 \
  --resume runs/step-lane/last-training-state.pt
```

With no duration budget, cosine decay follows optimizer steps and
`--warmup-steps` applies. `--max-run-steps` limits updates in the current
invocation without changing the planned schedule. The first command pauses
after 2,500 updates; the second continues toward the same 10,000-step schedule.
Nonzero patience optionally stops a step-based experiment after that many
validation intervals without a better selection score.

## Selection and evidence boundaries

- Only `train.jsonl` and `validation.jsonl` (or `val.jsonl`) are read. The
  trainer never opens a test split.
- A reproducible, approximately balanced subset of validation actions is
  frozen before optimization. `--selection-examples 0` uses all validation
  examples. The IDs are recorded, and the subset must cover all action types.
- Checkpoints are selected by **greedy exact action-and-argument count** on
  that subset. Full-validation response cross entropy breaks ties. Schema
  correctness and generated control tokens use the existing strict evaluator.
- Full-validation cross entropy is measured at every validation interval.
  Training loss alone never selects a checkpoint. Step zero is an eligible
  baseline so degradation cannot replace a better initialization.
- All lanes and candidate selection use training/validation data. Keep any
  final test/challenge split sealed until the campaign's chosen model and
  selection rule are fixed. Repeated validation selection is not a final
  independent performance estimate.

The optimizer is AdamW with betas (0.9, 0.95), epsilon 1e-8, gradient-norm
clipping at 1.0 and no weight decay on normalization gains. Reports include
actual example, non-padding input-token and response-token counts, LR,
pre-clipping gradient norm and walltime. No mixed precision or GPU speedup
is assumed by the recorded CPU procedure.

## Files and resume guarantees

| File | Contents |
| --- | --- |
| `checkpoint.pt` | Best standard `s0ul-training-v1` model; compatible with the existing evaluation, INT8 exporter and integer converter |
| `last-training-state.pt` | Last durable model, optimizer, next-step position, random states, schedule identity, best model and timing/counters |
| `training-report.json` | Completion reason, observed duration, pinned inputs, validation history and best checkpoint hash |
| `progress.json` | Same structured progress at the latest durable boundary |
| `training-log.jsonl` | Validation events with training counters and diagnostics |

Resume verifies the exact architecture, full tokenizer specification, dataset
hashes, validation selection, source-file hashes, PyTorch version and schedule
settings. Change the output directory if desired, but keep the original
planned total steps/duration and the other pinned settings. Initialization
and resume are mutually exclusive. The resume checkpoint is read using
PyTorch `weights_only=True` and contains only tensors and simple containers.

The fixed-step path is tested for identical model weights, optimizer moments,
sampler/torch RNG state, counters and validation decisions after a clean
pause/resume. Duration-based schedules depend on measured runtime; changes
in machine speed, interruptions or validation timing can change their exact
trajectory. Saved elapsed time is measured at the durable snapshot boundary;
time spent outside the running process is not counted toward the budget.

If a process is killed between checkpoints, resume from its latest durable
`last-training-state.pt`. Do not treat an interrupted report or merely queued
workflow as a completed hour of training.

```bash
python -m unittest discover -s tests -p 'test_training_advanced.py' -v
```
