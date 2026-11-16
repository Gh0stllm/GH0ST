# GL3 · Production acceptance

[Linux evidence](../README.md) · [Restart fixture](fixtures/system_tests/gl3_restart_acceptance_test.go) · [ELF hardening](harden_native_stack.py)

This directory prepares production acceptance. Its existence does not establish a mainnet launch. Builds, engine execution, contract tests and recovery checks run on Runpod; local work is limited to editing, source inspection and transfers.

## Verified in this milestone

The rebuilt Linux Nitro executable has a non-executable `GNU_STACK` (`RW`). Dumping its original embedded-network object still yields exactly 98,511,183 bytes with the pinned NNUE hash. This hardens ELF metadata without changing the engine program, policy or proof-machine root. [ELF evidence](evidence/native-stack-hardening.json) · [build identity](evidence/native-acceptance-build.json).

The actual execution and consensus nodes closed/reopened the same Pebble database at search cursors 64 and 2,048. Each restart discarded the live chess VM; the persisted head, state root, cursor and image root matched. The full decision then produced e7e5 /24,000,033 /depth 38 and the exact 163,085,439-byte canonical state. Restart plus the first real resumed transaction took 5.08 and 19.15 seconds respectively; those totals include node shutdown/startup and are not isolated block-time measurements. The complete fixture took 399.13 seconds, and Go printed `PASS`. [Restart result](evidence/sequencer-lifecycle-recovery.json) · [complete test log](evidence/sequencer-restart.log.gz).

Before the search, after both restarts and after completion, native management remained disabled with no mint owners. Owner/unauthorized mint attempts, adding a minter while disabled, immediate feature activation and unauthorized future activation all rejected. This validates the research child configuration; its artificial genesis balances do not demonstrate parent escrow backing.

The original full-search fixture treated any non-nil RPC error as a negative-call rejection. Those historical counters alone do not distinguish execution failures from transport or internal errors. Its exact earlier source is preserved in [the historical fixture](fixtures/historical/gl3_restart_acceptance_r31.go.txt); its report is not rewritten. Future runs use strict classification, and a separate short native-control regression verifies real RPC error codes/payloads/reasons before and after restart, without repeating the full chess search.

That separate regression passed with actual exit zero. Eight before/after calls produced code-3 EVM reverts with valid empty `0x` payloads; two unauthorized scheduling calls produced the pinned precompile wrapper's exact access-control execution error, recorded separately with code `-32000`. The classifier rejects cancellation, transport, deadline, internal RPC and malformed-payload failures. Its first run correctly refused an intrinsic-gas failure; increasing only the view-call allowance let execution reach the intended controls. An owner can simulate scheduling later activation successfully, while the setting remains unchanged after simulation. The accepted full-search binary and native executable hashes remain unchanged. [Strict native-control report](evidence/native-mint-controls-strict.json) · [classification summary](evidence/strict-mint-classification-summary.json) · [separate binary/source verification](evidence/strict-mint-verification.json).

The outer resource collector assumed cgroup v2 paths on a v1 host. It skipped resource rows and failed after the test returned, before persisting the operating-system exit code. That code remains explicitly unavailable; assertion/report and Go-PASS evidence remain intact. The measured v1 whole-pod peak was 25,549,938,688 bytes under a 32,000,000,000-byte limit, with zero allocation-limit failures, but this peak includes the earlier native/Rust builds. It is not a test-only memory peak, a 24 GB acceptance or a node/prover coexistence result. [Collection boundaries](evidence/restart-resources-summary.json) · [collector error](evidence/collector-failure.log.gz).

## Fixed engine identity

| Parameter | Required value |
| --- | --- |
| Stockfish source | `edb0d9db6731067ec50ce619ff372b463bc4dd5d` |
| Original NNUE | 98,511,183 bytes |
| NNUE SHA-256 | `1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2` |
| Portable engine SHA-256 | `1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc` |
| Search | 24,000,000 nodes; Hash 128 MiB; Threads 1; Skill 20; strength limiting disabled |
| Retention | Complete per-game transposition/history state |
| First complete decision | e7e5 /24,000,033 nodes /depth 38 |
| Complete retained-state SHA-256 | `5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6` |

The lazy proof-machine candidate is `0xd45324627b0b3118dfdf1ad585769024cfa6008da8cdcaa745de32edc724613b`. **Its terminal-block replay failed with guest heap exhaustion and is not accepted for production.** [Exact failure](../dispute/evidence/terminal-wavm-failure/replay-result.json). A cache-only replacement is under development; no replacement is accepted yet. The native executable uses the original portable program and Wazero compiler. Their agreement must be demonstrated against the same captured input, gas accounting, genesis and complete state transition; an unrelated official standard Nitro root cannot validate custom A14 behavior.

## Concrete acceptance work

