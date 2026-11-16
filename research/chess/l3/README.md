# GH0ST L3

Build the **fast base chain first**, then integrate the LLM and chess products. The initial core uses standard Nitro/Stylus, the official consensus-v61 machine, GH0ST native gas and Robinhood as parent. [Core build and configuration](core/README.md).

The clean node is built and locally tested. **No public L3, hosted RPC, server order or real token movement has been completed.** Parent/child integration is being rehearsed with local nodes and a clearly labeled mock token. Experimental LLM debug precompiles are excluded from the initial core.

## Verified core work

| Component | Evidence |
|---|---|
| Clean standard Nitro v3.12.2 | Pristine source, upstream Go1.25.12, ArbOS61, debug off; reproducible local native build |
| Official production machine | Canonical consensus-v61 root recovered from the SHA-verified official Linux image layer; no experimental model root used |
| Fast local sequencer | 96/96 measured native/Stylus transactions; chosen100ms minimum block delay; p95 approximately101–105ms |
| Solidity/Stylus | Real contract deployment, activation and execution on the running clean node |
| Factory route | Exact upstream templates and mock-token rollup initialized on a synthetic parent; 140 checks, ordinary code/initcode limits |
| Parent token | Read-only Robinhood checks confirm the expected GH0ST runtime, 18 decimals and basic ERC20 behavior; not a full audit |
| Genesis proposal | Exact pinned SDK pure helpers generate a standard61/debug-off configuration; no provider, signer or broadcast |

The burst fixture used eight concurrent senders and achieved about78 lightweight transactions/second. It is a bounded local workload, not maximum capacity, hosted latency or LLM throughput. The100ms setting is a minimum delay between non-empty blocks; execution and network conditions can make intervals longer. A sequencer receipt is separate from parent batch confirmation and final settlement. See [measured receipts](core/node/evidence/receipt-benchmark.json).

## Deployment direction

- Parent: Robinhood mainnet4663; native gas: the existing GH0ST ERC20.
- Proposed child ID4663001, screened against the public list but not registered or reserved.
- Standard Rollup data availability and official machine root; no custom model dependency for the first chain.
- Self-deployed factory and self-hosted nodes, with a reviewed operational/validation setup.
- GH0ST reimburses posting costs; operators still need parent ETH and a reviewed token pricer/rate.

Robinhood is absent from the current canonical-factory table. Self-deployment is documented but unsupported upstream, and the applicable Nitro/AEP terms still need to be handled. No license was accepted. [Factory documentation](https://docs.arbitrum.io/launch-arbitrum-chain/deploy/canonical-factory-contracts), [licensing](https://docs.arbitrum.io/launch-arbitrum-chain/overview/license).

The SDK's1WETH validator bond is a configurable default, not a universal launch fee. A project-run pilot and a separately reviewed smaller/custom bond are being considered; collateral asset/amount, validator custody and public access are not silently selected. See [gas policy](core/gas/README.md) and [deployment proposal](core/deployment/README.md).

**The user removed the old100ICP and0.003ETH spending ceilings.** Active plans use cost estimates and review with no replacement finite ceiling. Historical conversions/fees remain accounting records. No automatic top-ups were enabled. Existing fixed chess reward/entry amounts remain unchanged and are not available for an unapproved bond.

## Hosting and availability

Use the current core hosting research rather than the earlier single-server chess candidate. A fast public service needs redundant nodes, coordinated sequencer leadership, replicated coordination state, restricted administration, backups and tested recovery. Multiple containers or mirrored disks on one host do not provide independent failure protection. No provider or configuration guarantees literal zero downtime.

## Preserved future compute research

Further LLM work is deferred while the base L3 is built. These verified components remain available without being enabled in the core:

| Component | Verified research scope |
|---|---|
| [Small-model runtime](llm/README.md) | Complete TinyStories INT8/Q12/context64 variant;3,216,448 native/Wasm/oracle logits match |
| [Persistent model bridge](bridge/README.md) | Caller-bound jobs, exact checkpoints and all vocabulary logits; actual debug ABI/ArbOS tests |
| [State-write optimization](architecture/storage-optimization-plan.md) | Identical tested Geth state roots;29.16% lower fixture gas, still above ordinary limits; no CPU speed claim |
| [Experimental replay machine](nitro/replay/README.md) | Complete custom machine generated; full-model proof execution and an incorrect-result challenge remain unverified |
| [Paged registry](stylus/registry/README.md) |18 local EVM checks;64GiB format bound is not measured model capacity |

The unchanged Stockfish policy and one-million-GH0ST checkmate reward belong to the later chess product. Launching the standard base chain does not require claiming that the engine or a large LLM has already been ported. [Future architecture](architecture/README.md).

`capabilities.json` records exact component scopes. Source/evidence manifests pin local tests; cached binaries, model weights and keys remain ignored. All actual public-chain operations require a concrete deployment configuration rather than checking a planning flag.
