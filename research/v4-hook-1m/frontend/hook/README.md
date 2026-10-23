# H00K — GH0ST swaps and on-chain sentences

Public route: https://gh0st.fyi/H00K (GH0ST uses a zero). The static page supports native ETH ↔ GH0ST on Robinhood mainnet4663, through the exact deployed sentence-hook pool. The existing website, worker functions, and other pages are preserved when publishing.

## Public liquidity

The Add liquidity tab accepts any connected wallet. Users choose an ETH maximum and review the paired GH0ST maximum. First deposits use the existing GH0ST market as a reference and atomically initialize the new pool; later deposits use the pool price. Positions span the full price range and mint an NFT to the user. Both caps are enforced over a 0.5% price band, with unused ETH refunded and unspent GH0ST retained. Approvals, mint and receipt recovery each stay user-controlled.

## Behavior

- The page verifies hook, model, PoolManager, latest UniversalRouter, Quoter, StateView and Permit2 runtime hashes before allowing a quote.
- Every swap includes `0x53504b31` (SPK1): speech is required in the same transaction. A failed required generation reverts the swap.
- The user chooses the input amount, reviews a quote and minimum output, and confirms every approval or swap in their wallet. No key is accepted by the website.
- Token approvals are exact and the router allowance expires. Native ETH needs no token approval. Gas limits use150% of the current estimate; wallet fee pricing is retained.
- Sentences are decoded only from `SentenceSpoken` logs matching the exact hook, pool ID and model hash. Text is rendered as plain text. Empty states contain no invented model output.
- The page shows the live pool readiness state and prevents swaps until the pool has active liquidity. At the recorded preflight, contracts were deployed but the intended pool had no initial liquidity.
- Pending transactions remain in browser storage. An ambiguous outcome blocks another send until its receipt is reconciled, including manual hash recovery. Cross-tab signing uses an exclusive Web Lock.

## Validation

Run `node --test tests/evm/hook-swap.test.mjs tests/evm/hook-liquidity.test.mjs` from the research project. The swap and public-liquidity tests cover routing, hook data, exact approvals, deadlines, slippage, chain/account checks, no-liquidity handling, event authenticity and duplicate-safe recovery.

`fork-validation.json` records local-fork execution of both directions using the actual deployed contracts. Both swaps succeeded and emitted authentic sentences; measured gas was5,003,442 for ETH→GH0ST and4,570,485 for GH0ST→ETH. These were local transactions, not mainnet swaps. `validation.json` contains the chain preflight and runtime hashes.

The page uses local fonts already hosted by GH0ST and bundled ethers6.13.5. Its public RPC contains no credential. The private Alchemy RPC and Netlify token are excluded from public files and source control.
