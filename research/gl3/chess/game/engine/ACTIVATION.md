# A14 activation candidate

## Live GL3 ownership

`ArbOwnerPublic.getAllChainOwners()` returned only the zero address on
live GL3 at block **20,629**. The launch procedure deliberately removed
the child chain owner. The ordinary owner-scheduled activation path in
this candidate therefore applies to a private rehearsal. Live activation
requires the separate [parent-authorized candidate](ownerless/PARENT-ACTIVATION.md).
It binds only A14 activation and bootstrap to the existing parent authority
while preserving GL3's renunciation.
[Live owner read](activation/live-owner-20261118.json)

## Isolated activation

GL3's deployed parent proof root tracks stock ArbOS 61. The private A14
fixture registers its precompile before genesis. Carrying that fixture into
a live node would change historical state. A runtime-only method guard also
changes historical gas because Geth warms every address on the active
precompile list before the call.

`stage_activation.py` prepares an isolated copy of the pinned Nitro and Geth
sources after the A14 coordinator registration is staged. The caller must
supply the candidate version. This pinned source supports a proposed next
step from 61 to 62 for GL3 chain ID 4663001 with debug precompiles disabled.
That number is a build input. An activation time and proof root remain subject
to release review.

```sh
python3 research/gl3/chess/game/engine/stage_activation.py ISOLATED_NITRO_TREE --candidate-arbos-version 62
```

The version gate selects both dispatch and the EIP-2929 warm-address list.
Every stock version keeps its original tables. The normal ArbOS upgrade
transition installs the A14 code marker only when the candidate goes live on
GL3. The candidate rejects genesis initialization and an existing nonce or
code at A14, and preserves any native balance at that address. The initial
Stockfish seed needs a separate installation before the first game.

Release evidence still needs pre-activation historical state and gas parity,
the activation-boundary replay on matching native and proof builds, and
validated engine seed and coordinator admission. The active sequencer and
validators must support the upgrade before changing the Robinhood rollup proof
root or scheduling ArbOS. The recorded GL3 standalone configuration has no
sequencer coordinator. A read-only follower can validate shadow replay, while
production activation requires a coordinated transfer of sequencing and batch
posting authority.

[Current GL3 configuration](../../../same-day-mainnet/node/node.proposed.json) ·
[Observed base proof root](../../../same-day-mainnet/node/live-readonly/run-02/snapshot.json) ·
[Arbitrum upgrade order](https://docs.arbitrum.io/launch-arbitrum-chain/operate/arbos-upgrade)
