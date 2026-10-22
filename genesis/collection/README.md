# GH0ST Genesis — 495 dot-matrix collectibles

## Published release

All 495 PNGs and 495 finalized token metadata records have been pinned to public
IPFS through Pinata. Both directory CIDs were reconstructed from all 990 exact local file bytes
and filenames. First/last gateway samples and the collection metadata JSON
were independently fetched and matched too. All 990 individual files were not
downloaded; complete content-address verification covers every file.

- Image directory CID: `bafybeifbg7tarcknlsgz54bhxg7cbcufhstbty3kkqldr72pd55ynkx43y`
- Metadata directory CID: `bafybeiacuudlonut2coevovyc5t5u3hc6bjjf4ekfrzd4d5544mh4o7z2i`
- Contract metadata base URI: `ipfs://bafybeiacuudlonut2coevovyc5t5u3hc6bjjf4ekfrzd4d5544mh4o7z2i/`
- Token URI example: `ipfs://bafybeiacuudlonut2coevovyc5t5u3hc6bjjf4ekfrzd4d5544mh4o7z2i/001.json`
- Collection URI: `ipfs://bafkreigrokhivgmp763x3xbwhug5jfvk7i5b2hwlavtzb6rpld3mkwzpsq`

Use `metadata-final/` for the published token records. The original
`metadata-templates/` remain only for reproducibility; their placeholders are
intentional and are not the published metadata. `pinata-result.json` and
`pinata-receipts.json` preserve the publication details. Filenames are padded:
the eventual NFT contract must resolve token ID 1 to `001.json`, not `1.json`.
The NFT contract is still not deployed; this publication does not mint NFTs.

Recheck all content addresses locally with:
python3 verify_ipfs_directory_cids.py --collection . --report ipfs-directory-cid-verification.json

The sections below preserve the original generation and upload workflow.

495 distinct 1280 × 1280 PNG artworks, matching self-contained geometric SVGs,
and 495 ERC-721-compatible metadata templates linked to actual deployed GH0ST
weight shards. Token IDs 1–495 map to shard indices 0–494. Filenames are padded:
001.png / 001.json through 495.png / 495.json.

Open `index.html` to browse every piece locally. Use expression, accent and signal
filters; click an image to open the full-resolution PNG. No server is needed.

## Contents

- `images/`: 495 final PNG images, 1280 × 1280, black background.
- `vectors/`: 495 independent SVGs. All labels are geometric dots: no fonts, links
  or remote assets are needed. SVGs are the scalable geometric source; PNGs use
  Pillow's rasterization, so renderer-specific antialiasing/glow can differ.
- `metadata-templates/`: 495 metadata templates; **not yet publishable** until
  `__IMAGE_CID__` is replaced with the actual pinned image-directory CID.
- `collection-template.json`: collection-level metadata template.
- `collection-manifest.json` and `inventory.csv`: artwork/shard mapping and hashes.
- `evidence/`: pinned GitHub manifest, receipt journal and normalized records.
- `generation-report.json`, `independent-qa.json`: production validation.
- `pinata_upload.py`, `PINATA-UPLOAD.md`: authenticated upload/finalization workflow.
- `generate_collection.py`: reproducible generator (Python 3.10+, Pillow).

## Visual design and uniqueness

All pieces follow the approved pure-black, circular white-dot face identity.
There are 11 expressions × 9 accent colours × 5 signal placements = 495 distinct
trait combinations. Each expression occurs 45 times, accent 55 times and signal
99 times. These are balanced design traits, not claims about model performance
or economically meaningful rarity. Printed serials are not the sole difference:
every face/colour/signal composition is distinct before its serial is considered.

The SHA-256 seed is calculated from generator version, chain ID, lowercase shard
address and manifest-recorded runtime code hash. Sorting all seeds assigns the
balanced trait grid. A subtle 32-dot footer encodes the first 32 seed bits.
The complete canonical input inventory is needed to reproduce trait assignment.
Keep `normalized-shards.json` and the generator version fixed for reproduction.

## Provenance and interpretation

Source repository: https://github.com/8tk8m2kv9f-lang/GH0ST
Pinned commit: 0c82d527564dc6c081f16f7d05898c5b33b655cf
Chain: Robinhood Chain mainnet, ID 4663.
Model: tiiuae/Falcon-H1-Tiny-90M-Instruct; four-bit export `affine64_s12z4`.
Whole-export SHA-256:
9cc5e90880d96ff15bf4110f7970a7ea473c9b86576298691ade1e745672e7a9

All 495 shards were cross-checked between the repository deployment manifest and
receipt journal. This is repository-recorded evidence, **not fresh RPC checking**.
Runtime Keccak-256 covers a one-byte 0x00 STOP prefix plus shard payload. Logical
export offsets exclude that prefix. No payload-only hash was invented. PNG/SVG
SHA-256 hashes identify the newly produced image files, not the model weights.

GH0ST is built using artificial intelligence technology from the Technology
Innovation Institute. Original model rights and license terms remain upstream.
This package does not redistribute the raw model weights or grant a new license
over them. A shard is an arbitrary byte range and can cross tensor boundaries;
no fictional layer, neuron or ability is assigned to it.

The NFT collection is **not deployed**. These files propose an immutable
association; the later NFT contract must enforce the token-to-shard mapping.
No NFT has been minted and no GH0ST has been burned by producing this package.
The discussed mint mechanism is 200,000 GH0ST per NFT (up to 99,000,000 at 495
lifetime mints). The token's burn capability still needs contract verification.
Artwork and metadata do not enforce payments. No monetary value or price rise
is promised. Ownership of an NFT would not automatically confer exclusive data
access, inference control, model copyright or revenue rights.

## Pinata publishing

1. Run `python3 pinata_upload.py --dry-run` from this directory.
2. Supply a valid Pinata upload JWT through the `PINATA_JWT` environment variable.
   Credentials must never be added to this folder or archive.
3. Run `python3 pinata_upload.py --verify --upload-collection`.
4. The uploader pins `images/` to **public IPFS**, verifies first/last files,
   substitutes the returned CID, then pins `metadata-final/`. It can optionally
   pin the finalized collection-level JSON. `--verify` checks every remote file.
5. Retain `pinata-result.json` and the checkpoint. On retries, reuse this exact
   source package; altered source fingerprints are rejected.

The metadata base URI will be `ipfs://<METADATA_CID>/` with padded suffixes such
as `001.json`. The future contract must pad `tokenURI` filenames; using the
usual unpadded `1.json` would fail. The SVG sources are included for preservation;
the upload workflow publishes PNGs and their metadata. Vectors can be pinned
separately later if desired. Metadata templates are intentionally not uploaded.
Check the account's file/storage limits for the 990 child files; directory pins
do not necessarily bypass plan limits. Public IPFS content may be copied by
third parties, and unpinning does not guarantee its removal from the network.

To reproduce images and templates:
`python3 generate_collection.py --source evidence/normalized-shards.json --output ../GH0ST-Genesis-reproduced`
Byte-identical PNGs also require matching Pillow/runtime versions; the PNG
checksums in the supplied inventory are authoritative for this release.
