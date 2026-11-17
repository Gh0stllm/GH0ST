# GL3 · launch packet

[Acceptance notebook](../README.md) · [Production candidate](../production/README.md) · [Locked candidate](artifact-lock.json) · [Operator decisions](decisions.json)

**Prepared for review, not approved for deployment.** This packet separates the recorded build from the operator choices and acceptance results still needed for a funded Robinhood launch. No contract, hosting account, license agreement or financial action is created by these files. Official sources were checked **17 November 2026 IST**.

**Current gate: RUNNING_NOT_ACCEPTED.** Combined C preserves native header/gas/canonical state and passes full real-C WASM32 diagnostics with all four fields, **2,000.5 MiB Go / 711,655,424 bytes C**. One four-hour-bounded exact-counter interpreter started at **2026-11-17 00:35:20 UTC**; no actual exit, final step count, BoLD geometry or new lifecycle is accepted. Production and deployment remain false. [Combined diagnostic](../diagnostics/aot-jit/evidence/combined-final/summary.json) · [Launch record](../production/bounded-restore/scheduling/comparison/C-combined/interpreter/process.json).

Historical d453/c03c failures and the 48-edge stopped trial are retained. Guarded c03c exited 1 after 3,575.36s; its dependent lifecycle is **STOPPED_NOT_ACCEPTED** with zero accepted one-step/confirmation/refund results. [Exact failure](../production/bounded-restore/evidence/guarded-replay-failure/replay-result.json) · [Stopped audit](../dispute/full-lifecycle/audit/evidence/stopped-current/stopped-summary.json).

## Acceptance controller hardening

The future controller passes syntax and 87 normal/87 optimized pure regressions. Eight auditor boundary units, two actual cloud-compiled ELF refusal checks and final auxiliary-module preflight pass. These reject stale/mismatched evidence, invalid entry points and absent dependencies; they do not establish complete fresh integration or a full engine/proof pass. The stopped fixture used different frozen source. [Expanded guards](../dispute/full-lifecycle/controller-tests/transition-evidence/result.json), [actual ELF checks](../dispute/full-lifecycle/controller-tests/entrypoint-evidence/result.json), [dependency check](../dispute/full-lifecycle/controller-tests/auxiliary-evidence/result.json).

A new acceptance run requires exact terminal-transition one-step ancestry → exact target assertion confirmation → exact nonzero edge-collateral refund with successful receipts/transfers/reconciled balances. Assertion-stake withdrawal is outside this scope. The stopped fresh input `c419b88eec6e62cffc6afed5c6a38b7bce26e13512ab8ed7982ffb793f781f48` differs from original `bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90` used by the failed c03c replay. Broad fixture reports cannot grant acceptance.

The earlier STOP diagnostics are distinct from the later full real-C diagnostic; neither substitutes for interpreter/OSP acceptance. The exact-counter CLI's completed 7-step tiny-WASM smoke executes no chess engine and supplies no full terminal count. The separate [checkpoint study](../storage/checkpoint-study/README.md) measures about 146 MB versus 1.619 GB on an authenticated **preterminal** image with exact offline all-byte round-trip. Its independent codec/emulator/harness prototype is source work, not production STF/cleanup or 20-game capacity.

## The exact candidate

| Component | Locked identity | Scope |
| --- | --- | --- |
| Native Linux client | Prior hardened client SHA-256 `d2785471435cc3420f14b61ddfd8bc47e8e5fd7f23cbf916db303603cc51b011` | Historical native record; a matching repaired production client/genesis pair is not frozen |
| Selected combined C proof candidate | Root `0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086` | Native/real-C diagnostic pass; single bounded interpreter **RUNNING_NOT_ACCEPTED** |
| Candidate machine file | SHA-256 `4bf7fe54c28ad0b6f2620df3ee6b4c6d87452f9ab76ec8be294eb7d4c934770e` | Generated selected machine; final exit and exact step/BoLD geometry pending |
| Selected Go guest | SHA-256 `8d18145460e5f4c649895728fa089a52a04ead2c3fa5e7d10789d72d7de42fbd` | Combined restore scheduling + authenticated immutable seed reading; no engine-strength change |
| Real C companion | SHA-256 `b481f92a852a685411db42c8b51abd3a3f2c8cd8c5d0c1c8eed2962d986f5555` | Exact unchanged engine bytes in diagnostics and selected proof machine |
| Original portable engine | SHA-256 `1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc` | Full original program; no model or search reduction |
| NNUE | 98,511,183 bytes; SHA-256 `1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2` | Dumped bytes verified unchanged by the native hardening check |
| Contract source | `4341b132cfbdcc980ead03765ca5224ff6cb5d97` | Actual pinned Nitro contract sources/artifacts |
| Production genesis and deployed addresses | **Not generated / not deployed** | A final allocation, chain-info file and creation calldata must be frozen together |

