# GH0ST Chess: Robinhood game, ICP brain

This source implements the selected hybrid architecture. It is distinct from the older `RHChessChallengeVault` research escrow, which accepted signed terminal outcomes without executing chess.

## Immutable economics

- Entry: **25,000 GH0ST**.
- Total payout for a legal human checkmate: **1,000,000 GH0ST** to the wallet that entered; net 975,000 before gas.
- The full 1,000,000 must already be available before entry is charged. Entry cannot fund its own missing collateral.
- One active game globally matches one retained-cache engine. Every entry reserves its full prize; owner withdrawals cannot touch it.
- Draw, human resignation, human timeout or bot checkmate pays no prize and retains entry.
- A missed Black service deadline refunds exactly the entry. This closes the game and releases the unused prize reserve.
- Manual funding only. There is no token auto-pull, minting, topup or administrator force-win function.

The pool owner and ICP signer are immutable. The deployment starts paused. Pausing blocks new entries only; existing moves, refunds and results continue.

## Authority and trust

`HybridChessGame` stores the board, side, castling rights, en-passant square, halfmove clock, ply, transcript and repetition counts. It executes each move through `HybridChessRules`. It decides checkmate and pays from escrow in the same transaction. The ICP signer authorizes Black moves; it cannot submit a terminal winner declaration or change the recipient.

This still trusts the ICP brain and its controllers to run the promised Stockfish policy honestly. A valid threshold signature is authorization, not a cryptographic proof of search execution. A malicious signer could authorize deliberately losing legal moves. Engine identity, controller policy, retained-cache isolation and adequate operating cycles must be verified before paid entry is enabled.

Human is White. Standard starting position only. One hour per Black turn and one day per White turn, measured on Robinhood block timestamps. Black moves must land by their immutable turn deadline; a signature cannot extend it. After a missed turn anyone can call `claimTimeout`. The player forfeits a missed White turn; a missed Black turn refunds entry. There is no owner-triggered early termination.

## Board and move encoding

Squares are a1=0 through h8=63. Each square occupies a 4-bit nibble at `4*square` in `uint256 board`. White pieces: pawn1, knight2, bishop3, rook4, queen5, king6. Black adds8. Empty0.

`encodedMove = (from << 6) | to | (promotion << 12)`.

Promotion is 2=knight,3=bishop,4=rook,5=queen; zero for every non-promotion. All four promotions are supported; missing, extraneous or reserved promotion bits reject.

Castling rights: White kingside1, White queenside2, Black kingside4, Black queenside8. Rights clear after king/rook movement and corner-rook captures. Castling requires the actual rook, clear intervening squares and a king that is not in check at its start, transit or destination.

En-passant is the raw target square after **every** two-square pawn advance, even if no capture is available; otherwise64. A legal en-passant move removes the pawn before self-check testing.

`positionHash = keccak256(abi.encode(uint256 board,uint8 castling,uint8 enPassant,bool blackToMove))`.

Repetition uses a separate key that replaces the raw en-passant target with64 unless a **legal** en-passant capture exists. This includes checking for discovered self-check.

Initial transcript is `keccak256(bytes("GH0ST_CHESS_INITIAL_V1"))`; every legal move advances it with `keccak256(abi.encode(bytes32 previous,uint16 encodedMove))`. `getMoves(gameId)` returns the canonical complete encoded history.

## Bot authorization

Domain:

```text
EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)
name = GH0ST Hybrid Chess
version = 1
```

Type:

```text
BotMove(bytes32 gameId,address player,uint32 ply,bytes32 positionHash,bytes32 transcriptHash,uint16 encodedMove,bytes32 engineConfigHash,uint64 validUntil)
```

The signature is checked against the immutable attestor with low-s enforcement. Exact current game, wallet, ply, position, transcript and engine configuration must match. Validity cannot exceed the stored turn deadline. Chain and contract are bound by the domain. Any relayer may apply a valid move. Replay, alternative position, cross-game and modified moves fail. Signatures authorize only Black's turn and still pass native legality.

## Terminal adjudication

After each legal move, no legal reply plus check means checkmate; no legal reply without check means stalemate. **Checkmate takes precedence** over move-count and repetition draw thresholds.

Automatic draws: fivefold repetition, 150 reversible halfmoves, and conservative material-dead positions (bare kings, king and one bishop/knight versus king, or bishops-only material with every bishop on the same colour). General blocked-position deadness is not solved by this material check.

Human may claim a current-position threefold repetition or 100 reversible halfmoves on their turn. Black claims those current-position draws automatically on its turn. This challenge intentionally does **not** implement the optional FIDE procedure of claiming a draw before making an intended move. It has no agreed draw, clock flag challenge, arbiter or takeback.

## Source and verification

- `contracts/HybridChessRules.sol`: independent packed-board orthodox move rules and read-only test helper.
- `contracts/HybridChessGame.sol`: single-capacity native game, threshold bot authorization and exact token custody.
- `evm/compile-hybrid.mjs`: pinned Solidity0.8.30, optimizer200, viaIR, Shanghai artifacts.
- `evm-tests/hybrid.test.mjs`: local EVM differential legality, promotions/castling/en-passant, signed moves, escrow and timeout tests.
- `evm/hybrid-test-report.json`: generated local receipts and assertions when the complete test passes.

Current complete local run passed **277 checks** and **55 mined receipts**. It compared **2,071 legal branches** from80 deterministic positions against chess.js, rejected240 sampled illegal moves, and verified every start-position depth2 leaf (**400**) and every Kiwipete depth2 leaf (**2,039**). All195 plies of the saved historical `98.Qa8#` loss replay through the independent Solidity move rules. Separate paid-game fixtures prove native Scholar's mate pays exactly1,000,000, bot outage refunds25,000, entry reserves before charging, signed moves cannot replay, and hostile token callbacks/taxes/false returns roll back atomically. Largest observed move was the native mate/payout at **3,152,236 gas**, below Robinhood's measured32M transaction cap; this is a tested case, not a universal worst-case proof.

Runtime sizes: game14,079 bytes; standalone rules test helper5,119 bytes. Rules are inlined in the game; the helper is not a production dependency.

Local testing is not an external contract audit or public deployment. Paid activation additionally requires canonical Robinhood chain4663/GH0ST binding, actual ICP module/controller/config/signer verification, full-budget inference integration and sufficient manual operating/prize funding.
