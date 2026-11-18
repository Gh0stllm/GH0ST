# A14 on GL3 mainnet

## 2026-11-18 public chain check

The [GL3 RPC](https://rpc.gh0st.fyi/) returned chain ID `4663001` and
genesis hash `0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483`.
At 16:48:21 UTC, its latest returned block was [20,629](https://scan.gh0st.fyi/#q=0x5e977015dc36d5a2758a30becf0e3d64362e78afd46f55c951daf9e9917d9e6d),
timestamped 13:47:50 UTC. At that block, `ArbSys.arbOSVersion()`
returned 116, which is ArbOS 61 after subtracting the Nitro offset of
55. `engineStatus()` at A14 returned empty data. These public reads
establish the observed chain and engine state at that block.

The [receipt-bound deployment record](../../../same-day-mainnet/deployment-packet/receipt-derived/deployment-verified.json)
identifies the Robinhood rollup at `0xeE811A8ee20C03E684ECB5BFd6f7721f85451b01`.
The [launch observer](../../../same-day-mainnet/node/live-readonly/run-02/snapshot.json)
recorded the standard ArbOS 61 proof root
`0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97`.
The current check got HTTP 403 from the public Robinhood RPC, so that root
is from the saved launch observation.

## Production handoff

The [deployed configuration record](../../../same-day-mainnet/node/node.proposed.json)
puts sequencing, batch posting and validation in one Nitro process and
disables sequencer coordination. An upgraded node can replay the chain
independently before any handoff. For activation, it needs exclusive
sequencing and batch-posting authority and a matching validator. A Robinhood
transaction selecting a new proof machine cannot install native code on
the sequencer. [Arbitrum upgrade procedure](https://docs.arbitrum.io/launch-arbitrum-chain/operate/arbos-upgrade)

The private A14 profile registers the precompile from genesis. The live
upgrade must preserve original genesis and all earlier block hashes, state
roots and gas accounting. It must add A14 to both EVM dispatch and the
prewarmed-address list only at the scheduled protocol transition. The
Stockfish image must then be installed into existing GL3 state and matched
to the pinned engine and seed commitments before the game admits entries.

The production constraint requires the existing pod to be left alone and
GL3 to remain available. The current standalone topology has no proven
uninterrupted sequencer handoff. A second independently active sequencer
can produce conflicting blocks. Any cutover needs a coordinated way to
transfer the active role before scheduling A14. [Arbitrum high-availability sequencing](https://docs.arbitrum.io/launch-arbitrum-chain/run-a-node/high-availability-sequencer)

The game contract and player are source artifacts. The exact 24M-node
Stockfish policy and retained model are the release target. There is no
mainnet activation receipt, deployed game or funded prize associated with
this update.

## 2026-11-18 live handoff check

The running GL3 sequencer's startup profile confirmed standalone sequencing,
batch posting and delayed sequencing in one process. Its sequencer
coordinator and feed output are disabled. The A14 follower held safe
block **20,628** while production served block **20,629**. Promoting it from
that frontier can replace a block that the live node already served.
Changing the verifier root cannot make the standalone sequencer share a
leader lease with the follower. [Live observations](handoff-evidence-20261118.json)

The current Robinhood rollup still has the stock ArbOS 61 proof root.
The deployed challenge manager reports one big-step level, big-step
height `524288` and small-step height `8388608`. This gives
`4398046511104` machine steps per disputed block. The A14 candidate's
activation and search transitions need their own evidence against those
deployed parameters before selection of the new root.
