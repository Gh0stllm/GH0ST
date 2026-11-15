# GH0ST Chess Challenge

Research and implementation in progress. A real Stockfish 19 engine has been built and executed in isolated local ICP tests. No paid challenge, public engine deployment or prize funding is live.

**Current user-selected execution target: hybrid ICP brain + Robinhood game.** Full Stockfish 19 with the improved, per-game retained cache runs on ICP. Robinhood Solidity owns the board, legal moves, game result, GH0ST entry and reserved reward. A bot signature authorizes a Black move; it cannot assert a winner or bypass native chess rules. The earlier [fully native research](NATIVE_ROBINHOOD.md) remains an archived alternative.

**Prize-readiness finding:** the 3m-node, per-decision-cache-cleared reference was legally checkmated in one of six completed full games against a 12m-node challenger; the other five games drew. Six deeper-challenger games were stopped unfinished to prioritize repairs and are excluded from that fraction. The winning transcript is reproducible evidence, not a future-user probability. This unchanged policy must remain unfunded while the [higher-budget and per-game-cache repair candidates](benchmarks/README.md) are tested. The user has also requested an [ICP cost comparison](icp-costs/); this does not silently switch the selected execution target.

**Completed repair checkpoint:** retaining TT/history within each game held fresh Larsen games against both 12m and 24m challengers to legal Black threefold draws (63 and 57 plies). Four consecutive decisions, including the changed defence, and a new-game reset matched native execution on local ICP in the [retained-cache experiment](engine/continuation/retained-experiment/README.md). This is a promising tested candidate, not an unbeaten guarantee or production activation. The optional 10m-cleared full-game trial was stopped unfinished at the user's request to finish faster. Paid entry remains closed.

User-selected terms: **25,000 GH0ST entry fee; 1,000,000 GH0ST total payout** only when the human player legally checkmates the bot. A winner nets **975,000 GH0ST before network costs**. Top-ups are manual. No project wallet or existing escrow balance is authorized for automatic funding. Every accepted game must have its full one-million-token potential prize reserved. Entry fees alone cover prizes at a 2.5% player win rate before execution costs; this is arithmetic, not an estimated win probability or profitability claim.

The hybrid implementation is being connected under `contracts/HybridChess*`, `engine/hybrid/`, `hybrid-brain/` and `frontend/`. Until public deployment, funding and end-to-end receipts verify, the page must keep paid entry closed. The previous ICP game-authority/terminal-attested vault below is historical source, not the selected hybrid architecture.

The game authority and Stockfish engine are built as separate ICP canisters. The reward vault is designed to hold the canonical GH0ST entry fees and reserved prizes on Robinhood Chain. The pinned official Stockfish 19 release uses its complete 98,511,183-byte neural network, maximum skill, and disabled strength limiting. The synchronous ICP Wasm is 101,257,329 bytes (96.567 MiB). Fourteen local ICP searches at 250,000 and 500,000 target nodes matched the native upstream engine in move, node count and completed depth; additional Black-side and costly-evaluation cases also matched. A one-million-node opening search exceeds the synchronous per-message instruction ceiling.

A separate [test-only continuation prototype](engine/continuation/experiment/README.md) now preserves the same search across ICP updates. Three one-million-node cases completed over 50 local updates each. A three-million-node Black search completed over 30 updates, reaching depth 28 and exactly matching native Stockfish's move, final nodes and depth. That module is 102,984,786 bytes (98.214 MiB); its largest observed update used 10.361 billion instructions. These are isolated local ICP results, not public gameplay or Elo evidence. The continuation still needs the production job/step journal, multi-game queue, interleaving protection, upgrade recovery and authority adapter before paid use.

The reward vault passed 87 local checks with 215 isolated EVM transaction receipts. The Rust authority passed legal-rules/session tests and a local canister installation/upgrade check, including rejection of entry attempts. Browser approval and entry remain disabled in the staged interface until the authority, engine, source, signer, canonical token, and full prize reserve all verify. The production RH entry verifier and threshold-ECDSA result signing/relay are unfinished; the current canister has no setting that bypasses those gates.

Draws, bot wins, resignation and player abandonment have no prize under the reviewable default terms; their entry fee is retained. Infrastructure failure refunds the entry fee. Proposed fixed windows are 24 hours of play plus seven days for settlement reconciliation. These defaults and custody/upgrade controls require review before a funded launch.

The reward vault verifies a pinned ICP-controlled ECDSA attestor. It does not independently execute Stockfish or verify ICP code in Solidity. Its trusted-canister/controller boundary must be explicit. Games bind a wallet, ICP principal commitment, engine configuration, position/transcript, chain/vault domain and entry nonce. One verified game cannot pay twice or pay a caller-selected recipient.

External engines cannot be excluded by wallet checks. Players may automate, use stronger hardware or prepare openings. At a 25,000 entry and 100,000 payout, the token pool breaks even at a 25 percent player-win rate before execution costs when entry fees are retained on draws. This is arithmetic, not a profitability or human-only-play guarantee.

## Source and evidence

- [Stockfish port, build pins, licenses and measured ICP execution](engine/README.md)
- [Durable game authority and test commands](protocol/README.md)
- [Protocol, terms and production launch gates](spec/PROTOCOL.md)
- [Reward vault, fixed payouts and local escrow evidence](evm/README.md)
- [Frontend source and local build](frontend/)
- [Read-only RH token identity and operating-cost notes](ops/README.md)
