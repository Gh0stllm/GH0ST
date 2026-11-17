# Additive GL3 bridge, RPC fallback and GH0ST Scan

This packet is staged source, not a public launch. All preparation/build/tests run on Runpod. The authenticated CLI is used only for bounded read-only discovery in this task. Root/operator must separately execute and review draft/publish/domain mutations.

## Preserve the actual main website

Read-only discovery found production deploy `6af9cd5a5be613fc1cfd99e5`, 652 files and two functions, `live-stats` and `watcher-scans`. The local `website-overhaul/dist` is older and lacks newer live routes; do not deploy it as a replacement. `evidence/current-production-snapshot.json` records public file hashes and selected function metadata. Obtain a fresh snapshot if production changes.

`netlify_additive.py` constructs a full atomic file digest preserving all existing paths/hashes and existing function digest/runtime/routes/config. It adds only `/gl3/bridge/*`, `/gl3/scan/*` and one new `gl3-rpc` function routed exactly at `/gl3/rpc`. It never replaces `_redirects`, `_headers`, old pages or function sources. Its draft routine refuses unavailable old artifacts and checks exact preservation of existing function metadata before creating a publishable receipt. A changed production deploy blocks later publication, preventing a stale snapshot from overwriting newer work.

The RPC bundle is prepared on Runpod as a small uncompressed zip of the existing tested handler with fixed public chain/genesis/upstream bindings. Its upstream is excluded from the public bridge config. No private RH provider token is shipped. Binary upload uses `netlify_binary_upload.mjs`, which calls the existing CLI's normal authentication helper in memory; it neither searches credential stores nor prints a token. This helper has not uploaded a function in this task. Actual Netlify archive/runtime/route behavior remains a draft integration check, not a unit-test claim.

## Exact staged method

1. Read the current production snapshot using the existing CLI, on the authenticated computer:

```
python3 netlify_additive.py --cli /Users/abhijith/Documents/ChatGPT/GH0ST/website-overhaul/node_modules/netlify-cli/bin/run.js snapshot /absolute/new-snapshot.json
```

2. Fill `bridge/public-config.example.json` from actual deployment and setup receipts. Use the **new** genesis produced by temporary-owner fee setup. Before activation, verify final owners `[zero]`, no native minters, minimum L2 base fee `10000000000000`, actual activation-base-fee receipt, and explicit nonzero treasury recipients. Set the actual HTTPS upstream from approved port readback in `rpcUpstreamHttpsUrl`. This field is removed from public config when staging. Never use a private RPC provider credential here.

3. Transfer this source packet, public snapshot and reviewed configuration to the existing Runpod workspace. Prepare a fresh stage there, using its source-file location:

```
python3 netlify_additive.py --cli /unused-during-prepare prepare /absolute/new-snapshot.json /absolute/reviewed-public-config.json /absolute/new-stage
```

The stage contains the additive static files, `gl3-rpc.zip`, a full digest `plan.json`, and `separate-sites-plan.json`. Set operational input `includeMainRpcFallback: false` for the preferred separate RPC site; then the main website keeps exactly its two existing functions. Omit it or set true only when the existing-domain RPC fallback is needed. The input flag is excluded from public page config. No remote Netlify operation occurs during prepare. Copy this ready stage back without rebuilding/compressing locally.

4. Root/operator may create the reviewed draft using the authenticated computer:

```
python3 netlify_additive.py --cli /Users/abhijith/Documents/ChatGPT/GH0ST/website-overhaul/node_modules/netlify-cli/bin/run.js draft /absolute/new-stage --execute-reviewed-draft
```

The draft remains unpublished. It reuses old file/function blobs and uploads only the new assets/function. It requires Node24 runtime and the exact `/gl3/rpc` route for the new function, and unchanged metadata for both old functions. If any check fails, stop; do not publish an unverified draft or blindly retry an ambiguous operation.

5. Verify the draft URL: all existing routes still serve, old function routes remain, bridge UI/actual live RPC binding is correct, rejected RPC methods stay rejected, real Scan blocks/transactions/receipts work, and approval/deposit/withdraw/proof/claim behavior passes against the actual launch contracts. A unit test or private rehearsal is not that live check. Fill `production-review.example.json` for the exact draft/base IDs, actual network/setup evidence, and private operator review record hash.

6. Publish that reviewed draft only through root/operator execution:

