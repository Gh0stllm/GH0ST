# Deployment-first assessment

The user has prioritized a substantially smaller deployment bill. The preceding kernel round optimized repeated execution and increased weight-deployment gas. Its balanced format should not be described as the deployment-minimum choice.

**No new deployment reduction is implemented in this assessment.** It reproduces size budgets from existing measured files and standard EVM code-deposit pricing. The current self-contained full-model requirement is retained. No model was retrained or replaced, no public transactions were sent, and the active manifests were not changed.

## Dominant cost

The balanced file contains 75,641,184 bytes. At 200 gas per runtime-code byte, its payload alone costs **15,128,236,800 gas**, or **92.13%** of the modeled 16,421,055,512-gas deployment. Even eliminating every other modeled deployment charge would save only 7.87% with that byte representation unchanged.

The recovered compact six-bit file is already smaller: 72,045,528 bytes and 15,648,599,873 modeled deployment gas, 4.70% below the balanced layout. Its measured matrix execution is slower. This is an existing trade-off, not a newly discovered optimization.

The earlier exact compression study reached 70,263,862 bytes with a symbol transform and Zstd, and estimated 69,278,579 bytes for Huffman coding before tables. These CPU results do not include an implemented on-chain decoder. They do not establish a universal impossibility bound, but they provide no evidence for a 50–90% lossless reduction of the selected six-bit model.

## Concrete storage targets

| Total deployment target | Maximum bytes at 200 gas/byte before every other cost | Minimum reduction from balanced file |
| --- | ---: | ---: |
| 10 billion gas | 50,000,000 | 33.90% |
| 5 billion gas | 25,000,000 | 66.95% |
| 1 billion gas | 5,000,000 | 93.39% |
| 100 million gas | 500,000 | 99.34% |

These are optimistic byte budgets, not achievable deployment estimates. Metadata, constructors, transactions, engine, tokenizer and chain-specific charges reduce the available space further.

## Precision changes: useful scale, not a quality guarantee

| Hypothetical fixed-width matrix codes | Matrix-code bytes only | Code-deposit gas only |
| --- | ---: | ---: |
| 4 bits per weight | 45,498,368 | 9,099,673,600 |
| 3 bits per weight | 34,123,776 | 6,824,755,200 |
| 2 bits per weight | 22,749,184 | 4,549,836,800 |
| 1 bit per weight | 11,374,592 | 2,274,918,400 |

These rows account only for the 90,996,736 matrix parameters. They omit scale/offset metadata, nonmatrix tensors, indexes and deployment overhead. They are arithmetic scenarios, not working model exports or measured gas receipts. Lower precision changes the weights and can damage behavior. Existing NF4 and selective 4/8-bit tests already show material drift; they are not accepted substitutes for the selected six-bit model.

A sensible next model-preserving-in-architecture experiment is calibration-aware mixed precision: start from the pinned original checkpoint, protect sensitive matrices, evaluate 3/4-bit alternatives for the remainder, and compare complete held-out responses with the six-bit and original references. No training is needed for a post-training calibration experiment, but success is not guaranteed. It must report actual encoded bytes and task quality before being adopted. A blanket low-bit conversion is not enough.

Sub-billion deployment with ordinary fixed-width storage cannot be achieved merely by changing this 91-million-parameter model from six bits to two or even one bit. It would require a much smaller or strongly weight-sharing representation, or relaxation of the storage architecture. Those are separate design decisions, not compiler tweaks.

## Alternatives that do not satisfy the current boundary

The recovered authenticated-streaming prototype deployed locally for 478,876 gas and verified selected exact dot products. That is the commitment/verifier/kernel cost, **not deployment of all model weights**. It relies on resupplied weight bytes and shifts costs to future calls. It remains excluded from the self-contained design. Likewise, deploying weights only when first used defers the full-model bill; sharing one model among agents avoids repetition but not the first copy; new-chain genesis allocation changes the chain requirement.

## Reproduce and sources

Run `python falcon-agent/gas-refinement/deployment_budget.py` from the repository root. It writes `deployment-budget.json` using existing `storage-results.json` and `sixbit-optimization/research-results.json`. No package installation, network access or signing key is required.

- EVM code-deposit schedule: https://ethereum.github.io/yellowpaper/paper.pdf, Appendix G (`Gcodedeposit = 200`).
- Existing compression evidence: `../sixbit-optimization/research-results.json`.
- Existing quality evidence: `../research-quality/RH-QUALITY-UPDATE.md`.
- Historical streaming receipts: `../research-quality/architecture-results.json`.

All figures are standard-EVM gas accounting or local measurements identified above. They are not live Robinhood/BNB monetary quotes, complete inference measurements, or evidence of successful public deployment.
