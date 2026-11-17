# Future lifecycle: large-input host integration

**Compile/preflight only. No lifecycle was launched.** This is a new variant of the frozen geometry43 fixture. R36, the original geometry43 packet, the stopped c03c run, its logs, selected865 machine/guest/engine, and accepted interpreter evidence are unchanged.

The future fixture uses the **ordinary unguarded** `valnode.CreateValidationNode` backend, with a loopback-only WebSocket request limit of 3 GiB. The positive-step stop wrapper in `TestGL3OriginalFullInputValidationTransport` is not installed by this lifecycle helper. Only the named standalone transport test uses it.

Host-only changes:

* `gl3_large_validation_node_test.go` creates the ordinary validation node with an explicit cap and records endpoint/configuration. The fixture sets client `ArgLogLimit=2048`, `Timeout=0`, `Retries=0`; four-hour run idle eviction stays distinct.
* `gl3_upload_admission.go` supplies **one process-global upload slot**, shared by both validators' `validator/client` instances. The two exact call-site changes in `validation_client.go` acquire before `ValidationInputToJson` and defer release until response/error/cancellation. The host diff is saved in `../future-evidence/host-upload-admission.patch`. This limits conversion/serialization/upload overlap; it does not limit resident execution runs, backend eager scans, or arbitrary clients bypassing that package.
* A fixture-scoped handler drops raw validation argument/result/error-data attributes before formatting. Full input files and their manifests remain separate evidence.
* The copied controller runs Go with pinned `-test.v=test2json` framing. Its scanner reads 64 KiB chunks, retains at most 2,048 bytes per line, and requires complete short framework-framed markers. It never iterates a giant raw log line or searches argument strings for PASS text. Oversized framed lines or more than 10,000 framed markers fail closed.
* Launch still requires the accepted interpreter, independent geometry/offset-cap review and separate root authorization. It additionally requires and freezes the actual original-input transport pass, exact selected-byte identities, decoded-input binding, measured wire count, backend initialization, closure and admission receipts. Nothing here grants launch authorization.

## Actual Runpod checks

* Host admission regression: **exit 0**, sixteen concurrent callers, canceled waiter, idempotent release, peak one and active zero.
* New full fixture compilation: **exit 0**, 28.596728931 seconds build time. This compiled the ordinary backend; it did not run it through a lifecycle.
* Final exact compiled-input reuse preflight: **exit 0**, 2.083057903 seconds, run `b7071d2d7f554f8dac10222ce3bc0754`.
* Bounded scanner: **7 normal + 7 optimized Python tests pass**, including a 128 MiB line, fake PASS text, unframed markers and marker flooding.
* Actual pinned Go framing smoke: **exit 0**, 29 recognized framework markers from the small logging/admission test. No engine/model or full input was loaded in that smoke.

The first controller preparation failed before compilation because a patch needle reused the launch-receipt variable name. Its actual exit 1 and frozen source are preserved; it was corrected before the successful build. The original build's manifest retains its original controller hash. The final run's `source-manifest.json` records the final controller/scanner provenance and the unchanged compiled Go input set.

| Final identity | SHA-256 |
| --- | --- |
| Ordinary future lifecycle binary | `badfbe867010c41dd43727fcbe3fb25b814030a1521d3fe28875d3964e0ba1bc` |
| Final controller | `122997f9b21275529ab0c586755549f26de65eb21c290e461e6576e249c5d8ac` |
| Bounded marker scanner | `b3e100eb6d030a3becb6891ea3cb605dd4fb6adf138728c34fc3c60889506630` |
| Selected machine (unchanged) | `4bf7fe54c28ad0b6f2620df3ee6b4c6d87452f9ab76ec8be294eb7d4c934770e` |
| Selected guest (unchanged) | `8d18145460e5f4c649895728fa089a52a04ead2c3fa5e7d10789d72d7de42fbd` |

All checks ran on the existing Runpod128 instance with at most four Go CPUs. The final process inspection found no active process owned by this lane's test prefixes. No cleanup/deletion, public transaction, wallet access, proof-machine change or engine-strength change occurred.

This addresses the old 32 MiB request-cap and payload-log failures. It does **not** address or accept the separate eager MachineCache/repeated-run performance concern, end-to-end dispute settlement, public launch, storage retention, or twenty-game/$100 capacity.
