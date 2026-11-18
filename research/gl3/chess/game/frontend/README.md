# GL3 Chess wallet client

`wallet.mjs` connects a browser wallet to the full `GL3StockfishChess` coordinator. It uses native GH0ST for the 25,000 entry and reads the fixed 1,000,000 prize from the contract.

The page must supply the reviewed `GL3StockfishChess` compiler artifact with its ABI, creation bytecode, runtime bytecode and immutable references. It also needs a verified deployment configuration with `schemaVersion: 1`, `status: "live"`, and the following fields.

| Field | Value |
| --- | --- |
| `chainId` | `4663001` |
| `publicRpc` | `https://rpc.gh0st.fyi/` |
| `genesisHash` | The canonical GL3 block zero hash exported by the wallet module |
| `coordinator`, `poolOwner` | Reviewed coordinator and pool owner addresses |
| `coordinatorRuntimeHash`, `deploymentTransaction` | Exact deployed runtime hash and creation transaction hash |
| `engineModuleHash`, `engineSeedRoot` | Exact native Stockfish module and initialized-state commitment |

`verify()` checks the release against the canonical chain, the original constructor, the reviewed bytecode and immutable terms. `connect()` adds or selects GL3 in the user's wallet and returns the verified state and native balance. `game(id)` returns a board and search snapshot anchored to one block. `engineProgress(id)` reads the native engine, and `credit(account)` reads earned GH0ST.

The page can invoke `enter()`, `humanMove(id, uci)`, `beginBotSearch(id)`, `advanceBotSearch(id)` and `applyBotMove(id)` as separate user actions. Each receives its own wallet approval. `claimDraw(id)`, `resign(id)`, `claimTimeout(id)` and `releaseEndedGame(id)` cover the game lifecycle. `claimPayout(recipient)` withdraws already credited GH0ST to the selected address. Each write returns its verified receipt together with available position, settlement and payout data.

`pending()` exposes the saved transaction intent. A page can call `resolve(hash)` to reconcile an interrupted wallet action using its exact hash. The client keeps writes blocked until that intent is resolved. Resolved payouts report the wallet, recipient and amount from the coordinator’s checked event.

This source has no deployment configuration. Public gameplay requires the deployed coordinator and activated native engine.
