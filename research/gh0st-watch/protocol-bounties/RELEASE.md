# Bounties release

The evidence board shares the existing Watcher and Spawn canister, `ggcey-baaaa-aaaao-bbsgq-cai`, on ICP. The public page uses anonymous queries; Internet Identity signs writes. Task creators review submissions. The board does not hold funds, calculate rewards, call Qwen, or send payouts.

## Backend release checks

1. Match the current live module hash to the saved pre-upgrade Wasm. Capture the live Candid, a known Spawn profile and Watcher's cached note and assets.
2. Build `../icp-checker` with its locked dependencies and attach the updated public `candid:service` metadata. Run the Rust tests and check the Wasm exports against the updated interface.
3. On a disposable replica, start from the exact previous Wasm, save a Spawn profile, and upgrade. Verify the profile survives. Exercise anonymous read, authenticated creation, a different principal's evidence submission, owner-only review, and persistence through a second upgrade.
4. Check the existing canister balance. Stop it briefly, take a snapshot, install with `--mode upgrade`, and restart. Do not use reinstall, create a canister, or top up cycles for this release.
5. Confirm the new public board responds and that the saved Spawn profile, cached Watcher note, and certified Watcher assets still match.

## Website release checks

Build the Bounties page using the existing mainnet canister. Apply `site-overlay.py` to the published homepage and roadmap HTML. Publish the overlay as part of the complete Netlify site snapshot, preserving the existing static files, functions, aliases, and routing rules. The dated artwork still shows the original roadmap snapshot; the HTML labels the evidence board as a preview once it is live.