```
python3 netlify_additive.py --cli /Users/abhijith/Documents/ChatGPT/GH0ST/website-overhaul/node_modules/netlify-cli/bin/run.js publish /absolute/new-stage /absolute/completed-production-review.json --execute-reviewed-publish
```

The script checks that production still equals the captured base and that draft functions remain verified, then uses Netlify's restore endpoint to publish the ready draft. It reads back the published ID and stops on ambiguity. Keep the previous deploy ID for a separately reviewed rollback.

This follows Netlify's [atomic file-digest API](https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/) and the installed CLI's current function-config/body transport implementation. Actual public mutations are deliberately not executed by this source-preparation task.

## DNS and usable fallback

Actual DNS on 17 November: `gh0st.fyi` delegates to Porkbun nameservers. The authenticated Netlify `getDnsZones` read returned no GH0ST zones. `rpc.gh0st.fyi` and `scan.gh0st.fyi` had no A/AAAA/CNAME records. The main site's `managed_dns` flag is not evidence of authoritative DNS control.

Root can publish functional fallbacks on the existing hostname without DNS changes:

- RPC: `https://gh0st.fyi/gl3/rpc`
- Explorer: `https://gh0st.fyi/gl3/scan/`
- Bridge: `https://gh0st.fyi/gl3/bridge/`

These are **planned targets**, not live claims. The prepared default config uses the fallback URLs and stays disabled until real bindings exist. `scan/` is also a standalone Netlify static-site package; copy its reviewed actual `public-config.json` into `scan/public/` before deploying that separate site. No extra explorer backend, pod or exposed port is needed for this lightweight RPC explorer. It supports block pagination, transaction/receipt views, address balance/nonce/bytecode and hash/number search. It does not claim indexed address history, source verification or token indexing. The previous Blockscout backend/proxy plan is preserved and deferred.

Root has now created empty separate sites: RPC `cda71aa3-eb0f-40be-ac67-d24c7545a703` / `gh0st-gl3-rpc.netlify.app`; Scan `60e107a7-2bda-498a-8790-b757a2321a5e` / `gh0st-gl3-scan.netlify.app`. This is creation-only evidence, not a deployed endpoint. The generated separate-sites plan gives exact draft payloads and uses the same ready RPC ZIP with a root `/` POST/OPTIONS route, plus standalone Scan file digests. For the confirmed `scan.gh0st.fyi` and intended `rpc.gh0st.fyi` names, add CNAMEs to these actual Netlify hostnames at **authoritative Porkbun DNS** after the sites are deployed and checked. This requires existing authorized Porkbun access; no account/session/API credential has been discovered or changed here. Keep existing root nameservers and website records. Update domain bindings and verify live TLS, chain/genesis and explorer operation before switching displayed links/config. `domain-binding.unsigned.json` records the actual root-created site IDs and CNAME targets; unresolved node/upstream/genesis values remain null.

Latest DNS outcome: the user subsequently logged into Porkbun and explicitly authorized the two CNAME additions. Both `scan` and `rpc` now point to their exact separate Netlify hostnames with TTL600; all four authoritative nameservers return both records, and the fresh UI record list shows the original three plus those two. See `evidence/dns-created-and-verified.json`. No nameservers, old records, credentials or unrelated account settings changed. Earlier Netlify domain updates returned422 before DNS creation; root owns retrying domain binding, deployment and TLS verification. DNS success alone is not a live RPC/explorer claim. Existing-host `/gl3/rpc`, `/gl3/scan/` and `/gl3/bridge/` fallbacks remain prepared with `includeMainRpcFallback: true`, preserving both old functions and adding only `gl3-rpc`, until root selects the verified live configuration.

## Operator and license review

`operator-review.html` is a private review form excluded from deployed page files. It links the full current AEP agreement, records the operator's own explicit choices, disclosure approval, new genesis/setup review and optional payment-route evidence, and downloads a private JSON record. It performs no external submission, contract action or agent acceptance. Do not publish the operator's private legal identity in this public repository or page.

The current plan uses accessible treasury fee receipts, manual 10% positive-net-revenue accounting, and final child authority removal. The official GH0ST/RH payment target or alternative agreed route remains unconfirmed. This is an outstanding continuing payment-routing obligation, not an invented mandatory external prelaunch countersignature/approval gate. Do not relabel an outstanding reserve as a payment or infer a burn exemption. Full terms and remaining payment-route decision are documented in `license-gate.md` and `aep-accounting-plan.md`.
