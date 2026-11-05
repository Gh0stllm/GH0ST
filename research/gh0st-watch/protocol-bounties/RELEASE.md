# Bounties release

The evidence board shares the existing Watcher and Spawn canister, `ggcey-baaaa-aaaao-bbsgq-cai`, on ICP. Anyone can read the board and Internet Identity signs writes. Task creators review submissions. Robinhood Chain escrow holds and transfers optional token rewards.

## Backend release checks

1. Match the current live module hash to the saved pre-upgrade Wasm. Capture the live Candid, a known Spawn profile and Watcher's cached note and assets.
2. Build `../icp-checker` with its locked dependencies and attach the updated public `candid:service` metadata. Run the Rust tests and check the Wasm exports against the updated interface.
3. On a disposable replica, start from the exact previous Wasm, save a Spawn profile, and upgrade. Verify the profile survives. Exercise anonymous read, authenticated creation, a different principal's evidence submission, owner-only review, and persistence through a second upgrade.
4. Check the existing canister balance. Stop it briefly, take a snapshot, install with `--mode upgrade`, and restart. Do not use reinstall, create a canister, or top up cycles for this release.
5. Confirm the new public board responds and that the saved Spawn profile, cached Watcher note, and certified Watcher assets still match.

## Website release checks

Build the Bounties page using the existing mainnet canister. Apply `site-overlay.py` to the published homepage and roadmap HTML. Publish the overlay as part of the complete Netlify site snapshot, preserving the existing static files, functions, aliases, and routing rules. The dated artwork still shows the original roadmap snapshot; the HTML labels the evidence board as a preview once it is live.

## Robinhood escrow launch

Build and test [`escrow/`](escrow/). The exact artifact uses chain ID 4663 and canonical GH0ST `0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559`. Review the gas estimate and pilot amount before signing. Verify the creation receipt and deployed runtime hash against the built artifact, then configure the escrow address once on the ICP board. The browser checks the same runtime hash before presenting any wallet transaction.

Run a capped funding, payout and refund pilot before publishing the reward controls. Verify that the contributor receives the exact amount, that the second deposit returns to the sponsor wallet, and that ICP independently records the finalized Robinhood receipts. A creator signs a direct wallet transaction to pay the address fixed to the submission. The creator can cancel and reclaim a deposit until a payout succeeds. The payout succeeds on Robinhood before the board can mark the proof approved. A finalized payment from a direct contract call that fails to match a submission closes the board record with an unmatched payout status.

The board uses the official Robinhood RPC for bounded receipt, finality and canonical-block checks. For funding it also checks that the escrow still holds the exact deposit. Use the original transaction hash to resume verification after finality, a browser refresh, or a temporary RPC error. Reward options stay hidden until escrow is configured. If moderation hides a bounty, its creator can still call `cancel` directly with the saved escrow key and reconcile the refund through `bounty_sync_reward`.
