# Vendored GH0ST transaction helpers

These four files are copied byte-for-byte from the project's local
`rh-icp-inference/scripts/` helper tree. `provenance.json` records the original
paths, source repository, byte counts and SHA-256 digests. They were untracked
local files at copy time; the recorded working-tree base commit does not contain
their contents, and no existing committed source permalink is claimed.

The dependency closure is `execute-rh.mjs` → `manual-wallet.mjs` and
`manual-rh-core.mjs`; `manual-wallet.mjs` → `swap-plan.mjs`. The remaining imports
are Node built-ins and the existing pinned `ethers` dependency. Run `npm ci` from
the Synapse directory before using the deployment tools.

SYNAPSE imports `executeActions`, `validateSigned` and `executionMessage` from
this local copy. Its own plan validation and freshness guards remain in
`../guards.mjs`. Vendoring does not change transaction bytes, signing rules,
confirmation handling, gas limits or fees. The other helpers preserve the
original module's import closure; their CLI entry points do not run on import.

No file-level license/SPDX notice or package license was present for these helper
sources. This copy asserts no new license grant. The repository's LFM license
concerns model materials and is not assigned to these helpers; `ethers` remains
an external dependency under its own license.
