![GH0ST GL3](assets/gl3-cover.png)

# GH0ST L3 · GL3 research notebook

[Open the full overview](../../README.md) · [History](HISTORY.md) · [Findings](FINDINGS.md) · [Roadmap](ROADMAP.md)

This branch records the path from a full-strength chess workload to a private Robinhood-settled compute chain. The standard base works locally. The full-strength Stockfish search now resumes across blocks: 128 independent transfers confirmed at about112ms median while it remained pending. The corrected cache passes exact gas equality and fresh replay of two consecutive blocks; complete WAVM replay and production acceptance remain active research.

| Notebook | Read for |
| --- | --- |
| [History](HISTORY.md) | Sequential decisions, failed approaches and actual milestones |
| [Findings](FINDINGS.md) | Measured resources, scope and unresolved questions |
| [Roadmap](ROADMAP.md) | Achieved work and the next testable gates |
| [Machine-readable status](status.json) | Current workload and verified deployment boundaries |
| [Append-only journal](journal.jsonl) | Ordered research events linked to their evidence |
| [Chess memory study](../chess/l3/core/hosting/chess-workload-20261116/README.md) | Full network,24m nodes, retained state and hosting measurements |

[Active full chess integration](chess/README.md) · [USD 100 hosting direction](chess/HOSTING.md)

[Chess across fast blocks: measured results and replay fixes](chess/sliced/README.md)
