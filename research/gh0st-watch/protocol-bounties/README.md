# GH0ST Bounties

Source for the [public bounty board](https://gh0st.fyi/bounties/). Visitors can read tasks and evidence without signing in. Internet Identity is required to post, submit evidence, and record a sponsor decision. The board records work and review decisions. This preview has no escrow or payouts.

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

The canister must expose the six methods defined in `service.js` before the board is published. Queries verify ICP responses with the SDK's mainnet root key. Internet Identity derives its principal for the site's origin, so a preview hostname has separate sign-ins. The app loads the existing site fonts from `/fonts/` and Bounties artwork from `/roadmap/assets/`.

## Local preview

```sh
BOUNTIES_FIXTURE=1 npm run build
python3 -m http.server 8021 --directory dist
```

Open [the localhost board](http://localhost:8021/bounties/). The fixture runs in memory and resets when the page reloads. It stands in for both sign-in and canister calls. Publish with a regular build. An alternate trusted HTTPS ICP gateway can be set at build time through `BOUNTIES_IC_HOST`.
