# GL3 · one active cloud worker

The standard GL3 runtime, pristine build dependencies and private base checks were consolidated on the persistent volume of the BIG worker. The earlier worker is no longer needed by this lane.

| Required component | Actual transfer result |
|---|---|
| Official Nitro, standard `c10` machine, pristine SDK, Go toolchain, native link library and genesis helper | Source and receiver **0**, 263.47 s |
| Pinned neutral Node modules and deployment contract artifacts | Source and receiver **0**, 129.91 s |
| Decoded Go module cache | Source and receiver **0**, 405.31 s; published atomically after completion |
| Basic Node/build packages | Package installation actual **0** |
| Optional warm Go build cache | Cancelled after the required transfers completed; **not accepted or used** |

The active paths reside under `/workspace/gl3/durable`, with matching legacy path aliases for the pinned build. The new private withdrawal/recovery fixture uses `/workspace/gl3/testnet/withdrawal-recovery`. No partially transferred Go cache is exposed to a compiler. The dispute lane uses its own fresh build cache.

[The initial receiver](evidence/big-consolidation/initial-ready.json), [module receiver](evidence/big-consolidation/modules-ready.json) and [neutral artifact receiver](evidence/big-consolidation/neutral-npm-contracts-ready.json) record those boundaries. The active standard chain uses the [official artifact lock](evidence/artifact-lock.json).

The deferred chess work is preserved separately at `/workspace/gl3/archive/chess/deferred-c1af-checkpoint.tar.gz`. Its **2,336,260,769-byte** archive has SHA-256 `b2ee786a3c0f913474f595a2eebbd0001bbff6a4386ee28c3c00fd1cfe0d071d`. All fifteen payload members were stream-decompressed and matched against their source byte counts and hashes **on Runpod**. This contains the fresh cancelled-run input, checkpoint guest/machine/snapshot, beginning input, final compiled helper and provenance locks. It was never extracted into the active chain or executed. [The exact archive receipt](evidence/big-consolidation/deferred-c1af-checkpoint-receipt.json) identifies every preserved member; no wallet file or private key was included.

The temporary cloud-to-cloud staging authorization was revoked and the exact previous authorization-file hash restored. The task-only source key was deleted after checking for open owners. [Authorization revocation](evidence/big-consolidation/staging-key-revocation.json), [source-key deletion](evidence/big-consolidation/private-staging-key-deletion.json) and [optional-cache cleanup](evidence/big-consolidation/optional-warm-cache-cleanup.json) preserve these controls. None of these operations changed the running base fixtures or their private signing material.

The earlier worker can be removed by the parent operator after its final inventory. This document records artifact preservation and transfer; successful public deployment, sustained hosting reliability and mainnet custody are separate claims.