Sources: [native build record](../production/evidence/native-acceptance-build.json), [stack/weight verification](../production/evidence/native-stack-hardening.json), [next-block replay](../evidence/cloud-next-wavm-replay.json), [next-block Solidity checks](../evidence/cloud-next-complete-solidity-steps.json).

Current source/artifact binding: [selected machine manifest](../production/bounded-restore/scheduling/comparison/C-combined/machine-manifest.json), [selected source provenance](../production/bounded-restore/scheduling/comparison/C-combined/selected-source-provenance.json), [native equivalence](../diagnostics/aot-jit/evidence/combined-final/source-spec/native-comparison.json), [bounded interpreter launch](../production/bounded-restore/scheduling/comparison/C-combined/interpreter/process.json). The collector (65941) records direct-child exit before optional processing; prover 65942 uses exact-counter tool `cc5c9de07b2a739978e383cd4ac4baee3a1d49761c5c75ad414e12056cd7ab27`. Raw final steps and raw-counter-plus-one/start-offset geometry are pending. The original input is `bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90`, not the stopped trial's fresh `c419…` input.

The historical native cachefix root `0x52c7…fa4e5` identifies a different recorded machine artifact. The standard official root `0xc10c…dc97` belongs to the clean upstream client used by the withdrawal baseline. Neither is a substitute for the selected custom machine. A standard-client withdrawal pass cannot certify custom A14 execution. The final client, machine, genesis state, parent contracts and validator configuration must agree as one release. The recorded d453 guest failed after 2,153.854 seconds with actual exit 1 while restoring historical deltas through `StateDB.GetCode`. Roughly 4 GB of guest heap was exhausted; the 128 GB host was not OOM. Native decision/capture passes do not supersede that failure, and the new native repair passes do not change that historical outcome. The historical c03c guarded replacement also failed; the cache-only reference root was deliberately not long-replayed. Selected combined C is a separate running attempt. [Guarded build](../production/bounded-restore/evidence/guard-machine-build-result.json), [native/canonical acceptance](../production/bounded-restore/README.md).

The strength lock remains Stockfish `edb0d9db6731067ec50ce619ff372b463bc4dd5d`, 24 million nodes, Hash 128 MiB, Threads 1, Skill 20, strength limiting disabled and retained per-game state. A 100 ms block target is not a 100 ms chess move.

## Robinhood is the parent

