# Read-only RPC certificate investigation

The root funding-review preflight reported `ERR_TLS_CERT_ALTNAME_INVALID` and a `*.netlify.app` certificate before opening its server. Root reported zero financial intents/signatures/submissions at that point. That failure is retained as a reported observation; this lane did not reproduce it or claim that it never occurred.

Fresh strict checks passed on 2026-11-17 around 20:44–20:45 UTC:

- Mac Node verified the exact `rpc.gh0st.fyi` SAN on all four resolved IPv4/IPv6 addresses under both TLS 1.2 and TLS 1.3. A normal, unmodified Node fetch returned HTTP200 and chain `0x4726d9`.
- Mac Python strict hostname/CA checks passed all four addresses.
- Runpod verified both IPv4 addresses under TLS1.3 and its normal HTTPS chain-ID request returned HTTP200. The pod's IPv6 connection attempts failed with OS errno99 (no usable IPv6 source), rather than a TLS rejection; no IPv6 connectivity pass is claimed there.
- Netlify's read-only API confirmed the correct RPC custom domain, ssl:true, force_ssl:true and issued certificate `6afc988c1dd56297d6be4bfc` covering exactly `rpc.gh0st.fyi`, expiring 2027-02-15T17:11:47Z. The current deployment remained `6afcb977530253e3456ce1e4`.

The earlier mismatch's cause is not established by these successful samples. No certificate renewal, domain/DNS/hosts change, global TLS setting, pod/node halt or financial action was performed. Verification was never disabled. The results establish current sampled connectivity, not a guarantee against every future edge failure.
