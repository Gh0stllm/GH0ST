# GH0ST recovery record

Prepared on 22 October 2026 for the newly connected GitHub account `Gh0stllm`. Original account/repository: `8tk8m2kv9f-lang/GH0ST`.

## Recovered source and history

The local recovery repository retains **43 complete reachable pre-recovery Git commits** from the surviving S0UL/Falcon clone. Both surviving research branch refs and their history remain preserved locally; a local recovery commit assembles the prepared `main` tree. This is not a complete mirror of every branch formerly hosted on GitHub. Local documentation additions from the separate cleanup chat were copied with provenance, including staged changes that had not been published.

**Individual-file restoration to `Gh0stllm/GH0ST` is in progress.** File contents are being published through GitHub’s Contents API. That process creates new commits for the uploaded files; it does **not** transfer the 43 original commits, their parent relationships or the surviving local branch refs. This document does not claim that all recovered files, artifacts or Git history have been uploaded. The inventory below describes the verified local recovery tree; remote publication requires its own completion and verification record.

| Material | Recovery |
| --- | --- |
| Falcon, LFM, FLAN, distillation and Stylus studies | Original tracked sources and research records retained |
| Historical model binaries | All **4,552 files / 318,227,588 bytes**, each size and SHA-256 verified against the historical manifest |
| S0UL final 20-lane campaign | Winner, preceding baseline, integer/mixed bundles, all 20 validation reports, full 540/360-request outputs and compressed frozen dataset |
| S0UL complete Solidity runtime | Original source, exporter, CLI, math/tokenizer/integration tests and final exact-parity reports |
| Website | All **547 exact files** from the latest surviving random-mint-fix deployment package |
| Genesis | Contracts, tests/reviews, ABI/build input, historical deployment receipt, generators, published metadata/IPFS proofs, all 495 SVGs and 495 PNGs |
| Paper and media | Original research PDF, article, logos, images and Qwen animation recovered from saved files |

The original benchmark archive is pinned by SHA-256 `44fee2c717891e06c546908056eacb6f3044b3be09e7baf665059a07ce4317b7`. Exact per-file provenance is recorded in the JSON files beside this document. Originals in the source workspaces and saved-file collection were not changed.

## Large model files

Two historical checkpoints exceed GitHub's regular-file limit. Their original bytes are preserved as eight parts, each no larger than 32 MiB, with complete and per-part hashes under `artifacts/large-files/`. Reconstruct them after cloning:

```bash
python scripts/restore-large-files.py
```

Use `python scripts/restore-large-files.py --help` for verification and alternate-output options. Reassembly was tested independently and matched both original SHA-256 hashes. The oversized assembled files are intentionally excluded from regular Git commits; their parts contain all bytes needed for restoration.

## Verification boundaries and missing material

- Every one of the 4,552 historical binaries matches the previous manifest.
- Winning S0UL checkpoint: `44bed666c464273e6fff84b10a4977744d9b0e923f5b6a519d7725920b500692`. Float/integer harder challenge: 224/540 exact; historical selected float: 209/360. Integer saturation: zero.
- The final native 128-row Solidity run checks all 1,024 decision logits exactly for `Wait.` → `[268, 2]`. Existing evidence was preserved, not represented as a newly executed public-chain inference.
- A credential-pattern scan found no project credentials in 2,256 current UTF-8 files and 2,356 historical text blobs. The reviewed matches were a bundled library’s public default provider key and descriptive text about synthetic offline signing keys. Eight oversized binary/archive blobs were excluded from that text scan. The GH0ST token contract address is public deployment metadata, not a signing credential.
- The **Qwen frontend, weight-publication archive index and model metadata are recovered**. Its original research/backend branch is not recovered here. Chat recollections of deployment completion are context, not a replacement for missing source or newly verified chain receipts.
- The complete **sub1b 20-model campaign**, later unrecovered experiment series, original three-lane hard campaign's selected/raw final artifact, individual 20-lane optimizer/RNG checkpoints, original GitHub issues/PR conversations and complete remote-only branch history remain unavailable.
- The matched final native 32-row CI result was not retrieved. The documented 61.06% transaction reduction compares a calculated 1,022-transaction baseline with measured 398 transactions; it does not claim measured full-model gas/time savings.

Historical deployments remain at their recorded on-chain addresses. This recovery does not redeploy, mint, spend funds, modify the live website or restart model training.

## Workflow migration

The five surviving workflow definitions are present and set to manual dispatch in the local recovery tree. Exact original definitions are retained in `original-workflows/` and earlier Git commits. This prevents an import from launching old training jobs or referencing deleted artifact run IDs automatically. Training workflows require reviewed baseline/run references before use with the new account.

## Historical documents

Original README variants and replaced documentation are preserved under this directory. Exact versions of the research directory, repository map, contribution guide and this recovery record from before individual-file navigation fixes are retained under `pre-individual-upload-docs/`, preserving their relative paths. Historical repository URLs and run IDs remain provenance; they do not assert that the suspended account is currently accessible. The original Qwen research/backend and sub1b campaign branches remain unavailable, even where frontend assets or historical branch names survive.
