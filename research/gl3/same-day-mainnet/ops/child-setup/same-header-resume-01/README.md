# Coherent same-header settlement and private review resume

**Regression packet only. Root's existing nine-action flow completed naturally. Do not restart the current server or re-execute this completed plan.** No current browser, wallet, journal or served file was accessed by this lane.

`settled()` now accepts the setter's receipt block itself when both block hashes are valid nonzero 32-byte hashes, they match exactly, and the observed minimum fee, header base fee and direct quote all equal `1e13`. Older heights, hash mismatch/missing hash and old prices remain rejected. Later-height checks are unchanged. No fabricated header or extra transaction is introduced.

The optional `GL3_REVIEW_RESUME_SESSION` points to a canonical owner-only `0600`, single-link regular file under the private review directory. Its exact fields are `schema`, `planSHA256`, `port`, `prefix`, `expiresAt`; schema is `gh0st.gl3.child-review.resume-session.v1`. The original expiry is retained, never extended, with at most two hours remaining. The path must be a 48-character lowercase hex prefix; the origin remains derived exclusively from `127.0.0.1` and the validated port. Actual session values are not included here.

Resume-only startup validates the session, build and confirmed journal first, then opens the same local transport while awaiting the same startup binding promise. Both quote and submit await that promise, and every existing per-action financial preflight remains in place. Binding rejection fails closed with a sanitized message. Initial non-resume startup remains unchanged. This avoids making the browser wait for startup RPC calls while its server port is closed; actual unlocked-wallet retention was not exercised because the live flow had already completed.

All 26 Runpod unsigned/mock/filesystem cases passed, retaining the original 19 cases and adding seven groups of same-header, session and binding-order checks. The separate browser build passed with exact plan SHA256 `36a3e9753bd92663b33e805e24e0cc3412cf23a41523ae71d7aee954428ad85b`, the same nine actions, and byte-identical existing browser bundle/index. Engine, journal, nonce, quote expiry, full gas floor, signed limits and intent-before-broadcast code are unchanged. No key, password, signature, actual RPC, server startup or broadcast was involved in these tests/builds.

`ready-packet-separate/` is additive; the active served packet was not replaced. `freeze.json` binds the sources and results. Root's completed live flow is separate evidence.
