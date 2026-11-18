# GH0ST Chess on GL3

The playable GL3 game pairs the existing on-chain chess rules with the
retained Stockfish 19 engine at precompile address `0x0a14`. White plays
through the game contract. The contract builds the exact UCI history from
the moves it has already accepted. A14 runs Black's search with the pinned
NNUE model, 24 million-node policy, 128 MiB hash and retained memory for the
whole game. The game applies the completed move from the engine's state.

One game reserves the engine and **1,000,000 GH0ST** before the player pays
the **25,000 GH0ST** native entry fee. A human checkmate credits the fixed
prize. A missed bot deadline credits the entry refund. The recipient can
claim each balance separately from settling the board.

## Build the game contract

Use the existing chess package's pinned Solidity 0.8.30 dependency.

```sh
node research/gl3/chess/game/build.mjs new-gl3-chess-artifact.json research/chess/package.json
```

The artifact contains deployment bytecode, compiler settings, immutable
references and ABI. Solidity 0.8.30 produced **17,404 runtime bytes** for
the [compiled revision](build-20261118.json).

The [wallet client](frontend/README.md) uses the reviewed release manifest
and the compiled artifact. The optional [keeper](keeper.mjs) advances
Black's on-chain work using the same manifest. It prints the next action by
default. Run mode needs a dedicated funded signer and a pending transaction
journal. Entry, White's moves, and payout claims remain wallet actions.

```sh
node research/gl3/chess/game/keeper.mjs live-release.json new-gl3-chess-artifact.json
```

## Live engine dependency

The [custom runtime](../sliced/README.md) completed the full-strength move in
a private EVM chain and reproduced consecutive blocks in fresh native
replay. The [stock Stylus implementation](../stylus-port/README.md) reached
partial opening execution. Live GL3 currently runs the base Nitro profile.

The game requires matching native execution and proof software, a pinned
engine image installed in the live chain's state, and A14 configured to
admit this coordinator. The private runtime loads its engine image at
genesis. Applying that initial state to an existing rollup requires a
separate deterministic migration delivered with the runtime upgrade. The
[engine overlay](engine/README.md) includes candidate source for the
[scheduled activation](engine/ACTIVATION.md) and the
[pinned seed migration](engine/SEED-MIGRATION.md). The candidate is separate
from the private startup profile and awaits a matching native and proof
build. [Mainnet status](engine/MAINNET.md)

The research build tooling can prepare native execution and its matched
replay machine from the same coordinator source. The profile writes its
artifacts in separate `game-a14` cache directories.

```sh
python3 research/gl3/chess/build_replay.py --sliced --game-coordinator --candidate-arbos-version 62
```

The game source and toolchain can be prepared before the chain upgrade.
Paid entry remains closed until the expected engine identity, coordinator
admission and prize funding can be established on GL3.
