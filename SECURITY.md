# Security reporting

[Project home](README.md) · [Contributing](CONTRIBUTING.md) · [Architecture](docs/ARCHITECTURE.md) · [Evidence](docs/EVIDENCE.md)

GH0ST contains experimental inference contracts, payment accounting, deployment tools and historical research. Identify the exact commit, branch and contract address involved in a finding. A source revision and an immutable deployed contract can differ.

## Report a possible vulnerability

If this repository offers **Security → Advisories → Report a vulnerability**, use that private reporting option for exploitable findings. Availability depends on the repository's GitHub settings; this document does not enable the feature.

If private reporting is unavailable, open a minimal issue asking maintainers to provide a private reporting channel. State only the affected component and that the report is security-sensitive. Keep exploit details, private data and credentials out of the public issue until an appropriate channel is agreed.

For ordinary documentation errors or non-sensitive reproducible bugs, use the [issue forms](https://github.com/8tk8m2kv9f-lang/GH0ST/issues/new/choose).

## Include enough evidence to assess the report

- Affected repository path, branch and commit SHA.
- For deployed behavior: chain ID, address, relevant public transaction or block, and expected code hash where available.
- Expected behavior, observed behavior and the security impact.
- A minimal local reproduction with its prerequisites and actual output.
- Whether the finding affects numerical correctness, permissions, escrow/withdrawals, deployment integrity or client behavior.
- Any proposed mitigation, clearly separated from verified results.

Use local reproductions for testing. Do not spend another user's funds, interrupt their jobs, modify their model artifacts, or exercise an exploit against a live deployment to substantiate a report. Remove private keys, seed phrases, API credentials and unrelated personal data from attachments and logs.

## Interpret the existing security evidence

The runtime and controller contain local validation records. Passing those checks does not establish an independent security audit or coverage of every allowed input. The [evidence guide](docs/EVIDENCE.md#what-remains-to-demonstrate) describes the remaining review and validation work.

Published deployment receipts, bytecode pins, model hashes and historical reports are provenance records. Preserve them when proposing a correction. Changes to source files do not update contracts already deployed at immutable addresses.

Prompts, token IDs, intermediate states and generated outputs submitted to the documented runtime are public. Tokenization does not make a conversation private. [Request lifecycle](docs/REQUEST-LIFECYCLE.md#5-display-results).
