# Ordinary source06 · frozen operator artifacts

**Node and validator builds passed. No production activation or mainnet deployment is claimed.** Both use the reviewed host-only source06 overlay and the unchanged selected865 machine, model and engine policy.

| Artifact | Actual build | Bytes | SHA256 prefix |
|---|---:|---:|---|
| `nitro` | exit 0 · 11.9165 s | 387,913,224 | `f161019587140840` |
| `nitro-val` | exit 0 · 9.2674 s | 353,101,632 | `dcd26a0e1a751e58` |

Full hashes and all source/model bindings are in [artifact-lock.json](artifact-lock.json). Both ELF stacks are non-executable. Each build rehashed all **6,204** selected dependency/source records before and after compilation. The audit found exactly the seven approved host-file changes/additions from source05; the selected guest, companion, machine, engine archive and native link/tool inputs matched their existing identities after the builds.

Actual help/version/configuration-only smokes passed. They confirm the new 3 GiB cap, default-disabled retained cache and explicit WARN/interpreter/root profile parsing. Configuration dumps do not run final validation or startup. Separate source06 tests passed **23 top-level tests and 50 subtests in both normal and race runs**, including actual small authenticated HTTP/fragmented-WS transport and parent-root RPC helper checks. The first combined main-package race build's disk-floor stop is preserved separately from its successful authorized sequential retry.

Builds used one Go build worker, two allowed CPUs, a three-billion-byte owned scratch cap and six-billion-byte disk floor. Node minimum sampled free space was 7.568 GB; validator minimum was 7.340 GB. No chain, engine search, prover, wallet operation or production service was started by these builds/smokes.

A private archive contains both ELF files, the frozen host overlay, source manifest, locks and receipts. All **81 members** were stream-decompressed and checked byte-for-byte by size/SHA on Runpod. See [backup-receipt.json](backup-receipt.json). The separately verified selected-machine archive remains its explicit dependency. Private binaries are excluded from Git; the owner off-pod compressed archive was also verified without local decompression; see [offpod-backup-verification.json](offpod-backup-verification.json).

The earlier source05 raw ELF duplicates were relocated to verified read-only copies on the checkpoint worker before unlinking only the two old duplicate files. Both selected-machine archive copies and all source05 metadata were retained; [the cleanup receipt](../source06/evidence/source05-raw-relocation-cleanup.json) records identities and reclaimed space.

Remaining gates include ordinary full-size private transport, paired production startup/genesis, operator custody/pricing/stake/license decisions, and accepted twenty-game storage. The [zero-step full-size proposal](../source06/FULL-SIZE-TRANSPORT-PROPOSAL.md) is a negative typed-decoding test only; a valid execution creation starts the eager cache and needs a separate positive-step review.
