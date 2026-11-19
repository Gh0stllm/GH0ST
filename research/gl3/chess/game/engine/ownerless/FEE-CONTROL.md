# GL3 posting fee governance

This proposal restores the ability to set the GL3 data-posting price through
existing Robinhood governance. The ArbOS 63 candidate was built and replayed
on the same pod in a separate workspace. Live activation needs its own review. The deployed GL3 owner list remains
`[0x0000000000000000000000000000000000000000]`.

## Verified starting point

Both public GL3 RPCs agreed at block **20,641** on ArbOS 62, A14 code at
`0x0000000000000000000000000000000000000a14`, and the zero owner list.
At Robinhood block **118,097,793**, the rollup still reported
`0xA632B4c45726C779086F60d8b09BEE7b09bA2541` as its owner, and the
project treasury still held its executor role. The live proving root was
`0xa6d61281b9933ed55535fc12b6e62f77430b81f2d9d2b10b414ae972d5a5030d`.

The [A14 activation record](a14-activation-20261119.json) covers the prior
consensus transition. A14's shipped parent calls nominate a seed installer
and register a chess coordinator. Nitro binds its general fee setters to
the child owner list. The Robinhood rollup owner can install a proving root.
A separate synchronized runtime activation gives that root its matching GL3
execution semantics.

[ArbOwner access check](https://raw.githubusercontent.com/OffchainLabs/nitro/v3.12.2/precompiles/precompile.go#L584-L594) ·
[Parent proof root setter](https://raw.githubusercontent.com/OffchainLabs/nitro-contracts/main/src/rollup/RollupAdminLogic.sol#L361-L370)

## Proposed authority

- Add a version-gated entry point for setting the GL3 posting price. Limit it
  to sealed GL3 and a canonical delayed contract transaction from the existing
  Robinhood UpgradeExecutor. Reuse the prior activation's origin, aliased
  sender, authenticated poster, and delayed message checks.
- A price call includes the expected prior price and the reviewed new price.
  Require it to match current state when applied. Emit the old and new values
  for public verification. Review the exact units and price bounds with the
  release.
- The first activation resets the price to **0.015 GH0ST per compressed byte**
  in the same block as the authenticated migration. The proving root binds
  the exact reset value. This avoids signing an old-price snapshot that could
  expire during proving-root promotion. Later price changes use the exact
  prior-price check above.
- Preserve the zero owner list, the bridge and withdrawal rules, the A14
  seed and coordinator state, and the execution base fee. Keep Nitro's
  existing batch-report pricing controller active.

The current Stockfish [fee study](seed-launch-quote-20261119.json) puts the
initial affordability target at roughly **0.0193 GH0ST per compressed byte**
with the prize reserved. The next batch report may change a manually set
price. A lasting fee cap and funding for any posting deficit would require
a separate economic review. Robinhood posting continues to use the
batch poster's ETH balance.

[Nitro posting price updates](https://raw.githubusercontent.com/OffchainLabs/nitro/v3.12.2/arbos/l1pricing/l1pricing.go#L438-L481)

## A14 compatibility

The [current activation overlay](../stage_activation.py) selects A14 at
ArbOS 62 by exact version equality. If the fee upgrade adds a new ArbOS
version, its runtime must explicitly carry forward the A14 precompile and
its authorization rules. Replay at version 62 must retain its original
activation and dispatch behavior. The isolated test must verify that the
Stockfish module, seed cursor, and A14 methods remain accessible after the
fee transition.

## Evidence before a live review

1. Build the node and proving machine from the same pinned source. Select the
   activation version and method after auditing unused version and address
   assignments in the pinned build.
2. Cold-replay the historical chain, the A14 boundary, the proposed upgrade,
   and the first fee update. Match block, state and send roots and inbox
   positions. Verify that ordinary sequenced callers, unrelated parent
   signers, and stale price requests are rejected.
3. Rehearse the handoff and preserve read access on both public RPCs throughout
   the separately approved brief write pause.
4. Freeze the proof root, activation method, and exact first price action for
   the Robinhood signing review. Check parent finality, validator adoption,
   the price on both public RPCs, and the effect of the next batch report.

**Status** The earlier fee-control candidate passed private activation and six
proof replays. The atomic reset changes the proving root and requires fresh
proof evidence. Live handoff and activation are pending.
[Earlier build evidence](fee-control/build-evidence-20261119.json)