| Gate | Required evidence |
| --- | --- |
| Native artifact permissions | ELF `GNU_STACK` lacks executable permission, original dumped network bytes match, rebuilt native tests retain exact search/canonical result |
| Graceful child recovery | Execution and consensus close/reopen the same Pebble directory; every live engine VM is discarded; persisted head, cursor and image root match; the full decision still matches every canonical byte |
| Terminal challenge input | Actual last compute receipt and parent-batch inclusion; saved terminal `InputJSON` SHA-256 and all four expected global-state fields; matching proof machine |
| Native token backing | Production native allocations are backed by parent escrow; native supply management is disabled, mint-owner list empty, unauthorized and disabled mint/configuration calls reject |
| Withdrawal and dispute | Complete native GH0ST deposit/child burn/confirmed parent withdrawal; actual wrong-engine-result challenge won by the honest validator |
| Retention and resources | Measured long-history cold recovery; live delta-account growth bounded; challenge-safe state availability and reclamation; accepted node/prover coexistence memory |
| Operator control | Concrete signer addresses and custody for chain owner, proxies, upgrade executor, validators, sequencer, batch poster and pricer; observable changes and recovery procedure |
| Parent and fee configuration | Verified Robinhood chain 4663, reviewed custom factory deployment, concrete ETH posting reserve and GH0ST/ETH reimbursement pricing |

The restart fixture adds only acceptance-tagged test seams. It is absent from ordinary production builds. It tests a graceful node lifecycle within one OS process, not a process kill, filesystem power loss or an already accepted hosting provider. It also uses explicitly artificial research balances; that allocation must not enter a backed production chain.

The Linux runner requires the pinned source/portable-program bundle, built native Rust library and headers, the matching custom-machine directory, and the pinned parent Geth executable at `/root/gl3-node/bin/geth`. It guards that Geth dependency before starting the fixture and sets its path explicitly. The cloud evidence also preserves the initial setup attempt that failed before any chess transaction because that prerequisite was absent.

## Native supply is a custody boundary

The pinned ArbOS source initializes native management to zero unless `ArbOSInit.NativeTokenSupplyManagementEnabled` is true. `ArbNativeTokenManager` only mints for configured native-token owners. `ArbOwner.AddNativeTokenOwner` rejects while management is disabled.

However, a chain owner can schedule native supply management to become enabled after the source's seven-day minimum and then add a minter. Proxy/upgrade authorities can also change the rules. An empty minter list at launch therefore does not eliminate privileged control. Production genesis must explicitly disable management, avoid unbacked native allocations, and bind those administrative powers to reviewed custody and monitoring.

Source locations: pinned Nitro `arbos/arbosState/arbosstate.go` initialization, `precompiles/ArbOwner.go` feature scheduling and minter management, and `precompiles/ArbNativeTokenManager.go` access checks and mint/burn accounting.

## Storage remains an STF gate

`ReleaseGame` clears reservation/live cache and marks metadata released. It does not erase the immutable delta bytecode accounts from current chain state. Database compaction is therefore not evidence that those still-live accounts have been reclaimed. First-decision raw deltas total about 1.618 GB; extrapolating 80 decisions across 20 games exceeds 2.5 TB before overhead, without proving that later decisions have the same rate.

Safe checkpointing and reclamation must retain complete engine state and challenge/replay availability. A semantic implementation changes the STF and requires a new machine root with fresh parity, replay and dispute acceptance. It must not be presented as an ordinary disk-cleanup setting.

## Configuration and licensing sources

Robinhood's documentation identifies chain 4663 as an ETH-gas Arbitrum L2 settling to Ethereum. It labels the public endpoint as rate limited and unsuitable for production; production parent RPC needs an appropriate provider and protected credentials. [Robinhood connection guide](https://docs.robinhood.com/chain/connecting/).

A rollup using GH0ST for gas still pays parent posting costs in ETH. Its registered fee-token pricer determines GH0ST reimbursement; the old private fixture's unit-rate mock is not a production market quote. [Custom gas-token rollup guide](https://docs.arbitrum.io/launch-arbitrum-chain/chain-config/costs/custom-gas-token-rollup).

Robinhood is absent from the current canonical factory table. The documented self-deployed-factory route is marked unsupported, so the private three-layer rehearsal does not itself confer upstream support. [Factory documentation](https://docs.arbitrum.io/launch-arbitrum-chain/deploy/canonical-factory-contracts).

The pinned Nitro source carries BSL 1.1 with an additional production-use grant and a stated change date of December 31, 2030. Current chain documentation describes the AEP route for other parent chains and its net-revenue terms. Applicable permissions, including any parent-specific arrangement and combined software distribution, need to be established for the final artifact. No agreement is accepted by these tests. [Arbitrum licensing guide](https://developer.arbitrum.io/launch-arbitrum-chain/overview/license).

Official pages checked November 17, 2026 IST. These are release-engineering boundaries, not a representation that production configuration, licensing or hosting has been accepted.
