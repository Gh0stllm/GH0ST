# GL3 · chain first

Build the base GL3 chain before adding chess or model execution. The active foundation is **standard Nitro 3.12.2, ArbOS 61, Solidity and Stylus**, with Robinhood as the intended parent and $GH0ST as the intended native gas token. Debug/model/chess precompiles are excluded.

| Workstream | Current evidence | Remaining gate |
|---|---|---|
| Clean node and official machine | Official binary SHA `d9e778d3c513e106dab9de8ef04be9500093b0638cfd463e4d4ec542c214c4ed`; official consensus-v61 root below | Final production configuration and genesis binding |
| Cloud base functionality | Fresh Runpod test exits0 in2.609s; EVM return42, standard Stylus activation/signed-dot−31;16/16 measured transactions, receipt p95≈105.65ms | Recheck deployed configuration and persistent-volume behavior |
| Native $GH0ST gas / withdrawal | Fresh private three-layer flow passes: deposit 4, spend 1, withdraw 0.5; four invalid withdrawals rejected | Synthetic balance-owner remap and privileged confirmation apply; public Robinhood settlement unperformed |
| Abrupt recovery and light storage | Actual SIGKILL; same three persistent databases recover the exact head/state in 743 ms; 100 fresh-account transfers pass | Same-host process recovery only; supervision, host replacement and long-run capacity remain separate |
| Disputes | Full standard test compiles; two immediate setup failures preserved | Align external Geth with the pinned upstream fixture, then complete assertion confirmation and stake refund |
| Operations | One retained 32-vCPU / 64-GB pod plus 1,000-GB persistent volume; old workers deleted and verified absent | Final production configuration, supervision and bootstrap review |

Official machine root: `0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97`.

[Launch/runtime work](launch/) · [Withdrawal and crash recovery](withdrawal-recovery/) · [Full dispute readiness](dispute-readiness/) · [Verified infrastructure](infrastructure/runpod-allocation.json) · [Sequential history](../HISTORY.md)

The fresh [private flow result](withdrawal-recovery/evidence/result.json) exits **0 in 68.413 seconds**. Its [independent audit](withdrawal-recovery/evidence/post-run-audit.json) verifies exact configuration, database identities, genesis, recovered state and process cleanup. The 100 basic transfers measure **101 ms median / 109 ms p95 / 123 ms maximum**, with **1,013,760 newly allocated database bytes** during that sample. These observations do not establish sustained public throughput, power-loss recovery or a long-run storage projection. The captured receipt evidence contains actual transaction hash/block/gas rows and assertion/outbox fields; it does not contain every full RPC receipt JSON.

## Deployment boundary

The new Runpod machine is infrastructure, **not a public GL3 deployment**. Parent rollup addresses, exact final genesis, posting/validation authority, fee-token pricer, bonds, funding and applicable license decisions require the final reviewed packet. No real token movement or license acceptance follows from private tests.

The selected pod is `9fu9ldfpioy14f` inEUR-IS-1:32 vCPU,64 GB allocatedRAM,64 GB temporary working disk and the1,000 GB standard persistent volume `hb0wpuifqx` mounted at `/workspace`. Live API compute rate is$1.12/hour; standard storage is approximately$70/month and remains billed until deleted. Container disk is separately billed. The API allocation defines volume capacity; filesystem reports show a shared network-storage pool and cannot be treated as a private hundreds-of-TB allocation.

Keep test and future mainnet data/processes separate. Do not run a public chain from ephemeral container storage. The [fresh cleanup read](infrastructure/cleanup-only-big.json) confirms that only the new GL3 worker remains. Required artifacts and unique deferred research were verified before the old worker was deleted.

## Preserved earlier work

The earlier core source remains at [the existing core directory](../../chess/l3/core/README.md); its legacy folder name does not enable chess in the base. [Private native-parent withdrawal evidence](../mainnet/withdrawal/parent-parity/README.md) is complementary to the new full-dispute test, with privileged-confirmation and observed-state-clone limits retained.

Chess and custom-model machine experiments remain research. Their2.59 TB20-game planning projection is **not a base-chain storage requirement**. The user-cancelled chess disputes did not complete confirmation/refund acceptance. They are preserved in [the chronological history](../HISTORY.md) and [cancelled lifecycle receipt](../mainnet/production/final-pairing/main03-scope-cancellation/cancellation-result.json).
