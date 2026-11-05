# GH0ST Bounty Escrow

The constructor accepts no arguments and requires Robinhood Chain mainnet (chain ID 4663) and contract code at the canonical 18-decimal GH0ST token address, `0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559`. The escrow has no administrator or fee.

The creator approves the GH0ST allowance and calls `fund(bountyKey, amount)`. The reward is scoped to the creator’s wallet and that board key. `approve(bountyKey, submissionId, recipient)` pays the exact reward to the recipient that the creator signs for. The creator chooses which evidence to accept and must check the payout address before signing.

The Bounties V1 board requires a direct EVM account for sponsorship and verifies finalized transactions sent from that wallet to the escrow. If a direct payout uses a submission ID or recipient outside the board’s eligible matches, the board records `paid_unmatched` and closes the bounty with zero approved submissions.

Before payment, `cancel(bountyKey)` closes the reward and returns any funded GH0ST to the same creator wallet. Cancelling an empty reward also closes the key, so a delayed funding transaction cannot reopen it. A failed funding transaction leaves its token allowance available for the creator to revoke. After either payment or cancellation, the key is closed for that creator.

`getReward(creator, bountyKey)` returns status, original amount, paid submission ID and paid recipient. Status is `0` empty, `1` funded, `2` paid or `3` cancelled. The contract emits `RewardFunded`, `RewardPaid` and `RewardCancelled` with the creator and key indexed. The paid event also indexes the submission ID and records the recipient. Each event records the exact amount, including zero for an unfunded cancellation. Use successful finalized receipts to confirm these events.

Send rewards through `fund`. Direct token transfers to the escrow do not create a reward and the contract has no sweep function.

Run `forge test` from this directory. The optional mainnet fork test uses a public RPC and a holder with at least 2 GH0ST. Foundry impersonates the holder inside the fork.

```sh
GH0ST_ESCROW_FORK_RPC=https://rpc.mainnet.chain.robinhood.com \
GH0ST_ESCROW_FORK_CREATOR=0xYOUR_PUBLIC_TEST_HOLDER \
forge test --match-test testForkCanonicalTokenPaysAndRefundsExactly
```
