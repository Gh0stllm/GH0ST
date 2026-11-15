# GH0ST Chess Challenge

Research and implementation in progress. No paid challenge, mainnet engine deployment or prize funding is live.

User-selected terms: 25,000 GH0ST entry fee; 100,000 GH0ST total payout only when the human player legally checkmates the bot. A winner nets 75,000 GH0ST before network costs. Top-ups are manual. No project wallet or existing escrow balance is authorized for automatic funding. Every accepted game must have its full potential prize reserved.

The proposed game authority and full-strength Stockfish engine execute in separate ICP canisters. Robinhood Chain holds the canonical GH0ST entry fees and reserved prizes. The intended engine is the pinned official Stockfish 19 release with its full neural evaluation network, maximum skill, strength limiting disabled and a measured fixed search budget. Compilation, consensus execution and rating claims require separate evidence. No weaker fallback is permitted for paid games.

Draws, bot wins, resignation and player abandonment have no prize under the reviewable default terms; their entry fee is retained. Infrastructure failure refunds the entry fee. Proposed fixed windows are 24 hours of play plus seven days for settlement reconciliation. These defaults and custody/upgrade controls require review before a funded launch.

The reward vault verifies a pinned ICP-controlled ECDSA attestor. It does not independently execute Stockfish or verify ICP code in Solidity. Its trusted-canister/controller boundary must be explicit. Games bind a wallet, ICP principal commitment, engine configuration, position/transcript, chain/vault domain and entry nonce. One verified game cannot pay twice or pay a caller-selected recipient.

External engines cannot be excluded by wallet checks. Players may automate, use stronger hardware or prepare openings. At a 25,000 entry and 100,000 payout, the token pool breaks even at a 25 percent player-win rate before execution costs when entry fees are retained on draws. This is arithmetic, not a profitability or human-only-play guarantee.
