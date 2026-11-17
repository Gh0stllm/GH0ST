# Optional version-notification client

The source-backed minimal correction is **`version-alerter.enable: false`**, restoring the official default. It leaves the c10 validator, fatal validation failures, staking, challenges, finalized parent reads and batch finality enabled.

The alerter constructs its RPC client with a nil automatic stack, while the inherited connection default is `self-auth`. That combination returns `self-auth not supported for this connection`. Enabling an auth listener alone cannot supply the missing stack reference. An explicit external RPC URL can be configured, but this deployment has no selected upgrade-notification feed; enabling an otherwise unused self-polled feed is unnecessary.

The optional client only polls `arb_getMinRequiredNitroVersion` and logs upgrade notices. `cmd/nitro/nitro.go` starts it after ordinary execution/consensus/validation startup. It does not enforce the chain's state transition or replace module-root/block validation.

[Source excerpts and exact hashes](source-proof.json) bind the pinned official Nitro source. Two actual official-binary typed configuration dumps passed on Runpod; [the comparison](parser-result.json) found exactly one difference, `version-alerter.enable`. All eight recorded validator/finality/staking checks remained enabled or unchanged. Configuration dumping exits before startup and `NodeConfig.Validate`; this test is not an actual mainnet startup or assertion pass. The raw public-template dumps are hash-bound but excluded from Git.

## Initial latest-agreed lookup

[The separate staker source trace](genesis-startup-source-proof.json) explains a possible nonfatal initialization window. The assertion manager initially has a zero latest-agreed hash; asynchronous synchronization seeds it from the actual latest-confirmed assertion. During that window, the zero-hash log-query fallback uses `rollupDeploymentBlock` in EVM coordinates, which differ from Arbitrum RPC log block coordinates. The nonzero hash path uses `getAssertionCreationBlockForLogLookup` correctly.

The staker explicitly falls back to the actual latest-confirmed state when the agreed-state lookup has not finished. The active synchronization path uses `latestConfirmed`, not the empty-genesis convenience helper. A one-time startup message does not justify a genesis override, skipped validation or changed finality. Repeated errors require actual provider/filter diagnostics; a genuine new-batch SDK assertion and fast-confirmation remain separate acceptance evidence.

No private configuration/log/key contents, services or transaction submissions were used by this source/parser lane.
