# Final artifact pairing

> **A production release is not accepted by this packet.** The ordinary source05 binaries, source identities and configuration parsing passed. Production transport settings, genesis, authority/funding settings, complete dispute settlement and 20-game storage remain separate gates.

The ordinary native CLI `13ba3c…1f38` was rebuilt and exercised earlier, including the private cursor64 CLI crash rehearsal. A fresh Runpod hash still matches that exact executable. Its engine uses the original portable program `1d6504…5e5bc`, native archive `a8b46c…beebd` and 98,511,183-byte network `1a298a…dfc2`.

The source audit compares the actual Go-selected ordinary node and validator dependency closures: **6,195 original records, 6,201 for final03 and 6,202 for source05**. Source05 has exactly fourteen host changes: the eleven reviewed cache files plus the three operator-hook files. All 6,202 selected files were rehashed after compilation. There is no selected Geth, precompile, engine or runtime source drift. This is source pairing, not acceptance of an ungenerated production genesis.

The first ordinary final03 build hit its explicit task-scratch guard and received an actual SIGTERM exit `−15`; it produced no final executable. The incomplete temporary directory was inventoried, checked for open owners, and deleted with root authorization. Logs and source evidence remain. That event was a resource stop, not a compiler or model failure. The approved source05 retry used a three-billion-byte task guard, a six-billion-byte free-space floor and two CPU-affinity slots.

## Ordinary binaries and smoke checks

| Artifact | Actual result |
|---|---|
| Node | 387,901,976 bytes; SHA-256 `0724b8cc02c8205deb24eaad7b2c3b3a7f87778cdb35afa2cd884c48338a9e3d`; build exit0 in64.588s |
| Validator | 353,097,184 bytes; SHA-256 `e26b0a9f8c4e61ff63d76749308981d546c4f71045c2ee9aa9644487fa61c083`; build exit0 in14.812s |
| ELF stack | Both `GNU_STACK RW`, without execute permission |
| Ordinary node parser | Default cache false/one entry/four hours; explicit enable parses true |
| Help/version | Both help commands exit0; node version exit0, `local+unknown-unknown` |
| Execution scope | Configuration parsing only; no node, chain, engine, prover or activation |

[Complete results](ordinary05/evidence/results.json) · [artifact/input lock](ordinary05/artifact-lock.json) · [source closure](ordinary05/source-pairing-summary.json) · [native link/tool identities](ordinary05/native-inputs.json) · [Runpod build reproducer](build-ordinary05.py).

Both ordinary binaries still default to `validation.use-jit=true`. The reviewed interpreter configuration must explicitly set it to false. The ordinary raw source05 profile also does not silently inherit the private fixture's before-conversion upload-admission/log-suppression helper or its explicit large-request cap. Production activation needs that transport, authentication and resource policy reviewed and composed deliberately.

The binaries and exact selected865 machine/snapshot are preserved in an owner-only archive. All 63 decompressed members were byte/hash verified on Runpod: 713,234,002 compressed bytes, SHA-256 `67916f26c6e9e0fb9bef689c750d1ca6d25d9c93a9c733e9cf3d6aebf0dc363c`. [Backup receipt](ordinary05/backup-receipt.json). The binaries are not committed to Git.

## An explicit operator switch

The private dispute fixture could call the reviewed cache's Go API directly. The ordinary node had no operator setting that activated it. The isolated **source05** candidate adds:

```text
node.block-validator.experimental-bold-execution-cache.enable = false
node.block-validator.experimental-bold-execution-cache.max-entries = 1
node.block-validator.experimental-bold-execution-cache.idle-timeout = 4h
```

An operator must opt in. The enabled startup path requires a resolved nonzero module root, one retained entry per client, a positive timeout, and paired supported RPC clients. Redis, invalid/typed-nil clients and already owned/stopped RPC clients reject before starting resources. Each BOLD client starts before its cache is enabled. A failed RPC startup attempt is stopped because it may already have opened a transport; earlier successful starts then roll back in reverse order. Concurrent or repeated enabled startup cannot stop an existing owner. The disabled startup body and normal shutdown ordering remain unchanged.

[Frozen source](source05/frozen/manifest.json) · [normal/race results](source05/evidence/results.json) · [acceptance scope](source05/evidence/acceptance.json) · [three-file patch](source05/frozen/operator-hook.patch).

Both Runpod suites passed **10 top-level tests and 24 subtests**, including a real reviewed BOLD client that reused one bounded mock execution for two proof requests after startup, an actual loopback RPC handshake failure, and shared/concurrent startup ownership. No chess engine, prover, full chain or public chain was started by those tests. The selected guest, machine and engine are unchanged. Full dispute fixtures use the separate final03 profile.

The earlier [source04 passes](source04/evidence/acceptance.json) remain preserved. They covered the original seven startup/config tests but did not exercise a partially opened RPC transport. Source review found that gap; source05 adds the actual failed-handshake regression and cleanup rather than relabeling the earlier tests.

## Genesis and ownership inputs

[Configuration review](configuration-review.json) is a concrete input inventory, deliberately not a runnable configuration. Missing addresses and prices are `null`; deterministic test identities and mock rates are not substituted for them.

Before generating production genesis, the selected custom native implementation must calculate the exact header/state root from the final GH0ST-gas configuration and zero-native-balance model/account seed. The deployed parent genesis assertion must reproduce those values. The earlier ordinary CLI smoke used an artificial, pre-BoLD ETH parent and research balances; it does not meet that requirement. An official standard machine cannot validate this custom A14 state transition.

The actual chain owner, upgrade/proxy custody, validator/fast-confirmer permissions, sequencer/coordinator, batch poster, fee-token pricer and emergency authority remain unselected. Native supply management must launch disabled with no mint owners and no unbacked genesis allocation. Its delayed reactivation/upgrade authority still needs reviewed custody and monitoring. GH0ST gas does not remove the parent ETH posting reserve, pricer, collateral or bridge-liability decisions.

## Release boundaries

| Gate | Current evidence | Still required |
|---|---|---|
| Consensus/model identity | Selected865 reference terminal replay; exact model/native identities; fourteen-file host-only closure difference | Complete configured release pairing |
| Operator activation | Source05 normal/race startup/config/ownership tests and ordinary parser smoke | Final production transport/authentication/configuration and actual activation acceptance |
| Genesis | Earlier private CLI and native-parent bridge fixtures, each with explicit scope | One final custom GH0ST-gas genesis, exact parent assertion, final roles |
| Disputes | Terminal reference and authentic witness checks; complete lifecycle owned separately | Full natural dispute, exact terminal assertion confirmation and collateral reconciliation |
| Capacity | Bounded tests and storage research | 20 games, challenge-safe retained data, measured production RAM/disk/throughput |
| Authority and finances | Disabled mint research tests; no financial changes in this lane | Concrete custody, pricing/reserves/collateral and license-path review |

All Go metadata, compilation, smoke checks, engine/proof work and tests ran on Runpod. Local work only edits, inspects and transfers source/evidence. No mainnet transaction, purchase, wallet read, funding operation or license acceptance occurred.
