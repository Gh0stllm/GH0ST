# ICP brain, Robinhood game

Selected by the user on 2026-11-15. Human plays White from the standard starting position. Entry is 25,000 GH0ST; legal human checkmate pays 1,000,000 GH0ST total to the original entering wallet. Full reward is reserved before accepting the fee. No automatic pool top-ups.

## Authority

- Robinhood chain 4663: immutable game contract, native move validation, board, castling/en-passant/promotion, repetition/draw adjudication, deadlines, escrow and payouts.
- ICP engine: official Stockfish 19, full pinned NNUE, 24 million nodes, Hash 128 MiB, one thread, maximum skill. TT/history retained across decisions within one game and explicitly cleared between games. No lower-strength fallback.
- ICP coordinator: reads canonical RH game state through its pinned HTTPS RPC, independently replays full legal UCI history and its contract transcript, drives bounded engine steps, and signs the resulting Black move using threshold ECDSA.
- Browser: wallet actions, board interaction, progress and permissionless bounded cranking. It never supplies an accepted bestmove or winner.

One active game at a time matches one retained engine instance. Increasing capacity requires isolated per-game engine memory and contract capacity changes, not clearing another player's cache. Chain rules and payment remain valid if the brain is offline; a missed bot deadline permits the game's entry-refund path.

## Signed move

EIP-712 domain: `GH0ST Hybrid Chess`, version `1`, chain 4663, exact game contract.

`BotMove(bytes32 gameId,address player,uint32 ply,bytes32 positionHash,bytes32 transcriptHash,uint16 encodedMove,bytes32 engineConfigHash,uint64 validUntil)`

Position hash is `keccak256(abi.encode(board,castling,enPassant,blackToMove))`. Transcript starts at `keccak256("GH0ST_CHESS_INITIAL_V1")`; append each move with `keccak256(abi.encode(previous,uint16 encodedMove))`. Move is `(from << 6) | to | (promotion << 12)`, squares a1=0 through h8=63, promotion knight=2/bishop=3/rook=4/queen=5. Signature is valid only for the exact current game, original wallet, ply, position, transcript, configured engine and expiry. Applying a bot move still executes native legality and terminal adjudication.

## Evidence and trust

RPC agreement/confirmations are an explicit external-data trust boundary, not a cryptographic EVM state proof. The configured ICP module hashes/controllers, threshold signer, contract code and funding must be checked at launch. Controllers can upgrade canisters; a pinned release and disclosed upgrade policy are required. Active continuation loss must fail/refund, never silently restart with a cleared cache or smaller budget.

The improved bot drew two fresh Larsen games against 12m/24m challengers. This does not establish a population win probability. The original cleared-cache bot was checkmated once in six completed games; it must not be used as the funded policy. Public engines and automation cannot be excluded, and a deterministic winning transcript can be replayed. Wider opening regression and a capped pilot precede funded public entry.

## Launch gates

Complete native legality and custody tests, actual retained engine/coordinator integration, canister hashes and signer derivation, Robinhood deployment receipts, full reward reserve, manual operating budget, frontend dependency checks, end-to-end move and refund receipts. Historical legacy contracts and native cost comparators do not satisfy these gates.
