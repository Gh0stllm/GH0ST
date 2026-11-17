# Candidate 03 · independent cross-layer review

**The fixed host candidate passed the independent normal and Go race suites: 24 top-level tests plus 25 subtests in each.** A separate real-minute renewal test and transport-first shutdown regression also passed. This accepts the tested host behavior for the root-controlled private lifecycle experiment. The lifecycle itself has not passed.

[Independent review receipt](candidate03-review.json) binds the exact 11-file manifest, final composed system-test binary, compiled inputs, controller and strict auditor. The host overlay manifest SHA-256 is `4ed531f0d90ff3234cf457f98184b0103dcdd8e6c1f83597c4a7f3ceb56ee38e`. Ten final host files match that candidate exactly. The final client additionally contains the two reviewed shared upload-admission insertions, before input conversion and through the RPC result.

| Completed check | Evidence | Result |
|---|---|---|
| Normal server/client/valnode suite | [Actual exits](evidence/candidate03-attempt-01/results.json) | All three packages exited 0; valnode's actual health-failure path took 10.051 s. |
| Same independent suite with Go race detection | [Actual exits](evidence/candidate03-race-01/results.json) | All exited 0; valnode took 11.079 s including the race runtime. |
| Actual minute KeepAlive | [Receipt](evidence/candidate03-minute-01/actual-minute-keepalive.json) | Exit 0 / 60.056 s. The real client's 60-second renewal advanced the registered server run's access time under a five-minute TTL. One run and one spawn remained. |
| Transport stops before the retained pool | [Normal/race exits](evidence/candidate03-stoporder-01/results.json) | Exit 0 / 0.509 s and exit 0 / 1.627 s. The remaining registered ID was reclaimed by a static 500 ms server TTL. |

The prefix and minute modes are deliberately skipped in the regular suites. The minute mode ran separately once. The authentic original-input raw 0/100M/200M prefix is the earlier [completed candidate 01 evidence](evidence/actual-prefix-01/actual-prefix-result.json); all five native machine-cache/recording implementation files exercised there are byte-identical in candidate 03. No duplicate eager or full replay was run.

## What changed after candidate 01

The admitted client queries now preserve the existing 10-second health-check cadence and five-second check timeout. An opt-in server gate keeps one slot charged across decoding, pending creation and registered run ownership. A canceled request that has not received an ID retains a charged observer; when the actual late run arrives, it is closed. Registered IDs whose response was lost have no client renewal and are handled by server expiry or Stop.

Independent testing found a real candidate 02 defect: a null input or null preimage group panicked inside decoding after admission, retaining the sole slot. Actual HTTP RPC recovered the panic, but the next valid creation remained capacity-busy. [Direct failures](evidence/candidate02-attempt-01/valnode-tests.log), [HTTP failures](evidence/candidate02-null-http/valnode-tests.log), their manifests and the exact old helper remain preserved.

Candidate 03 rejects those nullable inputs and defers slot release until ownership transfers to the late observer or registered wrapper. Both direct and real HTTP regressions pass. Additional failures cover nil promises, ready errors, nil runs and an injected factory panic; each leaves the gate reusable.

The real cross-layer tests use HTTP RPC, `ExecutionClient`, the retained `BOLDExecutionClient` pool and the actual `ExecServer`/JSON decoder. Only the engine-facing spawner and execution run are bounded doubles. Two borrowers share one real remote ID; canceling the queued borrower preserves the active result and later reuse. Other tests cover pending cancellation, late completion, pending Stop, registered Stop and idle expiry.

## Precise resource boundary

The server's slot is released at **Close invocation**. Native destruction is asynchronous, so the slot is not an acknowledgment of physical memory reclamation or a termination deadline. An uncooperative unresolved creation stays charged and observed rather than admitting another creation.

The existing source shutdown order closes the RPC client before stopping the retained pool. The separate shutdown regression observed the resulting registered ID remain owned by the server, then verified its idle cleanup. The minute test's known-ID Close acknowledgment was observed while the transport was still alive. These are distinct cases.

The selected machine, Go guest, C engine, model, verifier and full-strength search policy are unchanged. Full selected-engine repeated-work cost, the actual proof→target confirmation→exact edge-collateral refund lifecycle, assertion-stake withdrawal, storage/20-game capacity and production deployment remain separate gates.

The [main cross-layer archive](evidence/candidate03-archive-receipt.json) is 72,558 bytes, SHA-256 `c4fb3036ab0e40e15fa7081ee777f1f60f4a1f0abbd97efec4b58165e17b3816`. The [shutdown supplement](evidence/candidate03-stoporder-archive.json) has its own immutable receipt. All execution was on the existing Runpod worker; no mainnet transaction or new full replay was started by this lane.
