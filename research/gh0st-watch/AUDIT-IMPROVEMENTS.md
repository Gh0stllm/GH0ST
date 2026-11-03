# Qwen3.5-2B accuracy and ICP cost improvement study

3 November 2026. Research in progress. No paid or production changes.

The previous model completed inference but failed contract reasoning. This follow-up tests narrow claim verification with an explicit unknown result, constrained one-letter output, and code-specific reasoning instructions. Known vulnerability-family routing is supplied by the harness, so this tests a component of an audit pipeline, not independent bug discovery. The initial 13 fixtures are development data; 12 new transfer fixtures add modifier/role guards, irrelevant tx.origin usage, guarded unchecked arithmetic and indirect token-return checks. They are small authored tests, not an independent audit benchmark.

Cost work will distinguish shorter output, shorter input, fewer model requests and runtime changes. A shorter answer can reduce cost while still being wrong. Abstention can reduce false accusations while losing vulnerability recall. Both effects will be recorded separately.

Next: publish raw native results and local ICP metering, then recommend the smallest useful verified workflow. Training a specialist adapter, runtime kernel changes and an automatic scanner integration are proposals unless explicitly reported as implemented.
