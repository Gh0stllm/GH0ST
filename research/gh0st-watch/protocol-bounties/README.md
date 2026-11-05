# GH0ST Bounties

Source for the [public bounty board](https://gh0st.fyi/bounties/). Visitors can read tasks and evidence without signing in. Internet Identity is required to post, submit evidence, and record a sponsor decision.

When the canister exposes a Robinhood Chain escrow configuration, a sponsor can attach a GH0ST reward before a bounty receives submissions. The sponsor prepares a fixed wallet and amount, grants an exact token allowance, then funds the escrow. A contributor to a funded bounty connects a fixed payout wallet when submitting evidence. The sponsor can pay an eligible submission or cancel the escrow through their wallet. The board records funding, payment, or cancellation after the sponsor submits the transaction hash and the canister verifies a finalized receipt. Bounties without escrow continue through the evidence-only workflow.

Wallet signing requires a direct EVM account on Robinhood Chain and ETH for gas. The page saves the latest escrow transaction hash in the sponsor’s browser. To resume on another device, copy the funding, payment, or cancellation hash from wallet activity and use **Verify reward transaction** after it finalizes. If a prior wallet request has an unknown outcome, find that transaction in wallet activity and use **Check pending transaction** before signing again.

## Build

Run these commands from this directory with Node.js 22 or later.

```sh
npm ci
npm run build
```

The default build targets the existing ICP mainnet canister `ggcey-baaaa-aaaao-bbsgq-cai` and writes three static files to `dist/bounties/`. To stage them at the same path in a full site overlay, pass the canister ID and the output root.

```sh
npm run build -- ggcey-baaaa-aaaao-bbsgq-cai /path/to/site-overlay
```

The canister must expose the core board methods defined in `service.js` before the board is published. The reward methods and configuration are optional. Queries verify ICP responses with the SDK's mainnet root key. Internet Identity derives its principal for the site's origin, so a preview hostname has separate sign-ins. The app loads the existing site fonts from `/fonts/` and Bounties artwork from `/roadmap/assets/`.

## Local preview

```sh
BOUNTIES_FIXTURE=1 npm run build
python3 -m http.server 8021 --directory dist
```

Open [the localhost board](http://localhost:8021/bounties/). The fixture runs in memory and resets when the page reloads. It stands in for sign-in, canister calls, and the Robinhood wallet. Bounty #2 has a funded reward and a pending submission. Bounty #1 accepts an evidence submission with a payout wallet. Publish with a regular build. An alternate trusted HTTPS ICP gateway can be set at build time through `BOUNTIES_IC_HOST`.
