# Canonical base EVM input capture

This additive Go overlay records one real native transfer under the pinned Nitro system-test harness: ArbOS 61, debug precompiles disabled, MEL disabled and official machine root `c10cd7ec…29dc97`.

It records the original typed validation input, transaction receipt, block header and the actual private parent's sequencer/delayed accumulator records. It requires the native expected ending block hash to equal the actual transfer's receipt block hash and rejects any unexpected user executable module. This capture is witness preparation, not a zkVM execution or proof, public settlement, withdrawal acceptance or mainnet deployment.

The output's expected post-state is only a native comparison target. A future guest must execute the authenticated pre-state and data, derive its own post-state, track actual inbox reads and generate the new domain-bound statement. It must not echo this expected state.

All compilation and execution ran on Runpod. Actual compile exited zero in 20.465 seconds; the private capture exited zero in 2.279 seconds. The captured input is 12,968 bytes, SHA `d27f8e07156a81b3508de40b0e2bf10a295e6dd3368dc2695a2c7e7b5c0495e2`. It includes one sequencer record and no delayed read or user executable module. [Actual result](evidence/capture-result.json), [capture](evidence/captured/report.json).

The first controller had a Python syntax error before launching Go; it was preserved and corrected. A later temporary SSH outage did not stop the corrected job. The remote evidence root is `/workspace/gl3/zk-tests/stylus-source/base-capture/`.

The pre-state is the private test genesis block at cursor `[1,0]`, rather than `[0,0]`. Both MEL hashes and the send root are zero. The actual parent accumulator immediately before sequencer record 1 is the accumulator after initialization record 0. The fixture's genesis includes test balances and must not be promoted to the production zero-allocation genesis. See [the bootstrap distinction](GENESIS.md).
