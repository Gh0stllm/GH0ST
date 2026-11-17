# Add GH0ST GL3 to a wallet

**Published and verified.** This buildless shared control adds a compact amber **Add GL3** button to every HTML page on the main GH0ST, RPC and Scan sites. The dedicated L3 and bridge pages have their separately maintained prominent controls.

| Production site | Published deployment |
|---|---|
| https://gh0st.fyi | `6afcb977948cf2c93401bf17` |
| https://rpc.gh0st.fyi | `6afcb977530253e3456ce1e4` |
| https://scan.gh0st.fyi | `6afcb9792e8886cba9594b68` |

All 30 changed production assets passed exact SHA256 checks over genuine custom-hostname HTTPS, actual exit 0 in 4.135 s. Both public RPC routes still returned chain 4663001 and exact genesis `0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483`. Root's actual browser QC passed Main, Roadmap, Memory, Watcher, RPC and Scan, including the Roadmap hash policy and the externally styled 390px mobile dialog. No wallet approval, account request or signature was used for QC.

The widget discovers browser wallets only when opened. Multiple providers appear as text choices through EIP-6963 or the legacy provider list; external provider icons are never loaded. The visitor explicitly chooses **Add network**, approves inside the wallet, and may switch afterward. This control requests no account, signature, transaction, transfer or storage entry and makes no application RPC/HTTP calls; its same-origin script and CSS assets load normally. Unsupported wallets and rejected requests receive clear messages and copyable network details. The compact dock is dismissible and hides while an underlying page form has focus.

| Setting | Exact value |
|---|---|
| Network | GH0ST GL3 |
| Chain ID | 4663001 / `0x4726d9` |
| Currency | GH0ST, 18 decimals |
| RPC | https://rpc.gh0st.fyi |
| Explorer | https://scan.gh0st.fyi |

## Source and checks

- [Wallet module](gh0st-network-wallet.mjs): SHA256 `75b4456c6895becd086a13f8b0d9579df22375397e4e4919ce96ddbb905e82c4`.
- [Same-origin stylesheet](gh0st-network-wallet.css): SHA256 `d89a11e1cd0e1f90eb03f8d70ed6c1c712a07fa720d7bba6551c0148630e5708`.
- `evidence/final/source-freeze.json` records the exact Runpod preparation and test tools. The final profile passed 23 mock-wallet cases, five Python preservation tests and 29 mutation-guard cases. These are unsigned/mock tests, not real wallet approvals.
- `evidence/actual-draft-verification/result.json` records genuine HTTPS checks of all 30 changed draft assets: 24 HTML responses, three identical module responses and three identical CSS responses. Every response matched its exact staged SHA256, including SRI and the Roadmap CSP statement.

All staging and tests ran on Runpod. Local work was inspection, editing, file transfer and lightweight authenticated Netlify API operations. No live wallet or financial operation was used to test the control. `evidence/actual-production-verification/`, `evidence/production-rpc-readback.json` and `evidence/root-browser-qc.json` distinguish public HTTP, RPC identity and browser observations from mock tests.

## Preservation boundaries

The fresh bases were main `6afcb0390521058040d590fe`, RPC `6afcae7fa70c3f2f51681936` and Scan `6afcae975cae7429b6291dfd`. The patch changes all 22 main HTML pages plus the RPC and Scan HTML pages, and adds only the module and stylesheet to each site. All 645 pre-existing non-HTML file hashes remain exact: 641 main and four Scan assets. Existing `live-stats`, `watcher-scans` and `gl3-rpc` function digests, runtime/stream mode, routes, configuration, default-versus-explicit memory/region overrides and schedules are independently compared on each ready draft. No function bundle is rebuilt or uploaded.

Two HTML-specific boundaries are explicit:

1. Netlify's historical main index input manifest is `a1fe5398bdcb47a668897dcae094258ff58ee5fe`, while its current processed served bytes are `31122bdf7a01d22662904154d45b43dad64e4ade`. The root-approved patch uses the exact verified current served page as the deliberately changed HTML baseline. It does not claim preservation of unavailable original build-input bytes for that file.
2. Roadmap previously prohibited every script through `default-src 'none'`. It now permits only the finalized module's exact SHA256 source through a matching CSP hash and external-script SRI. All other directives remain unchanged. There is no broad `script-src 'self'`, `unsafe-inline` or `unsafe-eval` addition. Watcher, Spawn and Dead Drop keep their existing strict policies; the shared external stylesheet satisfies `style-src 'self'`.

Other page bytes remain exact outside the declared insertion. The initial preparation stopped on the processed-index mismatch before any public mutation; that failure is preserved. No existing deployment guard was weakened. [netlify-wallet-once.mjs](netlify-wallet-once.mjs) is a separate narrow guard for these three sites and only the reviewed draft, changed-file upload and exact reviewed publication operations.

Each API mutation has a saved intent and one HTTP attempt. Ambiguous outcomes are reconciled by readback; there is no automatic resend or replacement. Fresh published-deploy checks run before creating and publishing each draft. A concurrent publication, old asset/function upload request, metadata mismatch, undeclared HTML edit or missing review evidence stops publication.
