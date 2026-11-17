# Bridge and L3 domain plumbing

Two dedicated Netlify sites were created and verified public, with custom CNAMEs added through the logged-in Porkbun UI. No apex, nameserver, main, RPC or Scan setting changed.

| Domain | Netlify site ID | CNAME target |
|---|---|---|
| bridge.gh0st.fyi | 119afe7d-4215-4fb3-b6df-43febded2d71 | gh0st-gl3-bridge.netlify.app |
| l3.gh0st.fyi | 642f0437-d987-46de-b70a-270cf65585cf | gh0st-gl3-l3.netlify.app |

Both CNAMEs have TTL 600. Porkbun displayed the exact two records after saving; resolver readbacks are in `dns-readback.json`. Existing apex/mint/rpc/scan/www records remained visible and unchanged. The CUA completion was recorded before releasing Opera.

`final-site-readback.json` confirms ssl:true, force_ssl:true, sso_login:false, account_sso_login:false and no password on exactly these two sites. `final-runpod-tls-readback.json` records genuine hostname-validated TLS 1.3 connections and exact certificate SANs for both domains at 20:20:56 UTC on 2026-11-17. TLS was not disabled or bypassed.

The frontend owner deployed the dedicated content separately. Its final deployment IDs at this readback were bridge `6afcb73efd2ae6d2833e83a7` and L3 `6afcb73df9be5820b6d59906`; creation/DNS plumbing alone is not a frontend or bridge transaction test.

Early probes correctly failed while certificates were pending. The explicit post-publication platform provisioning requests returned HTTP 200/null and automatic provisioning was observed before certificates became available. An initial CLI parameter shape sent no update; its unchanged readback is preserved as `attempt1-ignored-body-parameter-*`. Domain, public-access and force-SSL updates were then applied separately with strict final readbacks.

A configured Mac/ISP resolver temporarily returned NXDOMAIN for bridge even after public Cloudflare/Google DNS and Runpod succeeded. The limitation was reported; global Mac DNS, hosts, filtering and pod ports were not changed. No insecure fallback was used. Main/chain services were not stopped or reconfigured by this lane.