Use parent chain **4663**, whose posting currency is **ETH**. The public RPC is `https://rpc.mainnet.chain.robinhood.com`; official documentation marks it rate limited and unsuitable as the production provider. Select a protected provider endpoint and an independent fallback before operation. Public primary and delayed feed URLs are `wss://feed.mainnet.chain.robinhood.com` and `wss://delayed-feed.mainnet.chain.robinhood.com`. [Robinhood connection guide](https://docs.robinhood.com/chain/connecting/).

Robinhood is absent from the maintained canonical factory table. The documented self-deployed-factory route is explicitly unsupported. The pinned private three-layer factory rehearsal establishes bounded compatibility evidence; it does not confer upstream support or a public factory address. Preserve the tested **104857-byte L2 parent maximum-data setting**, and verify the actual parent host behavior rather than promoting the Ganache parent adapter. [Canonical factory documentation](https://docs.arbitrum.io/launch-arbitrum-chain/deploy/canonical-factory-contracts).

The parent-side GH0ST token is `0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559`, 18 decimals. The observed runtime hash is `0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164`. Recheck it at the release snapshot. The candidate child chain ID **4663001** is not reserved or collision-checked by this packet.

## Gas, backing and operator roles

Parent posting still consumes ETH when users pay GH0ST. A registered pricer supplies the reimbursement conversion; the upstream requirements exclude transfer-fee/rebasing/callback tokens and require direct ERC20 transfers/approvals. The existing unit-rate test pricer is not a market rate. [Custom-gas-token requirements](https://docs.arbitrum.io/launch-arbitrum-chain/chain-config/costs/custom-gas-token-rollup).

The pinned `IFeeTokenPricer.getExchangeRate()` uses **child fee tokens per parent token, scaled by 10¹⁸**. For this pair, the returned value represents GH0ST per ETH, not its inverse. The `SequencerInbox` scales parent gas price by that ratio. A missing pricer in this pinned code skips the reimbursement report; that is not free parent hosting. [Pinned interface](https://github.com/OffchainLabs/nitro-contracts/blob/4341b132cfbdcc980ead03765ca5224ff6cb5d97/src/bridge/ISequencerInbox.sol), [implementation](https://github.com/OffchainLabs/nitro-contracts/blob/4341b132cfbdcc980ead03765ca5224ff6cb5d97/src/bridge/SequencerInbox.sol).

An owner-updated pricer is the simplest pilot candidate when GH0ST operates both owner and batch poster. Its actual source, starting ratio, update authority, stale-rate policy and recovery behavior still need review. Do not promote `1e18` from a test fixture. Determine an ETH posting reserve from the exact deployment/batch/assertion calldata, stress fee caps and the chosen replenishment interval. No reliable mainnet reserve amount follows from the private fixture's fake balances or total gas count.

| Authority | Required release record |
| --- | --- |
| Rollup/upgrade executor and child chain owner | Exact addresses, custody/approval policy, timelock or emergency authority, and tested recovery |
| Sequencer and batch poster | Separate online operational credentials; exact permitted posters/managers and ETH reserve account |
| Validator(s) | Exact addresses, permissioned/permissionless policy, stake asset/amounts and active challenge responsibility |
| Fee pricer | Exact contract/source and rate-update authority |
| Native token management | Disabled genesis flag, empty mint-owner list, no artificial unbacked native allocations, ongoing activation/owner monitoring |
| Public RPC | Accepted bounds for expensive simulation, recording and queue admission; protected operator endpoints |

Genesis-disabled native minting is not permanent protection from its owner: the pinned owner path can schedule activation after the seven-day minimum and then add minters. The native supply must remain backed by parent escrow, and the upgrade/chain-owner custody model must account for that power. Research faucet allocations must not enter the funded public genesis. [Reviewed source finding](../production/README.md#native-supply-is-a-custody-boundary).

## Bond and withdrawal finality

The pinned BoLD `RollupUserLogic` requires a nonzero ERC20 stake-token address. Bond asset and base/minibond amounts are configurable; **1 WETH is not a universal launch fee**. The old factory rehearsal used one GHMOCK base bond and `[0, 0.5, 0.25]` GHMOCK minibonds. Those are test parameters, not economically reviewed production amounts. [Pinned contract](https://github.com/OffchainLabs/nitro-contracts/blob/4341b132cfbdcc980ead03765ca5224ff6cb5d97/src/rollup/RollupUserLogic.sol), [validator configuration](https://docs.arbitrum.io/launch-arbitrum-chain/chain-config/validation/bond-and-validator).

A conservative candidate keeps ordinary challenge-based confirmation and `anyTrustFastConfirmer = 0x0000000000000000000000000000000000000000`. The existing helper's main period is 45818 and minimum assertion period 75, measured through the parent's Ethereum block-number view rather than the child's 100 ms blocks. Its BoLD grace value is only 10: review the pinned ABI/configuration and response budget instead of treating that private setting, or a legacy documentation field, as a production default. [Challenge-period documentation](https://docs.arbitrum.io/launch-arbitrum-chain/chain-config/validation/challenge-period).

The repeated adapted-fork tests and separate actual native-parent observed-state flow exercise genuine transfer/burn/outbox machinery but add trusted confirmation. The latter traces all 82 committed parent transactions and seven token storage keys with zero unmatched dependencies; it remains a sparse observed account clone, not a full canonical ledger or authenticated Merkle-proof reconstruction. Enabling such a confirmer publicly changes the trust model and needs an explicit committee/custody choice; it does not become permissionless finality because a private test completes quickly. [Fast-withdrawal documentation](https://docs.arbitrum.io/launch-arbitrum-chain/chain-config/validation/fast-withdrawals).

## License path remains an operator decision

The pinned Nitro license is BSL 1.1 with a change date of 31 December 2030. Its grant includes named Covered chains, future DAO designations and qualifying descendants. Robinhood being an Arbitrum L2 does not itself establish its Covered-chain status. Record the applicable designation, written arrangement or AEP path for this exact deployment before production use. [Pinned license](https://github.com/OffchainLabs/nitro/blob/v3.12.2/LICENSE.md).

Current chain documentation describes AEP for other parents, with 8% of net chain revenue to the DAO and 2% to the developer guild. The Foundation's formula deducts settlement/DA costs, not ordinary hosting/compute bills, from protocol revenue. Do not budget this as 10% of profit after the server invoice. These files accept no agreement and establish no parent-specific exemption. [Licensing guide](https://developer.arbitrum.io/launch-arbitrum-chain/overview/license), [fee formula](https://docs.arbitrum.foundation/calculate-aep-fees), [published terms](https://docs.arbitrum.foundation/aep/ArbitrumExpansionProgramTerms.pdf).

The final distribution also needs the corresponding engine/network sources and notices: Stockfish is GPL-licensed. The combined release's distribution obligations have not been accepted or resolved by a native build test. [Stockfish source and license](https://stockfishchess.org/download/).

## A real budget screen, not a hosting order

The live official Hetzner auction feed listed **#3113605**, Core i7-6700, **64 GB RAM and 2×512 GB M.2 NVMe**, at **$87/month base + $1.90/month IPv4**, with **$0 setup**. This is a candidate for an unchanged-engine acceptance test, not an accepted production host. Tax, billing country, backups, selected RAID layout, current stock and checkout total are not verified. [Official auction](https://www.hetzner.com/sb/), [anonymous catalog feed used by that page](https://www.hetzner.com/_resources/app/data/app/live_data_sb.json), [saved observation](hosting-observation.json).

Its storage cannot substantiate the 20-game goal: mirrored capacity is roughly one 512 GB disk before overhead, while the illustrative first-decision projection exceeds 2.5 TB raw for 20×80 Black decisions. The current proof path has already exceeded 24 GB; its isolated peak is 39.05 GB, before accepting co-hosted production services. A 64 GB candidate needs a hard-limit node/prover/recovery test; an old CPU also needs measured block/move timing. Neither capacity nor zero downtime follows from the price.

**No complete all-in $100/month production setup meeting the current memory, latency, 20-game storage and recovery requirements is verified.** Keep the $100 preference intact while the retention design and measured capacity are resolved; do not silently buy a slower HDD configuration or shorten the engine search. One host is one failure domain, with independent backup/restore still required.

## Release decision

The operator packet needs five filled decisions: applicable license path; final owner/upgrade/validator custody; collateral and finality; fee pricer and ETH reserve; and accepted hosting/retention capacity. Native equivalence and the real-C diagnostic pass, but the release still needs completed selected-C interpreter replay, exact final step/BoLD geometry review and a matching artifact/genesis rehearsal, then a fresh complete wrong-engine-result dispute. Production token backing/configuration, recovery/storage and public receipt gates remain open. Until linked and reviewed, `deploymentReady` remains false in [decisions.json](decisions.json).

The historical c03c replay and stopped lifecycle are not overwritten. The only current long run is the selected-C four-hour-bounded interpreter, **RUNNING_NOT_ACCEPTED**; no lifecycle has restarted. Only the temporary 128 GB worker remains at USD 1.04/hour compute plus disk. All tests run on Runpod; no mainnet funds were moved or production hosting ordered by this packet.
