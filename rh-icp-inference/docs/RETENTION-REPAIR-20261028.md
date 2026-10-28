# Retained-history repair — 28 October 2026

The deployed coordinator and production worker had independent 256-job lifetime
limits. Once 256 jobs were retained, new queued buys could no longer begin.
The repair changes admission to count unfinished work while preserving the
existing job history and replay protection. It was deployed and verified on
28 October 2026.

## Deployed artifacts

| Binding | Value |
| --- | --- |
| Coordinator | `6jacx-5yaaa-aaaaj-a65jq-cai` |
| Model canister | `6obed-qaaaa-aaaaj-a65ja-cai` |
| Coordinator Wasm SHA-256 | `3fb60905f6008a13c6b170f784558a722651cda9289bf13f04103c70ff4a1a59` |
| Artifact identity | `0x65d045ec2ab262372834065fb7d59453e7047ecac2a346d55d5eb14f4b123b53` |
| RH gateway | `0x0a99a5f180ab7990877df73f63686958298330ce` |
| Runtime archive SHA-256 | `ef65daddbcddcc9d2b23608f0c897d99d08225d9aa833ba9eac45f02f66306ba` |

The [versioned artifact directory](../deployments/retention-20261028/) contains
the Wasm, artifact manifest, runtime archive, release manifest, and
[public verification record](../deployments/retention-20261028/verification.json).
The final gateway has a confirmed
[deployment](https://robin.etherscan.io/tx/0x2921a65155031b69e969121dd5e2fff3d3c40c4541b13d80b6976c221311e1a6)
and [pool registration](https://robin.etherscan.io/tx/0xd8cf0ed0e6b89c33d4718f3e1b7299b47855db627a850609814e18c5e05722d9).
Its immutable artifact identity matches the upgraded coordinator.

## Retention and migration behavior

- Admission permits one unfinished model job. Completed and failed history no
  longer consumes a lifetime quota. The stable `State` and `Job` layouts remain
  unchanged, and all 256 original jobs were preserved.
- `retention_status()` reports admission state. `list_jobs_page(after, limit)`
  returns at most 32 jobs and 1,000,000 encoded Candid bytes. Production worker,
  recorder, statistics, and funding observers use pagination. The existing
  `list_jobs()` query remains available for compatibility.
- The proof sidecar keeps the latest 256 posted replies and every unfinished or
  ambiguous record in its active journal. Older posted replies move to hashed
  archives with a permanent deduplication index. Historical plans and signatures
  retain their original signing domains.
- A paused owner rebind can recognize a deliberately skipped exact duplicate:
  the completed source must match a distinct, earlier, remembered source from
  the same model, with exact nonempty answer bytes and settled signed records.
  This changes neither job nor memory. Unique unacknowledged completions still
  block rebinding, and existing owner, pause, and in-flight checks remain.

The upgrade/rebind comparison preserved all 256 historical jobs, 41 original
deferrals, 255 terminal worker records, and 210 existing proof replies. All 215
completed signatures and 212 fee receipts were checked against their original
gateway domains. Model Wasm, controller sets, credentials, exact-thought history,
and funding settings were preserved. These are rollout snapshots, not live
counts. The coordinator suite passed 60 tests.

## Unchanged generation policy

The model, persona, and 30–180-character output gate are unchanged. Swap jobs use
the coordinator's existing unlimited generation-budget setting
(`model_cycle_budget = 0`); the worker's two-trillion-cycle admission reserve is
not a per-job execution cap. Manual requests keep their separate bounds.

The automatic production worker retains its single-attempt policy. It stops and
defers a source when the coordinator requests another candidate after a quality
rejection, then advances the queue. The first resumed source was rejected for
length and retained this way. No output rule was relaxed to obtain a successful
post. Long calls also retained their pending identity across client timeouts;
read-only reconciliation continued the same job without duplicate generation.

## Verified thought

The next queued source,
`0xfb3e786693f224758b49c5c875b57536e3e4aa961dac5d63331c5d268c18ed37`,
completed generation and publication at **15:29:04 IST on 28 October 2026**:

- [Canonical RH callback](https://robin.etherscan.io/tx/0x800aabd5bc6a578b1bfa2f3a5c75647ce4413b99f4f8b4aa78e8f8025b13d684)
- [X thought and Afterimage](https://x.com/i/web/status/2115382833590186076)
- [Proof reply](https://x.com/i/web/status/2115382850740760618)

The callback's source, output, artifact identity, and ICP signature were verified.
Direct X reads verified the text, image attachment, and proof reply. Memory
acknowledgement and a complete recorder capture were also confirmed. The measured
job recorded 264 input tokens, 31 output tokens, and 1,602,979,391,152 model cycles;
that measurement is not a fixed price for other requests.

Both [Live](https://gh0st.fyi/live/) and [Whispers](https://gh0st.fyi/whispers/)
remained available and showed the published count advance from 212 to 213.
Another queued source was already active at the final verification snapshot.
