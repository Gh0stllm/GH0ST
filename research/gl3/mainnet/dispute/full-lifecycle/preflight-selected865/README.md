# Selected 865 · future lifecycle preflight

**Build and guard checks passed on Runpod. The lifecycle was not launched.** The selected interpreter remains a separate acceptance gate; this preflight never runs a node, chess search, interpreter or challenge.

| Check | Recorded outcome |
| --- | --- |
| [Compiler receipt](evidence/compile/build-exit.json) | Actual exit 0; complete tagged future fixture compiled |
| [Python guard log](evidence/regressions/normal.log) · [optimized log](evidence/regressions/optimized.log) | 160 tests passed in each mode |
| [Go binding log](evidence/regressions/go-binding.log) | Five top-level tests, 55 named tests/subtests; actual exit 0 |
| [Entry without run ID](evidence/regressions/refuse-no-run-id.log) · [without launch receipt](evidence/regressions/refuse-no-launch-receipt.log) | Actual exits 1; refused before the engine starts |
| [Controller without mode](evidence/regressions/controller-refuse-no-mode.log) · [without accepted receipts](evidence/regressions/controller-refuse-no-receipts.log) | Actual exits 2 and 1; no native source staged by the rejected launch |
| [Combined results](evidence/regressions/results.json) | Exact source identities, real exits and bounded scope |
| [Compiled input manifest](evidence/compile/source-manifest.json) | 2,890 source, dependency, compiler and environment inputs; binary SHA-256 `6125db8279dd3610ca23c697b07b78bd9f7939c5a3fb27d44809f017d9bf25c2` |

The controller requires an explicit `--compile-only` or `--launch`. Launch requires three separately bound receipts: the selected interpreter's actual successful Finished result with all four global fields and exact final counter, a reviewed backend/geometry receipt, and explicit authorization bound to both receipt hashes. No accepted receipt or authorization was created by these tests. Synthetic positive guard values establish predicate behavior only.

Claims are classified by exact terminal global state and recomputed honest/forged history. Sender identity cannot turn a legitimate earlier claim into a false terminal claim. Both rivals must share their predecessor, before-state data, inbox context, module and challenge manager.

The fixture waits for the independent auditor's exact target proof and later confirmation before requesting the honest level-zero edge's refund. It then keeps the parent alive until the auditor exits successfully and the controller acknowledges the exact audit-file hash and run nonce. A broad Go pass, an unrelated proof, a refund flag or a stale report cannot satisfy this handshake. Refund scope is exact confirmed-edge collateral, excluding rollup assertion-bond withdrawal and losing-stake economics.

The pinned contract getter takes **EdgeType**, not a challenge-level index. Types 0, 1 and 2 mean block, big step and small step. With three big levels, the [source-backed expansion](evidence/regressions/geometry-getter-provenance.json) is `[8192, 1024, 1024, 1024, 1024]`. The machine-step capacity is `1024⁴ = 2⁴⁰`; block height 8192 does not multiply that capacity. A changed final small-step height is explicitly rejected. Actual on-chain readback is implemented but was not executed in compile-only mode. The raw-counter boundary, absorbing Finished transition and BoLD kickoff offset still require selected-backend review before launch.

Selected module root: `0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086`. [Selected bytes](evidence/compile/selected-artifacts.json) are pinned independently of the future test binary. Cloud work was isolated under `/root/future-lifecycle-865-preflight` and `/root/future-lifecycle-865-build`; [the live interpreter was untouched](evidence/regressions/protected-interpreter.json). The first controller syntax attempt failed on a bracket typo; [that failure is preserved](evidence/launcher/initial-syntax-failed-preflight-exit.json), followed by the passing syntax and compiler receipts.

[Frozen compiled sources](evidence/compile/frozen/) include cloud `gofmt` output. The regression source manifest also retains the original staged kit hashes. [Transfer verification](evidence/transfer-verification.json) records the verified 182,710-byte evidence archive. No local builds/tests, mainnet transactions, strength changes or new pods were involved.
