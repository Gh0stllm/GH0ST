# Full-game adversarial strength benchmark

Status: the original clear-cache baseline is frozen after **six complete games**
against 12m-node White: **five legal draws and one White checkmate**. The Larsen
line checkmated GH0ST at ply 195 (`98.Qa8#`). Four active 24m games and two queued
24m games were stopped as unfinished to prioritise repair; they are not draws.
See [the operator stop note](results/baseline-3m/STOP-NOTE.md) and complete records.
A single known winning line is material for a deterministic repeated-prize bot,
regardless of a low selected-suite average. Paid activation remains closed.

This tests a verified native CPU
proxy of the current **Stockfish 19 / full NNUE / 3m-node / Black** search policy.
It does not establish the strength, gas cost or correctness of a Solidity engine.
It is not a public ICP game or a prize payout.

The optimized official native build first matched the existing direct C ABI probe
at three million nodes on Black after `1.e4` and Kiwipete, exactly in move, actual
nodes and completed depth. [Reference evidence](reference-verification.json).
The underlying engine/network pins match the separate local ICP execution tests.
Architecture-optimized native execution is used to make full games practical;
runtime speed is not interpreted as ICP latency.

## Match policy

- GH0ST is Black: 3,000,000 target nodes per decision, 128 MiB hash, one worker,
  maximum skill, strength limiting disabled, no pondering or tablebase files.
  `ucinewgame` clears TT and search histories before **each** GH0ST decision,
  matching the current engine adapter. Full move history is supplied every time.
- The adversary is White: the same pinned full-strength Stockfish 19, with
  **12,000,000 or 24,000,000 target nodes per decision** and its ordinary cache
  retained across moves. These are larger-budget, stronger configurations; no
  unverified absolute Elo is assigned.
- Every game begins at the normal initial position. Only White's first move is
  fixed: `e4`, `d4`, `c4`, `Nf3`, `g3` or `b3`. These are disclosed legal player
  choices; **no GH0ST move is forced**. Twelve deterministic selected-opening
  games are planned, six at each challenger budget.
- Only a legal White checkmate counts as the bounty-winning outcome. Legal Black
  checkmates and natural/validly claimed draws are recorded separately. Checkmate
  takes precedence over move-clock draws. GH0ST claims current threefold/50-move
  draws as its protocol does; White never elects a voluntary draw, including an intended-move claim, because only checkmate earns the bounty. Mandatory draws remain in force.
- There is no evaluation-score resignation or draw adjudication. A work-budget
  stop, resource-ply ceiling or error is **unfinished**, never a draw or mate.

The harness checks every returned move for legality, verifies that each search
reached its target nodes (or the pinned maximum depth 245), and saves the full
move history, FENs, actual nodes/depth, scores, PVs and PGN after every ply. Four
games may run in parallel. The corrected run has a 45-minute wall-work budget; any
unfinished games remain visible and excluded from completed-game percentages.

Results are in [results/baseline-3m](results/baseline-3m/). `summary.json` is updated
when games finish. This suite is deterministic and selected, not an independent
random sample of future players. Its observed fraction is not a calibrated user
win probability, an Elo measurement, or evidence of prize-pool profitability.

## Reproduce

Use a workspace-local Python environment with `requirements.txt`. Build the official
native binary with the parent engine's pinned source (`make build ARCH=apple-silicon
COMP=clang` on the tested Apple M5). The existing scalar C ABI probe is built by
`engine/tools/build_native.py`. From this directory:

```sh
.cache/venv/bin/python verify_reference.py
.cache/venv/bin/python -m unittest test_adjudication.py
.cache/venv/bin/python run_matches.py --games 12 --workers 4 --minutes 45
```

The reference report records exact binary hashes, source/net pins, configuration,
and independent probe outputs. The game configuration records software version,
node budgets, cache policy, selected opening choices and stopping conditions.
Large binaries/environments remain ignored; source and completed evidence are public.

The superseded incomplete run is preserved under `results/superseded-white-claims-partial/`. It completed zero games and contributes no win/draw/checkmate counts. It was stopped to remove voluntary White draw claims and restart with the stronger bounty-hunter policy.

## Conditional repair experiment

`run_repair.py` refuses an unfinished/drawn baseline was run against the actual Larsen checkmate; its optional full-game comparison was later stopped as unfinished when the user requested faster completion. If a
legal White checkmate is found, it independently compares a 10m-node native defence
with the direct C ABI on that opening, replays the known attack only until the first
new Black move, and starts a separate fresh full game against the 24m challenger.
It preserves the baseline and does not alter an engine/canister/configuration in
production. A first divergence is explicitly **not** a repair proof, and a single
fresh game is not a prize-safety guarantee. It should run only after a real mate,
with worker capacity coordinated separately. Repair experiments are stored separately:

- `results/repair-10m-larsen/`: Black 10m with per-decision clear, against White
  24m retained. The direct C ABI 10m reference matched exactly; the old attack first
  diverged at Black ply 6 (`...Nf6` instead of `...d5`). The fresh 10m-vs-24m
  game was stopped at 136 plies as unfinished at the user's request;
  no full-game repair result is assigned.
- `results/repair-retained3m-vs12m-larsen/`: Black still 3m, but retaining its own
  TT and histories **within one isolated game**, against White 12m retained. The
  original first empty-cache response matched exactly; the old attack first
  diverged at Black ply 8 (`...Bd6` instead of `...e4`). The fresh full game
  completed in a legal Black threefold-claim draw after 63 plies. This is a changed cache
  policy that has not been implemented or equivalence-tested on ICP or Solidity.

- `results/repair-retained3m-vs24m-larsen/`: a further fresh native-only game
  against the 24m challenger completed in a legal Black threefold-claim draw
  after 57 plies, with the same per-game retained Black cache policy.

Old-line divergences alone are preliminary mechanism observations. The completed
63-ply and 57-ply draws are two case-specific outcomes from the same starting
choice, not a general repair or win-rate proof.
Neither candidate is selected for production or establishes general prize safety.

Retained-cache porting detail: in pinned Stockfish 19, assigning `Hash=128` again
invokes the option callback and reallocates/clears the TT even when the value is
unchanged. The retained native candidate configures Hash/Threads/NumaPolicy once
per game, and uses a stable UCI game token for all Black turns. A canister port
must skip both per-decision `search_clear` and option resets that rebuild the
worker/TT, while preserving isolation between games. This benchmark has not
implemented that production memory/queue/controller policy.

## Higher-budget retained-cache reference

`run_tightest.py` starts a separate new run at
`results/retained24m-vs48m/`: full Stockfish 19, Hash128, one worker, Black
24,000,000 target nodes with per-game retained TT/histories, against a White
48,000,000-node retained-cache challenger. The two starting choices are `1.b3`
(the previous attack family) and `1.e4`. Only White's first move is forced; all
Black moves and subsequent White moves are searched.

White never elects optional draw claims. Black may claim a current threefold or
50-move draw; mandatory draw conditions and checkmate precedence are unchanged.
The run has no implicit wall-time adjudication. An explicit operator stop, engine
error or disclosed 1,024-ply resource ceiling remains unfinished, never a draw.
Both games have separate engine instances and stable per-colour UCI game tokens.
There is no cross-game cache sharing or production configuration mutation.

This is a **new native-only strength reference** for a larger target budget.
Completed whole-game results, when available, must be distinguished from selected
ICP decision tests, local Solidity tests and any public deployment. No Elo, public
checkmate probability or guaranteed prize safety is inferred from two games.

```sh
.cache/venv/bin/python run_tightest.py --openings larsen,king-pawn --workers 2
```
