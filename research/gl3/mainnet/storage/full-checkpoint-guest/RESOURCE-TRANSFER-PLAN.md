# Fresh native terminal-capture worker · reviewed transfer plan

**Planning only. No pod, new search, new build or proof is launched by this file.**
Use a separate disposable worker; never move or mutate the live03 databases.
Compile the reviewed full-capture helper on the existing warm build worker,
then transfer its exact ELF. The current399,561,160-byte ELF is **progress-only**;
it cannot be relabeled as the full terminal-capture program.

## Worker and safeguards

- Root's live catalog candidate:8vCPU /64GB /96GB disk, CPU5m at$0.52/hour. Root rechecks stock/pricing before provisioning; this document places no order.
- Use **Ubuntu24.04/x86_64 compatible runtime**. Actual ELF requirements include **GLIBC2.39 and GLIBCXX3.4.32**. Ubuntu22.04 is insufficient unchanged. Prefer the same image as the current worker; run `ldd`/test listing before any search.
- Read the actual Runpod cgroup hard limit and require64GB allocation as provisioned; host `/proc/MemAvailable` is not a substitute. Record disk size/free and CPU quota.
- Restrict the job/process tree to two CPUs. Private parent Geth uses the already tested cache16 flags for both init/run; same pinned Geth binary and consensus.
- Proposed **new-worker** owned-scratch cap24GiB and free-space floor6GB, with native capture RSS/cgroup monitoring and baseline-independent cleanup. This is a requested reviewed cap, not a change to the current3GiB trial.

## Minimum exact runtime inputs

[Full file/hash and dynamic dependency inventory](fresh-pod-runtime-inventory.json).
These are immutable source fixtures/artifacts, independent of the live03 run.

| Destination absolute path | Actual bytes now | Use |
| --- | ---: | --- |
| `/root/bounded-restore/preimages.bin` |1,914,805,529| Hash-verified immutable source witness; reconstructs the accepted first completed image |
| `/root/bounded-restore/final-state-export/export/meta.json` |781| Exact accepted completed metadata |
| `/root/bounded-restore/final-state-export/export/final-code-0000.bin` |6,282| Exact accepted final immutable delta fragment |
| `/root/terminal-acceptance/bin/geth` |76,972,936| Pinned private parent Geth, SHA256 `daec86c874d2f31d70784f4c8e15faf786e8eebd3cd23e77be744c2c42273119` |
| `/root/gl3-full-checkpoint-guest/machine-generation/machine/module-root.txt` |67| Exact new root2a423…e608 |
| `/root/gl3-full-checkpoint-guest/machine-generation/machine/machine.v2.wavm.br` |90,327,577| Exact matching machine9f5c…4752 |
| `/root/gl3-full-checkpoint-guest/machine-generation/machine/until-host-io-state.bin` |164,300,352| Matching validator initialization state |
| Reviewed full-capture ELF, final destination frozen after compile |TBD; current progress ELF399,561,160| New native full-search helper only after source/result review |

Using the existing progress ELF as the **size proxy only**, these files total
**2,645,974,684 bytes** before tiny controllers/manifests. The source witness SHA256
is `8852477df16204a51a337c1f91023fc46fc052304315b96e91e3f1c4a1369157`;
the passing native fixture rescanned all402,818 records. Recompute every transfer
hash on the destination and make original fixtures read-only before use.

The proven importer reconstructs the466,157,568-byte image, writes the same64
checkpoint pieces and validates full canonical TT/history in about25seconds
without a new search. This avoids an untested new snapshot format. A smaller
seed+64-piece account bundle could replace the1.915GB source later, but requires
its own exporter/importer equality test; its archive size is not invented here.

The portable engine is embedded in the ELF (`go:embed .cache/sliced.wasm`);
no separate model file, Go toolchain, Rust compiler, module cache or source tree
is needed to **run** the reviewed executable. Create the owned work/temp and
`machines/latest` layout; point `NITRO_TEST_L1_GETH` to the exact copied binary.
Source-free runtime startup still receives an explicit preflight on the new pod.

Dynamic runtime dependencies are `libm.so.6`, `libstdc++.so.6`, `libgcc_s.so.1`,
`libc.so.6` and `/lib64/ld-linux-x86-64.so.2`: the current resolved files total
**6,093,904 bytes**. Their hashes and required symbol versions are in the inventory.
Use compatible image packages; do not silently substitute an older C++/glibc.

Optional independent provenance files: guest29,576,047B and the nine library files
(including B481)176,070,475B. They are not required by the already sealed native
machine runtime, but help verify/rebuild it. The600,010,302-byte progress input,
old failed databases, existing build caches and live03 data are **not** runtime
requirements for a fresh full capture.

## Disk envelope · estimates explicitly separate from measurements

| Phase / retained item | Budget | Basis |
| --- | ---: | --- |
| Runtime/fixtures |2.65GB plus tiny manifests| Actual sizes above; full ELF final size must replace proxy |
| Fresh L1/L2 databases during full decision |8GiB| Conservative planning reserve; short capture is measured, full A15 decision DB is not yet measured |
| New terminal input |4GiB| Planning reserve, not a measured result; old reference was2.575GB and layout/context differ |
| Logs, resource data, small receipts, transfer buffers |2GiB| Bounded planning allowance; raw payload logs remain disabled |
| Extra compaction/WAL/transient room |6GiB| Planning contingency; does not establish a worst-case mathematical bound |

These allowances fit a reviewed24GiB owned cap on a96GB worker with substantial
remaining free space. Keep the6GB free floor and fail closed before exhaustion.
Do not copy a database to make a second snapshot. Do not delete immutable inputs
or accepted evidence for space; preserve failed receipts and inventory any owned
unready temporary database before root-approved cleanup.

## Transfer and launch sequence

1. Root provisions/reviews the compatible image, actual64GB cgroup and disk/CPU limits. Boot/transfers can precede the progress verdict; **no new search/proof may**.
2. Copy immutable data, Geth and exact machine directly between disposable workers; compare all SHA256/bytes. No Mac download of raw VM images or large inputs.
3. After the progress trial's real exit/result and source review, compile/freeze the new full-capture ELF on the warm existing worker. Transfer its source manifest and exact binary; perform loader/test-list/fixture-path preflight only.
4. Root separately approves the full24m native capture. Use the exact golden and corrected kit3 terminal batch sealing described in [next-test plan](NEXT-TEST-PLAN.md). Capture actual dynamic terminal blockN, parent batch, header/gas/end fields and input hash.
5. Freeze receipts/source/data before any new interpreter or OSP regression. A native terminal capture is not a terminal guest proof; active ancestry is not physical-history reclamation;20-game and mainnet acceptance remain false.
