# Same-day Nitro fast-confirmation network binding

Prepared source only. Nothing in this directory creates a site, binds DNS, exposes a port, signs a license, or deploys a chain. This profile uses **project-run fast confirmation**, not ZK at launch. GH0ST's operator key confirms withdrawal roots; users do not wait through the normal challenge period after that root has been fast-confirmed on Robinhood. Timing still depends on GH0ST's service and Robinhood processing. The existing ZK launch gates are preserved separately and are not relabeled as passed.

The exact UI badge is **Project-run fast confirmation**. Its note is **GH0ST-operated key confirms withdrawal roots. ZK verification not live.** The bound public role is `0x0F2a3E06D0B6379a68DFe4a6E636C8e9EDdEf5ad`. No key is read by this packet. A standard challenge-period fallback may remain in the contracts; it is not the normal displayed withdrawal path. Never label this operator-trusted mode trustless, ZK-verified, or guaranteed instant. Robinhood processing fees still apply.

At the exact Contracts pin, [`fastConfirmAssertion`](https://github.com/OffchainLabs/nitro-contracts/blob/4341b132cfbdcc980ead03765ca5224ff6cb5d97/src/rollup/RollupUserLogic.sol#L293) restricts the caller to `anyTrustFastConfirmer` and skips ordinary deadline/challenge validation. Its comment recommends a quorum contract for AnyTrust. Binding the selected EOA instead is the explicitly selected GH0ST operator trust model; it does not establish a DAC/quorum or switch data availability to AnyTrust by itself. A public role address is configuration intent until actual onchain readback matches it.

The authenticated existing Netlify site is `1460fb0c-b81d-4624-aac5-b78658310ce0`, name `gh0st-observatory`. Its primary domain is `gh0st.wiki`; `gh0st.fyi` is an existing production alias. Read-only API evidence is in `netlify-discovery.json`. Preserve its existing publish directory, routes and functions. Do not deploy the `rpc/` directory to that main site.

## RPC site package

`rpc/` is a separate Netlify site package, with Node runtime functions and a root JSON-RPC route. After the actual chain, genesis, reviewed contracts, licensing basis and tested backing bridge are ready, the operator supplies runtime variables on that separate site:

```
GL3_RPC_ENABLED=true
GL3_CHAIN_ID=4663001
GL3_GENESIS_HASH=<actual verified block-zero hash>
GL3_RPC_UPSTREAM_HTTPS_URL=<actual HTTPS upstream read back after approved Runpod port exposure>
```

The package defaults to disabled. It verifies upstream chain ID and genesis before every forwarded call, including signed transactions, and rejects admin, debug, engine, personal, txpool, miner, arbdebug and unknown methods. It supports HTTP JSON-RPC, bounded batches and raw signed transaction submission; no keys are accepted or held. It provides browser CORS, rejects notifications, restricts body/response size, prohibits redirects and caps upstream time at 10 seconds. It does not provide WebSocket subscriptions. A separate private explorer backend may need tracing methods; those must never be enabled on the public RPC function.

This is an external routing function, not the sequencer or bridge. A public HTTPS Runpod upstream does not exist merely because this source exists. Read actual exposed ports and the resulting proxy URL after root's approved infrastructure action. The actual URL remains null in `bindings.example.json`. Add rate controls appropriate to observed traffic and the account's hosting budget before unrestricted public operation. No Netlify quota, free-tier entitlement or new-site billing claim is made by this packet.

For the existing local CLI, read-only identity/site discovery works without linking:

```
node /Users/abhijith/Documents/ChatGPT/GH0ST/website-overhaul/node_modules/netlify-cli/bin/run.js api getSite --data '{"site_id":"1460fb0c-b81d-4624-aac5-b78658310ce0"}'
```

Only print selected public fields from API responses; do not publish complete account/site settings. Site creation, deploy, domain assignment, runtime-variable changes and DNS changes remain root/operator actions and are deliberately absent from executable scripts here.

## Website and explorer

`https://gh0st.fyi/gl3/bridge/` is an additive directory in the existing main website's build output. The real bridge page must bind actual parent4663/child4663001, parent token, deposit inbox/bridge, rollup and native withdrawal contracts from confirmed deployment evidence. It must display the fast-confirmation badge and trust note above, bind the actual rollup's `anyTrustFastConfirmer()` readback to the expected public role, and explain that Robinhood processing fees still apply. `bridge-state.mjs` provides fail-closed UI state derivation from read-only observations; it does not create or confirm roots. Do not add a global proxy or overwrite the site's existing routes to serve it.

`scan.gh0st.fyi` is the confirmed explorer hostname. `render_scan_proxy.py` emits a standalone proxy-site package only when given an actual HTTPS explorer service URL and health evidence. It must not point at the RPC API or a fake explorer. Blockscout installation/indexing is separate; no explorer service was launched in this work.

Netlify's [official proxy documentation](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/) permits external 200 rewrites, documents a 26-second proxy timeout and notes relative asset issues. The explorer must be configured with its final public base URL. WebSocket/explorer realtime support and live TLS/domain routing need actual integration checks; a rendered config alone proves none of them.

## Before public enable

Complete `bindings.example.json` from actual receipts and node readback. Check parent/child chain IDs, genesis, native backing and zero unintended genesis balances; actual rollup machine/module pins; validator and batch-poster health; fallback challenge-period configuration; actual `anyTrustFastConfirmer()` equal to `0x0F2a3E06D0B6379a68DFe4a6E636C8e9EDdEf5ad`; deposit/retryable execution and native-credit evidence; and a successful fast-confirmed root/withdrawal receipt. Withdrawal UI must distinguish awaiting GH0ST root confirmation, ready for Robinhood claim, and actual paid receipt. A fast-confirmed result relies on the operator key and is not a ZK proof or an ordinary challenge-period confirmation.

The license decision is documented separately in `license-gate.md`; `aep-accounting-plan.md` records native GH0ST router support and the still-unconfirmed official payment target. Both exact Nitro/Contracts pins remain pre-conversion on 17 November 2026. AEP self-service does not mean zero obligation and does not authorize this agent to accept terms.

`test_remote.mjs` is a bounded function regression suite. Its mocked fetch is labeled unit evidence only; it is not an actual Nitro execution, deployed Netlify request, bridge receipt or mainnet proof.
