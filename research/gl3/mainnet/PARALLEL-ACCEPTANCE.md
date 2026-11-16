# GL3 · parallel acceptance work

[Acceptance notebook](README.md) · [Sequential history](../HISTORY.md) · [Remaining gates](../ROADMAP.md)

The next milestone separates real-token withdrawal, chess dispute handling and production restart checks. All builds and execution take place on isolated Runpod workers. Editing, transfers and publication remain local.

| Lane | Test being prepared/executed | Current boundary |
| --- | --- | --- |
| Native GH0ST withdrawal | Real token state in a pinned private fork; actual native Nitro child, child burn, actual rollup confirmation and outbox release | Privileged fast confirmation; private parent adapter; complete receipt checks pending |
| Chess dispute | Inherited challenge-manager terminal proof path over authentic custom-machine witnesses, followed by complete dispute integration | Seeded ancestors and synthetic history siblings are a bounded unit test, not full BoLD bisection or assertion confirmation |
| Production recovery | Complete unchanged decision across execution/consensus lifecycle restarts; cold VM reset and disabled native-mint controls | Graceful same-process lifecycle restart is distinct from a process kill or production daemon recovery |

The new fixtures are not marked passed by implementation, allocation or compilation. Results will be recorded after actual cloud execution. The previously completed two consecutive block replays and five real Solidity witness checks per block remain separately documented.

## Fixed strength and artifact controls

The full network, 24 million nodes, Hash128 MiB, Threads1, Skill20, disabled strength limiting and retained game state remain fixed. A native ELF metadata repair adds a non-executable-stack note without changing the engine program or weights. Its dumped NNUE bytes and final ELF require explicit verification.

## Storage and authority findings

Releasing the retained game clears admission/cache metadata but does not remove its immutable delta accounts. Database compaction alone does not reclaim those live state accounts. Long-history capacity and challenge-safe reclamation therefore remain launch gates.

Disabled native mint management at genesis is necessary but does not permanently constrain the chain owner. The owner can schedule activation after the upstream seven-day delay and then assign mint owners. Backing, upgrade/chain-owner custody and monitoring need an explicit production policy; research-only artificial balances must not enter a funded public genesis.

## Temporary resources

The live catalog and create/read-back results selected two16-vCPU/32GB workers atUSD0.56/hour each and one16-vCPU/128GB worker atUSD1.04/hour. Compute total isUSD2.16/hour plus temporary disks. These are disposable acceptance workers, not an approved recurring production hosting plan or evidence that every worker is continuously computing.

Robinhood mainnet remains undeployed. Full native-token parent compatibility, complete incorrect-engine-result dispute, long-history recovery/storage, matching production image/genesis/module root, fee pricing, operator controls and the applicable license path remain under review.
