# Private signing site

The static signing page is packaged separately from the research project. Run
`node scripts/package-signing-site.mjs` from the research directory. Publish only
`deployment/signing-site/`; it contains the reviewed HTML, deployment and liquidity helpers, pinned plan,
vendored ethers, license, robots file and security headers. The build refuses a
changed plan hash, a changed model identity, credential-like content or unexpected
output files. `.netlify/` and generated site files are gitignored.

The Netlify project must require **team login for all deploys**, including
production, previews and deploy permalinks, before the site files are uploaded.
The `_headers` and `robots.txt` files do not make a site private; the Netlify
visitor-access setting is the authentication boundary. The whole project is
protected so direct requests to the plan and JavaScript also require login.

No Netlify API credential belongs in the repository, site, environment injected
into browser code, or deployment plan. Use the connected Netlify account or an
ephemeral API credential solely for deployment. The signing site itself needs no
API token or server-side code. Its only external HTTP connection is the public Coinbase ETH/USD price endpoint; all scripts are bundled locally.

Open the protected HTTPS site in a browser with an injected wallet. Log in to
Netlify, load the reviewed plan, then connect the confirmed wallet on Robinhood
Chain mainnet. Each deployment requires an explicit wallet signature. The separate liquidity section becomes available after the expected model and hook are deployed and verified; it prepares fresh $100-per-token caps, approvals and the initialize-and-mint transaction. Each of those actions also requires its own wallet signature. The localhost and Netlify origins have
separate receipt history; existing on-chain contracts are still verified and
skipped when resuming.

If connecting Git continuous deployment later, set the base directory to
`research/v4-hook-1m` so this directory's `netlify.toml` controls the build.
The current site uses a reviewed manual deploy.

## Published instance

- Signing page: https://gh0st-v4-signing.netlify.app
- Dashboard: https://app.netlify.com/projects/gh0st-v4-signing
- Netlify deploy: `6adb85318862df4b3c6a433f`
- Access: Netlify team login, all production and preview deploys.
- Verification: all ten deployed file hashes match the local package; twelve anonymous requests across the production URL and deploy permalink returned HTTP 401.

The wallet and liquidity planner checks passed 23/23, including the 150% gas limit and duplicate-mint prevention across tabs. Browsers must support Web Locks to sign liquidity transactions.

The API credential was passed ephemerally to Netlify and is not stored in the project, generated package, or this record. See `netlify-signing.json` for the exact hosted file hashes and plan identity.
