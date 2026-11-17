# Actual read-only node and parent observations

These one-shot Runpod observers use the fixed public Robinhood RPC and loopback child RPC. They read no key, password, private configuration, credential or log contents and submit no transaction.

`run-01/snapshot.json` observed the actual SDK's initial `100,000 GH0ST` stake, consumed finite allowance and nonzero-history pending assertion. `credit-clarification.json` preserves the original threshold result while explaining why comparing an already spent child balance with the original one-million deposit is not an ingress-failure test.

`run-02/snapshot.json` independently matched confirmed/staked assertion events and computed hashes to actual canonical child headers/send roots. It observed seven parent batches, one staker, the full stake and a confirmed non-genesis assertion. `run-02/batch-poster-health.json` binds an actual canonical posted-batch receipt and its configured poster sender; this is an observation rather than a future-uptime guarantee.

`run-02/fast-confirmation.json` finds the exact earlier confirmation outside the snapshot's bounded recent-event window: transaction `0x0bdfa47739b9f31ba537435f09b2b8e92fcd89a8df7dabce9cfdb2ff38ebd9dc`, receipt 1, validator nonce 2, actual `fastConfirmAssertion`, and history root `0x04d80dc5a035353779142b8bf3e678aad86fb328668bbc47e5ca50f4f84090c5`.

That assertion advances batch progress while retaining child block-zero hash `0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483` and zero send root. It proves the genuine SDK existing-assertion fast-confirmation path; it does not claim that the later fee/setup blocks or a mainnet withdrawal had already been confirmed by that transaction. The newer staked successor and later confirmations remain separately observable. Fast confirmation is project-operator trust, not ZK or permissionless confirmation.
