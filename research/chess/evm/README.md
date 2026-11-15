# RH chess reward vault: local review stage

This is source and isolated local test evidence. No vault has been deployed, funded,
or enabled on Robinhood Chain by this work. New deployments start **paused**. The
reward engine and payment bridge still need independent verification before paid entry.

The production binding is Robinhood mainnet **chain ID 4663** and canonical GH0ST
**0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559** (18 decimals). The constructor accepts
an alternate 18-decimal token to permit local hostile-token testing. A production
manifest and front end must verify chain, token address and code, deployed vault
runtime/immutables, pinned attestor, pinned engine configuration and funding before
the immutable owner enables entries. The constructor alone does not enforce those
production bindings. There is no production attestor address or deployment manifest yet.

The vault trusts the pinned ICP threshold-ECDSA attestor to authenticate the ICP
principal, verify the real RH entry, execute the pinned chess/Stockfish policy, and
sign the correct terminal result. EVM signature verification does **not** prove ICP
execution, chess legality, engine strength, or a deployed canister's code. Canister
controllers, entry verifier, key derivation and engine build are material trust boundaries.

Review defaults requiring the user's review before launch:

- Entry costs exactly **25,000 GH0ST**. Human checkmate pays **100,000 GH0ST total**
  to the wallet that entered; the winner nets **75,000 GH0ST before gas**.
- Each new entry requires at least 100,000 GH0ST free pool **before** collecting
  its entry fee. That full amount remains reserved until its one terminal outcome.
- Signed bot checkmate, draw, human resignation or player timeout pay no reward;
  the entry fee stays in the pool. Signed service fault or engine abort refunds
  exactly the entry fee and releases the full prize reserve.
- Games have 24 hours from on-chain entry and then seven days to reconcile a
  signed result. `completedAt` must be within the game window, including its last
  second. `completedAt <= issuedAt <= now <= validUntil <= reconciliationDeadline`.
  Attested player timeout may complete at the exact gameplay deadline.
- After the reconciliation deadline, anyone may trigger a 25,000 GH0ST refund
  to the bound player for missing attestation. Missing evidence never causes an
  unsigned loss. A refund and a prize can never both succeed for the same game.
- The pool has voluntary manual funding only. `fundPool(amount)` pulls only the
  calling funder's approved amount; it has no budget wallet, auto-refill or wallet
  allowance registry. Direct donations become free pool without creating games.
- The immutable owner may pause new entries and withdraw only unreserved funds
  to itself. It cannot change fees, prize, signer, engine configuration, owner or
  existing game deadlines, or arbitrarily close a game. Existing settlement and
  timed refund remain available while entries are paused.
- Normal, exact-transfer GH0ST behavior is assumed. Taxed/false-return transfers
  revert atomically. Unexpected token balance destruction reports insolvency and
  fails closed; nobody can use an owner withdrawal to consume active reserves.

`receipt-schema.json` fixes the EIP-712 types and outcome codes; the `nonce` in the
receipt is exactly the wallet's original uint256 entry nonce, not a new counter.
Principal commitments are SHA256 of raw ICP Principal bytes. `EntryAccepted` comes
only from atomic `enterGame`, never from a plain token transfer. Relayers may submit
receipts but cannot redirect either the prize or fee refund.

From the chess project root: `node evm/compile.mjs` writes the ABI/artifacts and
`node evm-tests/vault.test.mjs` executes isolated Ganache checks on chain 31337.
`test-report.json` and `receipt-test-vector.json` contain local evidence only.
