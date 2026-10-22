# Publish GH0ST Genesis assets

`pinata_upload.py` uses only Python's standard library. It publishes artwork and metadata to public IPFS; it does not deploy an NFT contract, mint an NFT, burn GH0ST, or change the model.

## Required package layout

```
images/001.png ... images/495.png
metadata-templates/001.json ... metadata-templates/495.json
collection-template.json          # optional
pinata_upload.py
```

Each metadata template must have an `image` field exactly `ipfs://__IMAGE_CID__/001.png` for token 1, continuing through 495. `__IMAGE_CID__` is replaced only after the actual image-directory CID is received. Collection metadata may use `__IMAGE_CID__` and `__METADATA_CID__`. Unresolved templates are never uploaded.

Token IDs are **1–495**, with three-digit filenames. A future NFT contract's `tokenURI` must zero-pad its ID (`1` becomes `001.json`). A plain concatenation that produces `1.json` will not work with this package.

## Validate without credentials

```
python3 pinata_upload.py --dry-run
```

The validator checks exact file counts, PNG signatures, unique PNG hashes, valid JSON, required metadata fields, expected image filenames, and the checkpoint's source fingerprint. It does not prove the contents of a model shard independently; the collection's evidence records provide that provenance.

## Upload after authentication is available

Provide a Pinata JWT through the `PINATA_JWT` environment variable using a protected secret input. Do not paste it into a script, commit it, pass it on the command line, or include it in an archive.

```
python3 pinata_upload.py --verify --upload-collection
```

The JWT needs permission to pin files using Pinata's public IPFS pinning API and the account needs sufficient storage, file-count and request quota. The script never logs or persists the JWT. This package is about **990 child files** (495 PNGs plus 495 JSONs), even though they are sent as two directory requests. Folder uploads should not be assumed to bypass your plan's file-count limits. Collection JSON is one additional optional pin.

The script performs these steps in order:

1. Pins one directory containing all 495 PNGs.
2. Fetches the first and last image by their final CID paths and verifies their bytes before finalizing any JSON.
3. Writes `metadata-final/`, using the real `ipfs://` image paths.
4. Pins the finalized JSON directory and checks its first and last paths.
5. Writes `collection-final.json`; `--upload-collection` also pins that JSON file.
6. With `--verify`, downloads every PNG and JSON with at most four concurrent reads and compares its SHA-256 to the local file.

`pinata-result.json` records the real CIDs, metadata base URI, token URI format, source fingerprint and verification status. No CID is invented in advance.

## Resume and verify

`.pinata-upload-state.json` stores completed stages and file fingerprints. Rerun the same command to resume. A partial directory transfer restarts that directory; it is not a byte-resumable TUS transfer. A metadata retry reuses the completed image pin. Reuploading identical content can produce the same CID.

```
python3 pinata_upload.py --verify-only
```

`--verify-only` makes no uploads and needs no JWT. To use your own Pinata gateway, append `--gateway https://YOUR-GATEWAY.mypinata.cloud/ipfs`; no authentication is sent to gateway reads. Public-IPFS gateway propagation or throttling can temporarily delay verification; rerun after availability recovers.

The script refuses to resume if the artwork, templates, collection template, count or endpoint differ from the saved source fingerprint. Keep the checkpoint with the exact published package. If a deliberate new version is needed, use a separate package directory; do not silently reuse the old state.

## API choice and limits

The official current [folder guide](https://docs.pinata.cloud/files/uploading-files#folders) states that folder uploads use the legacy `https://api.pinata.cloud/pinning/pinFileToIPFS` endpoint and public IPFS. Each file is a repeated multipart `file` field with a preserved filename. The uploader explicitly requests CIDv1 and directory wrapping.

The [endpoint reference](https://docs.pinata.cloud/api-reference/endpoint/ipfs/pin-file-to-ipfs) documents Bearer JWT authentication and returns `IpfsHash`, `PinSize` and `Timestamp`. Pinata's [official SDK documentation](https://github.com/PinataCloud/Pinata-SDK#pinata-options) documents `wrapWithDirectory`.

The [current upload guide](https://docs.pinata.cloud/files/uploading-files#resumable-uploads) says files over 100 MB on V3 require TUS or the legacy endpoint; folders still use the legacy endpoint. V3 also defaults to **private** unless `network=public` is supplied. This uploader uses the explicitly public legacy folder API, not the private default. It does not use CAR uploads, which require a paid plan.

`--max-upload-bytes` defaults to a **local safety ceiling of 1 GiB per folder**. That is not a claim that a particular Pinata plan permits 1 GiB uploads. Check [current account limits](https://pinata.cloud/pricing) before publishing. The multipart request is built in a private temporary disk file, streamed during upload and deleted afterward, so allow temporary disk space at least equal to the largest folder.

API failures 429/500/502/503/504 and interrupted transfers use bounded retries with short exponential backoff. Other API errors stop. Upload redirects are rejected so that a Bearer credential is never forwarded to another host. Errors show status codes, not raw request/response objects.

Documentation checked: 21 October 2026.
