# Selected native CLI · build and smoke check

The ordinary Linux node executable now builds from the exact selected C native source, with **build exit 0** and **version-command exit 0**. No acceptance-only or guest-only build tag is used, and no chain or engine search is started by this check.

| Artifact check | Recorded result |
| --- | --- |
| Native executable | 387,757,096 bytes |
| SHA-256 | `13ba3c913c260c453628f273cfd8dc86f742f291d87e9a9887531e039d351f38` |
| Source/dependency identities before and after | 2,792, all unchanged |
| Go | Linux x86-64, 1.25.12; build parallelism 2; modules read-only |
| Executable stack | `GNU_STACK RW`, no execute permission |
| Embedded portable-engine input | Original `1d650410…5e5bc` |
| Native engine archive | `a8b46cbe96923ef6592ba4f356ba488f574dc074605c83f16a90a1bf2fbbeebd` |
| Network extracted from that archive | Original 98,511,183 bytes; SHA-256 `1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2` |
| Version display | `local+unknown-unknown` — extracted source is unstamped |
| Optional `target/bin/jit` | Absent, explicitly inventoried |

[Exact result](evidence/result.json) · [Build command and resolved paths](evidence/build-process.json) · [Build exit](evidence/build-exit.json) · [Version exit](evidence/version-exit.json) · [Go build metadata](evidence/go-build-metadata.txt) · [ELF headers](evidence/elf-program-headers.txt) · [Source before](evidence/source-before.json) · [Source after](evidence/source-after.json) · [Runpod reproducer](run-linux.py)

Two initial checker failures are preserved. The first incorrectly required the absent optional JIT before building. The second built successfully and returned version exit 0, but the checker incorrectly expected the word “nitro”; the pinned source actually prints the unstamped revision. Their outer collector exit codes were not captured and remain unknown. Neither is relabeled as a successful complete check. The final invocation verifies the Go main-package identity and retains the exact version text.

This is a source-bound candidate executable, **not an accepted native/machine/genesis release**. The selected proof root remains `865168…f086`, and its interpreter is a separate running gate. Production configuration, version stamping, auxiliary validator/prover distribution, daemon startup/recovery, full dispute settlement and storage capacity still need their own acceptance. The executable is kept private with a verified off-pod recovery copy; no binary is committed here. All build, smoke, network extraction and compression work ran on Runpod. Bot strength and search policy are unchanged.
